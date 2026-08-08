# Statement Workflow Date-Range Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `StatementWorkflow._calculate_date_range()` compute its email-search window from each account's actual last-processed date instead of a fixed 30-day window, so a delayed pipeline run doesn't silently skip backlog.

**Architecture:** Add one new read-only `AccountOperations` query that aggregates `last_statement_date` across active statement-sender accounts. `_calculate_date_range()` becomes async, uses `MIN(last_statement_date) - 3 days` as `start_date` and `now()` as `end_date` when that data is fully available, and falls back to the existing fixed STATEMENT_SEARCH_DAY window (extracted into its own helper) otherwise. Existing `normalized_filename` dedup in the processing log already makes any resulting overlap harmless — no new dedup logic needed.

**Tech Stack:** Python 3.12, SQLAlchemy 2.0 async (raw `text()` queries, matching the existing `AccountOperations` style), pytest + pytest-asyncio (`asyncio_mode = auto`), unittest.mock (`AsyncMock`/`patch`).

## Global Constraints

- Safety buffer: exactly **3 days**, subtracted from `MIN(last_statement_date)`.
- Scope: **global** — one `start_date`/`end_date` pair for the whole run, not per-account.
- Fallback trigger: any of — zero active statement-sender accounts, at least one active statement-sender account with `last_statement_date IS NULL`, or the stats query raising an exception. On any of these, use the existing fixed STATEMENT_SEARCH_DAY window unchanged.
- "Active statement-sender account" = `accounts.is_active = true AND statement_sender IS NOT NULL AND statement_sender != ''` (same predicate already used by `AccountOperations.get_all_statement_senders()`).
- No changes to `accounts.last_statement_date` / `last_processed_at` write paths — only a new read path.
- Backend has no hot reload in the deployed environment; a container restart is required after this lands (not part of this plan's tasks — call it out at handoff).

---

## Task 1: Add `AccountOperations.get_statement_account_date_stats()`

**Files:**
- Modify: `backend/src/services/database_manager/operations/account_operations.py`

**Interfaces:**
- Produces: `AccountOperations.get_statement_account_date_stats() -> dict` (async staticmethod) returning `{"min_last_statement_date": date | None, "account_count": int, "null_count": int}`. Consumed by Task 3.

- [ ] **Step 1: Add the method**

Add this method to the `AccountOperations` class in `backend/src/services/database_manager/operations/account_operations.py`, placed after `get_all_statement_senders` (around line 227):

```python
    @staticmethod
    async def get_statement_account_date_stats() -> dict:
        """Aggregate last_statement_date across active statement-sender accounts.

        Used by StatementWorkflow._calculate_date_range() to compute a
        data-driven search window. Returns a dict with:
            - min_last_statement_date: MIN(last_statement_date) across active
              statement-sender accounts, or None if there are no such accounts
              or none has ever been processed
            - account_count: number of active statement-sender accounts
            - null_count: how many of those have never been processed
              (last_statement_date IS NULL)
        """
        try:
            session_factory = get_session_factory()
            async with session_factory() as session:
                result = await session.execute(
                    text("""
                        SELECT
                            MIN(last_statement_date) AS min_last_statement_date,
                            COUNT(*) AS account_count,
                            COUNT(*) FILTER (WHERE last_statement_date IS NULL) AS null_count
                        FROM accounts
                        WHERE is_active = true
                          AND statement_sender IS NOT NULL
                          AND statement_sender != ''
                    """)
                )
                row = result.fetchone()
                stats = dict(row._mapping)
                logger.info(
                    "Statement account date stats: %d accounts, %d never processed, min=%s",
                    stats["account_count"], stats["null_count"], stats["min_last_statement_date"],
                )
                return stats
        except Exception:
            logger.error("Failed to retrieve statement account date stats", exc_info=True)
            raise
```

- [ ] **Step 2: Manual verification against the dev DB (if available)**

`AccountOperations` has no dedicated unit test file in this codebase (its methods are exercised indirectly through workflow-level tests, which is what Task 3 does via mocking). To sanity-check the raw SQL itself, if a local Postgres dev DB is running (per `backend/CLAUDE.md`, `localhost:5432`, db `expense_db`), from `backend/` run:

```bash
poetry run python -c "
import asyncio
from src.services.database_manager.operations import AccountOperations

async def main():
    print(await AccountOperations.get_statement_account_date_stats())

asyncio.run(main())
"
```

Expected: a dict printed with plausible `account_count` (matches your number of active statement-sender accounts) and a `min_last_statement_date` that is a real date (not obviously wrong). If Postgres isn't running locally, skip this step — Task 3's mocked tests cover the calling contract StatementWorkflow depends on.

- [ ] **Step 3: Commit**

```bash
cd backend
git add src/services/database_manager/operations/account_operations.py
git commit -m "feat(accounts): add get_statement_account_date_stats query

Aggregates MIN(last_statement_date) plus account/null counts across
active statement-sender accounts. Backs the data-driven date-range
calculation in StatementWorkflow (next commit).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 2: Extract the fixed-window logic into `_calculate_fallback_date_range`

Pure refactor, no behavior change — pulls the current fixed STATEMENT_SEARCH_DAY math out of `_calculate_date_range()` into its own testable helper that takes `now` as an explicit argument (avoids depending on wall-clock time in tests). `_calculate_date_range()` keeps its current sync signature and behavior for now; Task 3 converts it to the new async/data-driven version.

**Files:**
- Modify: `backend/src/services/orchestrator/statement_workflow.py:140` (class attribute), `:327-350` (method)
- Test: `backend/tests/test_workflow_orchestrator.py`

**Interfaces:**
- Produces: `StatementWorkflow._calculate_fallback_date_range(self, now: datetime) -> tuple[str, str]`. Consumed by Task 3.
- Produces: class attribute `StatementWorkflow.DATE_RANGE_SAFETY_BUFFER_DAYS = 3`. Consumed by Task 3.

- [ ] **Step 1: Write the failing test**

Add to `backend/tests/test_workflow_orchestrator.py`, inside `class TestStatementWorkflow`, near `test_date_range_calculation`:

```python
    def test_fallback_date_range_uses_search_day(self):
        """Fixed-window fallback: prev-month day-N to current-month day-N"""
        from datetime import datetime

        workflow = StatementWorkflow()

        start_date, end_date = workflow._calculate_fallback_date_range(datetime(2026, 8, 8))
        assert start_date == "2026/07/25"
        assert end_date == "2026/08/25"

    def test_fallback_date_range_handles_january(self):
        """January rolls back to December of the previous year"""
        from datetime import datetime

        workflow = StatementWorkflow()

        start_date, end_date = workflow._calculate_fallback_date_range(datetime(2026, 1, 10))
        assert start_date == "2025/12/25"
        assert end_date == "2026/01/25"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && poetry run pytest tests/test_workflow_orchestrator.py -v -k fallback_date_range`
Expected: FAIL — `AttributeError: 'StatementWorkflow' object has no attribute '_calculate_fallback_date_range'`

- [ ] **Step 3: Extract the helper**

In `backend/src/services/orchestrator/statement_workflow.py`, add the class attribute right after the class docstring (line 141):

```python
class StatementWorkflow:
    """Orchestrates the complete statement processing workflow"""

    DATE_RANGE_SAFETY_BUFFER_DAYS = 3

    def __init__(
```

Then replace the body of `_calculate_date_range` (lines 327-350) with:

```python
    def _calculate_fallback_date_range(self, now: datetime) -> tuple[str, str]:
        """
        Fixed-window fallback: STATEMENT_SEARCH_DAY of the previous month to
        STATEMENT_SEARCH_DAY of the current month (configurable via env var,
        default 25). Used when no per-account last-statement-date signal is
        available (see _calculate_date_range).
        """
        day = get_settings().STATEMENT_SEARCH_DAY

        current_month_nth = now.replace(day=day)

        if now.month == 1:
            previous_month_nth = now.replace(year=now.year - 1, month=12, day=day)
        else:
            previous_month_nth = now.replace(month=now.month - 1, day=day)

        return previous_month_nth.strftime("%Y/%m/%d"), current_month_nth.strftime("%Y/%m/%d")

    def _calculate_date_range(self) -> tuple[str, str]:
        """
        Calculate date range for statement retrieval.

        TEMPORARY: still delegates straight to the fixed-window fallback.
        Task 3 replaces this with the data-driven async version.
        """
        start_date, end_date = self._calculate_fallback_date_range(datetime.now())
        logger.info(f"Date range for statement retrieval: {start_date} to {end_date}", extra=self._log_extra())
        return start_date, end_date
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && poetry run pytest tests/test_workflow_orchestrator.py -v -k "fallback_date_range or date_range_calculation"`
Expected: PASS — all 3 tests (`test_date_range_calculation`, `test_fallback_date_range_uses_search_day`, `test_fallback_date_range_handles_january`) pass. `test_date_range_calculation` still passes unchanged since `_calculate_date_range()`'s external behavior hasn't changed yet.

- [ ] **Step 5: Commit**

```bash
cd backend
git add src/services/orchestrator/statement_workflow.py tests/test_workflow_orchestrator.py
git commit -m "refactor(workflow): extract fixed-window date range into _calculate_fallback_date_range

Pure extraction, no behavior change. Takes 'now' as an explicit
argument so it's testable without depending on wall-clock time.
Prep for the data-driven date range in the next commit.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 3: Make `_calculate_date_range` data-driven, with fallback

**Files:**
- Modify: `backend/src/services/orchestrator/statement_workflow.py:327` (`_calculate_date_range`, replaces the temporary version from Task 2), `:1081` (call site)
- Modify: `backend/tests/test_workflow_orchestrator.py` (rewrite `test_date_range_calculation`, add new tests, update `run_tests()` helper)
- Modify: `backend/tests/test_complete_workflow.py:187` (add `await`)

**Interfaces:**
- Consumes: `AccountOperations.get_statement_account_date_stats()` (Task 1), `StatementWorkflow._calculate_fallback_date_range(now)` and `DATE_RANGE_SAFETY_BUFFER_DAYS` (Task 2).
- Produces: `async def StatementWorkflow._calculate_date_range(self, now: Optional[datetime] = None) -> tuple[str, str]` — now async; callers must `await` it. `now` is optional (defaults to `datetime.now()`) so tests can pass a fixed value.

- [ ] **Step 1: Write the failing tests**

Replace the existing `test_date_range_calculation` method in `backend/tests/test_workflow_orchestrator.py` and add new ones alongside it:

```python
    async def test_date_range_calculation_smoke(self):
        """End-to-end smoke test: default call (no accounts mocked) still
        returns a valid, correctly-ordered date range via the fallback path."""
        with patch(
            "src.services.orchestrator.statement_workflow.AccountOperations.get_statement_account_date_stats",
            new_callable=AsyncMock,
            return_value={"min_last_statement_date": None, "account_count": 0, "null_count": 0},
        ):
            workflow = StatementWorkflow()
            start_date, end_date = await workflow._calculate_date_range()

        from datetime import datetime as dt
        assert len(start_date.split('/')) == 3
        assert len(end_date.split('/')) == 3
        start_dt = dt.strptime(start_date, "%Y/%m/%d")
        end_dt = dt.strptime(end_date, "%Y/%m/%d")
        assert start_dt < end_dt

    async def test_date_range_data_driven(self):
        """When every active statement-sender account has a last_statement_date,
        start_date = MIN(last_statement_date) - 3 days, end_date = now."""
        from datetime import date as d, datetime as dt

        with patch(
            "src.services.orchestrator.statement_workflow.AccountOperations.get_statement_account_date_stats",
            new_callable=AsyncMock,
            return_value={
                "min_last_statement_date": d(2026, 6, 28),
                "account_count": 3,
                "null_count": 0,
            },
        ):
            workflow = StatementWorkflow()
            start_date, end_date = await workflow._calculate_date_range(now=dt(2026, 8, 8))

        assert start_date == "2026/06/25"  # 2026-06-28 minus 3 days
        assert end_date == "2026/08/08"

    async def test_date_range_data_driven_buffer_crosses_month_boundary(self):
        """3-day buffer subtracted from an early-month min date crosses into
        the previous month/year correctly."""
        from datetime import date as d, datetime as dt

        with patch(
            "src.services.orchestrator.statement_workflow.AccountOperations.get_statement_account_date_stats",
            new_callable=AsyncMock,
            return_value={
                "min_last_statement_date": d(2026, 8, 1),
                "account_count": 2,
                "null_count": 0,
            },
        ):
            workflow = StatementWorkflow()
            start_date, end_date = await workflow._calculate_date_range(now=dt(2026, 8, 8))

        assert start_date == "2026/07/29"  # 2026-08-01 minus 3 days crosses into July
        assert end_date == "2026/08/08"

    async def test_date_range_data_driven_handles_datetime_value(self):
        """min_last_statement_date coming back as a datetime (not date) is truncated correctly."""
        from datetime import datetime as dt

        with patch(
            "src.services.orchestrator.statement_workflow.AccountOperations.get_statement_account_date_stats",
            new_callable=AsyncMock,
            return_value={
                "min_last_statement_date": dt(2026, 6, 28, 14, 30),
                "account_count": 1,
                "null_count": 0,
            },
        ):
            workflow = StatementWorkflow()
            start_date, end_date = await workflow._calculate_date_range(now=dt(2026, 8, 8))

        assert start_date == "2026/06/25"
        assert end_date == "2026/08/08"

    async def test_date_range_falls_back_when_account_never_processed(self):
        """Any active statement-sender account with last_statement_date IS NULL
        disqualifies the data-driven path for the whole run."""
        from datetime import date as d, datetime as dt

        with patch(
            "src.services.orchestrator.statement_workflow.AccountOperations.get_statement_account_date_stats",
            new_callable=AsyncMock,
            return_value={
                "min_last_statement_date": d(2026, 6, 28),
                "account_count": 3,
                "null_count": 1,
            },
        ):
            workflow = StatementWorkflow()
            start_date, end_date = await workflow._calculate_date_range(now=dt(2026, 8, 8))

        assert (start_date, end_date) == workflow._calculate_fallback_date_range(dt(2026, 8, 8))

    async def test_date_range_falls_back_when_no_accounts(self):
        """No active statement-sender accounts -> fixed-window fallback."""
        from datetime import datetime as dt

        with patch(
            "src.services.orchestrator.statement_workflow.AccountOperations.get_statement_account_date_stats",
            new_callable=AsyncMock,
            return_value={"min_last_statement_date": None, "account_count": 0, "null_count": 0},
        ):
            workflow = StatementWorkflow()
            start_date, end_date = await workflow._calculate_date_range(now=dt(2026, 8, 8))

        assert (start_date, end_date) == workflow._calculate_fallback_date_range(dt(2026, 8, 8))

    async def test_date_range_falls_back_on_query_error(self):
        """Stats query raising -> fixed-window fallback, no exception propagates."""
        from datetime import datetime as dt

        with patch(
            "src.services.orchestrator.statement_workflow.AccountOperations.get_statement_account_date_stats",
            new_callable=AsyncMock,
            side_effect=Exception("db unavailable"),
        ):
            workflow = StatementWorkflow()
            start_date, end_date = await workflow._calculate_date_range(now=dt(2026, 8, 8))

        assert (start_date, end_date) == workflow._calculate_fallback_date_range(dt(2026, 8, 8))
```

Then remove the old sync `test_date_range_calculation` method entirely (it's superseded by `test_date_range_calculation_smoke` above and would otherwise fail once `_calculate_date_range` becomes async).

Update `run_tests()` at the bottom of the file: remove `test_instance.test_date_range_calculation()` from the "synchronous tests" section, and add these to the "async tests" section:

```python
        await test_instance.test_date_range_calculation_smoke()
        await test_instance.test_date_range_data_driven()
        await test_instance.test_date_range_data_driven_buffer_crosses_month_boundary()
        await test_instance.test_date_range_data_driven_handles_datetime_value()
        await test_instance.test_date_range_falls_back_when_account_never_processed()
        await test_instance.test_date_range_falls_back_when_no_accounts()
        await test_instance.test_date_range_falls_back_on_query_error()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && poetry run pytest tests/test_workflow_orchestrator.py -v -k date_range`
Expected: FAIL — `TypeError: object tuple can't be used in 'await' expression` (or similar) since `_calculate_date_range` is still sync from Task 2, and doesn't accept a `now` kwarg.

- [ ] **Step 3: Implement the data-driven logic**

In `backend/src/services/orchestrator/statement_workflow.py`, replace the temporary `_calculate_date_range` written in Task 2 (keep `_calculate_fallback_date_range` as-is) with:

```python
    async def _calculate_date_range(self, now: Optional[datetime] = None) -> tuple[str, str]:
        """
        Calculate date range for statement retrieval.

        Data-driven: start_date = MIN(last_statement_date) across active
        statement-sender accounts, minus DATE_RANGE_SAFETY_BUFFER_DAYS;
        end_date = now(). Falls back to the fixed STATEMENT_SEARCH_DAY window
        (_calculate_fallback_date_range) if any active statement-sender
        account has never been processed, no such accounts exist, or the
        lookup fails — preserving first-run/error-safe behavior.

        The normalized_filename unique key in the processing log prevents
        re-processing anything already inserted, even when the buffer causes
        the search window to overlap a previously-covered range.
        """
        now = now or datetime.now()

        try:
            stats = await AccountOperations.get_statement_account_date_stats()
        except Exception:
            logger.warning(
                "Failed to fetch account statement-date stats — using fixed-window fallback",
                exc_info=True, extra=self._log_extra(),
            )
            return self._calculate_fallback_date_range(now)

        min_date = stats.get("min_last_statement_date")
        if stats.get("account_count", 0) == 0 or stats.get("null_count", 0) > 0 or min_date is None:
            logger.info(
                "Using fixed-window fallback for date range "
                "(no statement-sender accounts, or one has never been processed)",
                extra=self._log_extra(),
            )
            return self._calculate_fallback_date_range(now)

        if isinstance(min_date, datetime):
            min_date = min_date.date()
        start_dt = datetime.combine(min_date, datetime.min.time()) - timedelta(
            days=self.DATE_RANGE_SAFETY_BUFFER_DAYS
        )
        start_date = start_dt.strftime("%Y/%m/%d")
        end_date = now.strftime("%Y/%m/%d")

        logger.info(
            f"Date range for statement retrieval (data-driven): {start_date} to {end_date}",
            extra=self._log_extra(),
        )
        return start_date, end_date
```

Update the call site around line 1081:

```python
                    # Step 3: Calculate date range
                    start_date, end_date = await self._calculate_date_range()
```

(This call is already inside an `async def` method that `await`s elsewhere on neighboring lines, so no further changes are needed there.)

Fix the other caller in `backend/tests/test_complete_workflow.py:187`:

```python
        start_date, end_date = await workflow._calculate_date_range()
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && poetry run pytest tests/test_workflow_orchestrator.py -v`
Expected: PASS — all tests in the file, including the new and existing ones.

Run: `cd backend && poetry run pytest tests/test_complete_workflow.py --collect-only`
Expected: no collection errors (confirms the `await` fix is syntactically correct). Do not execute `test_complete_workflow` itself — it's a real Gmail/DB end-to-end script unrelated to this fix and isn't part of this plan's verification.

- [ ] **Step 5: Run the full non-E2E test suite as a regression check**

Run: `cd backend && poetry run pytest tests/ -v --ignore=tests/test_complete_workflow.py`
Expected: PASS (or the same pre-existing failures/skips as before this change, if any — none introduced by this fix). If anything outside the files touched in this plan fails, stop and investigate before committing.

- [ ] **Step 6: Commit**

```bash
cd backend
git add src/services/orchestrator/statement_workflow.py tests/test_workflow_orchestrator.py tests/test_complete_workflow.py
git commit -m "fix(workflow): compute statement date range from last_statement_date

_calculate_date_range() is now data-driven: start_date =
MIN(last_statement_date) across active statement-sender accounts minus
a 3-day safety buffer, end_date = now(). Falls back to the existing
fixed STATEMENT_SEARCH_DAY window when any account has never been
processed, none exist, or the lookup fails.

Fixes silent backlog-skipping when the pipeline hasn't run recently
(e.g. June->August gap missed July's early-month statements under the
old fixed day-25 window). Buffer-overlap re-scans are a no-op via the
existing normalized_filename dedup in statement_processing_log.

See docs/superpowers/specs/2026-08-08-statement-workflow-date-range-design.md

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Handoff note (not a task — read before running the pipeline)

This backend has no hot reload in the deployed environment. After this lands, restart the backend container before triggering a real workflow run, or the fix will be inert. (Same class of issue as the e-mandate duplicate-transactions incident — see memory `backend-needs-restart-after-code-changes`.)
