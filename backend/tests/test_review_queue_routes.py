"""
Route-level tests for the review-queue endpoints.
Run from backend/ with: poetry run pytest tests/test_review_queue_routes.py -v

Note on async DB helpers vs. TestClient (read before adding more tests here):
`TestClient` (starlette) runs every HTTP call through a persistent
`anyio.from_thread.start_blocking_portal()` thread/event-loop set up once by the
module-scoped `client` fixture's `with TestClient(app) as c:` block — that portal's
loop is where the app's own DB access actually executes for the whole module.
The `_insert_transaction` / `_insert_review_item` / `_cleanup` / `_fetch_transaction`
helpers below are `async def` but must NEVER be `await`-ed directly from an
`async def test_...` under `@pytest.mark.asyncio` (pytest-asyncio gives each such
test its own, different, per-test event loop). Doing so puts a connection bound to
that per-test loop into the process-wide async engine pool
(`src/services/database_manager/connection.py` is a module-level singleton), and when
the app later checks it out from the portal's loop, asyncpg raises
`RuntimeError: ... attached to a different loop`, surfacing as a 500 on the very next
`client.*()` call in the same test.

Instead, always dispatch these helpers through the same portal the app uses, via the
`_run(client, fn, *args, **kwargs)` helper below (`client.portal.call(...)` under the
hood). Because everything now goes through the portal synchronously, test functions
in this file are plain `def test_...(client):` — no `async def` / `@pytest.mark.asyncio`
needed. Follow this same `_run(client, ...)` pattern for any new DB-setup/teardown
helpers added here (e.g. for `/link` or `/confirm` tests).
"""
import functools
import pytest
from datetime import date
from decimal import Decimal
from fastapi.testclient import TestClient
from sqlalchemy import text

from main import app
from src.utils.auth_deps import get_current_user
from src.services.database_manager.connection import get_session_factory


def override_auth():
    return "test_user"


app.dependency_overrides[get_current_user] = override_auth


@pytest.fixture(scope="module")
def client():
    with TestClient(app, raise_server_exceptions=False) as c:
        yield c


def _run(client, fn, *args, **kwargs):
    """Run an async DB helper on the TestClient's own portal loop (see module
    docstring for why this matters)."""
    return client.portal.call(functools.partial(fn, *args, **kwargs))


async def _insert_transaction(**overrides) -> str:
    defaults = {
        "transaction_date": date(2026, 2, 10),
        "amount": Decimal("250.00"),
        "direction": "debit",
        # transactions.transaction_type has a DB CHECK constraint restricting it to
        # category values (purchase/refund/transfer/cc_payment/fee/interest/income/
        # reimbursement/adjustment) — it does NOT accept 'debit'/'credit' (that's what
        # `direction` is for). Every real row in this DB uses 'purchase' regardless of
        # direction, so that's the correct fixture default here.
        "transaction_type": "purchase",
        "description": "Route test fixture txn",
        "account": "Route Fixture Account",
        "transaction_source": "email_ingestion",
        "statement_confirmed": False,
    }
    defaults.update(overrides)
    session_factory = get_session_factory()
    async with session_factory() as session:
        result = await session.execute(
            text("""
                INSERT INTO transactions
                    (transaction_date, amount, direction, transaction_type, description,
                     account, transaction_source, statement_confirmed)
                VALUES
                    (:transaction_date, :amount, :direction, :transaction_type, :description,
                     :account, :transaction_source, :statement_confirmed)
                RETURNING id
            """),
            defaults,
        )
        await session.commit()
        return str(result.scalar())


async def _insert_review_item(candidate_ids, **overrides) -> str:
    defaults = {
        "review_type": "ambiguous",
        "transaction_date": date(2026, 2, 10),
        "amount": Decimal("250.00"),
        "description": "Route test review fixture",
        "account": "Route Fixture Account",
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


async def _cleanup(table: str, row_id: str) -> None:
    session_factory = get_session_factory()
    async with session_factory() as session:
        await session.execute(text(f"DELETE FROM {table} WHERE id = :id"), {"id": row_id})
        await session.commit()


async def _fetch_transaction(tx_id: str) -> dict:
    session_factory = get_session_factory()
    async with session_factory() as session:
        result = await session.execute(
            text("SELECT is_deleted FROM transactions WHERE id = :id"), {"id": tx_id}
        )
        return dict(result.first()._mapping)


def test_reject_soft_deletes_single_candidate(client):
    tx_id = _run(client, _insert_transaction)
    item_id = _run(client, _insert_review_item, [tx_id])
    try:
        resp = client.post(f"/api/review-queue/{item_id}/reject")
        assert resp.status_code == 200
        assert resp.json()["status"] == "rejected"

        row = _run(client, _fetch_transaction, tx_id)
        assert row["is_deleted"] is True
    finally:
        _run(client, _cleanup, "transactions", tx_id)
        _run(client, _cleanup, "review_queue", item_id)


def test_reject_rejects_multi_candidate_item(client):
    tx_a = _run(client, _insert_transaction, description="A")
    tx_b = _run(client, _insert_transaction, description="B")
    item_id = _run(client, _insert_review_item, [tx_a, tx_b])
    try:
        resp = client.post(f"/api/review-queue/{item_id}/reject")
        assert resp.status_code == 400
    finally:
        _run(client, _cleanup, "transactions", tx_a)
        _run(client, _cleanup, "transactions", tx_b)
        _run(client, _cleanup, "review_queue", item_id)


def test_reject_unknown_item_returns_404(client):
    resp = client.post("/api/review-queue/00000000-0000-0000-0000-000000000000/reject")
    assert resp.status_code == 404
