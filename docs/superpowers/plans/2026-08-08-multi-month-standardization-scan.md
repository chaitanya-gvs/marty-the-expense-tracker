# Multi-Month Standardization Scan Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Step 6 of the statement workflow (`DataStandardizerHelper.process()`, the only path that inserts extracted CSVs into `transactions`) discover every month with pending work instead of only "the previous calendar month", so extracted statements from any month reliably reach the database.

**Architecture:** A new `StatementLogOperations.get_pending_statement_months()` query becomes the single source of truth for "which months still need standardizing" (any month with a `statement_processing_log` row not yet `db_inserted`). `DataStandardizerHelper.process()` loops over that list instead of computing one hardcoded month, unioning each month's GCS file listing and already-inserted-filename set before its existing per-file loop (unchanged) runs. `StatementWorkflow.check_cloud_csvs_exist()` is simplified to reuse the same query instead of duplicating the single-month GCS check.

**Tech Stack:** Python 3.12, SQLAlchemy 2.0 async (raw `text()` queries), pytest + pytest-asyncio (this test file uses explicit `@pytest.mark.asyncio`, not the `asyncio_mode=auto` global default — match that), unittest.mock (`MagicMock`/`AsyncMock`/`patch`).

## Global Constraints

- "Pending" = any `statement_processing_log` row with `status != 'db_inserted'` (no special-casing for `error` rows — they never have a CSV in GCS to find regardless, per the spec's decision).
- `get_pending_statement_months()` returns months chronologically (oldest first).
- `db_inserted_keys` unioned across months is safe — normalized filenames already embed their own date, no cross-month collision possible.
- `calculate_splitwise_date_range` stays a constructor dependency of `DataStandardizerHelper` (still used elsewhere in the class) — only its use for month discovery in `process()` is removed.
- `StatementWorkflow.check_cloud_csvs_exist()` drops its own GCS-listing logic entirely in favor of the new query — one source of truth, not two.
- Backend has no hot reload in the deployed environment — needs `docker compose restart backend` after this lands, before resuming the paused catch-up run (not part of this plan's tasks — call out at handoff).

---

## Task 1: Add `StatementLogOperations.get_pending_statement_months()`

**Files:**
- Modify: `backend/src/services/database_manager/operations/statement_log_operations.py`
- Test: `backend/tests/test_statement_log_operations.py` (new file)

**Interfaces:**
- Produces: `StatementLogOperations.get_pending_statement_months() -> List[str]` (async staticmethod), returning distinct `statement_month` values (chronological) with ≥1 row not `db_inserted`. Consumed by Tasks 2 and 3.

This module has no existing dedicated test file, but a sibling operations module (`backend/tests/test_review_queue.py`) establishes the real convention for this layer: integration-style tests that insert real fixture rows via `get_session_factory()` against the local dev Postgres DB (required per `backend/CLAUDE.md`, `localhost:5432`, db `expense_db`), call the method under test, assert, then delete the fixture rows in a `finally` block. Follow that exact pattern here — do not mock SQLAlchemy internals.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_statement_log_operations.py`:

```python
"""
Tests for StatementLogOperations.
Run from backend/ with: poetry run pytest tests/test_statement_log_operations.py -v
"""
import pytest
from sqlalchemy import text

from src.services.database_manager.connection import get_session_factory
from src.services.database_manager.operations.statement_log_operations import StatementLogOperations


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


async def _insert_log_row(normalized_filename: str, statement_month: str, status: str) -> None:
    session_factory = get_session_factory()
    async with session_factory() as session:
        await session.execute(
            text("""
                INSERT INTO statement_processing_log (normalized_filename, statement_month, status)
                VALUES (:normalized_filename, :statement_month, :status)
                ON CONFLICT (normalized_filename) DO UPDATE
                SET statement_month = EXCLUDED.statement_month, status = EXCLUDED.status
            """),
            {"normalized_filename": normalized_filename, "statement_month": statement_month, "status": status},
        )
        await session.commit()


async def _delete_log_row(normalized_filename: str) -> None:
    session_factory = get_session_factory()
    async with session_factory() as session:
        await session.execute(
            text("DELETE FROM statement_processing_log WHERE normalized_filename = :normalized_filename"),
            {"normalized_filename": normalized_filename},
        )
        await session.commit()


@pytest.mark.asyncio
async def test_get_pending_statement_months_returns_non_db_inserted_months():
    """Months with a non-db_inserted row are returned; a purely db_inserted month is not."""
    filenames = [
        ("test_fixture_pending_202605", "2026-05", "csv_stored"),
        ("test_fixture_pending_202606", "2026-06", "csv_extracted"),
        ("test_fixture_pending_202607", "2026-07", "db_inserted"),
    ]
    try:
        for fname, month, status in filenames:
            await _insert_log_row(fname, month, status)

        months = await StatementLogOperations.get_pending_statement_months()

        assert "2026-05" in months
        assert "2026-06" in months
        assert "2026-07" not in months
    finally:
        for fname, _, _ in filenames:
            await _delete_log_row(fname)


@pytest.mark.asyncio
async def test_get_pending_statement_months_orders_chronologically():
    """Returned months are sorted oldest first."""
    filenames = [
        ("test_fixture_order_202608", "2026-08", "csv_stored"),
        ("test_fixture_order_202601", "2026-01", "csv_stored"),
    ]
    try:
        for fname, month, status in filenames:
            await _insert_log_row(fname, month, status)

        months = await StatementLogOperations.get_pending_statement_months()

        idx_jan = months.index("2026-01")
        idx_aug = months.index("2026-08")
        assert idx_jan < idx_aug
    finally:
        for fname, _, _ in filenames:
            await _delete_log_row(fname)


@pytest.mark.asyncio
async def test_get_pending_statement_months_includes_error_only_month():
    """A month whose only row is status='error' is still included (no special-casing —
    it simply won't have a CSV in GCS for Step 6 to find there, which is harmless)."""
    fname, month = "test_fixture_error_202609", "2026-09"
    try:
        await _insert_log_row(fname, month, "error")

        months = await StatementLogOperations.get_pending_statement_months()

        assert month in months
    finally:
        await _delete_log_row(fname)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && poetry run pytest tests/test_statement_log_operations.py -v`
Expected: FAIL — `AttributeError: type object 'StatementLogOperations' has no attribute 'get_pending_statement_months'`.

- [ ] **Step 3: Add the method**

Add to the `StatementLogOperations` class in `backend/src/services/database_manager/operations/statement_log_operations.py`, placed after `get_db_inserted_filenames` (currently ends around line 347):

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

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && poetry run pytest tests/test_statement_log_operations.py -v`
Expected: PASS — all 3 tests. Each test cleans up its own fixture rows in `finally`, so re-running is safe and leaves no residue in `statement_processing_log`.

- [ ] **Step 5: Commit**

```bash
cd backend
git add src/services/database_manager/operations/statement_log_operations.py tests/test_statement_log_operations.py
git commit -m "feat(statements): add get_pending_statement_months query

Returns every distinct statement_month with at least one row not yet
db_inserted. Backs the multi-month standardization scan in
DataStandardizerHelper (next commit).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 2: Multi-month discovery in `DataStandardizerHelper.process()`

**Files:**
- Modify: `backend/src/services/orchestrator/data_standardizer_helper.py:64-100` (the discovery preamble of `process()`)
- Test: `backend/tests/test_data_standardizer_helper.py` (update the `_make_helper` fixture and all 6 existing tests to mock the new query; add multi-month tests)

**Interfaces:**
- Consumes: `StatementLogOperations.get_pending_statement_months()` (Task 1).
- No change to `process()`'s own signature (`async def process(self, override: bool = False, job_id: str | None = None) -> Tuple[List[Dict[str, Any]], Set[str]]`) or return type — this task changes internal discovery logic only.

- [ ] **Step 1: Write the failing tests**

First, update the `_make_helper` fixture in `backend/tests/test_data_standardizer_helper.py` to accept a `list_files_side_effect` (so different months can return different files) while keeping the existing single-list behavior as the default:

```python
def _make_helper(
    cloud_csv_files=None,
    standardized_df=None,
    db_inserted_keys=None,
    temp_dir=None,
    list_files_side_effect=None,
) -> DataStandardizerHelper:
    """Build a DataStandardizerHelper with minimal mocks."""
    if temp_dir is None:
        temp_dir = Path(tempfile.mkdtemp())

    cloud_storage = MagicMock()
    if list_files_side_effect is not None:
        cloud_storage.list_files.side_effect = list_files_side_effect
    else:
        cloud_storage.list_files.return_value = cloud_csv_files or []
    cloud_storage.download_file.return_value = {"success": True}

    transaction_standardizer = MagicMock()
    if standardized_df is not None:
        transaction_standardizer.process_with_dynamic_method = AsyncMock(return_value=standardized_df)
    else:
        transaction_standardizer.process_with_dynamic_method = AsyncMock(return_value=pd.DataFrame())

    async def _remove_dupes(rows):
        return rows

    async def _sort(rows):
        return rows

    helper = DataStandardizerHelper(
        transaction_standardizer=transaction_standardizer,
        cloud_storage=cloud_storage,
        temp_dir=temp_dir,
        calculate_splitwise_date_range=lambda: (
            MagicMock(strftime=lambda fmt: "2026-05"),
            MagicMock(),
        ),
        remove_duplicate_transactions=_remove_dupes,
        sort_transactions_by_date=_sort,
        emit=MagicMock(),
        log_extra=lambda: {},
    )
    return helper, db_inserted_keys
```

Now add `patch(".../get_pending_statement_months", new=AsyncMock(return_value=["2026-05"]))` to every one of the 6 existing tests (they all currently rely on a single implicit month via `calculate_splitwise_date_range`, which `process()` will stop consulting for month discovery after Step 3 of this task). Apply this edit to each test in `backend/tests/test_data_standardizer_helper.py`:

- `test_process_returns_tuple_on_empty_storage`: add `patch("src.services.orchestrator.data_standardizer_helper.StatementLogOperations.get_pending_statement_months", new=AsyncMock(return_value=[]))` (empty storage now means empty pending-months list, not an empty file listing for one month — replace the test body):

```python
@pytest.mark.asyncio
async def test_process_returns_tuple_on_empty_storage():
    """process() returns ([], set()) when no months are pending."""
    helper, _ = _make_helper(cloud_csv_files=[])
    with patch(
        "src.services.orchestrator.data_standardizer_helper.StatementLogOperations.get_pending_statement_months",
        new=AsyncMock(return_value=[]),
    ), patch(
        "src.services.orchestrator.data_standardizer_helper.StatementLogOperations.get_db_inserted_filenames",
        new=AsyncMock(return_value=set()),
    ):
        result = await helper.process()

    assert isinstance(result, tuple), "process() must return a tuple"
    data, keys = result
    assert data == []
    assert keys == set()
```

- For each of the other 5 existing tests (`test_process_returns_tuple_with_valid_rows`, `test_process_separates_flagged_rows`, `test_process_no_valid_csv_keys_for_flagged_only`, `test_process_does_not_call_update_status`, `test_process_skips_already_inserted`), add `get_pending_statement_months` mocked to `AsyncMock(return_value=["2026-05"])` into their existing `with patch(...)` blocks, alongside the existing `get_db_inserted_filenames` patch. Example for `test_process_returns_tuple_with_valid_rows` (apply the same pattern — one extra `patch(..., new=AsyncMock(return_value=["2026-05"]))` alongside the existing one — to the other 4):

```python
@pytest.mark.asyncio
async def test_process_returns_tuple_with_valid_rows():
    """process() returns (rows, {csv_stem}) for a CSV with valid rows."""
    df = pd.DataFrame([
        {"date": "2026-05-01", "description": "UPI payment", "amount": 100.0, "_skip_reason": None},
        {"date": "2026-05-02", "description": "Grocery", "amount": 200.0, "_skip_reason": None},
    ])

    with tempfile.TemporaryDirectory() as tmpdir:
        tmp = Path(tmpdir)
        (tmp / "axis_savings_20260501.csv").write_text("date,description,amount\n2026-05-01,test,100\n")

        helper, _ = _make_helper(
            cloud_csv_files=[{"name": "2026-05/extracted_data/axis_savings_20260501.csv"}],
            standardized_df=df,
            temp_dir=tmp,
        )
        with patch(
            "src.services.orchestrator.data_standardizer_helper.StatementLogOperations.get_pending_statement_months",
            new=AsyncMock(return_value=["2026-05"]),
        ), patch(
            "src.services.orchestrator.data_standardizer_helper.StatementLogOperations.get_db_inserted_filenames",
            new=AsyncMock(return_value=set()),
        ):
            result = await helper.process()

    assert isinstance(result, tuple)
    data, keys = result
    assert len(data) == 2
    assert "axis_savings_20260501" in keys
```

Apply the identical one-line addition (`patch(".../get_pending_statement_months", new=AsyncMock(return_value=["2026-05"]))` added to the existing `with patch(...)` block) to `test_process_separates_flagged_rows`, `test_process_no_valid_csv_keys_for_flagged_only`, `test_process_does_not_call_update_status`, and `test_process_skips_already_inserted` — no other changes needed in those 4 test bodies.

Now add the new multi-month test:

```python
@pytest.mark.asyncio
async def test_process_combines_multiple_pending_months():
    """CSVs from two different pending months are combined into one result."""
    df_may = pd.DataFrame([
        {"date": "2026-05-01", "description": "May tx", "amount": 100.0, "_skip_reason": None},
    ])
    df_june = pd.DataFrame([
        {"date": "2026-06-01", "description": "June tx", "amount": 200.0, "_skip_reason": None},
    ])

    with tempfile.TemporaryDirectory() as tmpdir:
        tmp = Path(tmpdir)
        (tmp / "axis_savings_20260501.csv").write_text("date,description,amount\n2026-05-01,test,100\n")
        (tmp / "axis_savings_20260601.csv").write_text("date,description,amount\n2026-06-01,test,200\n")

        def list_files_side_effect(prefix):
            if prefix == "2026-05/extracted_data/":
                return [{"name": "2026-05/extracted_data/axis_savings_20260501.csv"}]
            if prefix == "2026-06/extracted_data/":
                return [{"name": "2026-06/extracted_data/axis_savings_20260601.csv"}]
            return []

        transaction_standardizer_returns = {
            "axis_savings_20260501.csv": df_may,
            "axis_savings_20260601.csv": df_june,
        }

        helper, _ = _make_helper(temp_dir=tmp, list_files_side_effect=list_files_side_effect)

        async def _dynamic_method(df, search_pattern, filename):
            return transaction_standardizer_returns[filename]

        helper.transaction_standardizer.process_with_dynamic_method = _dynamic_method

        with patch(
            "src.services.orchestrator.data_standardizer_helper.StatementLogOperations.get_pending_statement_months",
            new=AsyncMock(return_value=["2026-05", "2026-06"]),
        ), patch(
            "src.services.orchestrator.data_standardizer_helper.StatementLogOperations.get_db_inserted_filenames",
            new=AsyncMock(return_value=set()),
        ):
            result = await helper.process()

    data, keys = result
    assert len(data) == 2
    assert keys == {"axis_savings_20260501", "axis_savings_20260601"}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && poetry run pytest tests/test_data_standardizer_helper.py -v`
Expected: `test_process_combines_multiple_pending_months` FAILS (either an `AttributeError`/unexpected call on `list_files` because `process()` still only calls it once with the hardcoded `"2026-05/extracted_data/"` prefix from `calculate_splitwise_date_range`, or the assertions on `data`/`keys` don't match). The other 6 tests should still PASS at this point since their added mock of `get_pending_statement_months` is simply unused by the current implementation — this confirms the new test is exercising real new behavior before you change the implementation.

- [ ] **Step 3: Implement multi-month discovery**

Replace lines 66-100 of `backend/src/services/orchestrator/data_standardizer_helper.py` (the discovery preamble, from `try:` through the `if db_inserted_keys:` block) with:

```python
        try:
            logger.info("Standardizing and combining all transaction data", extra=self.log_extra())

            # Discover every month with pending (not yet db_inserted) work —
            # NOT just "the previous calendar month". A statement extracted in
            # any month must eventually be found here regardless of when this
            # step happens to run relative to it.
            pending_months = await StatementLogOperations.get_pending_statement_months()

            if not pending_months:
                logger.warning("No months with pending statements found", extra=self.log_extra())
                self.emit(
                    "standardization_started", "standardization",
                    "No pending statements found in GCS",
                    level="warning",
                )
                return [], set()

            cloud_csv_files: List[Dict[str, Any]] = []
            db_inserted_keys: set = set()
            for month in pending_months:
                cloud_csv_files.extend(self.cloud_storage.list_files(f"{month}/extracted_data/"))
                if not override:
                    db_inserted_keys |= await StatementLogOperations.get_db_inserted_filenames(month)

            csv_files_only = [f for f in cloud_csv_files if f.get("name", "").endswith(".csv")]
            logger.info(f"Found {len(csv_files_only)} CSV files in cloud storage", extra=self.log_extra())
            self.emit(
                "standardization_started", "standardization",
                f"Standardizing {len(csv_files_only)} CSV file(s) from GCS ({', '.join(pending_months)})",
                data={"csv_count": len(csv_files_only), "months": pending_months},
            )

            if db_inserted_keys:
```

This preserves the exact original `if db_inserted_keys:` block and everything after it (the log line about how many will be skipped, and the rest of the per-file loop) unchanged — only paste up to and including that `if db_inserted_keys:` line; do not duplicate the lines that already follow it in the file.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && poetry run pytest tests/test_data_standardizer_helper.py -v`
Expected: PASS — all 7 tests (6 existing + the new multi-month one).

- [ ] **Step 5: Commit**

```bash
cd backend
git add src/services/orchestrator/data_standardizer_helper.py tests/test_data_standardizer_helper.py
git commit -m "fix(workflow): scan every pending month in DataStandardizerHelper

process() now discovers work via get_pending_statement_months() instead
of assuming only 'the previous calendar month' has anything to combine.
Each pending month's GCS listing and already-inserted-filename set are
unioned before the existing per-file loop runs unchanged.

Fixes statements extracted in a month other than 'previous calendar
month as of whenever Step 6 runs' being silently stranded at
csv_stored/csv_extracted forever.

See docs/superpowers/specs/2026-08-08-multi-month-standardization-design.md

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 3: Simplify `check_cloud_csvs_exist()`

**Files:**
- Modify: `backend/src/services/orchestrator/statement_workflow.py:1751-1776`
- Test: `backend/tests/test_workflow_orchestrator.py`

**Interfaces:**
- Consumes: `StatementLogOperations.get_pending_statement_months()` (Task 1).
- No change to `check_cloud_csvs_exist(self) -> bool`'s signature — internal logic only.

- [ ] **Step 1: Write the failing tests**

Add to `backend/tests/test_workflow_orchestrator.py`, inside `class TestStatementWorkflow`:

```python
    async def test_check_cloud_csvs_exist_true_when_pending(self):
        """check_cloud_csvs_exist() returns True when any month has pending work."""
        with patch(
            "src.services.orchestrator.statement_workflow.StatementLogOperations.get_pending_statement_months",
            new_callable=AsyncMock, return_value=["2026-06", "2026-07"],
        ):
            workflow = StatementWorkflow()
            result = await workflow.check_cloud_csvs_exist()

        assert result is True

    async def test_check_cloud_csvs_exist_false_when_none_pending(self):
        """check_cloud_csvs_exist() returns False when nothing is pending."""
        with patch(
            "src.services.orchestrator.statement_workflow.StatementLogOperations.get_pending_statement_months",
            new_callable=AsyncMock, return_value=[],
        ):
            workflow = StatementWorkflow()
            result = await workflow.check_cloud_csvs_exist()

        assert result is False
```

Add both new calls to the `run_tests()` helper's async test list, next to the other `_calculate_date_range`-adjacent tests:

```python
        await test_instance.test_check_cloud_csvs_exist_true_when_pending()
        await test_instance.test_check_cloud_csvs_exist_false_when_none_pending()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && poetry run pytest tests/test_workflow_orchestrator.py -v -k check_cloud_csvs_exist`
Expected: FAIL — `test_check_cloud_csvs_exist_true_when_pending` fails because the current implementation calls `self.cloud_storage.list_files(...)` (unmocked here, will error or return an unexpected real/empty result) instead of consulting `get_pending_statement_months`.

- [ ] **Step 3: Implement the simplification**

Replace the full body of `check_cloud_csvs_exist` (`backend/src/services/orchestrator/statement_workflow.py:1751-1776`) with:

```python
    async def check_cloud_csvs_exist(self) -> bool:
        """Check if any statement has extracted data pending standardization/insert."""
        try:
            pending_months = await StatementLogOperations.get_pending_statement_months()
            return bool(pending_months)
        except Exception:
            logger.error("Error checking for pending statement months", exc_info=True, extra=self._log_extra())
            return False
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && poetry run pytest tests/test_workflow_orchestrator.py -v`
Expected: PASS — all tests in the file, including the two new ones. Same pre-existing unrelated failures as before (`test_previous_month_name_calculation`, `test_cloud_path_generation`) — confirm nothing new broke.

- [ ] **Step 5: Run the full regression check**

Run: `cd backend && poetry run pytest tests/ -v --ignore=tests/test_complete_workflow.py`
Expected: same failure set as the pre-existing baseline (10 failures — see `test_workflow_orchestrator.py`'s two plus the 8 unrelated ones already known from earlier today), nothing new.

- [ ] **Step 6: Commit**

```bash
cd backend
git add src/services/orchestrator/statement_workflow.py tests/test_workflow_orchestrator.py
git commit -m "refactor(workflow): simplify check_cloud_csvs_exist via get_pending_statement_months

Drops its own single-month GCS-listing logic in favor of the same query
DataStandardizerHelper now uses — one source of truth for 'is there
pending work' instead of two independent (and previously both wrong)
implementations.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Handoff note (not a task — read before resuming the catch-up run)

This backend has no hot reload in the deployed environment. After this lands, restart the backend container (`docker compose restart backend`) before resuming the paused statement-workflow catch-up run, or the fix will be inert.
