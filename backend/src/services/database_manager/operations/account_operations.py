from __future__ import annotations

from typing import List, Optional

from sqlalchemy import text

from ..connection import get_session_factory
from src.utils.logger import get_logger

logger = get_logger(__name__)


class AccountOperations:
    """Operations for managing bank accounts"""

    @staticmethod
    async def get_all_accounts() -> List[dict]:
        """Get all active bank accounts"""
        try:
            session_factory = get_session_factory()
            async with session_factory() as session:
                result = await session.execute(
                    text("""
                        SELECT
                            id, account_number, account_type, bank_name, card_type,
                            nickname, notes, statement_sender, statement_password,
                            last_statement_date, last_processed_at, credit_limit,
                            available_credit, due_date, billing_cycle_start,
                            is_active, created_at, updated_at,
                            alert_sender, alert_last_processed_at
                        FROM accounts
                        WHERE is_active = true
                        ORDER BY account_type, bank_name
                    """)
                )
                rows = result.fetchall()
                accounts = [dict(row._mapping) for row in rows]
                logger.info("Retrieved %d active accounts", len(accounts))
                return accounts
        except Exception:
            logger.error("Failed to retrieve all accounts", exc_info=True)
            raise

    @staticmethod
    async def get_accounts_by_type(account_type: str) -> List[dict]:
        """Get accounts by type (credit_card, savings, current)"""
        try:
            session_factory = get_session_factory()
            async with session_factory() as session:
                result = await session.execute(
                    text("""
                        SELECT * FROM accounts
                        WHERE account_type = :account_type AND is_active = true
                        ORDER BY bank_name
                    """), {"account_type": account_type}
                )
                rows = result.fetchall()
                accounts = [dict(row._mapping) for row in rows]
                logger.info("Retrieved %d accounts of type %s", len(accounts), account_type)
                return accounts
        except Exception:
            logger.error("Failed to retrieve accounts by type %s", account_type, exc_info=True)
            raise

    @staticmethod
    async def get_credit_cards() -> List[dict]:
        """Get all credit card accounts"""
        return await AccountOperations.get_accounts_by_type("credit_card")

    @staticmethod
    async def get_bank_accounts() -> List[dict]:
        """Get all savings and current accounts"""
        session_factory = get_session_factory()
        async with session_factory() as session:
            result = await session.execute(
                text("""
                    SELECT * FROM accounts
                    WHERE account_type IN ('savings', 'current') AND is_active = true
                    ORDER BY account_type, bank_name
                """)
            )
            rows = result.fetchall()
            return [dict(row._mapping) for row in rows]

    @staticmethod
    async def get_account_by_statement_sender(email: str) -> Optional[dict]:
        """Get account by statement sender email (handles comma-separated senders)"""
        session_factory = get_session_factory()
        async with session_factory() as session:
            # First try exact match
            result = await session.execute(
                text("""
                    SELECT * FROM accounts
                    WHERE statement_sender = :email AND is_active = true
                """), {"email": email}
            )
            row = result.fetchone()
            if row:
                return dict(row._mapping)

            # If no exact match, try comma-separated senders
            result = await session.execute(
                text("""
                    SELECT * FROM accounts
                    WHERE statement_sender LIKE :email_pattern AND is_active = true
                """), {"email_pattern": f"%{email}%"}
            )
            row = result.fetchone()
            return dict(row._mapping) if row else None

    @staticmethod
    async def get_account_by_id(account_id: str) -> Optional[dict]:
        """Get account by ID"""
        session_factory = get_session_factory()
        async with session_factory() as session:
            result = await session.execute(
                text("""
                    SELECT * FROM accounts
                    WHERE id = :account_id AND is_active = true
                """), {"account_id": account_id}
            )
            row = result.fetchone()
            return dict(row._mapping) if row else None

    @staticmethod
    async def update_last_statement_date(account_id: str, statement_date) -> bool:
        """Update the last statement date for an account"""
        session_factory = get_session_factory()
        async with session_factory() as session:
            result = await session.execute(
                text("""
                    UPDATE accounts
                    SET last_statement_date = :statement_date,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE id = :account_id
                """), {
                    "account_id": account_id,
                    "statement_date": statement_date
                }
            )
            await session.commit()
            return result.rowcount > 0

    @staticmethod
    async def update_alert_last_processed_at(account_id: str) -> bool:
        """Update the alert last processed timestamp for an account"""
        session_factory = get_session_factory()
        async with session_factory() as session:
            result = await session.execute(
                text("""
                    UPDATE accounts
                    SET alert_last_processed_at = CURRENT_TIMESTAMP,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE id = :account_id
                """), {"account_id": account_id}
            )
            await session.commit()
            return result.rowcount > 0

    @staticmethod
    async def update_last_processed_at(account_id: str) -> bool:
        """Update the last processed timestamp for an account"""
        session_factory = get_session_factory()
        async with session_factory() as session:
            result = await session.execute(
                text("""
                    UPDATE accounts
                    SET last_processed_at = CURRENT_TIMESTAMP,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE id = :account_id
                """), {"account_id": account_id}
            )
            await session.commit()
            return result.rowcount > 0

    @staticmethod
    async def get_account_nickname_by_sender(sender_email: str) -> Optional[str]:
        """Get account nickname by statement sender email (handles comma-separated senders)"""
        info = await AccountOperations.get_account_by_sender_email(sender_email)
        return info.get("nickname") if info else None

    @staticmethod
    async def get_account_by_sender_email(sender_email: str) -> Optional[dict]:
        """Get account id and nickname by statement sender email (handles comma-separated senders).

        Returns a dict with ``id`` and ``nickname`` keys, or ``None`` if not found.
        """
        session_factory = get_session_factory()
        async with session_factory() as session:
            # First try exact match
            result = await session.execute(
                text("""
                    SELECT id, nickname FROM accounts
                    WHERE statement_sender = :sender_email AND is_active = true
                """), {"sender_email": sender_email}
            )
            row = result.fetchone()
            if row:
                return {"id": row[0], "nickname": row[1]}

            # If no exact match, try comma-separated senders
            result = await session.execute(
                text("""
                    SELECT id, nickname FROM accounts
                    WHERE statement_sender LIKE :sender_pattern AND is_active = true
                """), {"sender_pattern": f"%{sender_email}%"}
            )
            row = result.fetchone()
            return {"id": row[0], "nickname": row[1]} if row else None

    @staticmethod
    async def get_all_statement_senders() -> List[str]:
        """Get all unique statement sender emails from active accounts"""
        session_factory = get_session_factory()
        async with session_factory() as session:
            result = await session.execute(
                text("""
                    SELECT DISTINCT statement_sender
                    FROM accounts
                    WHERE statement_sender IS NOT NULL
                    AND statement_sender != ''
                    AND is_active = true
                    ORDER BY statement_sender
                """)
            )
            rows = result.fetchall()
            return [row[0] for row in rows if row[0]]

    @staticmethod
    async def get_account_nickname_by_pattern(search_pattern: str) -> Optional[str]:
        """Get account nickname by search pattern (partial match).
        Tries exact pattern first, then pattern with underscores as wildcards for flexibility
        with {account}_{date} filenames (e.g. yes_bank matches 'Yes Bank Savings').
        """
        session_factory = get_session_factory()
        async with session_factory() as session:
            result = await session.execute(
                text("""
                    SELECT nickname FROM accounts
                    WHERE LOWER(nickname) LIKE LOWER(:pattern)
                    AND is_active = true
                    LIMIT 1
                """), {"pattern": f"%{search_pattern}%"}
            )
            row = result.fetchone()
            if row:
                return row[0]
            # Fallback: try with underscores as space/wildcard (yes_bank -> %yes%bank%)
            alt_pattern = "%".join(search_pattern.split("_"))
            result = await session.execute(
                text("""
                    SELECT nickname FROM accounts
                    WHERE LOWER(nickname) LIKE LOWER(:pattern)
                    AND is_active = true
                    LIMIT 1
                """), {"pattern": f"%{alt_pattern}%"}
            )
            row = result.fetchone()
            return row[0] if row else None


# Convenience functions for backward compatibility
async def get_all_bank_accounts() -> List[dict]:
    """Get all bank accounts (backward compatibility)"""
    return await AccountOperations.get_all_accounts()


async def get_credit_card_accounts() -> List[dict]:
    """Get all credit card accounts (backward compatibility)"""
    return await AccountOperations.get_credit_cards()


async def get_account_by_email(email: str) -> Optional[dict]:
    """Get account by statement sender email (backward compatibility)"""
    return await AccountOperations.get_account_by_statement_sender(email)
