from __future__ import annotations

from decimal import Decimal
from typing import Any, Dict, List, Optional
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from src.services.database_manager.connection import get_session_factory
from src.utils.logger import get_logger

logger = get_logger(__name__)


class BudgetOperations:
    """CRUD operations for budgets and budget overrides."""

    @staticmethod
    async def get_all_budgets() -> List[Dict[str, Any]]:
        """Return all budget templates with category name."""
        session_factory = get_session_factory()
        async with session_factory() as session:
            result = await session.execute(text("""
                SELECT b.id::text, b.category_id::text, b.monthly_limit::text,
                       b.name, b.created_at::text, b.updated_at::text,
                       c.name AS category_name
                FROM budgets b
                JOIN categories c ON c.id = b.category_id
                ORDER BY c.name
            """))
            rows = result.mappings().all()
            return [dict(r) for r in rows]

    @staticmethod
    async def get_budget_by_id(budget_id: str) -> Optional[Dict[str, Any]]:
        """Return a single budget template by id."""
        session_factory = get_session_factory()
        async with session_factory() as session:
            result = await session.execute(text("""
                SELECT b.id::text, b.category_id::text, b.monthly_limit::text,
                       b.name, b.created_at::text, b.updated_at::text,
                       c.name AS category_name
                FROM budgets b
                JOIN categories c ON c.id = b.category_id
                WHERE b.id = :budget_id
            """), {"budget_id": budget_id})
            row = result.mappings().first()
            return dict(row) if row else None

    @staticmethod
    async def get_budget_by_category_id(category_id: str) -> Optional[Dict[str, Any]]:
        """Return budget for a specific category, if it exists."""
        session_factory = get_session_factory()
        async with session_factory() as session:
            result = await session.execute(text("""
                SELECT b.id::text, b.category_id::text, b.monthly_limit::text,
                       b.name, b.created_at::text, b.updated_at::text,
                       c.name AS category_name
                FROM budgets b
                JOIN categories c ON c.id = b.category_id
                WHERE b.category_id = :category_id
            """), {"category_id": category_id})
            row = result.mappings().first()
            return dict(row) if row else None

    @staticmethod
    async def create_budget(category_id: str, monthly_limit: Decimal, name: Optional[str] = None) -> str:
        """Create a budget template. Returns new budget id."""
        session_factory = get_session_factory()
        async with session_factory() as session:
            result = await session.execute(text("""
                INSERT INTO budgets (category_id, monthly_limit, name)
                VALUES (:category_id, :monthly_limit, :name)
                RETURNING id::text
            """), {"category_id": category_id, "monthly_limit": monthly_limit, "name": name})
            await session.commit()
            return result.scalar_one()

    @staticmethod
    async def update_budget(budget_id: str, monthly_limit: Optional[Decimal] = None, name: Optional[str] = None) -> bool:
        """Update a budget template. Returns True if found and updated."""
        fields: Dict[str, Any] = {"budget_id": budget_id}
        set_clauses = ["updated_at = now()"]
        if monthly_limit is not None:
            set_clauses.append("monthly_limit = :monthly_limit")
            fields["monthly_limit"] = monthly_limit
        if name is not None:
            set_clauses.append("name = :name")
            fields["name"] = name
        if len(set_clauses) == 1:
            return True  # nothing to update
        session_factory = get_session_factory()
        async with session_factory() as session:
            result = await session.execute(
                text(f"UPDATE budgets SET {', '.join(set_clauses)} WHERE id = :budget_id"),
                fields
            )
            await session.commit()
            return result.rowcount > 0

    @staticmethod
    async def delete_budget(budget_id: str) -> bool:
        """Delete a budget template (cascades to overrides). Returns True if deleted."""
        session_factory = get_session_factory()
        async with session_factory() as session:
            result = await session.execute(
                text("DELETE FROM budgets WHERE id = :budget_id"),
                {"budget_id": budget_id}
            )
            await session.commit()
            return result.rowcount > 0

    # ── Overrides ────────────────────────────────────────────────────────────

    @staticmethod
    async def get_override(budget_id: str, period: str) -> Optional[Dict[str, Any]]:
        """Return override for budget+period, or None."""
        session_factory = get_session_factory()
        async with session_factory() as session:
            result = await session.execute(text("""
                SELECT id::text, budget_id::text, period, monthly_limit::text, created_at::text
                FROM budget_overrides
                WHERE budget_id = :budget_id AND period = :period
            """), {"budget_id": budget_id, "period": period})
            row = result.mappings().first()
            return dict(row) if row else None

    @staticmethod
    async def upsert_override(budget_id: str, period: str, monthly_limit: Decimal) -> str:
        """Create or update a monthly override. Returns override id."""
        session_factory = get_session_factory()
        async with session_factory() as session:
            result = await session.execute(text("""
                INSERT INTO budget_overrides (budget_id, period, monthly_limit)
                VALUES (:budget_id, :period, :monthly_limit)
                ON CONFLICT (budget_id, period)
                DO UPDATE SET monthly_limit = EXCLUDED.monthly_limit
                RETURNING id::text
            """), {"budget_id": budget_id, "period": period, "monthly_limit": monthly_limit})
            await session.commit()
            return result.scalar_one()

    @staticmethod
    async def delete_override(budget_id: str, period: str) -> bool:
        """Delete a monthly override. Returns True if deleted."""
        session_factory = get_session_factory()
        async with session_factory() as session:
            result = await session.execute(
                text("DELETE FROM budget_overrides WHERE budget_id = :budget_id AND period = :period"),
                {"budget_id": budget_id, "period": period}
            )
            await session.commit()
            return result.rowcount > 0

    @staticmethod
    async def get_categories_with_recurring_but_no_budget() -> List[Dict[str, Any]]:
        """Return categories that have recurring transactions but no budget template."""
        session_factory = get_session_factory()
        async with session_factory() as session:
            result = await session.execute(text("""
                SELECT DISTINCT c.id::text, c.name, c.color,
                       COUNT(t.id) AS recurring_count
                FROM transactions t
                JOIN categories c ON c.id = t.category_id
                WHERE t.is_recurring = true
                  AND t.is_deleted = false
                  AND NOT EXISTS (
                    SELECT 1 FROM budgets b WHERE b.category_id = t.category_id
                  )
                GROUP BY c.id, c.name, c.color
                ORDER BY c.name
            """))
            rows = result.mappings().all()
            return [dict(r) for r in rows]
