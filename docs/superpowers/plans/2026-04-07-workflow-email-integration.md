# Workflow Email Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three independent `Optional[bool]` toggles (`include_email_ingestion`, `include_statement`, `include_splitwise`) to `WorkflowRunRequest` and wire them into `run_complete_workflow`, inserting email alert ingestion as Step 1 of the unified pipeline.

**Architecture:** `WorkflowMode` becomes a preset system — the route layer resolves effective booleans from mode defaults + explicit toggle overrides, then always calls `run_complete_workflow` with the resolved values. `run_complete_workflow` gains three new bool params and conditionally executes each subsystem. `AlertIngestionService` is called as-is with no modifications.

**Tech Stack:** FastAPI + Pydantic v2, SQLAlchemy 2.0 async, `AlertIngestionService`, pytest + pytest-asyncio

**Spec:** `docs/superpowers/specs/2026-04-07-workflow-email-integration-design.md`

---

### Task 1: Add toggle fields to `WorkflowRunRequest`

**Files:**
- Modify: `backend/src/apis/schemas/workflow.py`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_workflow_toggle_integration.py`:

```python
"""Tests for workflow toggle integration."""
import pytest
from src.apis.schemas.workflow import WorkflowRunRequest, WorkflowMode


def test_toggle_defaults_are_none():
    """All three new fields should default to None (use mode preset)."""
    req = WorkflowRunRequest()
    assert req.include_email_ingestion is None
    assert req.include_statement is None
    assert req.include_splitwise is None


def test_explicit_toggle_false_stored():
    """Explicit False must be preserved (not coerced to None)."""
    req = WorkflowRunRequest(
        mode=WorkflowMode.full,
        include_email_ingestion=False,
        include_statement=True,
        include_splitwise=False,
    )
    assert req.include_email_ingestion is False
    assert req.include_statement is True
    assert req.include_splitwise is False


def test_existing_fields_unchanged():
    """Ensure existing fields still work after schema change."""
    req = WorkflowRunRequest(
        mode=WorkflowMode.resume,
        override=True,
        start_date="2025-01-01",
        end_date="2025-01-31",
    )
    assert req.mode == WorkflowMode.resume
    assert req.override is True
    assert req.start_date == "2025-01-01"
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && poetry run pytest tests/test_workflow_toggle_integration.py -v
```

Expected: `FAILED` — `WorkflowRunRequest` has no `include_email_ingestion` attribute.

- [ ] **Step 3: Add the three toggle fields to `WorkflowRunRequest`**

In `backend/src/apis/schemas/workflow.py`, update `WorkflowRunRequest`:

```python
class WorkflowRunRequest(BaseModel):
    mode: WorkflowMode = WorkflowMode.full
    # Independent subsystem toggles (None = use mode preset default)
    include_email_ingestion: Optional[bool] = None
    include_statement: Optional[bool] = None
    include_splitwise: Optional[bool] = None
    # Existing fields (unchanged)
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    splitwise_start_date: Optional[str] = None
    splitwise_end_date: Optional[str] = None
    enable_secondary_account: Optional[bool] = None
    override: bool = False
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd backend && poetry run pytest tests/test_workflow_toggle_integration.py -v
```

Expected: 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/apis/schemas/workflow.py backend/tests/test_workflow_toggle_integration.py
git commit -m "feat: add include_email_ingestion/statement/splitwise toggles to WorkflowRunRequest"
```

---

### Task 2: Add mode preset resolution to route layer

**Files:**
- Modify: `backend/src/apis/routes/workflow_routes.py`

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_workflow_toggle_integration.py`:

```python
from src.apis.schemas.workflow import WorkflowMode
from src.apis.routes.workflow_routes import _MODE_PRESETS, _resolve_toggles


def test_full_preset_all_enabled():
    preset = _MODE_PRESETS[WorkflowMode.full]
    assert preset["email"] is True
    assert preset["statement"] is True
    assert preset["splitwise"] is True
    assert preset["resume"] is False


def test_resume_preset():
    preset = _MODE_PRESETS[WorkflowMode.resume]
    assert preset["email"] is False
    assert preset["statement"] is True
    assert preset["splitwise"] is True
    assert preset["resume"] is True


