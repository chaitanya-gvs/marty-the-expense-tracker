from __future__ import annotations

from decimal import Decimal
from typing import List, Optional

from pydantic import BaseModel, Field


class BudgetCreate(BaseModel):
    """Request body for creating a budget template."""
    category_id: str
    monthly_limit: Decimal = Field(..., gt=0)
    name: Optional[str] = None


class BudgetUpdate(BaseModel):
    """Request body for updating a budget template."""
    monthly_limit: Optional[Decimal] = Field(None, gt=0)
    name: Optional[str] = None


class BudgetOverrideUpsert(BaseModel):
    """Request body for creating or updating a monthly override."""
    monthly_limit: Decimal = Field(..., gt=0)


class CommittedItemResponse(BaseModel):
    recurring_key: Optional[str]
    description: str
    amount: float
    recurrence_period: Optional[str]
    is_projected: bool


class BudgetSummaryResponse(BaseModel):
    id: str
    category_id: str
    category_name: str
    monthly_limit: float
    name: Optional[str]
    effective_limit: float
    has_override: bool
    committed_spend: float
    variable_spend: float
    headroom: float
    utilisation_pct: float
    committed_items: List[CommittedItemResponse]


class BudgetResponse(BaseModel):
    id: str
    category_id: str
    category_name: str
    monthly_limit: float
    name: Optional[str]
    created_at: str
    updated_at: str


class SetRecurringRequest(BaseModel):
    """Request body for PATCH /transactions/{id}/recurring."""
    is_recurring: bool
    recurrence_period: Optional[str] = Field(
        None,
        pattern="^(monthly|quarterly|yearly|custom)$"
    )
    recurring_key: Optional[str] = None  # if None, auto-generated from description
