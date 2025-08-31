from __future__ import annotations

from datetime import date
from decimal import Decimal

from fastapi import APIRouter, Query
from pydantic import BaseModel
from sqlalchemy import and_, select

from src.services.database_manager.models import Budget, Expense
from src.services.database_manager.operations import get_db_session


router = APIRouter(prefix="/budgets", tags=["budgets"])


class BudgetCreate(BaseModel):
    category: str
    month: date  # first of month
    amount: Decimal


class BudgetRead(BaseModel):
    id: str
    category: str
    month: date
    amount: Decimal

    class Config:
        from_attributes = True


@router.post("/", response_model=BudgetRead, status_code=201)
async def create_budget(payload: BudgetCreate):
    async with get_db_session() as db:
        budget = Budget(**payload.model_dump())
        db.add(budget)
        await db.flush()
        await db.refresh(budget)
        return BudgetRead.model_validate(budget)


@router.get("/", response_model=list[BudgetRead])
async def list_budgets():
    async with get_db_session() as db:
        result = await db.execute(select(Budget).order_by(Budget.month.desc(), Budget.category))
        budgets = result.scalars().all()
        return [BudgetRead.model_validate(b) for b in budgets]


class BudgetSummary(BaseModel):
    category: str
    month: date
    budgeted: Decimal
    actual: Decimal
    remaining: Decimal


@router.get("/summary", response_model=list[BudgetSummary])
async def budget_summary(
    month: date = Query(..., description="First day of the month to summarize"),
):
    async with get_db_session() as db:
    # Fetch budgets for month
        budgets_result = await db.execute(select(Budget).where(Budget.month == month))
        budgets = budgets_result.scalars().all()

    # Fetch expenses in that month
    start = month
    if month.month == 12:
        end = date(month.year + 1, 1, 1)
    else:
        end = date(month.year, month.month + 1, 1)

        expenses_result = await db.execute(
            select(Expense).where(and_(Expense.date >= start, Expense.date < end))
        )
        expenses = expenses_result.scalars().all()

    # Aggregate by category
    actual_by_cat: dict[str, Decimal] = {}
    for e in expenses:
        cat = e.category or "Uncategorized"
        actual_by_cat[cat] = actual_by_cat.get(cat, Decimal("0")) + e.amount

    summaries: list[BudgetSummary] = []
    budget_map = {b.category: b for b in budgets}

    seen_categories = set(budget_map.keys()) | set(actual_by_cat.keys())
    for cat in sorted(seen_categories):
        budgeted = Decimal(str(budget_map.get(cat).amount)) if cat in budget_map else Decimal("0")
        actual = Decimal(str(actual_by_cat.get(cat, Decimal("0"))))
        summaries.append(
            BudgetSummary(
                category=cat,
                month=month,
                budgeted=budgeted,
                actual=actual,
                remaining=budgeted - actual,
            )
        )

    return summaries


