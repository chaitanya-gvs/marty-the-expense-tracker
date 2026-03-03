"""
Workflow API Routes

Exposes the full statement + Splitwise processing pipeline as HTTP endpoints,
with real-time status streaming via Server-Sent Events (SSE).

Endpoints:
  POST /workflow/run          → start a workflow job, returns {job_id}
  GET  /workflow/{job_id}/stream  → SSE stream of WorkflowEvent objects
  GET  /workflow/{job_id}/status  → accumulated event log + final summary
  GET  /workflow/active        → currently running job info (or null)
"""

import asyncio
import json
import uuid
from datetime import datetime, date
from typing import Any, AsyncGenerator, Dict, Optional

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy import text

from src.apis.schemas.workflow import (
    WorkflowJobStatus,
    WorkflowJobStatusResponse,
    WorkflowMode,
    WorkflowRunRequest,
    WorkflowRunResponse,
    WorkflowEvent,
    WorkflowEventLevel,
)
from src.services.database_manager.connection import get_session_factory
from src.services.orchestrator.statement_workflow import StatementWorkflow
from src.utils.logger import get_logger

logger = get_logger(__name__)

router = APIRouter(prefix="/workflow", tags=["workflow"])


# ---------------------------------------------------------------------------
# In-memory job store (single-user personal tool — no Redis needed)
# ---------------------------------------------------------------------------

class _JobState:
    __slots__ = (
        "job_id", "mode", "status", "started_at", "completed_at",
        "events", "summary", "error", "queue",
    )

    def __init__(self, job_id: str, mode: WorkflowMode):
        self.job_id = job_id
        self.mode = mode
        self.status = WorkflowJobStatus.pending
        self.started_at: datetime = datetime.utcnow()
        self.completed_at: Optional[datetime] = None
        self.events: list[dict] = []
        self.summary: Optional[Dict[str, Any]] = None
        self.error: Optional[str] = None
        self.queue: asyncio.Queue = asyncio.Queue()


_jobs: Dict[str, _JobState] = {}
_active_job_id: Optional[str] = None


def _get_active_job() -> Optional[_JobState]:
    if _active_job_id and _active_job_id in _jobs:
        job = _jobs[_active_job_id]
        if job.status == WorkflowJobStatus.running:
            return job
    return None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

async def _get_last_splitwise_date() -> Optional[date]:
    """Query DB for the most recent Splitwise transaction date."""
    session_factory = get_session_factory()
    session = session_factory()
    try:
        result = await session.execute(
            text("""
                SELECT MAX(transaction_date) AS last_date
                FROM transactions
                WHERE is_deleted = false
                  AND LOWER(account) = 'splitwise'
            """)
        )
        row = result.fetchone()
        if row and row.last_date:
            return row.last_date
        return None
    except Exception:
        return None
    finally:
        await session.close()


def _build_splitwise_date_range(
    req: WorkflowRunRequest,
) -> tuple[Optional[datetime], Optional[datetime]]:
    """
    Resolve Splitwise date range from request.
    - If explicit splitwise_start_date / splitwise_end_date provided → use them.
    - Otherwise auto-detect: last Splitwise DB date → today (handled async in caller).
    Returns (None, None) when caller should auto-detect at runtime.
    """
    if req.splitwise_start_date and req.splitwise_end_date:
        return (
            datetime.strptime(req.splitwise_start_date, "%Y-%m-%d"),
            datetime.strptime(req.splitwise_end_date, "%Y-%m-%d"),
        )
    return None, None


