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
from src.services.database_manager.operations.review_queue_operations import ReviewQueueOperations


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


async def _cleanup_by_account_amount(account: str, amount: Decimal) -> None:
    """Teardown for tests where the route itself inserts a row whose id the test
    never learns — deletes every fixture row for that account/amount."""
    session_factory = get_session_factory()
    async with session_factory() as session:
        await session.execute(
            text("DELETE FROM transactions WHERE account = :account AND amount = :amount"),
            {"account": account, "amount": amount},
        )
        await session.commit()


async def _fetch_transaction(tx_id: str) -> dict:
    session_factory = get_session_factory()
    async with session_factory() as session:
        result = await session.execute(
            text("SELECT is_deleted FROM transactions WHERE id = :id"), {"id": tx_id}
        )
        return dict(result.first()._mapping)


async def _set_review_item_raw_data(item_id: str, raw_data: str) -> None:
    session_factory = get_session_factory()
    async with session_factory() as session:
        await session.execute(
            text("UPDATE review_queue SET raw_data = :raw_data WHERE id = :id"),
            {"id": item_id, "raw_data": raw_data},
        )
        await session.commit()


async def _count_transactions(account: str, amount: Decimal) -> int:
    session_factory = get_session_factory()
    async with session_factory() as session:
        result = await session.execute(
            text("""
                SELECT count(*) FROM transactions
                WHERE account = :account AND amount = :amount AND is_deleted = false
            """),
            {"account": account, "amount": amount},
        )
        return result.scalar()


async def _find_transaction_id(account: str, amount: Decimal) -> str | None:
    session_factory = get_session_factory()
    async with session_factory() as session:
        result = await session.execute(
            text("""
                SELECT id FROM transactions
                WHERE account = :account AND amount = :amount AND is_deleted = false
            """),
            {"account": account, "amount": amount},
        )
        row = result.first()
        return str(row[0]) if row else None


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


def test_link_rejects_non_candidate_transaction_id(client):
    tx_a = _run(client, _insert_transaction, description="Candidate")
    tx_stranger = _run(client, _insert_transaction, description="Not a candidate")
    item_id = _run(client, _insert_review_item, [tx_a])
    try:
        resp = client.post(
            f"/api/review-queue/{item_id}/link",
            json={"transaction_id": tx_stranger},
        )
        assert resp.status_code == 400
    finally:
        _run(client, _cleanup, "transactions", tx_a)
        _run(client, _cleanup, "transactions", tx_stranger)
        _run(client, _cleanup, "review_queue", item_id)


def test_link_propagates_candidate_claim_to_siblings(client):
    tx_shared = _run(client, _insert_transaction, description="Shared candidate")
    tx_other = _run(client, _insert_transaction, description="Other candidate")
    item_a = _run(client, _insert_review_item, [tx_shared, tx_other])
    # uq_review_queue_unresolved_item keys unresolved items on
    # (review_type, account, transaction_date, amount, direction); item_b needs a
    # distinct value in one of those columns to coexist with item_a, so it's given
    # its own account here, standing in for a separate review situation that
    # happens to share the same candidate transaction id.
    item_b = _run(
        client, _insert_review_item, [tx_shared],
        description="Sibling fixture", account="Sibling Fixture Account",
    )
    try:
        resp = client.post(
            f"/api/review-queue/{item_a}/link",
            json={"transaction_id": tx_shared},
        )
        assert resp.status_code == 200

        items = _run(client, ReviewQueueOperations.get_unresolved, "ambiguous")
        b = next(i for i in items if str(i["id"]) == item_b)
        assert tx_shared not in (b["ambiguous_candidate_ids"] or [])
    finally:
        _run(client, _cleanup, "transactions", tx_shared)
        _run(client, _cleanup, "transactions", tx_other)
        _run(client, _cleanup, "review_queue", item_a)
        _run(client, _cleanup, "review_queue", item_b)


def test_confirm_inserts_new_transaction_when_none_matches(client):
    item_id = _run(
        client, _insert_review_item,
        # /confirm is the multi-candidate "None of these" path and rejects
        # single-candidate items outright, so the fixture needs >= 2 candidates.
        # They needn't be real transaction ids for this case — nothing looks them
        # up, they only feed exists_matching's exclusion list.
        ["11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222"],
        account="Confirm Fixture Account",
        amount=Decimal("77.00"),
        description="Confirm fixture description",
    )
    # /confirm reads raw_data for the insert payload — set it directly since the
    # fixture helper above doesn't populate it.
    # Note: TransactionOperations._prepare_transaction_for_insert derives the
    # `transactions.direction` column from raw_data's `transaction_type` key (a
    # `direction` key in raw_data is ignored entirely — this matches production
    # raw_data shape, e.g. statement_workflow.py's
    # `direction=tx.get("transaction_type", "debit")`), and hardcodes the
    # `transactions.transaction_type` column to 'purchase' regardless of input —
    # so raw_data must carry 'debit'/'credit' under the `transaction_type` key,
    # not a category value, or the insert violates `transactions_direction_check`.
    _run(
        client, _set_review_item_raw_data, item_id,
        (
            '{"transaction_date": "2026-02-10", "amount": 77.00, '
            '"transaction_type": "debit", '
            '"description": "Confirm fixture description", '
            '"account": "Confirm Fixture Account"}'
        ),
    )

    inserted_id = None
    try:
        resp = client.post(f"/api/review-queue/{item_id}/confirm")
        assert resp.status_code == 200
        assert resp.json()["status"] == "confirmed"

        inserted_id = _run(client, _find_transaction_id, "Confirm Fixture Account", Decimal("77.00"))
        assert inserted_id is not None
    finally:
        _run(client, _cleanup, "review_queue", item_id)
        if inserted_id:
            _run(client, _cleanup, "transactions", inserted_id)


