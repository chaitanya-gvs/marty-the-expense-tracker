# Review Queue Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Retire the never-reviewed `statement_only` review-queue type (auto-insert instead), fix the "None of these" semantics for single-candidate `ambiguous` items, stop resolved candidates from staying claimable on sibling items, validate `/link` input, and harden the review-queue idempotency key.

**Architecture:** All changes are additive/subtractive within the existing `review_queue` subsystem: `TransactionOperations` (new `exists_matching` helper), `ReviewQueueOperations` (new `remove_candidate_from_others`), `review_queue_routes.py` (new `/reject`, validated `/link`, simplified `/confirm`, removed `/bulk-confirm`), one Alembic migration, a one-time backlog script, and matching frontend hook/component changes. No change to `_run_dedup_pass` or `_run_email_reconciliation_pass` — this plan is entirely downstream of them.

**Tech Stack:** FastAPI + SQLAlchemy 2.0 async (raw `text()` queries, this codebase's established pattern for `operations/*.py`) + PostgreSQL + Alembic; Next.js 15 + TanStack Query on the frontend.

## Global Constraints

- Backend commands run from `backend/`; frontend commands run from `frontend/`.
- Never hard-delete transactions from routes/operations — use the existing soft-delete pattern (`is_deleted=true, deleted_at=now()`), already implemented in `TransactionOperations.delete_transaction`.
- The `marty-backend` Docker container does **not** hot-reload (see prior incident this session) — after backend changes land, `docker compose restart backend` is required before they take effect. This plan's own tasks run against the dev/local backend process, not the container; the restart is a deploy step, not a plan step, but is called out at the end.
- This repo's test convention for DB-touching code is real-DB integration tests (see `test_cancel_recurring.py`, `test_budget_api.py`) — no mocking framework precedent for the operations layer. Follow that pattern: set up fixture rows with direct SQL, call the real function/endpoint, assert, clean up in `finally`.
- Frontend has no test runner configured (package.json has only `lint`, no `test` script) — frontend tasks verify via `npm run lint` and `npm run build` instead of unit tests, matching existing project conventions.

---

## File Structure

**Backend — modified:**
- `backend/src/services/database_manager/operations/transaction_operations.py` — add `exists_matching()`
- `backend/src/services/database_manager/operations/review_queue_operations.py` — add `remove_candidate_from_others()`
- `backend/src/apis/routes/review_queue_routes.py` — add `/reject`, validate `/link`, simplify `/confirm`, remove `/bulk-confirm`
- `backend/src/apis/schemas/email_ingestion.py` — remove now-unused `BulkConfirmRequest`
- `backend/src/services/database_manager/models/review_queue.py` — update `review_type` comment

**Backend — new:**
- `backend/src/services/database_manager/migrations/versions/n9o0p1q2r3s4_narrow_review_queue_dedup_index.py`
- `backend/scripts/process_statement_only_backlog.py`
- `backend/tests/test_review_queue.py` (operations-layer: `exists_matching`, `remove_candidate_from_others`)
- `backend/tests/test_review_queue_routes.py` (route-layer: `/reject`, `/link` validation, `/confirm`)

**Frontend — modified:**
- `frontend/src/lib/api/client.ts` — add `rejectReviewItem()`, remove `bulkConfirmReviewItems()`
- `frontend/src/hooks/use-review-queue.ts` — add `useRejectReviewItem()`, remove `useBulkConfirmReviewItems()`
- `frontend/src/lib/types/index.ts` — narrow `ReviewQueueItem.review_type` to `"ambiguous"`
- `frontend/src/components/review/statement-review-queue.tsx` — branch single- vs multi-candidate UI

**Docs — modified:**
- `docs/superpowers/specs/2026-06-29-statement-reconciliation-design.md` — note that unmatched statement rows insert directly, no review queue

---

### Task 1: `TransactionOperations.exists_matching()`

**Files:**
- Modify: `backend/src/services/database_manager/operations/transaction_operations.py:505` (insert after `delete_transaction`, before `search_transactions`)
- Test: `backend/tests/test_review_queue.py`

**Interfaces:**
- Produces: `TransactionOperations.exists_matching(account: str, amount: Decimal, transaction_date: date, direction: str) -> bool` — used by Task 6 (`/confirm`) and Task 8 (backlog script).

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_review_queue.py`:

```python
"""
Tests for review-queue-adjacent operations helpers.
Run from backend/ with: poetry run pytest tests/test_review_queue.py -v
"""
import pytest
from datetime import date
from decimal import Decimal
from sqlalchemy import text

from src.services.database_manager.connection import get_session_factory
from src.services.database_manager.operations.transaction_operations import TransactionOperations
from src.services.database_manager.operations.review_queue_operations import ReviewQueueOperations


async def _insert_test_transaction(**overrides) -> str:
    """Insert a minimal transaction row for fixture purposes, return its id."""
    defaults = {
        "transaction_date": date(2026, 1, 15),
        "amount": Decimal("199.00"),
        "direction": "debit",
        "description": "Test Fixture Txn",
        "account": "Test Fixture Account",
        "transaction_source": "email_ingestion",
    }
    defaults.update(overrides)
    session_factory = get_session_factory()
    async with session_factory() as session:
        result = await session.execute(
            text("""
                INSERT INTO transactions
                    (transaction_date, amount, direction, transaction_type, description, account, transaction_source)
                VALUES
                    (:transaction_date, :amount, :direction, :direction, :description, :account, :transaction_source)
                RETURNING id
            """),
            defaults,
        )
        await session.commit()
        return str(result.scalar())


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
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `backend/`): `poetry run pytest tests/test_review_queue.py -v`
Expected: FAIL with `AttributeError: type object 'TransactionOperations' has no attribute 'exists_matching'`

