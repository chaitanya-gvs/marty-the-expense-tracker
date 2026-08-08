"""
Tests for StatementLogOperations.
Run from backend/ with: poetry run pytest tests/test_statement_log_operations.py -v
"""
import pytest
from sqlalchemy import text

from src.services.database_manager.connection import get_session_factory
from src.services.database_manager.operations.statement_log_operations import StatementLogOperations


@pytest.fixture(autouse=True)
async def _cleanup_engine():
    """Dispose the shared DB engine after each test in this file — avoids the
    'Event loop is closed' asyncpg cleanup race when pytest-asyncio tears down
    the per-test event loop while the shared connection pool is still open."""
    yield
    from src.services.database_manager.connection import close_engine
    try:
        await close_engine()
    except Exception:
        pass


async def _insert_log_row(normalized_filename: str, statement_month: str, status: str) -> None:
    session_factory = get_session_factory()
    async with session_factory() as session:
        await session.execute(
            text("""
                INSERT INTO statement_processing_log (normalized_filename, statement_month, status)
                VALUES (:normalized_filename, :statement_month, :status)
                ON CONFLICT (normalized_filename) DO UPDATE
                SET statement_month = EXCLUDED.statement_month, status = EXCLUDED.status
            """),
            {"normalized_filename": normalized_filename, "statement_month": statement_month, "status": status},
        )
        await session.commit()


async def _delete_log_row(normalized_filename: str) -> None:
    session_factory = get_session_factory()
    async with session_factory() as session:
        await session.execute(
            text("DELETE FROM statement_processing_log WHERE normalized_filename = :normalized_filename"),
            {"normalized_filename": normalized_filename},
        )
        await session.commit()


@pytest.mark.asyncio
async def test_get_pending_statement_months_returns_non_db_inserted_months():
    """Months with a non-db_inserted row are returned; a purely db_inserted month is not."""
    filenames = [
        ("test_fixture_pending_202405", "2024-05", "csv_stored"),
        ("test_fixture_pending_202406", "2024-06", "csv_extracted"),
        ("test_fixture_pending_202407", "2024-07", "db_inserted"),
    ]
    try:
        for fname, month, status in filenames:
            await _insert_log_row(fname, month, status)

        months = await StatementLogOperations.get_pending_statement_months()

        assert "2024-05" in months
        assert "2024-06" in months
        assert "2024-07" not in months
    finally:
        for fname, _, _ in filenames:
            await _delete_log_row(fname)


@pytest.mark.asyncio
async def test_get_pending_statement_months_orders_chronologically():
    """Returned months are sorted oldest first."""
    filenames = [
        ("test_fixture_order_202408", "2024-08", "csv_stored"),
        ("test_fixture_order_202401", "2024-01", "csv_stored"),
    ]
    try:
        for fname, month, status in filenames:
            await _insert_log_row(fname, month, status)

        months = await StatementLogOperations.get_pending_statement_months()

        idx_jan = months.index("2024-01")
        idx_aug = months.index("2024-08")
        assert idx_jan < idx_aug
    finally:
        for fname, _, _ in filenames:
            await _delete_log_row(fname)


@pytest.mark.asyncio
async def test_get_pending_statement_months_includes_incomplete_only_month():
    """A month whose only row is at an incomplete status (csv_extracted, before
    db_inserted) is still included (no special-casing — it will be processed
    by the next run if CSVs are present in GCS)."""
    fname, month = "test_fixture_incomplete_202409", "2024-09"
    try:
        await _insert_log_row(fname, month, "csv_extracted")

        months = await StatementLogOperations.get_pending_statement_months()

        assert month in months
    finally:
        await _delete_log_row(fname)
