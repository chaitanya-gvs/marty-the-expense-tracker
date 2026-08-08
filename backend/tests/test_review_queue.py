"""
Tests for review-queue-adjacent operations helpers.
Run from backend/ with: poetry run pytest tests/test_review_queue.py -v
"""
import pytest
from datetime import date
from decimal import Decimal
from sqlalchemy import text

from src.services.database_manager.connection import get_session_factory
from src.services.database_manager.models.transaction import Transaction
from src.services.database_manager.operations.transaction_operations import TransactionOperations


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


async def _insert_test_transaction(**overrides) -> str:
    """Insert a minimal transaction row for fixture purposes, return its id."""
    defaults = {
        "transaction_date": date(2026, 1, 15),
        "amount": Decimal("199.00"),
        "direction": "debit",
        "transaction_type": "purchase",
        "description": "Test Fixture Txn",
        "account": "Test Fixture Account",
        "transaction_source": "email_ingestion",
    }
    defaults.update(overrides)
    session_factory = get_session_factory()
    async with session_factory() as session:
        txn = Transaction(
            transaction_date=defaults["transaction_date"],
            amount=defaults["amount"],
            direction=defaults["direction"],
            transaction_type=defaults["transaction_type"],
            description=defaults["description"],
            account=defaults["account"],
            transaction_source=defaults["transaction_source"],
        )
        session.add(txn)
        await session.commit()
        return str(txn.id)


async def _delete_test_transaction(transaction_id: str) -> None:
    session_factory = get_session_factory()
    async with session_factory() as session:
        await session.execute(
            text("DELETE FROM transactions WHERE id = :id"), {"id": transaction_id}
        )
        await session.commit()


@pytest.mark.asyncio
async def test_exists_matching_true_when_row_present():
    tx_id = await _insert_test_transaction()
    try:
        found = await TransactionOperations.exists_matching(
            account="Test Fixture Account",
            amount=Decimal("199.00"),
            transaction_date=date(2026, 1, 15),
            direction="debit",
        )
        assert found is True
    finally:
        await _delete_test_transaction(tx_id)


@pytest.mark.asyncio
async def test_exists_matching_false_when_no_row():
    found = await TransactionOperations.exists_matching(
        account="Nonexistent Account XYZ",
        amount=Decimal("1.00"),
        transaction_date=date(2026, 1, 1),
        direction="debit",
    )
    assert found is False


@pytest.mark.asyncio
async def test_exists_matching_ignores_soft_deleted_rows():
    tx_id = await _insert_test_transaction(description="Soft Deleted Fixture")
    try:
        await TransactionOperations.delete_transaction(tx_id)
        found = await TransactionOperations.exists_matching(
            account="Test Fixture Account",
            amount=Decimal("199.00"),
            transaction_date=date(2026, 1, 15),
            direction="debit",
        )
        assert found is False
    finally:
        await _delete_test_transaction(tx_id)
