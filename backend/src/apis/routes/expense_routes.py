from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select

from src.services.database_manager.models import Expense
from src.services.database_manager.operations import get_db_session


router = APIRouter(prefix="/expenses", tags=["expenses"])


class ExpenseCreate(BaseModel):
    date: date
    amount: Decimal
    currency: str = "USD"
    merchant: str
    category: Optional[str] = None
    description: Optional[str] = None


class ExpenseRead(BaseModel):
    id: str
    date: date
    amount: Decimal
    currency: str
    merchant: str
    category: Optional[str]
    description: Optional[str]

    class Config:
        from_attributes = True


@router.get("/", response_model=list[ExpenseRead])
async def list_expenses(
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
):
    async with get_db_session() as db:
        stmt = select(Expense).order_by(Expense.date.desc()).offset(offset).limit(limit)
        result = await db.execute(stmt)
        expenses = result.scalars().all()
        return [ExpenseRead.model_validate(e) for e in expenses]


@router.post("/", response_model=ExpenseRead, status_code=201)
async def create_expense(payload: ExpenseCreate):
    async with get_db_session() as db:
        expense = Expense(**payload.model_dump())
        db.add(expense)
        await db.flush()
        await db.refresh(expense)
        return ExpenseRead.model_validate(expense)


@router.get("/{expense_id}", response_model=ExpenseRead)
async def get_expense(expense_id: str):
    async with get_db_session() as db:
        expense = await db.get(Expense, expense_id)
        if not expense:
            raise HTTPException(status_code=404, detail="Expense not found")
        return ExpenseRead.model_validate(expense)


class ExpenseUpdate(BaseModel):
    date: Optional[date] = None
    amount: Optional[Decimal] = None
    currency: Optional[str] = None
    merchant: Optional[str] = None
    category: Optional[str] = None
    description: Optional[str] = None


@router.put("/{expense_id}", response_model=ExpenseRead)
async def update_expense(expense_id: str, payload: ExpenseUpdate):
    async with get_db_session() as db:
        expense = await db.get(Expense, expense_id)
        if not expense:
            raise HTTPException(status_code=404, detail="Expense not found")
        for key, value in payload.model_dump(exclude_unset=True).items():
            setattr(expense, key, value)
        await db.flush()
        await db.refresh(expense)
        return ExpenseRead.model_validate(expense)


@router.delete("/{expense_id}", status_code=204)
async def delete_expense(expense_id: str):
    async with get_db_session() as db:
        expense = await db.get(Expense, expense_id)
        if not expense:
            raise HTTPException(status_code=404, detail="Expense not found")
        await db.delete(expense)
        await db.flush()
        return None


