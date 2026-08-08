# Multi-Month Standardization Scan Design

## Context

Discovered mid-incident on 2026-08-08 while resuming a statement-workflow catch-up run for the date-range fix landed earlier the same day. `DataStandardizerHelper.process()` — the only code path that turns extracted CSVs into `transactions` rows (Step 6 of `StatementWorkflow.run_complete_workflow`) — computes a single `previous_month = <1st..last day of last calendar month>` window relative to `datetime.now()` and only lists that one GCS `{month}/extracted_data/` folder. Any statement whose CSV was produced in a month other than "the previous calendar month as of whenever Step 6 happens to run" is silently stranded at `csv_stored`/`csv_extracted` forever — it will never reach the `transactions` table, with no error, warning, or visible symptom.

This is a real, currently-live occurrence: an interrupted catch-up run left 9 correctly-extracted statements at `csv_stored` spanning two GCS month-folders (`2026-06`, `2026-07`); a plain re-trigger today would only process `2026-07` (today's "previous month"), permanently stranding the `2026-06` ones. Axis Bank Savings' pending backlog (once re-extracted under a separate, already-fixed sender-resolution bug) will span several more months.

This bug is independent of and was not touched by the date-range fix landed earlier today (`c329493..b150a9c`) — that fix governs Step 3/4 (the email search window), not Step 6 (the DB-insert step). The two bugs happened to surface together only because today's catch-up run is the first time in a while multiple months' worth of backlog needed processing in one go.

## Decisions

- Derive "what needs work" from `statement_processing_log` (the authoritative persisted state — same philosophy as the earlier date-range fix), not from wall-clock-relative month math.
- `error`-status rows are not specially excluded from month discovery: `set_error` is only ever called before a CSV exists (during download/unlock/extraction), so an errored statement never contributes a file for Step 6 to find regardless of whether its month is scanned. No special-casing needed.
- `StatementWorkflow.check_cloud_csvs_exist()` (→ module-level `can_resume_workflow()`) has the identical single-month assumption. Originally scoped out as a currently-unused CLI-only helper, but included per explicit instruction: fix it using the same underlying signal for consistency, rather than leave a second copy of the bug in the codebase.

## Design

### A. New query: `StatementLogOperations.get_pending_statement_months()`

`backend/src/services/database_manager/operations/statement_log_operations.py`, added alongside the other status-query methods (near `get_db_inserted_filenames`):

```python
@staticmethod
async def get_pending_statement_months() -> List[str]:
    """Return every distinct statement_month with at least one row not yet
    db_inserted, ordered chronologically (oldest first).

    Used by the standardization step to discover every month with pending
    work, instead of assuming only 'the previous calendar month' matters.
    """
    session_factory = get_session_factory()
    async with session_factory() as session:
        try:
            result = await session.execute(
                text("""
                    SELECT DISTINCT statement_month
                    FROM statement_processing_log
                    WHERE status != 'db_inserted'
                      AND statement_month IS NOT NULL
                    ORDER BY statement_month
                """)
            )
            return [row[0] for row in result.fetchall()]
        except Exception:
            logger.error("Failed to retrieve pending statement months", exc_info=True)
            return []
```

### B. `DataStandardizerHelper.process()` — multi-month discovery

`backend/src/services/orchestrator/data_standardizer_helper.py`. Current shape:

```python
start_date, end_date = self.calculate_splitwise_date_range()
previous_month = start_date.strftime("%Y-%m")
cloud_csv_files = self.cloud_storage.list_files(f"{previous_month}/extracted_data/")
if not cloud_csv_files:
    ...  # early return [], set()
csv_files_only = [f for f in cloud_csv_files if f.get("name", "").endswith(".csv")]
...
db_inserted_keys = await StatementLogOperations.get_db_inserted_filenames(previous_month)
```

Becomes: fetch `pending_months = await StatementLogOperations.get_pending_statement_months()`; if empty, same early-return `[], set()` (updated log/emit text, no month-specific wording). Otherwise, for each month in `pending_months`, call the existing `self.cloud_storage.list_files(f"{month}/extracted_data/")` and the existing `StatementLogOperations.get_db_inserted_filenames(month)`, and union the results into the same `csv_files_only` list and `db_inserted_keys` set the rest of the function already consumes. `db_inserted_keys` can be safely unioned across months — normalized filenames already embed their own date, so no cross-month collision is possible. Every line after that point (the per-file download/standardize/dedup/sort loop, all `emit()` calls, error handling) is unchanged; it already operates on whatever `csv_files_only`/`db_inserted_keys` it's given, one file at a time.

`calculate_splitwise_date_range` stays as a constructor dependency of `DataStandardizerHelper` (still used elsewhere in the class, e.g. for the `check_cloud_csvs_exist`-adjacent Splitwise CSV naming) — only this one call site's *use* of it for month discovery is replaced.

### C. `check_cloud_csvs_exist()` / `can_resume_workflow()`

`backend/src/services/orchestrator/statement_workflow.py`. Replace the body of `check_cloud_csvs_exist()` with a call to the same new query:

```python
async def check_cloud_csvs_exist(self) -> bool:
    """Check if any statement has extracted data pending standardization/insert."""
    pending_months = await StatementLogOperations.get_pending_statement_months()
    return bool(pending_months)
```

Drops its own previous-month computation and GCS listing entirely — one source of truth instead of two.

## Testing

- `get_pending_statement_months()`: multiple months pending → all returned chronologically; nothing pending → `[]`; a mix of `db_inserted`, `error`, and `csv_stored` rows across months → only months with a non-`db_inserted` row are returned, `error`-only months included (per the "no special-casing" decision — harmless since Step 6 finds no CSV there anyway).
- `DataStandardizerHelper.process()`: two months each contributing CSVs → both sets combined into one `all_valid_data`/dedup/insert batch (mock `get_pending_statement_months` returning two months, mock `list_files`/`get_db_inserted_filenames` per month); empty pending-months list → early return `[], set()`, matching current empty-single-month behavior.
- `check_cloud_csvs_exist()`: `True` when pending months exist, `False` when none do.

## Deployment note

Same as the date-range fix earlier today: this backend has no hot reload — needs `docker compose restart backend` after landing, before re-triggering the paused catch-up run.