async def _resolve_splitwise_dates(
    req: WorkflowRunRequest,
) -> tuple[Optional[datetime], Optional[datetime]]:
    """
    Resolve Splitwise date range, auto-detecting last DB date when not supplied.
    Falls back to StatementWorkflow's built-in date range logic when both are None.
    """
    custom_start, custom_end = _build_splitwise_date_range(req)
    if custom_start and custom_end:
        return custom_start, custom_end

    # Auto-detect last Splitwise transaction date in DB
    last_date = await _get_last_splitwise_date()
    if last_date:
        # Day after the last Splitwise transaction → today
        start = datetime(last_date.year, last_date.month, last_date.day)
        end = datetime.utcnow().replace(hour=23, minute=59, second=59, microsecond=0)
        logger.info(f"Auto-detected Splitwise range: {start.date()} → {end.date()}")
        return start, end

    # No DB records yet — let the workflow use its default (previous calendar month)
    return None, None


# ---------------------------------------------------------------------------
# Background task: runs the workflow and feeds the SSE queue
# ---------------------------------------------------------------------------

async def _run_workflow_task(job_id: str, req: WorkflowRunRequest) -> None:
    global _active_job_id
    job = _jobs[job_id]
    job.status = WorkflowJobStatus.running

    def emit_callback(event: dict) -> None:
        """Called from within the workflow; feeds both the SSE queue and the history list."""
        job.events.append(event)
        job.queue.put_nowait(event)

    try:
        sw_start, sw_end = await _resolve_splitwise_dates(req)

        workflow = StatementWorkflow(
            enable_secondary_account=req.enable_secondary_account,
            event_callback=emit_callback,
        )

        if req.mode == WorkflowMode.full:
            result = await workflow.run_complete_workflow(
                resume_from_standardization=False,
                custom_start_date=req.start_date,
                custom_end_date=req.end_date,
                custom_splitwise_start_date=sw_start,
                custom_splitwise_end_date=sw_end,
            )
        elif req.mode == WorkflowMode.resume:
            result = await workflow.run_complete_workflow(
                resume_from_standardization=True,
                custom_start_date=req.start_date,
                custom_end_date=req.end_date,
                custom_splitwise_start_date=sw_start,
                custom_splitwise_end_date=sw_end,
            )
        elif req.mode == WorkflowMode.splitwise_only:
            result = await workflow.run_splitwise_only_workflow(
                custom_start_date=sw_start,
                custom_end_date=sw_end,
            )
        else:
            raise ValueError(f"Unknown workflow mode: {req.mode}")

        job.summary = {k: v for k, v in result.items() if k != "all_standardized_data"}
        job.status = WorkflowJobStatus.completed

    except Exception as exc:
        logger.error(f"Workflow job {job_id} failed: {exc}", exc_info=True)
        job.error = str(exc)
        job.status = WorkflowJobStatus.failed
        error_event = {
            "event": "workflow_error",
            "step": "workflow",
            "message": f"Unhandled error: {exc}",
            "account": None,
            "level": "error",
            "timestamp": datetime.utcnow().isoformat() + "Z",
            "data": {"error": str(exc)},
        }
        job.events.append(error_event)
        job.queue.put_nowait(error_event)
    finally:
        job.completed_at = datetime.utcnow()
        # Signal stream consumers that the job is done
        job.queue.put_nowait({"event": "__stream_end__"})
        _active_job_id = None


# ---------------------------------------------------------------------------
# SSE generator
# ---------------------------------------------------------------------------

