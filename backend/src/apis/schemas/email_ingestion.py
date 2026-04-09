from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional
from pydantic import BaseModel


class EmailIngestionRunRequest(BaseModel):
    since_date: Optional[datetime] = None
    account_ids: Optional[List[str]] = None


class AccountIngestionResult(BaseModel):
    account: Optional[str]
    processed: int
    inserted: int
    skipped: int
    errors: int


class EmailIngestionRunResponse(BaseModel):
    processed: int
    inserted: int
    skipped: int
    errors: int
    accounts: List[AccountIngestionResult]


class ReviewQueueItemResponse(BaseModel):
    id: str
    review_type: str
    transaction_date: str
    amount: float
    description: str
    account: str
    direction: str
    transaction_type: str
    reference_number: Optional[str]
    ambiguous_candidate_ids: Optional[List[str]]
    created_at: str
    resolved_at: Optional[str]
    resolution: Optional[str]


class ReviewQueueResponse(BaseModel):
    items: List[ReviewQueueItemResponse]
    total: int


class ConfirmReviewItemRequest(BaseModel):
    edits: Optional[Dict[str, Any]] = None


class LinkReviewItemRequest(BaseModel):
    transaction_id: str


class BulkConfirmRequest(BaseModel):
    item_ids: List[str]
