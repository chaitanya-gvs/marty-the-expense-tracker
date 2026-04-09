# Workflow Email Integration Design

**Date:** 2026-04-07
**Branch:** feature/email-alert-ingestion

---

## Problem

Email alert ingestion was built as a standalone scheduled job (APScheduler) and a separate API endpoint (`/api/alert-ingestion/run`). This means when a user manually triggers the workflow (e.g., to process monthly statements), they must also separately trigger email ingestion, or wait for the scheduler to fire. There is no unified "run everything" path.

Additionally, the existing `run_complete_workflow` hardcodes all three subsystems (statements, Splitwise, dedup), with no way to skip individual parts.

---

## Goal

Integrate email alert ingestion as the first step in `run_complete_workflow`, controlled by three independent toggles. A single workflow run should be able to: ingest email alerts, process statements (with dedup), and sync Splitwise — in one atomic SSE-streamed job.

---

## Approach: Three Independent Toggles

Add three `Optional[bool]` fields to `WorkflowRunRequest`. Each defaults to `None`, meaning "use the mode preset." Explicit values override the preset.

### Schema Changes — `backend/src/apis/schemas/workflow.py`

```python
class WorkflowRunRequest(BaseModel):
    mode: WorkflowMode = WorkflowMode.full
    # New toggle fields (None = use mode preset)
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

### Mode Preset Defaults

| `WorkflowMode` | `include_email_ingestion` | `include_statement` | `include_splitwise` | `resume_from_standardization` |
|---|---|---|---|---|
| `full` | `True` | `True` | `True` | `False` |
| `resume` | `False` | `True` | `True` | `True` |
| `splitwise_only` | `False` | `False` | `True` | `False` |

`resume_from_standardization` is always derived from the mode — it is never a user-facing toggle.

### Toggle Override Examples

| Request | Effective behaviour |
|---|---|
| `{ mode: "full" }` | email ✅, statement ✅, splitwise ✅ |
| `{ mode: "full", include_email_ingestion: false }` | email ❌, statement ✅, splitwise ✅ |
| `{ mode: "splitwise_only", include_email_ingestion: true }` | email ✅, statement ❌, splitwise ✅ |
| `{ mode: "resume", include_splitwise: false }` | email ❌, statement ✅ (resume), splitwise ❌ |

---

## Route Layer Changes — `backend/src/apis/routes/workflow_routes.py`

`_run_workflow_task` becomes the single place where mode presets are resolved into effective booleans. All three modes now call `run_complete_workflow` with the resolved booleans — the separate dispatch to `run_resume_workflow` / `run_splitwise_only_workflow` is eliminated.

```python
_MODE_PRESETS = {
    WorkflowMode.full:           dict(email=True,  statement=True,  splitwise=True,  resume=False),
    WorkflowMode.resume:         dict(email=False, statement=True,  splitwise=True,  resume=True),
    WorkflowMode.splitwise_only: dict(email=False, statement=False, splitwise=True,  resume=False),
}

preset = _MODE_PRESETS[req.mode]
include_email     = req.include_email_ingestion if req.include_email_ingestion is not None else preset["email"]
include_statement = req.include_statement       if req.include_statement       is not None else preset["statement"]
include_splitwise = req.include_splitwise       if req.include_splitwise       is not None else preset["splitwise"]
resume            = preset["resume"]  # always mode-driven
```

Then always call:

```python
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

---

## Pipeline Flow Changes — `backend/src/services/orchestrator/statement_workflow.py`

### Updated `run_complete_workflow` Signature

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

### Updated Step Sequence

```
Step 0:  Token refresh            (if include_email_ingestion OR include_statement)
Step 1:  [NEW] Email alert ingestion  (if include_email_ingestion)
Step 2:  Get statement senders    (if include_statement)
Step 3:  Download + OCR per sender (if include_statement AND NOT resume_from_standardization)
Step 4:  Splitwise sync           (if include_splitwise)
Step 5:  Standardize + combine    (if include_statement OR include_splitwise)
Step 5b: Dedup pass               (if include_statement OR include_splitwise)
Step 6:  DB insert                (if include_statement OR include_splitwise)
```

### New Step 1 — Email Alert Ingestion

Inserted before the current Step 1 (statement senders). Uses `AlertIngestionService` directly. Events are emitted from the workflow wrapper — `AlertIngestionService` does not need modification.

```python
# Step 1: Email alert ingestion
if include_email_ingestion:
    logger.info("📧 Step 1: Running email alert ingestion", extra=self._log_extra())
    self._emit(
        "email_ingestion_started", "email_ingestion",
        "Starting email alert ingestion for all alert-enabled accounts",
    )
    try:
        from src.services.email_ingestion.alert_ingestion_service import AlertIngestionService
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
        logger.warning("Email ingestion failed, continuing workflow", exc_info=True, extra=self._log_extra())
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

**Why before statement processing:** By the time the dedup pass runs at Step 5b, all email-ingested transactions for this run are already committed to the DB. The existing `_run_dedup_pass` queries the DB for email-ingested transactions — this ordering makes them immediately available for matching.

### Statement Steps Guard

The existing Step 1 (statement senders) through Step 3 (OCR) is wrapped:

```python
if include_statement:
    # ... existing Steps 1-3 (statement senders, date range, download+OCR) ...
    # Early-return guard for no-senders moves inside this block
```

The `if not statement_senders: return workflow_results` early return is moved inside the `if include_statement` block so it doesn't abort a Splitwise-only or email-only run.

### Splitwise Step Guard

```python
if include_splitwise:
    # ... existing Step 4 (Splitwise sync) ...
```

### Standardize + Insert Guard

Steps 5, 5b, 6 run if either statement or Splitwise executed (something may be in temp_dir):

```python
if include_statement or include_splitwise:
    combined_data = await self._standardize_and_combine_all_data()
    # ... existing dedup + DB insert ...
```

### Updated `workflow_results` keys

```python
workflow_results = {
    # ... existing keys unchanged ...
    "email_ingestion": None,   # populated if include_email_ingestion=True
}
```

---

## SSE Events Reference

| event | step | level | when |
|---|---|---|---|
| `email_ingestion_started` | `email_ingestion` | `info` | Step 1 begins |
| `email_ingestion_complete` | `email_ingestion` | `success` / `warning` | Step 1 done |
| `email_ingestion_skipped` | `email_ingestion` | `info` | toggle off |
| `email_ingestion_error` | `email_ingestion` | `warning` | exception (non-fatal) |

---

## What Does NOT Change

- `AlertIngestionService` — no modifications needed; called as-is
- APScheduler job — still runs on its own schedule; the scheduler also calls `AlertIngestionService.run()` independently
- DB schema — no migrations needed
- Frontend — no changes; the existing workflow trigger UI works as-is; toggle support can be added as a later UI enhancement
- `run_resume_workflow` / `run_splitwise_only_workflow` — methods kept for backward compatibility with any direct internal callers; route layer no longer dispatches to them

---

## Files Changed

| File | Change |
|---|---|
| `backend/src/apis/schemas/workflow.py` | Add 3 optional toggle fields to `WorkflowRunRequest` |
| `backend/src/apis/routes/workflow_routes.py` | Add `_MODE_PRESETS`, resolve toggles, unify dispatch to `run_complete_workflow` |
| `backend/src/services/orchestrator/statement_workflow.py` | Add 3 new params + email ingestion Step 1 + guard existing steps |
| `backend/tests/test_workflow_orchestrator.py` | Tests for toggle resolution and step skipping |
