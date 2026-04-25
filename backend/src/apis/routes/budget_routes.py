from __future__ import annotations

import re
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, HTTPException, Query

from src.apis.schemas.budgets import (
    BudgetCreate,
    BudgetOverrideUpsert,
    BudgetResponse,
    BudgetSummaryResponse,
    BudgetUpdate,
)
from src.apis.schemas.common import ApiResponse
from src.services.budget_service import compute_all_budgets_summary, compute_budget_summary
from src.services.database_manager.operations import BudgetOperations
from src.utils.logger import get_logger

logger = get_logger(__name__)
router = APIRouter(prefix="/budgets", tags=["budgets"])


def _current_period() -> str:
    return datetime.now().strftime("%Y-%m")


@router.get("", response_model=ApiResponse)
@router.get("/", response_model=ApiResponse)
async def list_budgets():
    """List all budget templates (no spend computation)."""
    budgets = await BudgetOperations.get_all_budgets()
    return ApiResponse(data=budgets)


@router.get("/summary", response_model=ApiResponse)
async def get_budgets_summary(
    period: Optional[str] = Query(None, pattern=r"^\d{4}-\d{2}$", description="YYYY-MM, defaults to current month")
):
    """All budgets with computed spend for the given period."""
    period = period or _current_period()
    summaries = await compute_all_budgets_summary(period)

    # Coverage gaps: recurring without a budget + variable spend without a budget
    # Errors here are non-fatal — budgets still load, warnings just won't show
    try:
        coverage_gaps = await BudgetOperations.get_budget_coverage_gaps(period)
    except Exception as e:
        logger.error("Failed to compute coverage gaps for period %s: %s", period, e)
        coverage_gaps = {"recurring_gaps": [], "variable_gaps": []}

    return ApiResponse(data={"budgets": summaries, "coverage_gaps": coverage_gaps, "period": period})


@router.get("/{budget_id}/summary", response_model=ApiResponse)
async def get_budget_summary(
    budget_id: str,
    period: Optional[str] = Query(None, pattern=r"^\d{4}-\d{2}$")
):
    """Single budget with full spend breakdown."""
    period = period or _current_period()
    try:
        summary = await compute_budget_summary(budget_id, period)
    except ValueError:
        raise HTTPException(status_code=404, detail="Budget not found")
    return ApiResponse(data=summary)


@router.post("", response_model=ApiResponse, status_code=201)
@router.post("/", response_model=ApiResponse, status_code=201)
async def create_budget(body: BudgetCreate):
    """Create a budget template. Fails if category already has one."""
    existing = await BudgetOperations.get_budget_by_category_id(body.category_id)
    if existing:
        raise HTTPException(status_code=409, detail="A budget for this category already exists")
    budget_id = await BudgetOperations.create_budget(
        category_id=body.category_id,
        monthly_limit=body.monthly_limit,
        name=body.name,
    )
    budget = await BudgetOperations.get_budget_by_id(budget_id)
    return ApiResponse(data=budget)


@router.put("/{budget_id}", response_model=ApiResponse)
async def update_budget(budget_id: str, body: BudgetUpdate):
    """Update a budget template's limit or name."""
    updated = await BudgetOperations.update_budget(
        budget_id=budget_id,
        monthly_limit=body.monthly_limit,
        name=body.name,
    )
    if not updated:
        raise HTTPException(status_code=404, detail="Budget not found")
    budget = await BudgetOperations.get_budget_by_id(budget_id)
    return ApiResponse(data=budget)


@router.delete("/{budget_id}", response_model=ApiResponse)
async def delete_budget(budget_id: str):
    """Delete a budget template and all its overrides."""
    deleted = await BudgetOperations.delete_budget(budget_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Budget not found")
    return ApiResponse(data={"deleted": True})


@router.post("/{budget_id}/overrides", response_model=ApiResponse, status_code=201)
async def upsert_override(budget_id: str, period: str = Query(..., pattern=r"^\d{4}-\d{2}$"), body: BudgetOverrideUpsert = ...):
    """Create or update a monthly limit override for a budget."""
    budget = await BudgetOperations.get_budget_by_id(budget_id)
    if not budget:
        raise HTTPException(status_code=404, detail="Budget not found")
    override_id = await BudgetOperations.upsert_override(budget_id, period, body.monthly_limit)
    override = await BudgetOperations.get_override(budget_id, period)
    return ApiResponse(data=override)


@router.delete("/{budget_id}/overrides/{period}", response_model=ApiResponse)
async def delete_override(budget_id: str, period: str):
    """Remove a monthly override, reverting to the template limit."""
    if not re.match(r"^\d{4}-\d{2}$", period):
        raise HTTPException(status_code=422, detail="period must be YYYY-MM")
    deleted = await BudgetOperations.delete_override(budget_id, period)
    if not deleted:
        raise HTTPException(status_code=404, detail="Override not found")
    return ApiResponse(data={"deleted": True})