- [ ] **Step 3: Implement `exists_matching`**

In `backend/src/services/database_manager/operations/transaction_operations.py`, insert immediately after `delete_transaction` (after line 504, before the `search_transactions` method at line 506):

```python
    @staticmethod
    async def exists_matching(
        account: str,
        amount: Decimal,
        transaction_date: date,
        direction: str,
    ) -> bool:
        """True if a non-deleted transaction already exists with this exact
        account/amount/date/direction. Used to avoid double-booking when
        confirming a review-queue item that a manual entry has since covered."""
        session_factory = get_session_factory()
        async with session_factory() as session:
            result = await session.execute(
                text("""
                    SELECT 1 FROM transactions
                    WHERE account = :account
                      AND amount = :amount
                      AND transaction_date = :transaction_date
                      AND direction = :direction
                      AND is_deleted = false
                    LIMIT 1
                """),
                {
                    "account": account,
                    "amount": str(amount),
                    "transaction_date": transaction_date,
                    "direction": direction,
                },
            )
            return result.scalar() is not None
```

- [ ] **Step 4: Run test to verify it passes**

Run: `poetry run pytest tests/test_review_queue.py -v`
Expected: 3 passed

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/database_manager/operations/transaction_operations.py backend/tests/test_review_queue.py
git commit -m "feat(transactions): add exists_matching() dedup-safety helper

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Narrow the review_queue idempotency index

**Files:**
- Create: `backend/src/services/database_manager/migrations/versions/n9o0p1q2r3s4_narrow_review_queue_dedup_index.py`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: unique index `uq_review_queue_unresolved_item` redefined on `(review_type, account, transaction_date, amount, direction) WHERE resolved_at IS NULL`, replacing the `m8n9o0p1q2r3` version that also included `description`.

- [ ] **Step 1: Write the migration**

```python
"""narrow review_queue dedup index — drop description from the key

Revision ID: n9o0p1q2r3s4
Revises: m8n9o0p1q2r3
Create Date: 2026-08-08

The previous index keyed on description too, which is fragile for UPI-style
descriptions (embedded reference numbers vary slightly per extraction run),
letting logical duplicates slip past the guard. account/date/amount/direction
is already the same tuple tier-2 dedup uses to define "the same matching
situation", so it's the right idempotency key on its own.
"""
from alembic import op

revision = "n9o0p1q2r3s4"
down_revision = "m8n9o0p1q2r3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("DROP INDEX IF EXISTS uq_review_queue_unresolved_item")
    op.execute("""
        CREATE UNIQUE INDEX uq_review_queue_unresolved_item
        ON review_queue (review_type, account, transaction_date, amount, direction)
        WHERE resolved_at IS NULL
    """)


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS uq_review_queue_unresolved_item")
    op.execute("""
        CREATE UNIQUE INDEX uq_review_queue_unresolved_item
        ON review_queue (review_type, description, amount, transaction_date, direction, account)
        WHERE resolved_at IS NULL
    """)
```

- [ ] **Step 2: Apply and verify**

Run (from `backend/`): `poetry run alembic upgrade head`
Expected: migration `n9o0p1q2r3s4` applies with no errors.

Verify the new index definition:
```bash
PGPASSWORD=<see backend/configs/secrets/.env DB_PASSWORD> psql -h localhost -U <DB_USER> -d <DB_NAME> -c "\d review_queue" | grep uq_review_queue_unresolved_item
```
Expected output includes `account, transaction_date, amount, direction` and does **not** include `description`.

- [ ] **Step 3: Verify downgrade round-trips cleanly**

