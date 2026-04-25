from __future__ import annotations

"""
Budget spend computation service.

All spend is computed dynamically — nothing is cached or stored.
For a given budget + period (YYYY-MM):
  - committed_spend = recurring transactions in category that landed this month
  - variable_spend  = non-recurring debit transactions in category this month
  - headroom        = effective_limit - committed_spend - variable_spend

Committed items NOT yet transacted this month are shown as projections
(last known amount from any previous month, labelled is_projected=True).
"""

import calendar
from datetime import date
from decimal import Decimal
from typing import Any, Dict, List, Optional

from sqlalchemy import text


def _is_due_this_period(last_date: date, period_start: date, recurrence_period: Optional[str]) -> bool:
    """
    Return True if a recurring item is expected to recur in the month of period_start,
    given its last known transaction date and recurrence cadence.
    """
    if recurrence_period in (None, "monthly"):
        return True
    if recurrence_period == "yearly":
        return last_date.month == period_start.month
    if recurrence_period == "quarterly":
        months_since = (
            (period_start.year - last_date.year) * 12
            + (period_start.month - last_date.month)
        )
        return months_since % 3 == 0
    # "custom" or any unknown cadence — include to avoid silent omissions
    return True

from src.services.database_manager.connection import get_session_factory
from src.utils.logger import get_logger

logger = get_logger(__name__)