async def _sse_generator(job: _JobState) -> AsyncGenerator[str, None]:
    """
    Yields SSE-formatted lines from the job queue.
    First replays any events that arrived before the client connected, then
    streams live events until the terminal signal is received.
    """
    # Drain any already-accumulated events for clients that connect late
    replay = list(job.events)
    for event in replay:
        if event.get("event") == "__stream_end__":
            yield f"data: {json.dumps({'event': 'stream_end', 'message': 'Workflow already finished'})}\n\n"
            return
        yield f"data: {json.dumps(event)}\n\n"

    # Stream new events from the queue
    while True:
        try:
            event = await asyncio.wait_for(job.queue.get(), timeout=30.0)
        except asyncio.TimeoutError:
            # Send a keepalive comment so the connection stays open
            yield ": keepalive\n\n"
            continue

        if event.get("event") == "__stream_end__":
            break

        yield f"data: {json.dumps(event)}\n\n"


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.post("/run", response_model=WorkflowRunResponse, status_code=202)
async def start_workflow(req: WorkflowRunRequest):
    """
    Start a workflow job.

    Returns a `job_id` immediately. Use `GET /workflow/{job_id}/stream` to
    receive real-time status events, or `GET /workflow/{job_id}/status` to
    poll the current state.

    Only one workflow job may run at a time. Returns 409 if one is already running.
    """
    global _active_job_id

    active = _get_active_job()
    if active:
        raise HTTPException(
            status_code=409,
            detail=f"Workflow job '{active.job_id}' is already running. "
                   f"Wait for it to finish or check its status at /workflow/{active.job_id}/status",
        )

    job_id = str(uuid.uuid4())
    job = _JobState(job_id=job_id, mode=req.mode)
    _jobs[job_id] = job
    _active_job_id = job_id

    # Launch workflow as a background asyncio task
    asyncio.create_task(_run_workflow_task(job_id, req))

    logger.info(f"Started workflow job {job_id} (mode={req.mode})")
    return WorkflowRunResponse(
        job_id=job_id,
        mode=req.mode,
        started_at=job.started_at,
    )


@router.get("/active")
async def get_active_job():
    """
    Returns the currently running job's basic info, or null if no job is running.
    """
    active = _get_active_job()
    if not active:
        return {"active_job": None}
    return {
        "active_job": {
            "job_id": active.job_id,
            "mode": active.mode,
            "status": active.status,
            "started_at": active.started_at.isoformat() + "Z",
            "event_count": len(active.events),
        }
    }


@router.get("/{job_id}/stream")
async def stream_workflow_events(job_id: str):
    """
    Stream real-time workflow status events as Server-Sent Events.

    Connect to this endpoint after `POST /workflow/run`. The stream will:
    - Replay any events emitted before you connected (safe for slight delays)
    - Send new events as they are emitted by the workflow
    - Close when the workflow finishes (`workflow_complete` or `workflow_error`)

    Each SSE message has `data: <JSON>` with the shape:
    ```json
    {
      "event": "extraction_complete",
      "step": "extraction",
      "message": "Extracted 42 transactions from Axis Atlas Credit Card",
      "level": "success",
      "account": "axis_atlas",
      "timestamp": "2026-03-03T10:00:00Z",
      "data": { "row_count": 42 }
    }
    ```
    """
    if job_id not in _jobs:
        raise HTTPException(status_code=404, detail=f"Job '{job_id}' not found")

    job = _jobs[job_id]

    return StreamingResponse(
        _sse_generator(job),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",  # Disable nginx buffering
            "Connection": "keep-alive",
        },
    )


@router.get("/{job_id}/status", response_model=WorkflowJobStatusResponse)
async def get_workflow_status(job_id: str):
    """
    Get the current status and full event log for a workflow job.

    Useful as a polling fallback if SSE is not available, or to
    inspect completed jobs after they finish.
    """
    if job_id not in _jobs:
        raise HTTPException(status_code=404, detail=f"Job '{job_id}' not found")

    job = _jobs[job_id]

    events = [
        WorkflowEvent(
            event=e["event"],
            step=e["step"],
            message=e["message"],
            level=WorkflowEventLevel(e.get("level", "info")),
            account=e.get("account"),
            timestamp=datetime.fromisoformat(e["timestamp"].rstrip("Z")),
            data=e.get("data", {}),
        )
        for e in job.events
        if e.get("event") != "__stream_end__"
    ]

    return WorkflowJobStatusResponse(
        job_id=job.job_id,
        status=job.status,
        mode=job.mode,
        started_at=job.started_at,
        completed_at=job.completed_at,
        events=events,
        summary=job.summary,
        error=job.error,
    )