Run: `poetry run alembic downgrade -1` then `poetry run alembic upgrade head`
Expected: both succeed with no errors (confirms the downgrade SQL is syntactically valid and the index name doesn't collide on re-create).

- [ ] **Step 4: Commit**

```bash
git add backend/src/services/database_manager/migrations/versions/n9o0p1q2r3s4_narrow_review_queue_dedup_index.py
git commit -m "fix(review-queue): narrow idempotency index, drop fragile description key

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: `ReviewQueueOperations.remove_candidate_from_others()`

**Files:**
- Modify: `backend/src/services/database_manager/operations/review_queue_operations.py` (add after `resolve`, before `bulk_resolve`, i.e. after line 106)
- Test: `backend/tests/test_review_queue.py`

**Interfaces:**
- Produces: `ReviewQueueOperations.remove_candidate_from_others(transaction_id: str, exclude_item_id: str) -> None` — used by Task 4 (`/reject`) and Task 5 (`/link`).

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_review_queue.py`:

```python
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
    shared_candidate = "11111111-1111-1111-1111-111111111111"
    other_candidate = "22222222-2222-2222-2222-222222222222"
    item_a = await _insert_review_item("ambiguous", [shared_candidate, other_candidate])
    item_b = await _insert_review_item("ambiguous", [shared_candidate], description="Other fixture")
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
    shared_candidate = "33333333-3333-3333-3333-333333333333"
    item_a = await _insert_review_item("ambiguous", [shared_candidate])
    item_b = await _insert_review_item("ambiguous", [shared_candidate], description="Resolved fixture")
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `poetry run pytest tests/test_review_queue.py -v`
Expected: FAIL with `AttributeError: type object 'ReviewQueueOperations' has no attribute 'remove_candidate_from_others'`

- [ ] **Step 3: Implement `remove_candidate_from_others`**

In `backend/src/services/database_manager/operations/review_queue_operations.py`, insert after `resolve` (after line 106, before `bulk_resolve`):

```python
    @staticmethod
    async def remove_candidate_from_others(transaction_id: str, exclude_item_id: str) -> None:
        """Strip a just-claimed transaction ID from every OTHER unresolved item's
        candidate list, so the same transaction can't be linked/rejected twice
        via two different review-queue rows."""
        session_factory = get_session_factory()
        async with session_factory() as session:
            await session.execute(
                text("""
                    UPDATE review_queue
                    SET ambiguous_candidate_ids = array_remove(ambiguous_candidate_ids, :transaction_id)
                    WHERE resolved_at IS NULL
                      AND id != :exclude_item_id
                      AND :transaction_id = ANY(ambiguous_candidate_ids)
                """),
                {"transaction_id": transaction_id, "exclude_item_id": exclude_item_id},
            )
            await session.commit()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `poetry run pytest tests/test_review_queue.py -v`
Expected: 5 passed

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/database_manager/operations/review_queue_operations.py backend/tests/test_review_queue.py
git commit -m "feat(review-queue): add remove_candidate_from_others for candidate-claim propagation

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: `/reject` endpoint

**Files:**
- Modify: `backend/src/apis/routes/review_queue_routes.py` (add after `link_review_item`, before `delete_review_item`, i.e. after line 70)
- Test: `backend/tests/test_review_queue_routes.py`

**Interfaces:**
- Consumes: `ReviewQueueOperations.get_unresolved`, `.resolve`, `.remove_candidate_from_others` (Task 3); `TransactionOperations.delete_transaction` (existing).
- Produces: `POST /api/review-queue/{item_id}/reject` — 200 `{"status": "rejected"}`, 404 if item missing/resolved, 400 if the item has more than one candidate.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_review_queue_routes.py`:

```python
"""
Route-level tests for the review-queue endpoints.
Run from backend/ with: poetry run pytest tests/test_review_queue_routes.py -v
"""
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


async def _insert_transaction(**overrides) -> str:
    defaults = {
        "transaction_date": date(2026, 2, 10),
        "amount": Decimal("250.00"),
        "direction": "debit",
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
                    (:transaction_date, :amount, :direction, :direction, :description,
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


@pytest.mark.asyncio
async def test_reject_soft_deletes_single_candidate(client):
    tx_id = await _insert_transaction()
    item_id = await _insert_review_item([tx_id])
    try:
        resp = client.post(f"/api/review-queue/{item_id}/reject")
        assert resp.status_code == 200
        assert resp.json()["status"] == "rejected"

        row = await _fetch_transaction(tx_id)
        assert row["is_deleted"] is True
    finally:
        await _cleanup("transactions", tx_id)
        await _cleanup("review_queue", item_id)


@pytest.mark.asyncio
async def test_reject_rejects_multi_candidate_item(client):
    tx_a = await _insert_transaction(description="A")
    tx_b = await _insert_transaction(description="B")
    item_id = await _insert_review_item([tx_a, tx_b])
    try:
        resp = client.post(f"/api/review-queue/{item_id}/reject")
        assert resp.status_code == 400
    finally:
        await _cleanup("transactions", tx_a)
        await _cleanup("transactions", tx_b)
        await _cleanup("review_queue", item_id)


def test_reject_unknown_item_returns_404(client):
    resp = client.post("/api/review-queue/00000000-0000-0000-0000-000000000000/reject")
    assert resp.status_code == 404
```

- [ ] **Step 2: Run test to verify it fails**

Run: `poetry run pytest tests/test_review_queue_routes.py -v`
Expected: FAIL — `test_reject_*` tests get 404 (route doesn't exist) instead of the expected status codes.

- [ ] **Step 3: Implement the `/reject` endpoint**

In `backend/src/apis/routes/review_queue_routes.py`, insert after `link_review_item` (after line 70, before `delete_review_item`):

```python
@router.post("/{item_id}/reject")
async def reject_review_item(item_id: str):
    """
    Reject a single-candidate ambiguous item (the email-reconciliation-pass
    "is this lone transaction legit?" case): soft-delete the underlying
    transaction and resolve the review item. Only valid when there is exactly
    one candidate — multi-candidate items reject via /confirm's "None of
    these" (insert-new) path instead, since there's no single transaction to
    delete.
    """
    items = await ReviewQueueOperations.get_unresolved("ambiguous")
    item = next((i for i in items if str(i["id"]) == item_id), None)
    if not item:
        raise HTTPException(404, "Item not found or already resolved")

    candidate_ids = item.get("ambiguous_candidate_ids") or []
    if len(candidate_ids) != 1:
        raise HTTPException(400, "Reject is only valid for single-candidate items")

    transaction_id = candidate_ids[0]
    await TransactionOperations.delete_transaction(transaction_id)
    await ReviewQueueOperations.resolve(item_id, "rejected")
    await ReviewQueueOperations.remove_candidate_from_others(transaction_id, exclude_item_id=item_id)
    return {"status": "rejected"}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `poetry run pytest tests/test_review_queue_routes.py -v`
Expected: 3 passed

- [ ] **Step 5: Commit**

```bash
git add backend/src/apis/routes/review_queue_routes.py backend/tests/test_review_queue_routes.py
git commit -m "feat(review-queue): add /reject endpoint for single-candidate items

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: Validate `/link` input

**Files:**
- Modify: `backend/src/apis/routes/review_queue_routes.py:63-70` (`link_review_item`)
- Test: `backend/tests/test_review_queue_routes.py`

**Interfaces:**
- Consumes: `ReviewQueueOperations.remove_candidate_from_others` (Task 3).
- Produces: `POST /api/review-queue/{item_id}/link` now 400s if `transaction_id` isn't one of the item's `ambiguous_candidate_ids`; on success, also propagates the claim (Task 3) to sibling items.

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_review_queue_routes.py`:

```python
@pytest.mark.asyncio
async def test_link_rejects_non_candidate_transaction_id(client):
    tx_a = await _insert_transaction(description="Candidate")
    tx_stranger = await _insert_transaction(description="Not a candidate")
    item_id = await _insert_review_item([tx_a])
    try:
        resp = client.post(
            f"/api/review-queue/{item_id}/link",
            json={"transaction_id": tx_stranger},
        )
        assert resp.status_code == 400
    finally:
        await _cleanup("transactions", tx_a)
        await _cleanup("transactions", tx_stranger)
        await _cleanup("review_queue", item_id)


@pytest.mark.asyncio
async def test_link_propagates_candidate_claim_to_siblings(client):
    tx_shared = await _insert_transaction(description="Shared candidate")
    tx_other = await _insert_transaction(description="Other candidate")
    item_a = await _insert_review_item([tx_shared, tx_other])
    item_b = await _insert_review_item([tx_shared], description="Sibling fixture")
    try:
        resp = client.post(
            f"/api/review-queue/{item_a}/link",
            json={"transaction_id": tx_shared},
        )
        assert resp.status_code == 200

        items = await ReviewQueueOperations.get_unresolved("ambiguous")
        b = next(i for i in items if str(i["id"]) == item_b)
        assert tx_shared not in (b["ambiguous_candidate_ids"] or [])
    finally:
        await _cleanup("transactions", tx_shared)
        await _cleanup("transactions", tx_other)
        await _cleanup("review_queue", item_a)
        await _cleanup("review_queue", item_b)
```

Add the missing import at the top of `backend/tests/test_review_queue_routes.py`:

```python
from src.services.database_manager.operations.review_queue_operations import ReviewQueueOperations
```

- [ ] **Step 2: Run test to verify it fails**

Run: `poetry run pytest tests/test_review_queue_routes.py -v`
Expected: `test_link_rejects_non_candidate_transaction_id` FAILs (currently returns 200, links a non-candidate transaction); `test_link_propagates_candidate_claim_to_siblings` FAILs (sibling still lists the claimed candidate).

- [ ] **Step 3: Update `link_review_item`**

Replace the existing `link_review_item` function (`backend/src/apis/routes/review_queue_routes.py:63-70`):

```python
@router.post("/{item_id}/link")
async def link_review_item(item_id: str, request: LinkReviewItemRequest):
    """Link ambiguous item to a specific email_ingestion transaction."""
    items = await ReviewQueueOperations.get_unresolved("ambiguous")
    item = next((i for i in items if str(i["id"]) == item_id), None)
    if not item:
        raise HTTPException(404, "Item not found or already resolved")

    candidate_ids = item.get("ambiguous_candidate_ids") or []
    if request.transaction_id not in candidate_ids:
        raise HTTPException(400, "transaction_id is not a candidate for this item")

    resolved = await ReviewQueueOperations.resolve(item_id, "linked")
    if not resolved:
        raise HTTPException(404, "Item not found or already resolved")
    await TransactionOperations.mark_statement_confirmed(request.transaction_id)
    await ReviewQueueOperations.remove_candidate_from_others(request.transaction_id, exclude_item_id=item_id)
    return {"status": "linked"}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `poetry run pytest tests/test_review_queue_routes.py -v`
Expected: all passing (5 total so far in this file)

- [ ] **Step 5: Commit**

```bash
git add backend/src/apis/routes/review_queue_routes.py backend/tests/test_review_queue_routes.py
git commit -m "fix(review-queue): validate /link transaction_id and propagate candidate claims

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 6: Simplify `/confirm`, remove `/bulk-confirm`

**Files:**
- Modify: `backend/src/apis/routes/review_queue_routes.py:36-60` (`confirm_review_item`), delete lines 81-94 (`bulk_confirm`)
- Modify: `backend/src/apis/schemas/email_ingestion.py:58-59` (remove `BulkConfirmRequest`)
- Modify: `backend/src/apis/routes/review_queue_routes.py:6-7` (drop `BulkConfirmRequest` from the schema import)
- Test: `backend/tests/test_review_queue_routes.py`

**Interfaces:**
- Consumes: `TransactionOperations.exists_matching` (Task 1).
- Produces: `POST /api/review-queue/{item_id}/confirm` now always takes the insert-new-unless-already-exists path (single-candidate items no longer reach `/confirm` per Task 4/11's frontend wiring, but the endpoint itself no longer special-cases them). `POST /api/review-queue/bulk-confirm` removed (404 for any caller).

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_review_queue_routes.py`:

```python
@pytest.mark.asyncio
async def test_confirm_inserts_new_transaction_when_none_matches(client):
    item_id = await _insert_review_item(
        ["placeholder-not-used"],  # multi-candidate path doesn't need real candidates for /confirm
        account="Confirm Fixture Account",
        amount=Decimal("77.00"),
        description="Confirm fixture description",
    )
    # /confirm reads raw_data for the insert payload — set it directly since the
    # fixture helper above doesn't populate it.
    session_factory = get_session_factory()
    async with session_factory() as session:
        await session.execute(
            text("UPDATE review_queue SET raw_data = :raw_data WHERE id = :id"),
            {
                "id": item_id,
                "raw_data": (
                    '{"transaction_date": "2026-02-10", "amount": 77.00, '
                    '"direction": "debit", "transaction_type": "debit", '
                    '"description": "Confirm fixture description", '
                    '"account": "Confirm Fixture Account"}'
                ),
            },
        )
        await session.commit()

    inserted_id = None
    try:
        resp = client.post(f"/api/review-queue/{item_id}/confirm")
        assert resp.status_code == 200
        assert resp.json()["status"] == "confirmed"

        async with session_factory() as session:
            result = await session.execute(
                text("""
                    SELECT id FROM transactions
                    WHERE account = 'Confirm Fixture Account' AND amount = 77.00
                      AND is_deleted = false
                """)
            )
            row = result.first()
        assert row is not None
        inserted_id = str(row[0])
    finally:
        await _cleanup("review_queue", item_id)
        if inserted_id:
            await _cleanup("transactions", inserted_id)


@pytest.mark.asyncio
async def test_confirm_skips_insert_when_transaction_already_exists(client):
    existing_tx = await _insert_transaction(
        account="Already Exists Account", amount=Decimal("42.00"), description="Manual entry"
    )
    item_id = await _insert_review_item(
        ["placeholder-not-used"],
        account="Already Exists Account",
        amount=Decimal("42.00"),
        description="Confirm fixture — already covered",
    )
    session_factory = get_session_factory()
    async with session_factory() as session:
        await session.execute(
            text("UPDATE review_queue SET raw_data = :raw_data WHERE id = :id"),
            {
                "id": item_id,
                "raw_data": (
                    '{"transaction_date": "2026-02-10", "amount": 42.00, '
                    '"direction": "debit", "transaction_type": "debit", '
                    '"description": "Should not be inserted", '
                    '"account": "Already Exists Account"}'
                ),
            },
        )
        await session.commit()
    try:
        resp = client.post(f"/api/review-queue/{item_id}/confirm")
        assert resp.status_code == 200

        async with session_factory() as session:
            result = await session.execute(
                text("""
                    SELECT count(*) FROM transactions
                    WHERE account = 'Already Exists Account' AND amount = 42.00 AND is_deleted = false
                """)
            )
            count = result.scalar()
        assert count == 1  # only the pre-existing one — no duplicate inserted
    finally:
        await _cleanup("review_queue", item_id)
        await _cleanup("transactions", existing_tx)


def test_bulk_confirm_endpoint_removed(client):
    resp = client.post("/api/review-queue/bulk-confirm", json={"item_ids": []})
    assert resp.status_code == 404
```

Note: `_insert_review_item`'s `transaction_date` fixture default is `date(2026, 2, 10)`, matching the `raw_data` JSON above — keep these in sync since `/confirm` uses `raw_data`, not the review_queue row's own columns, for the insert payload.

- [ ] **Step 2: Run test to verify it fails**

Run: `poetry run pytest tests/test_review_queue_routes.py -v`
Expected: `test_confirm_skips_insert_when_transaction_already_exists` FAILs (currently always inserts, so count would be 2); `test_bulk_confirm_endpoint_removed` FAILs (currently 200, not 404).

- [ ] **Step 3: Simplify `confirm_review_item`, remove `bulk_confirm`**

Replace `confirm_review_item` (`backend/src/apis/routes/review_queue_routes.py:36-60`):

```python
@router.post("/{item_id}/confirm")
async def confirm_review_item(item_id: str, request: ConfirmReviewItemRequest = ConfirmReviewItemRequest()):
    """
    Confirm an ambiguous item with no accepted candidate ("None of these"):
    insert the statement row as a new transaction, unless a matching
    transaction already exists (e.g. entered manually in the meantime).
    """
    items = await ReviewQueueOperations.get_unresolved("ambiguous")
    item = next((i for i in items if str(i["id"]) == item_id), None)
    if not item:
        raise HTTPException(404, "Item not found or already resolved")

    already_exists = await TransactionOperations.exists_matching(
        account=item["account"],
        amount=item["amount"],
        transaction_date=item["transaction_date"],
        direction=item["direction"],
    )
    if not already_exists:
        tx = {**(item.get("raw_data") or {}), **(request.edits or {})}
        await TransactionOperations.bulk_insert_transactions(
            [tx],
            transaction_source="statement_extraction",
        )
    await ReviewQueueOperations.resolve(item_id, "confirmed")
    return {"status": "confirmed"}
```

Delete the `bulk_confirm` function entirely (`backend/src/apis/routes/review_queue_routes.py:81-94`, everything from `@router.post("/bulk-confirm")` to the end of the file).

Update the import line (`backend/src/apis/routes/review_queue_routes.py:5-8`) to drop `BulkConfirmRequest`:

```python
from src.apis.schemas.email_ingestion import (
    ReviewQueueResponse, ReviewQueueItemResponse,
    ConfirmReviewItemRequest, LinkReviewItemRequest,
)
```

In `backend/src/apis/schemas/email_ingestion.py`, delete the now-unused `BulkConfirmRequest` class (lines 58-59):

```python
class BulkConfirmRequest(BaseModel):
    item_ids: List[str]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `poetry run pytest tests/test_review_queue_routes.py -v`
Expected: all passing (10 total in this file)

Also run the full backend suite to confirm nothing else references `BulkConfirmRequest` or `/bulk-confirm`:
Run: `poetry run pytest tests/ -v`
Expected: no new failures (pre-existing failures, if any, are unrelated — note them but don't fix here).

- [ ] **Step 5: Commit**

```bash
git add backend/src/apis/routes/review_queue_routes.py backend/src/apis/schemas/email_ingestion.py backend/tests/test_review_queue_routes.py
git commit -m "fix(review-queue): dedup-safe /confirm insert, remove dead /bulk-confirm

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 7: Update the `review_queue` model comment

**Files:**
- Modify: `backend/src/services/database_manager/models/review_queue.py:22`

**Interfaces:** none (comment-only change, no behavior).

- [ ] **Step 1: Update the comment**

In `backend/src/services/database_manager/models/review_queue.py`, change line 22:

```python
    review_type: Mapped[str] = mapped_column(Text, nullable=False)  # 'ambiguous' (statement_only retired 2026-08)
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/services/database_manager/models/review_queue.py
git commit -m "docs(review-queue): update review_type comment — statement_only retired

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 8: One-time `statement_only` backlog script

**Files:**
- Create: `backend/scripts/process_statement_only_backlog.py`

**Interfaces:**
- Consumes: `TransactionOperations.exists_matching` (Task 1), `TransactionOperations.bulk_insert_transactions` (existing), `ReviewQueueOperations.get_unresolved` / `.resolve` (existing).

- [ ] **Step 1: Write the script**

```python
"""
One-time backlog processor for the retired 'statement_only' review-queue type.

For each unresolved statement_only row: if a matching non-deleted transaction
already exists (account/amount/date/direction), just resolve the row —
someone already covered it manually. Otherwise insert it as a real
statement_extraction transaction, then resolve the row.

Run from backend/ with: poetry run python scripts/process_statement_only_backlog.py
"""
import asyncio
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
os.environ.setdefault("ENV_FILE", "configs/.env")
os.environ.setdefault("SECRETS_FILE", "configs/secrets/.env")

from src.utils.settings import get_settings  # noqa: E402
get_settings()

from src.services.database_manager.operations.review_queue_operations import ReviewQueueOperations  # noqa: E402
from src.services.database_manager.operations.transaction_operations import TransactionOperations  # noqa: E402


async def main() -> None:
    items = await ReviewQueueOperations.get_unresolved("statement_only")
    if not items:
        print("No unresolved statement_only items — nothing to do.")
        return

    inserted = 0
    skipped_duplicate = 0

    for item in items:
        already_exists = await TransactionOperations.exists_matching(
            account=item["account"],
            amount=item["amount"],
            transaction_date=item["transaction_date"],
            direction=item["direction"],
        )
        if already_exists:
            skipped_duplicate += 1
            print(f"  SKIP (already exists) — {item['account']} {item['transaction_date']} "
                  f"₹{item['amount']} {item['description'][:60]}")
        else:
            tx = dict(item.get("raw_data") or {})
            await TransactionOperations.bulk_insert_transactions(
                [tx],
                transaction_source="statement_extraction",
            )
            inserted += 1
            print(f"  INSERT — {item['account']} {item['transaction_date']} "
                  f"₹{item['amount']} {item['description'][:60]}")
        await ReviewQueueOperations.resolve(str(item["id"]), "confirmed")

    print(f"\nDone. {inserted} inserted, {skipped_duplicate} skipped as already-covered, "
          f"{len(items)} total resolved.")


if __name__ == "__main__":
    asyncio.run(main())
```

- [ ] **Step 2: Dry-run check before executing**

Before running, inspect what will happen (read-only):
```bash
PGPASSWORD=<DB_PASSWORD> psql -h localhost -U <DB_USER> -d <DB_NAME> -c "
SELECT account, transaction_date, amount, description
FROM review_queue WHERE review_type = 'statement_only' AND resolved_at IS NULL
ORDER BY transaction_date;
"
```
Confirm the row count (34, per the design spec's investigation) and spot-check a few rows look like real transactions, not garbage.

- [ ] **Step 3: Run the script**

Run (from `backend/`): `poetry run python scripts/process_statement_only_backlog.py`
Expected: prints one line per item (INSERT or SKIP), ends with a summary line. All 34 rows resolved.

- [ ] **Step 4: Verify**

```bash
PGPASSWORD=<DB_PASSWORD> psql -h localhost -U <DB_USER> -d <DB_NAME> -c "
SELECT count(*) FROM review_queue WHERE review_type = 'statement_only' AND resolved_at IS NULL;
"
```
Expected: `0`.

- [ ] **Step 5: Commit the script**

```bash
git add backend/scripts/process_statement_only_backlog.py
git commit -m "chore(review-queue): add one-time statement_only backlog processor

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

(The script's *execution* against the real DB in Step 3 is an operational action, not something to re-run per environment — see the note at the end of this plan.)

---

### Task 9: Frontend — `rejectReviewItem` client method + hook

**Files:**
- Modify: `frontend/src/lib/api/client.ts:792-823` (review queue section)
- Modify: `frontend/src/hooks/use-review-queue.ts`

**Interfaces:**
- Produces: `apiClient.rejectReviewItem(itemId: string): Promise<void>`, `useRejectReviewItem()` hook — consumed by Task 11.

- [ ] **Step 1: Add the client method, remove the dead one**

In `frontend/src/lib/api/client.ts`, replace `bulkConfirmReviewItems` (lines 817-823) with:

```typescript
  async rejectReviewItem(itemId: string): Promise<void> {
    await this.request<void>(`/review-queue/${itemId}/reject`, { method: "POST" });
  }
```

- [ ] **Step 2: Add the hook, remove the dead one**

In `frontend/src/hooks/use-review-queue.ts`, replace `useBulkConfirmReviewItems`:

```typescript
export function useRejectReviewItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (itemId: string) => apiClient.rejectReviewItem(itemId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["review-queue"] });
      toast.success("Transaction rejected");
    },
    onError: () => toast.error("Failed to reject transaction"),
  });
}
```

- [ ] **Step 3: Verify**

Run (from `frontend/`): `npm run lint`
Expected: no errors (in particular, no "unused import" or "undefined reference" errors from the removed `bulkConfirmReviewItems`/`useBulkConfirmReviewItems`).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/api/client.ts frontend/src/hooks/use-review-queue.ts
git commit -m "feat(review-queue): add rejectReviewItem client method + hook

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 10: Frontend types — narrow `review_type`

**Files:**
- Modify: `frontend/src/lib/types/index.ts:425`

- [ ] **Step 1: Narrow the type**

Change:
```typescript
  review_type: "statement_only" | "ambiguous";
```
to:
```typescript
  review_type: "ambiguous";
```

- [ ] **Step 2: Verify**

Run (from `frontend/`): `npm run build`
Expected: builds cleanly — confirms nothing else in the frontend still branches on `"statement_only"`.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/types/index.ts
git commit -m "chore(review-queue): narrow ReviewQueueItem.review_type — statement_only retired

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 11: Frontend UI — single- vs multi-candidate branching

**Files:**
- Modify: `frontend/src/components/review/statement-review-queue.tsx`

**Interfaces:**
- Consumes: `useRejectReviewItem` (Task 9).

- [ ] **Step 1: Wire the reject mutation into `StatementReviewQueue`**

Replace the `StatementReviewQueue` function (lines 74-112):

```typescript
export function StatementReviewQueue() {
  const { data: ambiguous, isLoading } = useReviewQueue("ambiguous");
  const confirm = useConfirmReviewItem();
  const link = useLinkReviewItem();
  const reject = useRejectReviewItem();
  const runIngestion = useRunEmailIngestion();

  const items = ambiguous?.items ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">Ambiguous</span>
          {items.length > 0 && (
            <Badge variant="destructive">{items.length}</Badge>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => runIngestion.mutate(undefined)}
          disabled={runIngestion.isPending}
        >
          <RefreshCw
            className={`h-4 w-4 mr-2 ${runIngestion.isPending ? "animate-spin" : ""}`}
          />
          Fetch Latest
        </Button>
      </div>

      <AmbiguousList
        items={items}
        isLoading={isLoading}
        onLink={(itemId, txId) => link.mutate({ itemId, transactionId: txId })}
        onNoneMatch={(itemId) => confirm.mutate({ itemId })}
        onReject={(itemId) => reject.mutate(itemId)}
      />
    </div>
  );
}
```

Update the import line (line 6-11) to add `useRejectReviewItem`:

```typescript
import {
  useReviewQueue,
  useConfirmReviewItem,
  useLinkReviewItem,
  useRejectReviewItem,
  useRunEmailIngestion,
} from "@/hooks/use-review-queue";
```

- [ ] **Step 2: Thread `onReject` through `AmbiguousList`**

Replace the `AmbiguousList` function (lines 116-149):

```typescript
function AmbiguousList({
  items,
  isLoading,
  onLink,
  onNoneMatch,
  onReject,
}: {
  items: ReviewQueueItem[];
  isLoading: boolean;
  onLink: (itemId: string, txId: string) => void;
  onNoneMatch: (itemId: string) => void;
  onReject: (itemId: string) => void;
}) {
  if (isLoading)
    return <div className="text-muted-foreground text-sm py-6">Loading…</div>;

  if (items.length === 0)
    return (
      <div className="text-center py-12 text-muted-foreground text-sm">
        No ambiguous matches — all clear
      </div>
    );

  return (
    <div className="space-y-3">
      {items.map((item) => (
        <AmbiguousItem
          key={item.id}
          item={item}
          onLink={onLink}
          onNoneMatch={onNoneMatch}
          onReject={onReject}
        />
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Branch the candidates section in `AmbiguousItem`**

In `AmbiguousItem` (lines 153-348), update the function signature (lines 153-161):

```typescript
function AmbiguousItem({
  item,
  onLink,
  onNoneMatch,
  onReject,
}: {
  item: ReviewQueueItem;
  onLink: (itemId: string, txId: string) => void;
  onNoneMatch: (itemId: string) => void;
  onReject: (itemId: string) => void;
}) {
  const candidateIds = item.ambiguous_candidate_ids ?? [];
  const isSingleCandidate = candidateIds.length === 1;
  const parsed = parseUpiDescription(item.description);
```

(only `isSingleCandidate` is new — the rest of the destructuring/parsing block is unchanged).

Replace the "Candidates" section (lines 226-345, from `{/* ── Candidates ── */}` through the closing `</div>` of that block) with:

```typescript
      {/* ── Candidates ── */}
      <div className="px-4 py-3 space-y-2">
        <p className="text-xs text-muted-foreground font-medium">
          {isSingleCandidate
            ? "Is this a legitimate standalone transaction?"
            : `${candidateIds.length} possible matches — select the one this transaction belongs to:`}
        </p>

        {candidateQueries.map((query, i) => {
          const txId = candidateIds[i];
          const tx: Transaction | null = loadedTxs[i];
          const isBest = i === bestMatchIdx;
          const diff = tx ? daysDiff(item.transaction_date, tx.date) : null;

          if (query.isLoading) {
            return (
              <div
                key={txId}
                className="rounded-md border px-3 py-2.5 flex items-center gap-3 animate-pulse"
              >
                <div className="flex-1 space-y-1.5">
                  <div className="h-3.5 bg-muted rounded w-3/4" />
                  <div className="h-3 bg-muted rounded w-1/2" />
                </div>
                <div className="h-3.5 bg-muted rounded w-16 shrink-0" />
                <div className="h-7 bg-muted rounded w-14 shrink-0" />
              </div>
            );
          }

          if (!tx) {
            return (
              <div
                key={txId}
                className="rounded-md border px-3 py-2.5 flex items-center gap-3 text-xs text-muted-foreground"
              >
                <span className="flex-1">
                  Could not load transaction{" "}
                  <code className="font-mono">{txId.slice(0, 8)}…</code>
                </span>
                {!isSingleCandidate && (
                  <Button size="sm" variant="outline" onClick={() => onLink(item.id, txId)}>
                    <Link2 className="h-3.5 w-3.5 mr-1.5" />
                    Link anyway
                  </Button>
                )}
              </div>
            );
          }

          return (
            <div
              key={txId}
              className={cn(
                "rounded-md border px-3 py-2.5 flex items-center gap-3 transition-colors",
                isBest
                  ? "border-primary/40 bg-primary/5 hover:bg-primary/10"
                  : "hover:bg-muted/40"
              )}
            >
              <div className="flex-1 min-w-0 space-y-0.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm font-medium truncate">{tx.description}</p>
                  {isBest && (
                    <span className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium bg-primary/15 text-primary border border-primary/30 shrink-0">
                      <Sparkles className="h-2.5 w-2.5" />
                      Best match
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-xs text-muted-foreground">
                    {formatDate(tx.date)}&nbsp;&middot;&nbsp;{tx.account}
                    {tx.category ? <>&nbsp;&middot;&nbsp;{tx.category}</> : null}
                  </span>
                  {diff !== null && <DateProximityBadge diff={diff} />}
                </div>
                {tx.original_description &&
                  tx.original_description !== tx.description && (
                    <p className="text-[11px] text-muted-foreground/60 font-mono truncate">
                      {tx.original_description}
                    </p>
                  )}
              </div>
              <span
                className={cn(
                  "text-sm font-semibold tabular-nums shrink-0",
                  tx.direction === "debit" ? "text-red-500" : "text-green-500"
                )}
              >
                {tx.direction === "debit" ? "−" : "+"}
                {formatCurrency(tx.amount)}
              </span>
              {!isSingleCandidate && (
                <Button
                  size="sm"
                  onClick={() => onLink(item.id, txId)}
                  className="shrink-0"
                  variant={isBest ? "default" : "outline"}
                >
                  <ArrowRight className="h-3.5 w-3.5 mr-1.5" />
                  Link
                </Button>
              )}
            </div>
          );
        })}

        <div className="pt-1 flex items-center gap-2">
          {isSingleCandidate ? (
            <>
              <Button
                size="sm"
                variant="default"
                className="h-7 px-3 text-xs"
                onClick={() => onLink(item.id, candidateIds[0])}
              >
                <ArrowRight className="h-3.5 w-3.5 mr-1.5" />
                Looks right
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="text-muted-foreground hover:text-foreground text-xs h-7 px-2"
                onClick={() => onReject(item.id)}
              >
                <Ban className="h-3 w-3 mr-1.5" />
                Doesn&apos;t belong
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              className="text-muted-foreground hover:text-foreground text-xs h-7 px-2"
              onClick={() => onNoneMatch(item.id)}
            >
              <Ban className="h-3 w-3 mr-1.5" />
              None of these
            </Button>
          )}
        </div>
      </div>
```

Note: for the single-candidate case, the per-candidate card's own "Link" button is hidden (`!isSingleCandidate &&`) since the new "Looks right" button below does the same thing — avoids two redundant buttons doing the same action on screen.

- [ ] **Step 4: Verify**

Run (from `frontend/`): `npm run lint && npm run build`
Expected: both succeed with no errors.

Manual check (dev server, already running per project convention — don't restart it): open `/review`, confirm:
- Multi-candidate items still show per-candidate "Link" buttons + "None of these".
- Single-candidate items show "Looks right" / "Doesn't belong" instead, no per-candidate "Link" button.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/review/statement-review-queue.tsx
git commit -m "fix(review-queue): honest accept/reject UI for single-candidate items

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 12: Update the reconciliation design doc

**Files:**
- Modify: `docs/superpowers/specs/2026-06-29-statement-reconciliation-design.md`

- [ ] **Step 1: Append the note**

Add a new section at the end of the file:

```markdown
---

## Update (2026-08-08): no review gate on unmatched rows

This service was never implemented. If it is built in the future, unmatched
statement rows should insert **directly** as `statement_extraction`
transactions — no `review_queue` involvement. The `statement_only` review
type that this design originally specified was retired: it had no UI
surfacing it, so 34 real transactions sat unreviewed for months before being
processed as a one-time backlog cleanup. See
`docs/superpowers/specs/2026-08-08-review-queue-improvements-design.md` for
the full investigation and reasoning — every *other* unmatched statement row
already inserts directly in `_run_dedup_pass`; gating this specific subset
was the inconsistency that caused the problem.

Reuse `TransactionOperations.exists_matching(account, amount,
transaction_date, direction)` before inserting, so a manually-entered
transaction can't get double-booked.
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/specs/2026-06-29-statement-reconciliation-design.md
git commit -m "docs(reconciliation): note statement_only retirement, direct-insert going forward

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Final step: restart the backend container

None of these backend changes take effect in the running `marty-backend` container until it's restarted (see Global Constraints). After all tasks land:

```bash
docker compose restart backend
docker inspect marty-backend --format 'StartedAt={{.State.StartedAt}} Status={{.State.Status}}'
```

Confirm `StartedAt` is after the last backend commit's timestamp, and `docker logs marty-backend --tail 20` shows a clean startup (migrations applied, uvicorn running) before considering this plan complete.
