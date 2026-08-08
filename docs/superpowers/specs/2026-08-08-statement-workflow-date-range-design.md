# Statement Workflow Date-Range Fix Design

## Context

`StatementWorkflow._calculate_date_range()` (`backend/src/services/orchestrator/statement_workflow.py:327`) computes the email search window for statement ingestion as a fixed ~30-day span: `previous-month STATEMENT_SEARCH_DAY` → `current-month STATEMENT_SEARCH_DAY` (default day 25), anchored to `datetime.now()`. It does not track how long it's actually been since the last successful run.

This was surfaced by a concrete failure: triggering the pipeline on 2026-08-08 to catch up on ~2 months of backlog (last successful run 2026-06-28, confirmed via `statement_processing_log` — every account's last entry is `..._202606XX`). Most accounts' `billing_cycle_start` is early-month (1-6), so July statements arrived ~July 3-8 — well before a default Jul25-Aug25 window. A default-triggered run today would silently miss July entirely and only catch August. `end_date` has a related bug: hardcoded to day-25-of-current-month, which is already in the past for the back third of every month.

## Decisions

- **Global scope**, not per-account: one computed `start_date`/`end_date` for the whole run. Smaller change than true per-account ranges; safe because over-searching an already-caught-up account is harmless (see Verified invariant below).
- **3-day safety buffer** subtracted from the computed start date.

## Design

### Core logic

`_calculate_date_range()` changes from the static day-25-anchored formula to a data-driven one:

1. Fetch `last_statement_date` for all active statement-sender accounts (via `AccountOperations`).
2. **`start_date`** = `MIN(last_statement_date)` across those accounts, minus a **3-day** buffer.
3. **`end_date`** = `now()` (replaces the hardcoded day-25-of-current-month).
4. **Fallback**: if any active account has `last_statement_date IS NULL`, or the account list is empty, or the query fails, fall back entirely to the existing fixed-window formula for this run — preserves current first-run/error behavior unchanged. (All-or-nothing fallback, not per-account null substitution — simpler, and the fixed window has always been the safe default.)

MIN (not MAX/average) is the key correctness property: it guarantees the earliest straggler account's backlog is never silently skipped. `accounts.last_statement_date` and `last_processed_at` already exist and are updated per-account after every successful statement insert (`statement_workflow.py:1177-1178`, via `AccountOperations.update_last_statement_date` / `update_last_processed_at`) — this fix only changes what `_calculate_date_range()` reads, it adds no new write paths.

### Verified invariant: buffer overlap cannot cause reprocessing

The 3-day buffer (and MIN-across-accounts in general) will routinely cause the search window to re-include statements that are already processed. This is safe by construction, confirmed in the existing code (not assumed):

- `statement_workflow.py:507-520` — before downloading any statement PDF, the workflow computes its `normalized_filename` (`{account}_{YYYY-MM}`, month granularity) and checks it against `statement_processing_log`. If already `extracted`/`db_inserted`, it logs `"Skipped {original_filename} — already processed"` and never downloads it.
- `statement_workflow.py:1112` — a per-sender/month early skip (`"All statements already complete for {sender_email} ({expected_statement_month})"`) short-circuits before even reaching individual files.

Because the dedup key is month-granularity rather than exact-date, it doesn't matter that the buffer pulls `start_date` back into a window containing an already-processed statement — Gmail search re-finds it, the pipeline recognizes it, and skips before download/extraction/insert. No reprocessing, no duplicate rows.

### Error handling & fallback

- **No active accounts, or all have `last_statement_date IS NULL`**: fall back to the current fixed-window (day-25→day-25) logic — unchanged first-run behavior.
- **Mixed case** (some accounts have a date, some `NULL`): treat as disqualifying the data-driven path for this run entirely; use the fixed-window fallback for everyone. Simpler than a per-null substitution, consistent with YAGNI.
- **`end_date` in the future relative to now()**: not reachable, since `end_date = now()` always.
- **DB error fetching `last_statement_date`**: log and fall back to the fixed-window logic rather than failing the whole workflow run.

## Testing

Unit tests for `_calculate_date_range()`:
- All accounts have `last_statement_date` → `start_date = MIN(...) - 3 days`, `end_date = today`.
- One account `NULL` → falls back to the current fixed-window formula (regression-pins existing behavior).
- No active accounts → same fallback.
- Boundary case: buffer crossing a month/year boundary — date arithmetic sanity check.

No new test needed for the dedup-under-buffer-overlap concern — it's existing, already-covered pipeline behavior (`normalized_filename` skip logic), not new code introduced by this fix.

**Manual/integration check after deploy**: trigger a real run and confirm both July and August backlog get picked up (the original motivating scenario), with log lines showing `already processed` skips for anything re-scanned inside the buffer.

## Deployment note

This is a backend change to `statement_workflow.py`; the container needs a restart after it lands (no hot reload in this deployment — see prior incidents on the same file: e-mandate duplicate transactions fix).