def test_confirm_skips_insert_when_transaction_already_exists(client):
    existing_tx = _run(
        client, _insert_transaction,
        account="Already Exists Account", amount=Decimal("42.00"), description="Manual entry",
    )
    item_id = _run(
        client, _insert_review_item,
        # Two candidates (see note in the test above); neither is `existing_tx`,
        # so the exists_matching exclusion doesn't hide the pre-existing row.
        ["11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222"],
        account="Already Exists Account",
        amount=Decimal("42.00"),
        description="Confirm fixture — already covered",
    )
    _run(
        client, _set_review_item_raw_data, item_id,
        (
            '{"transaction_date": "2026-02-10", "amount": 42.00, '
            '"transaction_type": "debit", '
            '"description": "Should not be inserted", '
            '"account": "Already Exists Account"}'
        ),
    )
    try:
        resp = client.post(f"/api/review-queue/{item_id}/confirm")
        assert resp.status_code == 200

        count = _run(client, _count_transactions, "Already Exists Account", Decimal("42.00"))
        assert count == 1  # only the pre-existing one — no duplicate inserted
    finally:
        _run(client, _cleanup, "review_queue", item_id)
        _run(client, _cleanup, "transactions", existing_tx)


def test_confirm_rejects_single_candidate_item(client):
    """Single-candidate items belong to /link or /reject — /confirm would resolve
    them without ever marking the candidate statement-confirmed."""
    tx_id = _run(client, _insert_transaction, account="Single Candidate Account")
    item_id = _run(client, _insert_review_item, [tx_id], account="Single Candidate Account")
    try:
        resp = client.post(f"/api/review-queue/{item_id}/confirm")
        assert resp.status_code == 400

        items = _run(client, ReviewQueueOperations.get_unresolved, "ambiguous")
        assert any(str(i["id"]) == item_id for i in items)  # left unresolved
    finally:
        _run(client, _cleanup, "transactions", tx_id)
        _run(client, _cleanup, "review_queue", item_id)


def test_confirm_inserts_even_when_own_candidate_matches(client):
    """"None of these" on a multi-candidate item must insert a new transaction.
    Tier-3 candidates match the item on account/amount/direction by construction,
    so exists_matching would otherwise always find one of them and no-op."""
    # Both candidates are real rows that match the item exactly — precisely the
    # shape that used to make exists_matching swallow the user's decision.
    tx_a = _run(
        client, _insert_transaction,
        account="None Of These Account", amount=Decimal("88.00"), description="Candidate A",
    )
    tx_b = _run(
        client, _insert_transaction,
        account="None Of These Account", amount=Decimal("88.00"), description="Candidate B",
    )
    item_id = _run(
        client, _insert_review_item, [tx_a, tx_b],
        account="None Of These Account", amount=Decimal("88.00"),
        description="None of these fixture",
    )
    _run(
        client, _set_review_item_raw_data, item_id,
        (
            '{"transaction_date": "2026-02-10", "amount": 88.00, '
            '"transaction_type": "debit", '
            '"description": "Genuinely separate transaction", '
            '"account": "None Of These Account"}'
        ),
    )
    try:
        resp = client.post(f"/api/review-queue/{item_id}/confirm")
        assert resp.status_code == 200
        assert resp.json()["status"] == "confirmed"

        # 2 candidates + the newly inserted row
        assert _run(client, _count_transactions, "None Of These Account", Decimal("88.00")) == 3
    finally:
        _run(client, _cleanup, "review_queue", item_id)
        _run(
            client, _cleanup_by_account_amount,
            "None Of These Account", Decimal("88.00"),
        )


def test_confirm_leaves_item_unresolved_when_insert_fails(client):
    """An email-reconciliation-origin item has raw_data = NULL, so the insert
    payload is empty and bulk_insert_transactions fails internally (by return
    value, not by raising). The item must stay unresolved rather than being
    marked confirmed with nothing written."""
    item_id = _run(
        client, _insert_review_item,
        ["11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222"],
        account="Failed Insert Account", amount=Decimal("31.00"),
        description="No raw_data fixture",
    )  # raw_data intentionally left NULL
    try:
        resp = client.post(f"/api/review-queue/{item_id}/confirm")
        assert resp.status_code == 500

        items = _run(client, ReviewQueueOperations.get_unresolved, "ambiguous")
        assert any(str(i["id"]) == item_id for i in items)
        assert _run(client, _count_transactions, "Failed Insert Account", Decimal("31.00")) == 0
    finally:
        _run(client, _cleanup, "review_queue", item_id)


def test_bulk_confirm_endpoint_removed(client):
    resp = client.post("/api/review-queue/bulk-confirm", json={"item_ids": []})
    # The route is gone, but "/bulk-confirm" still path-matches the remaining
    # DELETE /{item_id} route (treating "bulk-confirm" as an item_id), so
    # FastAPI/Starlette reports 405 Method Not Allowed rather than 404 for a
    # POST here — either way, the old POST /bulk-confirm handler no longer runs.
    assert resp.status_code == 405