async def compute_budget_summary(budget_id: str, period: str) -> Dict[str, Any]:
    """
    Compute full spend breakdown for a budget in a given period.

    Args:
        budget_id: UUID string of the budget template.
        period: 'YYYY-MM' string e.g. '2026-04'.

    Returns a dict matching the BudgetSummary schema.
    """
    session_factory = get_session_factory()
    async with session_factory() as session:

        # 1. Fetch budget + effective limit
        budget_row = (await session.execute(text("""
            SELECT b.id::text, b.category_id::text, b.monthly_limit,
                   b.name, c.name AS category_name,
                   COALESCE(o.monthly_limit, b.monthly_limit) AS effective_limit,
                   (o.id IS NOT NULL) AS has_override
            FROM budgets b
            JOIN categories c ON c.id = b.category_id
            LEFT JOIN budget_overrides o ON o.budget_id = b.id AND o.period = :period
            WHERE b.id = :budget_id
        """), {"budget_id": budget_id, "period": period})).mappings().first()

        if not budget_row:
            raise ValueError(f"Budget {budget_id} not found")

        category_id = budget_row["category_id"]
        effective_limit = Decimal(str(budget_row["effective_limit"]))
        year, month = int(period[:4]), int(period[5:7])
        last_day = calendar.monthrange(year, month)[1]
        period_start = date(year, month, 1)
        period_end = date(year, month, last_day)

        # 2. Committed spend — recurring transactions that landed this month
        committed_rows = (await session.execute(text("""
            SELECT t.recurring_key,
                   t.description,
                   t.user_description,
                   COALESCE(t.split_share_amount, t.amount) AS amount,
                   t.recurrence_period
            FROM transactions t
            WHERE t.category_id = :category_id
              AND t.is_recurring = true
              AND t.is_deleted = false
              AND t.direction = 'debit'
              AND t.transaction_date BETWEEN :period_start AND :period_end
              AND (t.transaction_group_id IS NULL OR t.is_split = true OR t.is_grouped_expense = true)
        """), {"category_id": category_id, "period_start": period_start, "period_end": period_end})).mappings().all()

        # Build committed items from actual this-month transactions
        committed_by_key: Dict[str, Dict[str, Any]] = {}
        for row in committed_rows:
            key = row["recurring_key"] or row["user_description"] or row["description"]
            desc = row["user_description"] or row["description"]
            if key not in committed_by_key:
                committed_by_key[key] = {
                    "recurring_key": key,
                    "description": desc,
                    "amount": Decimal(str(row["amount"])),
                    "recurrence_period": row["recurrence_period"],
                    "is_projected": False,
                }
            else:
                # Sum multiple transactions with same key in same period
                committed_by_key[key]["amount"] += Decimal(str(row["amount"]))

        # 3. Projected committed items — recurring items seen in past months but not yet this month
        projected_rows = (await session.execute(text("""
            SELECT DISTINCT ON (COALESCE(t.recurring_key, t.user_description, t.description))
                   COALESCE(t.recurring_key, t.user_description, t.description) AS key,
                   t.user_description,
                   t.description,
                   COALESCE(t.split_share_amount, t.amount) AS amount,
                   t.recurrence_period,
                   t.transaction_date AS last_date
            FROM transactions t
            WHERE t.category_id = :category_id
              AND t.is_recurring = true
              AND t.is_deleted = false
              AND t.direction = 'debit'
              AND t.transaction_date < :period_start
              AND (t.transaction_group_id IS NULL OR t.is_split = true OR t.is_grouped_expense = true)
            ORDER BY COALESCE(t.recurring_key, t.user_description, t.description),
                     t.transaction_date DESC
        """), {"category_id": category_id, "period_start": period_start})).mappings().all()

        for row in projected_rows:
            key = row["key"]
            if key not in committed_by_key:
                # Only add projection if this recurring item hasn't landed yet this month
                # and is actually due in this period (e.g. yearly items only project in their month)
                if not _is_due_this_period(row["last_date"], period_start, row["recurrence_period"]):
                    continue
                desc = row["user_description"] or row["description"]
                committed_by_key[key] = {
                    "recurring_key": key,
                    "description": desc,
                    "amount": Decimal(str(row["amount"])),
                    "recurrence_period": row["recurrence_period"],
                    "is_projected": True,
                }

        committed_items = list(committed_by_key.values())
        committed_spend = sum(
            item["amount"] for item in committed_items if not item["is_projected"]
        )

        # 4. Variable spend — non-recurring debit transactions this month
        variable_row = (await session.execute(text("""
            SELECT COALESCE(SUM(COALESCE(t.split_share_amount, t.amount)), 0) AS total
            FROM transactions t
            WHERE t.category_id = :category_id
              AND (t.is_recurring = false OR t.is_recurring IS NULL)
              AND t.is_deleted = false
              AND t.direction = 'debit'
              AND t.transaction_date BETWEEN :period_start AND :period_end
              AND (t.transaction_group_id IS NULL OR t.is_split = true OR t.is_grouped_expense = true)
        """), {"category_id": category_id, "period_start": period_start, "period_end": period_end})).mappings().first()

        variable_spend = Decimal(str(variable_row["total"]))

        # 5. Headroom
        total_spend = committed_spend + variable_spend
        headroom = effective_limit - total_spend
        utilisation_pct = float((total_spend / effective_limit * 100) if effective_limit > 0 else 0)

        return {
            "id": budget_row["id"],
            "category_id": category_id,
            "category_name": budget_row["category_name"],
            "monthly_limit": float(budget_row["monthly_limit"]),
            "name": budget_row["name"],
            "effective_limit": float(effective_limit),
            "has_override": budget_row["has_override"],
            "committed_spend": float(committed_spend),
            "variable_spend": float(variable_spend),
            "headroom": float(headroom),
            "utilisation_pct": round(utilisation_pct, 1),
            "committed_items": [
                {
                    "recurring_key": item["recurring_key"],
                    "description": item["description"],
                    "amount": float(item["amount"]),
                    "recurrence_period": item["recurrence_period"],
                    "is_projected": item["is_projected"],
                }
                for item in committed_items
            ],
        }


async def compute_all_budgets_summary(period: str) -> List[Dict[str, Any]]:
    """Compute spend summary for all budget templates for a given period."""
    session_factory = get_session_factory()
    async with session_factory() as session:
        budget_ids_row = await session.execute(text("SELECT id::text FROM budgets ORDER BY id"))
        budget_ids = [r[0] for r in budget_ids_row.fetchall()]

    results = []
    for budget_id in budget_ids:
        try:
            summary = await compute_budget_summary(budget_id, period)
            results.append(summary)
        except Exception as e:
            logger.error("Failed to compute summary for budget %s: %s", budget_id, e)
    return results