def test_splitwise_only_preset():
    preset = _MODE_PRESETS[WorkflowMode.splitwise_only]
    assert preset["email"] is False
    assert preset["statement"] is False
    assert preset["splitwise"] is True
    assert preset["resume"] is False


def test_explicit_toggle_overrides_preset():
    req = WorkflowRunRequest(mode=WorkflowMode.full, include_email_ingestion=False)
    email, stmt, sw, resume = _resolve_toggles(req)
    assert email is False    # explicit override
    assert stmt is True      # from preset
    assert sw is True        # from preset
    assert resume is False   # always from preset


def test_splitwise_only_with_email_override():
    req = WorkflowRunRequest(mode=WorkflowMode.splitwise_only, include_email_ingestion=True)
    email, stmt, sw, resume = _resolve_toggles(req)
    assert email is True     # explicit override
    assert stmt is False     # from preset
    assert sw is True        # from preset
    assert resume is False


def test_resume_with_splitwise_off():
    req = WorkflowRunRequest(mode=WorkflowMode.resume, include_splitwise=False)
    email, stmt, sw, resume = _resolve_toggles(req)
    assert email is False    # from preset
    assert stmt is True      # from preset
    assert sw is False       # explicit override
    assert resume is True    # always from preset
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd backend && poetry run pytest tests/test_workflow_toggle_integration.py -v -k "preset or toggle or resolve"
```

Expected: `ImportError` — `_MODE_PRESETS` and `_resolve_toggles` don't exist yet.

- [ ] **Step 3: Add `_MODE_PRESETS` and `_resolve_toggles` to route file**

In `backend/src/apis/routes/workflow_routes.py`, after the `_IST` constant (line ~44), add:

```python
# ---------------------------------------------------------------------------
# Mode preset → toggle resolution
# ---------------------------------------------------------------------------

_MODE_PRESETS = {
    WorkflowMode.full:           dict(email=True,  statement=True,  splitwise=True,  resume=False),
    WorkflowMode.resume:         dict(email=False, statement=True,  splitwise=True,  resume=True),
    WorkflowMode.splitwise_only: dict(email=False, statement=False, splitwise=True,  resume=False),
}


def _resolve_toggles(req: WorkflowRunRequest) -> tuple[bool, bool, bool, bool]:
    """
    Resolve effective (email, statement, splitwise, resume) booleans from
    the mode preset and any explicit toggle overrides on the request.

    Returns:
        (include_email, include_statement, include_splitwise, resume_from_standardization)
    """
    preset = _MODE_PRESETS[req.mode]
    include_email     = req.include_email_ingestion if req.include_email_ingestion is not None else preset["email"]
    include_statement = req.include_statement       if req.include_statement       is not None else preset["statement"]
    include_splitwise = req.include_splitwise       if req.include_splitwise       is not None else preset["splitwise"]
    resume            = preset["resume"]  # always mode-driven, never a user toggle
    return include_email, include_statement, include_splitwise, resume
```

- [ ] **Step 4: Replace the if/elif/else dispatch in `_run_workflow_task`**

Find the current dispatch block (lines ~178–205):

```python
        if req.mode == WorkflowMode.full:
            result = await workflow.run_complete_workflow(
                resume_from_standardization=False,
                ...
            )
        elif req.mode == WorkflowMode.resume:
            result = await workflow.run_complete_workflow(
                resume_from_standardization=True,
                ...
            )
        elif req.mode == WorkflowMode.splitwise_only:
            result = await workflow.run_splitwise_only_workflow(
                ...
            )
        else:
            raise ValueError(f"Unknown workflow mode: {req.mode}")
```

Replace the entire block (including `sw_start, sw_end = await _resolve_splitwise_dates(...)` and the `workflow = StatementWorkflow(...)` instantiation lines) with:

```python
        sw_start, sw_end = await _resolve_splitwise_dates(req, job_id=job_id)
        include_email, include_statement, include_splitwise, resume = _resolve_toggles(req)

        workflow = StatementWorkflow(
            enable_secondary_account=req.enable_secondary_account,
            event_callback=emit_callback,
        )

        result = await workflow.run_complete_workflow(
            resume_from_standardization=resume,
            include_email_ingestion=include_email,
            include_statement=include_statement,
            include_splitwise=include_splitwise,
            custom_start_date=req.start_date,
            custom_end_date=req.end_date,
            custom_splitwise_start_date=sw_start,
            custom_splitwise_end_date=sw_end,
            override=req.override,
            job_id=job_id,
        )
