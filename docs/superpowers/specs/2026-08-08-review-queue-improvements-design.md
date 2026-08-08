# Review Queue Improvements Design

## Context

The `review_queue` table stages two kinds of uncertain transactions for human resolution: `statement_only` (a statement row with no matching DB transaction) and `ambiguous` (a transaction that needs a human pick or confirmation). Investigating why 46 items had sat unresolved for months surfaced several concrete problems, documented below alongside the fix for each.

## Problems found

1. **`statement_only` items are invisible.** The frontend (`StatementReviewQueue`) only queries `review_type=ambiguous`. 34 unresolved `statement_only` rows exist, the oldest from 2026-03-28 — real statement transactions that never became DB records and were never seen by anyone.
2. **No code path currently creates `statement_only` items.** The `StatementReconciliationService` designed in `2026-06-29-statement-reconciliation-design.md` was never implemented (no such file exists). The 34 rows are backlog from an earlier, since-removed mechanism (they predate that design doc by two months).
3. **`statement_only` review-gating contradicts the stated design philosophy.** The reconciliation design doc says "statements are the source of truth" — every *other* unmatched statement row in `_run_dedup_pass` already inserts directly without review. Gating this specific subset was inconsistent, and in practice the gate has no reviewer behind it.
4. **"None of these" lies for single-candidate `ambiguous` items.** These items come from `_run_email_reconciliation_pass` (an unconfirmed lone email transaction, `ambiguous_candidate_ids` has exactly one entry). `/confirm`'s branch (`len(candidate_ids) == 1` → mark that one transaction `statement_confirmed`) fires identically whether the user clicks "Link" or "None of these" — there is no way to actually reject a stray transaction through this UI.
5. **No candidate-claim propagation.** Two live `ambiguous` rows were found sharing the same candidate pair. Resolving one doesn't remove the claimed transaction ID from sibling items' candidate lists, so the same transaction could be linked to two different statement rows.
6. **`/link` doesn't validate its input.** `POST /review-queue/{id}/link` accepts any `transaction_id`, not just one from `ambiguous_candidate_ids`.
7. **Idempotency key is fragile.** The unique index added in `8b1280e` is `(review_type, description, amount, transaction_date, direction, account)`. UPI descriptions embed reference numbers that vary slightly per extraction, so the same logical duplicate can slip past the guard.
8. **No pre-insert dedup check against manual entries.** If a user manually enters a transaction that would have matched a queued item, confirming/inserting the queued item later can double-book it.

## Decisions

- **`statement_only` is retired as a review-gated type.** Existing backlog gets processed (inserted or skipped-as-duplicate) once, then the type and its dedicated endpoints are removed. If `StatementReconciliationService` is built in the future, unmatched statement rows insert directly — no review queue involvement.
- Full scope: all eight problems above are addressed in this pass (per user direction — no partial/deferred scope).

## Design

### A. Retire `statement_only`

**One-time backlog script** (`backend/scripts/process_statement_only_backlog.py`, run manually once, not part of the app):
- For each unresolved `statement_only` row: check for an existing non-deleted transaction matching `(account, amount, transaction_date, direction)`.
  - Match found → resolve the review row as `confirmed`, skip insert (already covered, e.g. by manual entry).
  - No match → insert via `TransactionOperations.bulk_insert_transactions([raw_data], transaction_source="statement_extraction")`, then resolve the review row as `confirmed`.
- Print a summary (inserted count, skipped-as-duplicate count) for manual sanity-check before commit.

**Code removal** (`backend/src/apis/routes/review_queue_routes.py`):
- Delete the `GET /review-queue/statement-only` and `POST /review-queue/bulk-confirm` endpoints.
- Simplify `/confirm`: since `statement_only` can no longer exist, the only remaining branch is the `ambiguous` one. Multi-candidate `ambiguous` confirm (the "None of these" case, see below) keeps doing the raw_data insert; single-candidate items no longer use `/confirm` at all (superseded by "Looks right" / "Doesn't belong", see B).
- Update `ReviewQueue.review_type` comment (model) to `'ambiguous' only (statement_only retired 2026-08)`.

