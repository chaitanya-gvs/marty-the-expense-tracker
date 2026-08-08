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
from src.services.database_manager.operations.review_queue_operations import ReviewQueueOperations


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


async def _insert_review_item(review_type, candidate_ids, **overrides) -> str:
    defaults = {
        "review_type": review_type,
        "transaction_date": date(2026, 1, 20),
        "amount": Decimal("500.00"),
        "description": "Test review fixture",
        "account": "Test Fixture Account",
        "direction": "debit",
        "transaction_type": "debit",
        "ambiguous_candidate_ids": candidate_ids,
    }
    defaults.update(overrides)
    session_factory = get_session_factory()
    async with session_factory() as session:
        result = await session.execute(
            text("""
                INSERT INTO review_queue
                    (review_type, transaction_date, amount, description, account,
                     direction, transaction_type, ambiguous_candidate_ids)
                VALUES
                    (:review_type, :transaction_date, :amount, :description, :account,
                     :direction, :transaction_type, :ambiguous_candidate_ids)
                RETURNING id
            """),
            defaults,
        )
        await session.commit()
        return str(result.scalar())


async def _delete_review_item(item_id: str) -> None:
    session_factory = get_session_factory()
    async with session_factory() as session:
        await session.execute(text("DELETE FROM review_queue WHERE id = :id"), {"id": item_id})
        await session.commit()


@pytest.mark.asyncio
async def test_remove_candidate_from_others_strips_claimed_id():
    # Clean up any leftover test data from previous runs
    session_factory = get_session_factory()
    async with session_factory() as session:
        await session.execute(text("DELETE FROM review_queue WHERE account = 'Test Fixture Account'"))
        await session.commit()

    shared_candidate = "11111111-1111-1111-1111-111111111111"
    other_candidate = "22222222-2222-2222-2222-222222222222"
    item_a = await _insert_review_item("ambiguous", [shared_candidate, other_candidate], amount=Decimal("500.00"))
    item_b = await _insert_review_item("ambiguous", [shared_candidate], description="Other fixture", amount=Decimal("600.00"))
    try:
        await ReviewQueueOperations.remove_candidate_from_others(shared_candidate, exclude_item_id=item_a)

        items = await ReviewQueueOperations.get_unresolved("ambiguous")
        a = next(i for i in items if str(i["id"]) == item_a)
        b = next(i for i in items if str(i["id"]) == item_b)

        # item_a is the one being resolved right now — untouched by the sweep.
        assert shared_candidate in a["ambiguous_candidate_ids"]
        # item_b had the now-claimed candidate stripped.
        assert shared_candidate not in b["ambiguous_candidate_ids"]
    finally:
        await _delete_review_item(item_a)
        await _delete_review_item(item_b)


@pytest.mark.asyncio
async def test_remove_candidate_from_others_ignores_resolved_items():
    # Clean up any leftover test data from previous runs
    session_factory = get_session_factory()
    async with session_factory() as session:
        await session.execute(text("DELETE FROM review_queue WHERE account = 'Test Fixture Account'"))
        await session.commit()

    shared_candidate = "33333333-3333-3333-3333-333333333333"
    item_a = await _insert_review_item("ambiguous", [shared_candidate], amount=Decimal("750.00"))
    item_b = await _insert_review_item("ambiguous", [shared_candidate], description="Resolved fixture", amount=Decimal("850.00"))
    try:
        await ReviewQueueOperations.resolve(item_b, "confirmed")
        await ReviewQueueOperations.remove_candidate_from_others(shared_candidate, exclude_item_id=item_a)

        session_factory = get_session_factory()
        async with session_factory() as session:
            result = await session.execute(
                text("SELECT ambiguous_candidate_ids FROM review_queue WHERE id = :id"),
                {"id": item_b},
            )
            row = result.first()
        # Resolved items are untouched even if they still list the candidate.
        assert shared_candidate in row[0]
    finally:
        await _delete_review_item(item_a)
        await _delete_review_item(item_b)