```

- [ ] **Step 5: Run all toggle tests to verify they pass**

```bash
cd backend && poetry run pytest tests/test_workflow_toggle_integration.py -v
```

Expected: All tests PASS.

- [ ] **Step 6: Run existing route/workflow tests to verify nothing broke**

```bash
cd backend && poetry run pytest tests/test_workflow_orchestrator.py tests/test_api_integration.py -v
```

Expected: All pre-existing tests PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/src/apis/routes/workflow_routes.py backend/tests/test_workflow_toggle_integration.py
git commit -m "feat: add mode preset resolution and unified dispatch in workflow route"
```

---

### Task 3: Add email ingestion step + guard existing steps in `run_complete_workflow`

**Files:**
- Modify: `backend/src/services/orchestrator/statement_workflow.py`

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_workflow_toggle_integration.py`:

```python
import pytest
from unittest.mock import AsyncMock, MagicMock, patch


@pytest.mark.asyncio
async def test_email_ingestion_called_when_enabled():
    """AlertIngestionService.run() is called when include_email_ingestion=True."""
    mock_result = {"processed": 5, "inserted": 3, "skipped": 2, "errors": 0, "accounts": []}

    with patch(
        "src.services.orchestrator.statement_workflow.AlertIngestionService"
    ) as MockSvc:
        instance = MockSvc.return_value
        instance.run = AsyncMock(return_value=mock_result)

        workflow = StatementWorkflow.__new__(StatementWorkflow)
        workflow.job_id = "test-job"
        workflow.override = False
        workflow.event_callback = None
        workflow.temp_dir = MagicMock()
        workflow._extractor_helper = MagicMock()
        workflow._splitwise_helper = MagicMock()
        workflow._data_standardizer_helper = MagicMock()

        result = await workflow.run_complete_workflow(
            include_email_ingestion=True,
            include_statement=False,
            include_splitwise=False,
        )

    instance.run.assert_called_once()
    assert result["email_ingestion"]["inserted"] == 3


@pytest.mark.asyncio
async def test_email_ingestion_skipped_when_disabled():
    """AlertIngestionService is never instantiated when include_email_ingestion=False."""
    with patch(
        "src.services.orchestrator.statement_workflow.AlertIngestionService"
    ) as MockSvc:
        workflow = StatementWorkflow.__new__(StatementWorkflow)
        workflow.job_id = "test-job"
        workflow.override = False
        workflow.event_callback = None
        workflow.temp_dir = MagicMock()
        workflow._extractor_helper = MagicMock()
        workflow._splitwise_helper = MagicMock()
        workflow._data_standardizer_helper = MagicMock()

        await workflow.run_complete_workflow(
            include_email_ingestion=False,
            include_statement=False,
            include_splitwise=False,
        )

    MockSvc.assert_not_called()


@pytest.mark.asyncio
async def test_statement_senders_not_queried_when_statement_disabled():
    """AccountOperations.get_all_statement_senders is not called when include_statement=False."""
    with patch(
        "src.services.orchestrator.statement_workflow.AccountOperations.get_all_statement_senders",
        new_callable=AsyncMock,
    ) as mock_senders, patch(
        "src.services.orchestrator.statement_workflow.AlertIngestionService"
    ) as MockSvc:
        MockSvc.return_value.run = AsyncMock(
            return_value={"processed": 0, "inserted": 0, "skipped": 0, "errors": 0, "accounts": []}
        )

        workflow = StatementWorkflow.__new__(StatementWorkflow)
        workflow.job_id = "test-job"
        workflow.override = False
        workflow.event_callback = None
        workflow.temp_dir = MagicMock()
        workflow._extractor_helper = MagicMock()
        workflow._splitwise_helper = MagicMock()
        workflow._data_standardizer_helper = MagicMock()

        await workflow.run_complete_workflow(
            include_email_ingestion=True,
            include_statement=False,
            include_splitwise=False,
        )

    mock_senders.assert_not_called()
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd backend && poetry run pytest tests/test_workflow_toggle_integration.py::test_email_ingestion_called_when_enabled tests/test_workflow_toggle_integration.py::test_email_ingestion_skipped_when_disabled tests/test_workflow_toggle_integration.py::test_statement_senders_not_queried_when_statement_disabled -v
```

Expected: All three FAIL — `run_complete_workflow` doesn't accept the new params yet.

- [ ] **Step 3: Add `AlertIngestionService` import to `statement_workflow.py`**

At the top of `backend/src/services/orchestrator/statement_workflow.py`, add after the existing imports:

```python
from src.services.email_ingestion.alert_ingestion_service import AlertIngestionService
```

- [ ] **Step 4: Update `run_complete_workflow` signature**

Change the method signature (currently at line ~848) from:

```python
    async def run_complete_workflow(
        self,
        resume_from_standardization: bool = False,
        custom_start_date: Optional[str] = None,
        custom_end_date: Optional[str] = None,
        custom_splitwise_start_date: Optional[datetime] = None,
        custom_splitwise_end_date: Optional[datetime] = None,
        override: bool = False,
        job_id: Optional[str] = None,
    ) -> Dict[str, Any]:
```

To:

```python
    async def run_complete_workflow(
        self,
        resume_from_standardization: bool = False,
        include_email_ingestion: bool = True,
        include_statement: bool = True,
        include_splitwise: bool = True,
        custom_start_date: Optional[str] = None,
        custom_end_date: Optional[str] = None,
        custom_splitwise_start_date: Optional[datetime] = None,
        custom_splitwise_end_date: Optional[datetime] = None,
        override: bool = False,
        job_id: Optional[str] = None,
    ) -> Dict[str, Any]:
```

- [ ] **Step 5: Add `email_ingestion` key to `workflow_results`**

In the `workflow_results` dict initialisation (lines ~884–901), add the new key:

```python
        workflow_results = {
            "total_senders": 0,
            "total_statements_downloaded": 0,
            "total_statements_uploaded": 0,
            "total_statements_processed": 0,
            "splitwise_processed": False,
            "splitwise_cloud_path": None,
            "splitwise_transaction_count": 0,
            "combined_transaction_count": 0,
            "database_inserted_count": 0,
            "database_skipped_count": 0,
            "database_error_count": 0,
            "database_errors": [],
            "errors": [],
            "processed_statements": [],
            "all_standardized_data": [],
            "email_ingestion": None,   # populated when include_email_ingestion=True
        }
```

- [ ] **Step 6: Update token refresh guard**

Currently (lines ~904–907):

```python
            # Step 0: Refresh Gmail tokens proactively
            if not resume_from_standardization:
                logger.info("Step 0: Refreshing Gmail tokens...", extra=self._log_extra())
                await self._refresh_all_tokens()
```

Change to:

```python
            # Step 0: Refresh Gmail tokens proactively (needed for email ingestion and statement download)
            if (include_email_ingestion or include_statement) and not resume_from_standardization:
                logger.info("Step 0: Refreshing Gmail tokens...", extra=self._log_extra())
                await self._refresh_all_tokens()
```

- [ ] **Step 7: Insert new Step 1 (email alert ingestion)**

After the token refresh block and before the current `# Step 1: Get all statement senders` line, insert:

```python
            # Step 1: Email alert ingestion
            if include_email_ingestion:
                logger.info("📧 Step 1: Running email alert ingestion", extra=self._log_extra())
                self._emit(
                    "email_ingestion_started", "email_ingestion",
                    "Starting email alert ingestion for all alert-enabled accounts",
                )
                try:
                    ingestion_svc = AlertIngestionService()
                    ingestion_result = await ingestion_svc.run()
                    workflow_results["email_ingestion"] = ingestion_result
                    self._emit(
                        "email_ingestion_complete", "email_ingestion",
                        (
                            f"Email ingestion complete: {ingestion_result['inserted']} inserted, "
                            f"{ingestion_result['skipped']} skipped, "
                            f"{ingestion_result['errors']} errors"
                        ),
                        level="success" if ingestion_result["errors"] == 0 else "warning",
                        data=ingestion_result,
                    )
                except Exception as e:
                    logger.warning(
                        "Email ingestion failed, continuing workflow",
                        exc_info=True, extra=self._log_extra(),
                    )
                    workflow_results["errors"].append(f"Email ingestion: {e}")
                    self._emit(
                        "email_ingestion_error", "email_ingestion",
                        f"Email ingestion failed (non-fatal): {e}",
                        level="warning",
                    )
            else:
                self._emit(
                    "email_ingestion_skipped", "email_ingestion",
                    "Email ingestion skipped (toggle off)",
                )
```

