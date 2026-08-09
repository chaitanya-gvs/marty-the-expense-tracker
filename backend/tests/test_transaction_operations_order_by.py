"""
Tests for TransactionOperations order_by validation.
Run from backend/ with: poetry run pytest tests/test_transaction_operations_order_by.py -v
"""
import pytest
from datetime import date

from src.services.database_manager.operations.transaction_operations import TransactionOperations


@pytest.fixture(autouse=True)
async def _cleanup_engine():
    """Dispose the shared DB engine after each test — matches the pattern in
    test_statement_log_operations.py to avoid the asyncpg event-loop-closed race."""
    yield
    from src.services.database_manager.connection import close_engine
    try:
        await close_engine()
    except Exception:
        pass


class TestGetAllTransactionsOrderBy:
    async def test_rejects_sql_injection_attempt(self):
        with pytest.raises(ValueError):
            await TransactionOperations.get_all_transactions(
                order_by="ASC; DROP TABLE transactions; --"
            )

    async def test_rejects_arbitrary_string(self):
        with pytest.raises(ValueError):
            await TransactionOperations.get_all_transactions(order_by="banana")

    async def test_accepts_asc(self):
        # Should not raise; returns a list (possibly empty depending on DB state)
        result = await TransactionOperations.get_all_transactions(order_by="ASC", limit=1)
        assert isinstance(result, list)

    async def test_accepts_desc(self):
        result = await TransactionOperations.get_all_transactions(order_by="DESC", limit=1)
        assert isinstance(result, list)

    async def test_accepts_lowercase(self):
        # Case-insensitive: callers may pass "asc"/"desc"
        result = await TransactionOperations.get_all_transactions(order_by="asc", limit=1)
        assert isinstance(result, list)


class TestGetTransactionsByDateRangeOrderBy:
    async def test_rejects_sql_injection_attempt(self):
        with pytest.raises(ValueError):
            await TransactionOperations.get_transactions_by_date_range(
                start_date=date(2026, 1, 1),
                end_date=date(2026, 1, 31),
                order_by="ASC, (SELECT 1) --",
            )

    async def test_accepts_desc(self):
        result = await TransactionOperations.get_transactions_by_date_range(
            start_date=date(2026, 1, 1),
            end_date=date(2026, 1, 31),
            order_by="DESC",
            limit=1,
        )
        assert isinstance(result, list)
