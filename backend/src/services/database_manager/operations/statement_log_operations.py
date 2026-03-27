from __future__ import annotations

from typing import List, Optional

from sqlalchemy import text

from ..connection import get_session_factory
from src.utils.logger import get_logger

logger = get_logger(__name__)

# Ordered list used to determine whether a status is "earlier" or "later" in the pipeline.
_STATUS_ORDER = [
    "downloaded",
    "pdf_unlocked",
    "pdf_stored",
    "csv_extracted",
    "csv_stored",
    "db_inserted",
]


def _status_rank(status: str) -> int:
    try:
        return _STATUS_ORDER.index(status)
    except ValueError:
        return -1


class StatementLogOperations:
    """DB operations for the statement_processing_log table.

    All callers (workflow, backfill script) must use these methods exclusively —
    no inline SQL or ORM calls against this table elsewhere.
    """

    @staticmethod
    async def upsert_log(data: dict) -> dict:
        """Insert a new row or update an existing one on normalized_filename conflict.

        The status is never downgraded: if the row already exists at a later step,
        the status column is left unchanged.  All other supplied fields are written.
        """
        session_factory = get_session_factory()
        async with session_factory() as session:
            try:
                normalized_filename = data.get("normalized_filename")
                if not normalized_filename:
                    return {"success": False, "error": "normalized_filename is required"}

                new_status = data.get("status", "downloaded")

                await session.execute(
                    text("""
                        INSERT INTO statement_processing_log (
                            normalized_filename, account_id, account_nickname,
                            sender_email, email_date, statement_month,
                            status, unlocked_cloud_path, csv_cloud_path,
                            transaction_count, db_inserted_count, last_error,
                            job_id, created_at, updated_at
                        ) VALUES (
                            :normalized_filename, :account_id, :account_nickname,
                            :sender_email, :email_date, :statement_month,
                            :status, :unlocked_cloud_path, :csv_cloud_path,
                            :transaction_count, :db_inserted_count, :last_error,
                            :job_id, now(), now()
                        )
                        ON CONFLICT (normalized_filename) DO UPDATE SET
                            account_id          = COALESCE(:account_id, statement_processing_log.account_id),
                            account_nickname    = COALESCE(:account_nickname, statement_processing_log.account_nickname),
                            sender_email        = COALESCE(:sender_email, statement_processing_log.sender_email),
                            email_date          = COALESCE(:email_date, statement_processing_log.email_date),
                            statement_month     = COALESCE(:statement_month, statement_processing_log.statement_month),
                            status              = CASE
                                WHEN array_position(
                                    ARRAY['downloaded','pdf_unlocked','pdf_stored','csv_extracted','csv_stored','db_inserted'],
                                    :status
                                ) > array_position(
                                    ARRAY['downloaded','pdf_unlocked','pdf_stored','csv_extracted','csv_stored','db_inserted'],
                                    statement_processing_log.status
                                ) THEN :status
                                ELSE statement_processing_log.status
                            END,
                            unlocked_cloud_path = COALESCE(:unlocked_cloud_path, statement_processing_log.unlocked_cloud_path),
                            csv_cloud_path      = COALESCE(:csv_cloud_path, statement_processing_log.csv_cloud_path),
                            transaction_count   = COALESCE(:transaction_count, statement_processing_log.transaction_count),
                            db_inserted_count   = COALESCE(:db_inserted_count, statement_processing_log.db_inserted_count),
                            last_error          = COALESCE(:last_error, statement_processing_log.last_error),
                            job_id              = COALESCE(:job_id, statement_processing_log.job_id),
                            updated_at          = now()
                    """),
                    {
                        "normalized_filename": normalized_filename,
                        "account_id": data.get("account_id"),
                        "account_nickname": data.get("account_nickname"),
                        "sender_email": data.get("sender_email"),
                        "email_date": data.get("email_date"),
                        "statement_month": data.get("statement_month"),
                        "status": new_status,
                        "unlocked_cloud_path": data.get("unlocked_cloud_path"),
                        "csv_cloud_path": data.get("csv_cloud_path"),
                        "transaction_count": data.get("transaction_count"),
                        "db_inserted_count": data.get("db_inserted_count"),
                        "last_error": data.get("last_error"),
                        "job_id": data.get("job_id"),
                    },
                )
                await session.commit()
                return {"success": True, "normalized_filename": normalized_filename}

            except Exception as e:
                await session.rollback()
                logger.error("Failed to upsert statement log for %s", data.get('normalized_filename'), exc_info=True)
                return {"success": False, "error": str(e)}

    @staticmethod
    async def register_csv_upload(
        normalized_filename: str,
        statement_month: str,
        account_nickname: str,
        csv_cloud_path: Optional[str] = None,
        transaction_count: Optional[int] = None,
    ) -> dict:
        """
        Register a CSV upload in statement_processing_log. Call this after any script
        uploads a CSV to GCS so the workflow skip logic will exclude it on future runs.

        Example (from scripts that upload CSVs):
            await StatementLogOperations.register_csv_upload(
                normalized_filename="sbi_20260312",
                statement_month="2026-02",
                account_nickname="SBI Savings",
                csv_cloud_path="2026-02/extracted_data/sbi_20260312.csv",
                transaction_count=45,
            )
        """
        return await StatementLogOperations.upsert_log({
            "normalized_filename": normalized_filename,
            "statement_month": statement_month,
            "account_nickname": account_nickname,
            "status": "db_inserted",
            "csv_cloud_path": csv_cloud_path,
            "transaction_count": transaction_count,
        })

    @staticmethod
    async def update_status(normalized_filename: str, status: str, **extra_fields) -> bool:
        """Advance the status and optionally set extra columns (e.g. unlocked_cloud_path).

        Only advances the status — never downgrades it.
        """
        session_factory = get_session_factory()
        async with session_factory() as session:
            try:
                allowed_extra = {
                    "unlocked_cloud_path", "csv_cloud_path",
                    "transaction_count", "db_inserted_count", "job_id",
                }
                set_clauses = [
                    """
                    status = CASE
                        WHEN array_position(
                            ARRAY['downloaded','pdf_unlocked','pdf_stored','csv_extracted','csv_stored','db_inserted'],
                            :status
                        ) > array_position(
                            ARRAY['downloaded','pdf_unlocked','pdf_stored','csv_extracted','csv_stored','db_inserted'],
                            status
                        ) THEN :status
                        ELSE status
                    END
                    """,
                    "last_error = NULL",
                    "updated_at = now()",
                ]
                params: dict = {"normalized_filename": normalized_filename, "status": status}

                for key, value in extra_fields.items():
                    if key in allowed_extra:
                        set_clauses.append(f"{key} = :{key}")
                        params[key] = value

                sql = f"""
                    UPDATE statement_processing_log
                    SET {", ".join(set_clauses)}
                    WHERE normalized_filename = :normalized_filename
                """
                await session.execute(text(sql), params)
                await session.commit()
                return True

            except Exception:
                await session.rollback()
                logger.error("Failed to update status for %s", normalized_filename, exc_info=True)
                return False

    @staticmethod
    async def set_error(normalized_filename: str, error: str) -> bool:
        """Record a failure message without changing the status."""
        session_factory = get_session_factory()
        async with session_factory() as session:
            try:
                await session.execute(
                    text("""
                        UPDATE statement_processing_log
                        SET last_error = :error, updated_at = now()
                        WHERE normalized_filename = :normalized_filename
                    """),
                    {"normalized_filename": normalized_filename, "error": error},
                )
                await session.commit()
                return True

            except Exception:
                await session.rollback()
                logger.error("Failed to set error for %s", normalized_filename, exc_info=True)
                return False

    @staticmethod
    async def check_sender_fully_complete(sender_email: str, statement_month: str) -> bool:
        """Return True if every known statement for a sender in a month has status db_inserted."""
        session_factory = get_session_factory()
        async with session_factory() as session:
            try:
                result = await session.execute(
                    text("""
                        SELECT
                            COUNT(*) AS total,
                            COUNT(*) FILTER (WHERE status = 'db_inserted') AS done
                        FROM statement_processing_log
                        WHERE sender_email = :sender_email
                          AND statement_month = :statement_month
                    """),
                    {"sender_email": sender_email, "statement_month": statement_month},
                )
                row = result.fetchone()
                if row is None or row.total == 0:
                    return False
                return row.total == row.done

            except Exception:
                logger.error(
                    "Failed to check sender completion for %s / %s",
                    sender_email,
                    statement_month,
                    exc_info=True,
                )
                return False

    @staticmethod
    async def check_already_extracted(normalized_filename: str) -> bool:
        """Return True if the statement has already reached csv_extracted or beyond."""
        session_factory = get_session_factory()
        async with session_factory() as session:
            try:
                result = await session.execute(
                    text("""
                        SELECT status FROM statement_processing_log
                        WHERE normalized_filename = :normalized_filename
                    """),
                    {"normalized_filename": normalized_filename},
                )
                row = result.fetchone()
                if row is None:
                    return False
                return row.status in ("csv_extracted", "csv_stored", "db_inserted")

            except Exception:
                logger.error("Failed to check extraction status for %s", normalized_filename, exc_info=True)
                return False

    @staticmethod
    async def get_incomplete_statements(statement_month: str) -> List[dict]:
        """Return all rows for a month that have not yet reached db_inserted."""
        session_factory = get_session_factory()
        async with session_factory() as session:
            try:
                result = await session.execute(
                    text("""
                        SELECT
                            id, normalized_filename, account_id, account_nickname,
                            sender_email, email_date, statement_month,
                            status, unlocked_cloud_path, csv_cloud_path,
                            transaction_count, db_inserted_count, last_error,
                            job_id, created_at, updated_at
                        FROM statement_processing_log
                        WHERE statement_month = :statement_month
                          AND status != 'db_inserted'
                        ORDER BY created_at
                    """),
                    {"statement_month": statement_month},
                )
                rows = result.fetchall()
                return [dict(row._mapping) for row in rows]

            except Exception:
                logger.error("Failed to fetch incomplete statements for %s", statement_month, exc_info=True)
                return []

    @staticmethod
    async def get_by_month(statement_month: str) -> List[dict]:
        """Return all rows for a given billing month, ordered by created_at."""
        session_factory = get_session_factory()
        async with session_factory() as session:
            try:
                result = await session.execute(
                    text("""
                        SELECT
                            id, normalized_filename, account_id, account_nickname,
                            sender_email, email_date, statement_month,
                            status, unlocked_cloud_path, csv_cloud_path,
                            transaction_count, db_inserted_count, last_error,
                            job_id, created_at, updated_at
                        FROM statement_processing_log
                        WHERE statement_month = :statement_month
                        ORDER BY created_at
                    """),
                    {"statement_month": statement_month},
                )
                rows = result.fetchall()
                return [dict(row._mapping) for row in rows]

            except Exception:
                logger.error("Failed to fetch statements for month %s", statement_month, exc_info=True)
                return []

    @staticmethod
    async def get_db_inserted_filenames(statement_month: str) -> set:
        """Return the set of normalized_filenames that are already at db_inserted for a given month.

        Used by the standardization step to skip CSVs whose transactions have already been
        inserted into the database, preventing duplicate insertions on workflow reruns.
        """
        session_factory = get_session_factory()
        async with session_factory() as session:
            try:
                result = await session.execute(
                    text("""
                        SELECT normalized_filename
                        FROM statement_processing_log
                        WHERE statement_month = :statement_month
                          AND status = 'db_inserted'
                    """),
                    {"statement_month": statement_month},
                )
                rows = result.fetchall()
                return {row[0] for row in rows}
            except Exception:
                logger.error(
                    "Failed to fetch db_inserted filenames for %s", statement_month, exc_info=True
                )
                return set()

    @staticmethod
    async def clear_all() -> int:
        """Delete all rows from statement_processing_log. Returns row count deleted."""
        session_factory = get_session_factory()
        async with session_factory() as session:
            try:
                result = await session.execute(text("DELETE FROM statement_processing_log"))
                await session.commit()
                return result.rowcount
            except Exception:
                await session.rollback()
                logger.error("Error clearing statement_processing_log", exc_info=True)
                return 0