- [ ] **Step 8: Wrap statement steps with `if include_statement`**

Wrap everything from the current `# Step 1: Get all statement senders` comment through the end of the `# Step 3` sender loop (ending just before `# Step 4: Process Splitwise data`).

Change:

```python
            # Step 1: Get all statement senders
            logger.info("📋 Step 1: Getting all statement senders", extra=self._log_extra())
            statement_senders_raw = await AccountOperations.get_all_statement_senders()
            ...
            if not statement_senders:
                logger.warning("No statement senders found in accounts table", extra=self._log_extra())
                return workflow_results
            ...
            # Step 2: Calculate date range
            ...
            # Step 3: Process each sender (skipped when resuming from standardization)
            if not resume_from_standardization:
                ...
```

To:

```python
            # Steps 2-3: Statement download + extraction
            if include_statement:
                logger.info("📋 Step 2: Getting all statement senders", extra=self._log_extra())
                statement_senders_raw = await AccountOperations.get_all_statement_senders()

                # Handle comma-separated sender emails
                statement_senders = []
                for sender in statement_senders_raw:
                    if ',' in sender:
                        individual_senders = [s.strip() for s in sender.split(',') if s.strip()]
                        statement_senders.extend(individual_senders)
                    else:
                        statement_senders.append(sender)

                # Remove duplicates while preserving order
                statement_senders = list(dict.fromkeys(statement_senders))
                workflow_results["total_senders"] = len(statement_senders)

                if not statement_senders:
                    logger.warning("No statement senders found in accounts table", extra=self._log_extra())
                    # Don't return — Splitwise may still need to run
                else:
                    logger.info(f"Found {len(statement_senders)} statement senders", extra=self._log_extra())

                    # Step 3: Calculate date range
                    start_date, end_date = self._calculate_date_range()
                    if custom_start_date and custom_end_date:
                        logger.info(f"Using custom date range override: {custom_start_date} to {custom_end_date}")
                        start_date = custom_start_date
                        end_date = custom_end_date

                    # Step 4: Process each sender (skipped when resuming from standardization)
                    if not resume_from_standardization:
                        logger.info("Starting document extraction step", extra=self._log_extra())
                        _now = datetime.now()
                        _prev_month = (_now.month - 1) or 12
                        _prev_year = _now.year if _now.month > 1 else _now.year - 1
                        expected_statement_month = f"{_prev_year}-{_prev_month:02d}"

                        for sender_email in statement_senders:
                            # ... (all existing sender loop body, indented one extra level) ...
```

> **Note to implementer:** The inner body of the sender loop (`try: ... except Exception: ...`) does not change at all — just indent it one additional level to sit inside the new `else:` block. The existing step numbers in log messages will shift (old Step 1 → new Step 2, etc.) — update the log strings only, not the logic.

- [ ] **Step 9: Wrap Splitwise step with `if include_splitwise`**

Find (approximately line 1053):

```python
            # Step 4: Process Splitwise data
            logger.info("Step 4: Processing Splitwise data", extra=self._log_extra())
            splitwise_result = await self._process_splitwise_data(
                continue_on_error=True,
                custom_start_date=custom_splitwise_start_date,
                custom_end_date=custom_splitwise_end_date
            )
            if splitwise_result:
                ...
            else:
                ...
```

Wrap it:

```python
            # Step 5: Splitwise sync
            if include_splitwise:
                logger.info("Step 5: Processing Splitwise data", extra=self._log_extra())
                splitwise_result = await self._process_splitwise_data(
                    continue_on_error=True,
                    custom_start_date=custom_splitwise_start_date,
                    custom_end_date=custom_splitwise_end_date
                )
                if splitwise_result:
                    workflow_results["splitwise_processed"] = True
                    workflow_results["splitwise_cloud_path"] = splitwise_result.get("cloud_path")
                    workflow_results["splitwise_transaction_count"] = splitwise_result.get("transaction_count")
                    logger.info(f"Processed {splitwise_result.get('transaction_count')} Splitwise transactions", extra=self._log_extra())
                else:
                    workflow_results["splitwise_processed"] = False
                    logger.warning("Splitwise processing failed or no data found", extra=self._log_extra())
```