**Frontend removal** (`frontend/src/hooks/use-review-queue.ts`, `frontend/src/lib/api/client.ts`):
- Remove `useBulkConfirmReviewItems` and any `statement_only`-specific API client methods (dead — never called from any component).

**Docs**: append a note to `2026-06-29-statement-reconciliation-design.md` — if this service is ever built, unmatched statement rows insert directly (reusing the same account/amount/date/direction dedup check as the backlog script), no review queue.

### B. Fix single-candidate `ambiguous` semantics

Backend — new endpoint in `review_queue_routes.py`:
```
POST /review-queue/{item_id}/reject
```
- Loads the item; requires `len(ambiguous_candidate_ids) == 1` (400 otherwise — multi-candidate items reject via the existing "None of these" → `/confirm` insert path, unchanged).
- Soft-deletes the one candidate transaction (`is_deleted=true, deleted_at=now()` via a new `TransactionOperations.soft_delete(transaction_id)` if one doesn't already exist — check `transaction_routes.py` for an existing delete path to reuse before adding a new DB op).
- Resolves the review item with `resolution='rejected'`.

Frontend (`statement-review-queue.tsx`):
- When `candidateIds.length === 1`, render two buttons instead of the candidate-list "Link" + "None of these" combo: **Looks right** (calls existing `onLink`, i.e. `/link`) and **Doesn't belong** (calls new `onReject` → `/reject`).
- When `candidateIds.length > 1`, behavior is unchanged (per-candidate "Link" buttons + "None of these" → `/confirm` insert).

### C. Candidate-claim propagation

New op in `review_queue_operations.py`:
```python
@staticmethod
async def remove_candidate_from_others(transaction_id: str, exclude_item_id: str) -> None:
    """array_remove(transaction_id) from ambiguous_candidate_ids on every other unresolved item."""
```
- `UPDATE review_queue SET ambiguous_candidate_ids = array_remove(ambiguous_candidate_ids, :tx_id) WHERE resolved_at IS NULL AND id != :exclude_id AND :tx_id = ANY(ambiguous_candidate_ids)`.
- Called from `/link` and `/reject` (the two places a specific candidate transaction gets "claimed") right after the item's own resolution succeeds.
- No special handling needed if a sibling's candidate list becomes empty — the existing UI already renders "0 possible matches" with a working "None of these" fallback.

### D. `/link` input validation

In `link_review_item` (`review_queue_routes.py`): before resolving, fetch the item and check `request.transaction_id in (item.get("ambiguous_candidate_ids") or [])`; raise `HTTPException(400, "transaction_id is not a candidate for this item")` otherwise.

### E. Idempotency key hardening

New migration `n9o0p1q2r3s4_narrow_review_queue_dedup_index.py`:
- Drop the existing unique index from `m8n9o0p1q2r3_add_review_queue_dedup_index.py`.
- Create a new one on `(review_type, account, transaction_date, amount, direction) WHERE resolved_at IS NULL` (description dropped).
- `downgrade()` restores the original index for rollback safety.

### F. Pre-insert dedup safety check

Add a small helper (`TransactionOperations.exists_matching(account, amount, transaction_date, direction) -> bool`, non-deleted only) and call it:
- In the backlog script (A) before each insert.
- In `/confirm`'s remaining insert branch (multi-candidate `ambiguous` "None of these"), before calling `bulk_insert_transactions` — if a match already exists, skip the insert and just resolve the item as `confirmed` (same pattern as the backlog script).

## Testing

- `tests/test_review_queue.py` (new): candidate-claim propagation (C), `/link` rejects non-candidate IDs (D), `/reject` requires single-candidate and soft-deletes correctly (B), pre-insert dedup skip (F).
- Manual: run the backlog script against a DB snapshot first, review its printed summary before running against production data.

## Out of scope

- Building `StatementReconciliationService` itself (still just a design doc; this pass only updates its stated insert behavior).
- Any change to `_run_dedup_pass` tier-1/tier-2 matching logic (unaffected — this pass is entirely about the review-queue layer downstream of it).
- UI redesign beyond the two-button single-candidate change in B.
