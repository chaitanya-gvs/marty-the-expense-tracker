# Statement Reconciliation Design

## Overview

Statement reconciliation validates that every transaction row in a downloaded bank statement has a corresponding record in the database. Statements are the source of truth — anything present in a statement but absent from the DB is flagged to the review queue.

The feature runs automatically at the end of each workflow (after both email ingestion and statement DB insertion are complete) and is available on-demand via API for any previously-processed statement.

---

## Architecture

### New file

**`backend/src/services/orchestrator/statement_reconciliation_service.py`** — `StatementReconciliationService`

Standalone class, no coupling to `StatementWorkflow`. Takes a GCS service instance and a DB session factory at construction. All reconciliation logic lives here.

### Modified files

- **`backend/src/services/orchestrator/statement_workflow.py`** — call reconciliation as the final step (step 8) of the main workflow, after both email ingestion and statement DB insertion complete, and before `workflow_complete` is emitted.
- **`backend/src/apis/routes/workflow_routes.py`** — add `POST /api/workflow/reconcile` for on-demand runs.
- **`backend/src/services/database_manager/operations/transaction_operations.py`** — add `get_transactions_for_period(account_nickname, date_from, date_to)`.
- **`backend/src/services/database_manager/operations/review_queue_operations.py`** — add `supersede_statement_only_for_period(account, date_from, date_to)`.
- **`backend/src/services/database_manager/operations/statement_log_operations.py`** — add `get_db_inserted_for_reconcile(account_nickname=None, statement_month=None)` for the on-demand API lookup.

---

## Period Determination

The billing period for a statement is derived using the existing `_get_billing_window` logic (already in `statement_workflow.py`):

```
anchor = min(statement_transaction_dates)
if anchor.day < billing_cycle_start:
    cycle_start = date(prev_month.year, prev_month.month, billing_cycle_start)
else:
    cycle_start = date(anchor.year, anchor.month, billing_cycle_start)
period_end = cycle_start + relativedelta(months=1) - timedelta(days=1)
```

If `billing_cycle_start` is null, fall back to `min(dates)` / `max(dates)`.

This logic is extracted into a **module-level utility function** `compute_billing_period(stmt_dates, billing_cycle_start)` inside the new service, so both the workflow and the service can share it without importing from one to the other.

---

## Data Flow

```
StatementProcessingLog (status=db_inserted)
  └─ csv_cloud_path → GCSService.download → parse CSV rows
  └─ account_nickname → AccountOperations → billing_cycle_start
        ↓
  compute_billing_period(stmt_dates, billing_cycle_start) → (date_from, date_to)
        ↓
  TransactionOperations.get_transactions_for_period(
      account_nickname, date_from, date_to
  ) → [(id, transaction_date, amount, direction)]
        ↓
  Match each statement row against DB transactions (see Matching below)
        ↓
  Unmatched rows → ReviewQueueOperations.add_item(review_type='statement_only', ...)
  All rows      → compute total debits/credits from both sides → log if mismatch
        ↓
  Return ReconciliationResult
```

---

## Matching Algorithm

For each statement row, two tiers are attempted in order. A match at any tier marks the row as reconciled.

**Tier 1 — Exact**
```
abs(stmt_amount - db_amount) < 0.01
AND stmt_direction == db_direction
AND stmt_date == db_date
```

**Tier 2 — Fuzzy**
```
abs(stmt_amount - db_amount) < 0.01
AND stmt_direction == db_direction
AND abs((stmt_date - db_date).days) <= 3
```

DB transactions can only be claimed by one statement row (first match wins). This prevents a single DB transaction from satisfying multiple statement rows when the same amount appears more than once in a period.

Rows that fail both tiers are sent to the review queue.

---

## Review Queue Items

Unmatched statement rows are queued as:

```python
ReviewQueueOperations.add_item(
    review_type="statement_only",
    transaction_date=stmt_row["date"],
    amount=stmt_row["amount"],
    description=stmt_row["description"],
    account=account_nickname,
    direction=stmt_row["direction"],
    transaction_type=stmt_row["transaction_type"],
    reference_number=stmt_row.get("reference_number"),
    raw_data=stmt_row,           # full original CSV row
    ambiguous_candidate_ids=None,
)
```

**Idempotency**: Before queueing, `StatementReconciliationService` resolves (with `resolution='superseded'`) all existing unresolved `statement_only` items for the same `account` and `transaction_date` range (the billing period). This requires a new `ReviewQueueOperations.supersede_statement_only_for_period(account, date_from, date_to)` method. Re-runs then produce a fresh, correct queue state.

---

## Total Validation

After matching, the service computes:

```
stmt_debit_total  = sum of all statement rows where direction == 'debit'
stmt_credit_total = sum of all statement rows where direction == 'credit'
db_debit_total    = sum of DB transactions for the period where direction == 'debit'
db_credit_total   = sum of DB transactions for the period where direction == 'credit'
```

If `abs(stmt_debit_total - db_debit_total) > 0.01` or `abs(stmt_credit_total - db_credit_total) > 0.01`, a warning is logged and included in the `ReconciliationResult`. This is informational only — the row-level matching already surfaces the discrepancy via the review queue.

---

## ReconciliationResult

```python
@dataclass
class ReconciliationResult:
    account_nickname: str
    statement_month: str          # "2026-05"
    period_start: date
    period_end: date
    statement_row_count: int
    matched_count: int
    unmatched_count: int          # → review queue
    stmt_debit_total: Decimal
    stmt_credit_total: Decimal
    db_debit_total: Decimal
    db_credit_total: Decimal
    total_mismatch: bool          # True if either debit or credit total differs
```

---

## New DB Operation

```python
# backend/src/services/database_manager/operations/transaction_operations.py

@staticmethod
async def get_transactions_for_period(
    account_nickname: str,
    date_from: date,
    date_to: date,
) -> List[Dict[str, Any]]:
    """
    Returns all non-deleted transactions for the given account
    and inclusive date range. Fields: id, transaction_date, amount, direction.
    """
```

The query filters on `account = account_nickname`, `transaction_date BETWEEN date_from AND date_to`, and `is_deleted = false`.

---

## Workflow Integration

Reconciliation is step 8, inserted right before `_emit("workflow_complete", ...)` in the main workflow path. It runs for every statement that reached `db_inserted` status during this run.

The workflow already collects `db_inserted_keys_this_run` (the set of `normalized_filename` values marked `db_inserted` during this run). Each entry is paired with the metadata already available in the workflow's in-memory statement list (account_nickname, csv_cloud_path, statement_month).

```python
# After db_inserted loop, before workflow_complete emit:
reconciliation_results = []
for csv_key, meta in db_inserted_meta_this_run.items():
    # meta = {"account_nickname": ..., "csv_cloud_path": ..., "statement_month": ...}
    if not meta.get("csv_cloud_path"):
        continue
    result = await self.reconciliation_service.reconcile_statement(
        meta["account_nickname"],
        meta["csv_cloud_path"],
        meta["statement_month"],
    )
    reconciliation_results.append(result)
    if result.unmatched_count > 0:
        self._emit("reconciliation_warning", "reconciliation",
            f"{result.unmatched_count} unmatched rows for {meta['account_nickname']} "
            f"({meta['statement_month']}) queued for review",
            level="warning",
            data=asdict(result),
        )
```

`db_inserted_meta_this_run` is a `dict[str, dict]` keyed by `normalized_filename`, built up inside the existing `db_inserted` marking loop (no new DB lookups needed).

The `StatementWorkflow` constructor receives a `StatementReconciliationService` instance (injected, not imported inline).

---

## On-Demand API

```
POST /api/workflow/reconcile
```

Request body (all fields optional):
```json
{
  "account_key": "axis_atlas",
  "statement_month": "2026-05"
}
```

Behaviour — uses `StatementLogOperations.get_db_inserted_for_reconcile(account_nickname, statement_month)` to locate candidates:
- If both fields provided: reconcile that specific statement.
- If only `account_key`: reconcile all `db_inserted` statements for that account.
- If neither: reconcile all `db_inserted` statements across all accounts.

Response:
```json
{
  "results": [
    {
      "account_nickname": "Axis Atlas Credit Card",
      "statement_month": "2026-05",
      "period_start": "2026-04-02",
      "period_end": "2026-05-01",
      "statement_row_count": 42,
      "matched_count": 41,
      "unmatched_count": 1,
      "total_mismatch": false
    }
  ]
}
```

The endpoint runs synchronously (no SSE) since it's a lightweight read + queue operation. If runtime becomes a concern for large backfills, this can be moved to a background task later.

---

## Error Handling

- If the CSV cannot be downloaded from GCS → log error, skip this statement, continue with others.
- If `billing_cycle_start` is null → fall back to min/max date from the CSV.
- If the statement CSV has zero parseable rows → skip reconciliation for that statement, log a warning.
- No unhandled exceptions should propagate out of `reconcile_statement()`; all errors are caught and returned as part of the result (with `error` field set).

---

## What Is NOT in Scope

- Modifying existing `review_queue` items for `'ambiguous'` type (untouched).
- UI changes to the review page — the `statement_only` review type already renders in the frontend's review queue.
- Reconciliation for Splitwise-only workflow runs (no statement CSV to validate against).
- Email-only accounts (no statement CSV exists; not present in `StatementProcessingLog`).