- [ ] **Step 10: Wrap Steps 5-6 (standardize + dedup + insert) with joint guard**

Find (approximately line 1069):

```python
            # Step 5: Standardize and combine all data
            logger.info("Step 5: Standardizing and combining all transaction data", extra=self._log_extra())
            combined_data = await self._standardize_and_combine_all_data()
```

Wrap the entire standardize → dedup → insert block:

```python
            # Steps 6-7: Standardize, dedup, and insert (runs if any data was collected)
            if include_statement or include_splitwise:
                logger.info("Step 6: Standardizing and combining all transaction data", extra=self._log_extra())
                combined_data = await self._standardize_and_combine_all_data()
                # ... (rest of existing standardize + dedup + insert logic, unchanged, indented one level) ...
```

- [ ] **Step 11: Run the three new tests to verify they pass**

```bash
cd backend && poetry run pytest tests/test_workflow_toggle_integration.py::test_email_ingestion_called_when_enabled tests/test_workflow_toggle_integration.py::test_email_ingestion_skipped_when_disabled tests/test_workflow_toggle_integration.py::test_statement_senders_not_queried_when_statement_disabled -v
```

Expected: All three PASS.

- [ ] **Step 12: Run full test suite to verify no regressions**

```bash
cd backend && poetry run pytest tests/ -v
```

Expected: All tests PASS (pre-existing tests continue to work because new params all have defaults).

- [ ] **Step 13: Run linter**

```bash
cd backend && poetry run ruff check .
```

Expected: No errors.

- [ ] **Step 14: Commit**

```bash
git add backend/src/services/orchestrator/statement_workflow.py backend/tests/test_workflow_toggle_integration.py
git commit -m "feat: add email ingestion as step 1 in run_complete_workflow with subsystem toggles"
```

---

### Task 4: Final integration smoke test

**Files:**
- Read-only: `backend/src/apis/routes/workflow_routes.py` (verify the unified dispatch path)

- [ ] **Step 1: Verify the `run_complete_workflow` default params preserve existing behaviour**

Run the existing workflow orchestrator tests:

```bash
cd backend && poetry run pytest tests/test_workflow_orchestrator.py tests/test_complete_workflow.py tests/test_statement_dedup_integration.py -v
```

Expected: All PASS — the three new params all default to `True` or `False` (matching prior behaviour: email ingestion is new so `True` is additive; statement/splitwise default `True` means nothing is removed).

- [ ] **Step 2: Verify schema serialization round-trip**

```bash
cd backend && poetry run python -c "
from src.apis.schemas.workflow import WorkflowRunRequest, WorkflowMode
import json

# Default full run
r = WorkflowRunRequest()
print(json.dumps(r.model_dump(), indent=2))
assert r.include_email_ingestion is None

# Explicit overrides
r2 = WorkflowRunRequest(mode=WorkflowMode.splitwise_only, include_email_ingestion=True)
print(json.dumps(r2.model_dump(), indent=2))
assert r2.include_email_ingestion is True
assert r2.include_statement is None

print('Schema round-trip OK')
"
```

Expected: Prints clean JSON, `Schema round-trip OK`.

- [ ] **Step 3: Commit final test run record**

```bash
git add .
git commit -m "test: verify workflow toggle integration smoke tests pass"
```

---

## Summary of Changes

| File | What changed |
|---|---|
| `backend/src/apis/schemas/workflow.py` | +3 optional toggle fields on `WorkflowRunRequest` |
| `backend/src/apis/routes/workflow_routes.py` | +`_MODE_PRESETS` dict, +`_resolve_toggles()`, unified dispatch replaces if/elif/else |
| `backend/src/services/orchestrator/statement_workflow.py` | +`AlertIngestionService` import, +3 params on `run_complete_workflow`, +email ingestion Step 1, statement/splitwise/combine steps gated by toggles |
| `backend/tests/test_workflow_toggle_integration.py` | New test file — schema defaults, preset resolution, toggle overrides, step skip behaviour |

## No-change list

- `AlertIngestionService` — called as-is, no modifications
- APScheduler job — unaffected, still calls `AlertIngestionService.run()` on its schedule
- DB schema — no migrations
- Frontend — no changes needed
- `run_resume_workflow` / `run_splitwise_only_workflow` — methods kept for backward compatibility
