from __future__ import annotations

from contextlib import asynccontextmanager
from typing import AsyncIterator

from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from .models import Budget, Expense, ProcessedItem
from .connection import get_session_factory


@asynccontextmanager
async def get_db_session() -> AsyncIterator[AsyncSession]:
    session_factory = get_session_factory()
    session = session_factory()
    try:
        yield session
        await session.commit()
    except Exception:
        await session.rollback()
        raise
    finally:
        await session.close()


async def add_expense(session: AsyncSession, expense: Expense) -> Expense:
    session.add(expense)
    await session.flush()
    await session.refresh(expense)
    return expense


async def get_expense_by_id(session: AsyncSession, expense_id: str) -> Expense | None:
    return await session.get(Expense, expense_id)


async def list_expenses(session: AsyncSession, limit: int = 50, offset: int = 0) -> list[Expense]:
    result = await session.execute(select(Expense).order_by(Expense.date.desc()).offset(offset).limit(limit))
    return list(result.scalars().all())


async def upsert_budget(session: AsyncSession, budget: Budget) -> Budget:
    session.add(budget)
    await session.flush()
    await session.refresh(budget)
    return budget


async def list_budgets(session: AsyncSession) -> list[Budget]:
    result = await session.execute(select(Budget).order_by(Budget.month.desc(), Budget.category))
    return list(result.scalars().all())


async def mark_processed_if_new(session: AsyncSession, item_type: str, external_id: str) -> bool:
    exists = await session.execute(
        select(ProcessedItem).where(and_(ProcessedItem.item_type == item_type, ProcessedItem.external_id == external_id))
    )
    if exists.scalars().first():
        return False
    session.add(ProcessedItem(item_type=item_type, external_id=external_id))
    await session.flush()
    return True


