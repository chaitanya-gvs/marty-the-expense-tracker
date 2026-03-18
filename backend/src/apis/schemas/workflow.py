from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Optional

from pydantic import BaseModel


class WorkflowMode(str, Enum):
    full = "full"
    resume = "resume"
    splitwise_only = "splitwise_only"


class WorkflowEventLevel(str, Enum):
    info = "info"
    success = "success"
    warning = "warning"
    error = "error"


class WorkflowEvent(BaseModel):
    event: str
    step: str
    message: str
    level: WorkflowEventLevel = WorkflowEventLevel.info
    account: Optional[str] = None
    timestamp: datetime
    data: Dict[str, Any] = {}


class WorkflowRunRequest(BaseModel):
    mode: WorkflowMode = WorkflowMode.full
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    splitwise_start_date: Optional[str] = None
    splitwise_end_date: Optional[str] = None
    enable_secondary_account: Optional[bool] = None
    override: bool = False


class WorkflowRunResponse(BaseModel):
    job_id: str
    mode: WorkflowMode
    started_at: datetime


class WorkflowJobStatus(str, Enum):
    pending = "pending"
    running = "running"
    completed = "completed"
    failed = "failed"
    cancelled = "cancelled"


class WorkflowJobStatusResponse(BaseModel):
    job_id: str
    status: WorkflowJobStatus
    mode: WorkflowMode
    started_at: datetime
    completed_at: Optional[datetime] = None
    events: List[WorkflowEvent] = []
    summary: Optional[Dict[str, Any]] = None
    error: Optional[str] = None
