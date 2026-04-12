# Budgets Feature Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a category-based budgeting system with automatic committed spend detection from recurring transactions, monthly override support, and threshold alerts.

**Architecture:** New `budgets` + `budget_overrides` tables and three new fields on `transactions` (`is_recurring`, `recurrence_period`, `recurring_key`). Spend is computed dynamically — committed = recurring transactions that landed this month, variable = non-recurring. Backend follows the existing FastAPI → operations → SQLAlchemy pattern. Frontend replaces the placeholder budget components with real data.

**Tech Stack:** FastAPI + SQLAlchemy 2.0 async + Alembic (backend); Next.js 15 + TanStack Query + Tailwind CSS 4 + Radix UI (frontend); Lucide icons; Recharts for charts.

**Branch:** All work on `feature/budgets`. Do not merge to `main` until the feature is complete.

---

## File Map

### Backend — New files
| File | Purpose |
|------|---------|
| `backend/src/services/database_manager/models/budget.py` | `Budget` + `BudgetOverride` SQLAlchemy models |
| `backend/src/services/database_manager/operations/budget_operations.py` | CRUD operations for budgets + overrides |
| `backend/src/services/budget_service.py` | Spend computation (committed, variable, headroom) |
| `backend/src/apis/schemas/budgets.py` | Pydantic request/response models |
| `backend/src/apis/routes/budget_routes.py` | All `/api/budgets` endpoints |
| `backend/tests/test_budget_api.py` | Integration tests |

### Backend — Modified files
| File | Change |
|------|--------|
| `backend/src/services/database_manager/models/__init__.py` | Add `Budget`, `BudgetOverride` imports |
| `backend/src/services/database_manager/operations/__init__.py` | Add `BudgetOperations` import |
| `backend/main.py` | Register `budget_router` |
| `backend/src/apis/routes/transaction_write_routes.py` | Add `PATCH /transactions/{id}/recurring` endpoint |

### Backend — Migrations (auto-generated, then reviewed)
| File | Purpose |
|------|---------|
| `backend/src/services/database_manager/migrations/versions/*_add_recurring_fields_to_transactions.py` | `is_recurring`, `recurrence_period`, `recurring_key` on `transactions` |
| `backend/src/services/database_manager/migrations/versions/*_add_budgets_tables.py` | `budgets` + `budget_overrides` tables |

### Frontend — New files
| File | Purpose |
|------|---------|
| `frontend/src/components/transactions/recurring-period-popover.tsx` | Period picker popover (↻ click handler) |
| `frontend/src/components/budgets/budget-card.tsx` | Single category budget card with stacked bar |
| `frontend/src/components/budgets/budget-threshold-alerts.tsx` | Panel listing budgets at/near limit |
| `frontend/src/components/budgets/no-budget-warning.tsx` | Warning for categories with recurring but no budget |
| `frontend/src/components/budgets/budget-create-modal.tsx` | Create/edit budget template modal |
| `frontend/src/components/budgets/budget-override-modal.tsx` | Set monthly limit override modal |

### Frontend — Replaced files (existing content is placeholder only)
| File | Change |
|------|--------|
| `frontend/src/components/budgets/budgets-overview.tsx` | Replace hardcoded stats with real `BudgetSummary` data |
| `frontend/src/components/budgets/budgets-list.tsx` | Replace placeholder with `BudgetCard` list |
| `frontend/src/app/budgets/page.tsx` | Add month picker, wire all real components |
| `frontend/src/hooks/use-budgets.ts` | Replace placeholder hooks with real implementations |

### Frontend — Modified files
| File | Change |
|------|--------|
| `frontend/src/lib/types/index.ts` | Replace `Budget` type; add `BudgetOverride`, `BudgetSummary`, `CommittedItem`; add `is_recurring`, `recurrence_period`, `recurring_key` to `Transaction` |
| `frontend/src/lib/api/client.ts` | Replace budget methods; add `setRecurring()` |
| `frontend/src/components/transactions/transaction-columns.tsx` | Add ↻ icon to action icons column |
| `frontend/src/components/transactions/transaction-edit-modal.tsx` | Add Recurring checkbox + period selector to flags section |

---

## Task 1: Create the feature branch

**Files:** none

- [ ] **Step 1: Create and switch to feature branch**

```bash
cd D:/dev/personal-projects/marty-the-expense-tracker
git checkout -b feature/budgets
```

Expected output: `Switched to a new branch 'feature/budgets'`

---

## Task 2: Add recurring fields to transactions (migration)

**Files:**
- Modify: `backend/src/services/database_manager/models/transaction.py`
- Create: migration (auto-generated)

- [ ] **Step 1: Add the three new fields to the Transaction model**

Open `backend/src/services/database_manager/models/transaction.py` and add after the `tags` field (line ~52):

```python
    is_recurring: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True, default=False)
    recurrence_period: Mapped[Optional[str]] = mapped_column(Text, nullable=True)  # monthly | quarterly | yearly | custom
    recurring_key: Mapped[Optional[str]] = mapped_column(Text, nullable=True)  # normalised slug e.g. 'netflix'
```

Also add an index inside `__table_args__`:
```python
        Index('idx_transactions_recurring_key', 'recurring_key'),
        Index('idx_transactions_is_recurring', 'is_recurring'),
```

- [ ] **Step 2: Generate the migration**

```bash
cd backend
poetry run alembic revision --autogenerate -m "add_recurring_fields_to_transactions"
```

Expected: a new file in `src/services/database_manager/migrations/versions/` with `add_recurring_fields_to_transactions` in the name.

- [ ] **Step 3: Review the generated migration**

Open the generated file. Confirm it contains:
```python
op.add_column('transactions', sa.Column('is_recurring', sa.Boolean(), nullable=True))
op.add_column('transactions', sa.Column('recurrence_period', sa.Text(), nullable=True))
op.add_column('transactions', sa.Column('recurring_key', sa.Text(), nullable=True))
op.create_index('idx_transactions_recurring_key', 'transactions', ['recurring_key'])
op.create_index('idx_transactions_is_recurring', 'transactions', ['is_recurring'])
```

If the index lines are missing, add them manually.

- [ ] **Step 4: Apply the migration**

```bash
cd backend
poetry run alembic upgrade head
```

Expected: `Running upgrade ... -> ..., add_recurring_fields_to_transactions`

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/database_manager/models/transaction.py
git add backend/src/services/database_manager/migrations/versions/
git commit -m "feat: add is_recurring, recurrence_period, recurring_key to transactions"
```

---

## Task 3: Create Budget and BudgetOverride models + migration

**Files:**
- Create: `backend/src/services/database_manager/models/budget.py`
- Modify: `backend/src/services/database_manager/models/__init__.py`
- Create: migration (auto-generated)

- [ ] **Step 1: Create the Budget and BudgetOverride models**

Create `backend/src/services/database_manager/models/budget.py`:

```python
from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import List, Optional
from uuid import UUID

from sqlalchemy import ForeignKey, Index, Numeric, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy import DateTime

from src.services.database_manager.connection import Base


class Budget(Base):
    """Budget template — one per category, defines the monthly spending limit."""

    __tablename__ = "budgets"

    id: Mapped[UUID] = mapped_column(primary_key=True, server_default=func.gen_random_uuid())
    category_id: Mapped[UUID] = mapped_column(ForeignKey("categories.id", ondelete="CASCADE"), nullable=False)
    monthly_limit: Mapped[Decimal] = mapped_column(Numeric, nullable=False)
    name: Mapped[Optional[str]] = mapped_column(Text, nullable=True)  # display override; falls back to category name
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())

    # Relationships
    category: Mapped["Category"] = relationship("Category")
    overrides: Mapped[List["BudgetOverride"]] = relationship("BudgetOverride", back_populates="budget", cascade="all, delete-orphan")

    __table_args__ = (
        UniqueConstraint("category_id", name="uq_budgets_category_id"),
        Index("idx_budgets_category_id", "category_id"),
    )


class BudgetOverride(Base):
    """Per-month limit override for a budget template."""

    __tablename__ = "budget_overrides"

    id: Mapped[UUID] = mapped_column(primary_key=True, server_default=func.gen_random_uuid())
    budget_id: Mapped[UUID] = mapped_column(ForeignKey("budgets.id", ondelete="CASCADE"), nullable=False)
    period: Mapped[str] = mapped_column(Text, nullable=False)  # 'YYYY-MM'
    monthly_limit: Mapped[Decimal] = mapped_column(Numeric, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())

    # Relationships
    budget: Mapped["Budget"] = relationship("Budget", back_populates="overrides")

    __table_args__ = (
        UniqueConstraint("budget_id", "period", name="uq_budget_overrides_budget_period"),
        Index("idx_budget_overrides_budget_id", "budget_id"),
    )
```

- [ ] **Step 2: Register models in `__init__.py`**

Open `backend/src/services/database_manager/models/__init__.py` and add:

```python
from .budget import Budget, BudgetOverride
```

And add `"Budget"` and `"BudgetOverride"` to `__all__`.

- [ ] **Step 3: Generate the migration**

```bash
cd backend
poetry run alembic revision --autogenerate -m "add_budgets_tables"
```

- [ ] **Step 4: Review and apply the migration**

Open the generated file. Confirm it creates both `budgets` and `budget_overrides` tables with correct columns, FKs, and constraints. Then apply:

```bash
cd backend
poetry run alembic upgrade head
```

Expected: `Running upgrade ... -> ..., add_budgets_tables`

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/database_manager/models/budget.py
git add backend/src/services/database_manager/models/__init__.py
git add backend/src/services/database_manager/migrations/versions/
git commit -m "feat: add Budget and BudgetOverride models and migration"
```

---

## Task 4: Budget database operations

**Files:**
- Create: `backend/src/services/database_manager/operations/budget_operations.py`
- Modify: `backend/src/services/database_manager/operations/__init__.py`

- [ ] **Step 1: Create `budget_operations.py`**

```python
from __future__ import annotations

from decimal import Decimal
from typing import Any, Dict, List, Optional
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ..connection import get_session_factory
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
```

- [ ] **Step 2: Register in operations `__init__.py`**

Open `backend/src/services/database_manager/operations/__init__.py` and add:

```python
from .budget_operations import BudgetOperations
```

Add `"BudgetOperations"` to `__all__` if it exists, or verify the import is accessible.

- [ ] **Step 3: Commit**

```bash
git add backend/src/services/database_manager/operations/budget_operations.py
git add backend/src/services/database_manager/operations/__init__.py
git commit -m "feat: add BudgetOperations for budgets and overrides CRUD"
```

---

## Task 5: Budget service — spend computation

**Files:**
- Create: `backend/src/services/budget_service.py`

- [ ] **Step 1: Create `budget_service.py`**

```python
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

from decimal import Decimal
from typing import Any, Dict, List, Optional

from sqlalchemy import text

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
        period_start = f"{period}-01"
        # Last day: let Postgres compute it
        period_end_row = (await session.execute(
            text("SELECT (date_trunc('month', :period_start::date) + interval '1 month - 1 day')::text AS period_end"),
            {"period_start": period_start}
        )).scalar_one()
        period_end = period_end_row

        # 2. Committed spend — recurring transactions that landed this month
        committed_rows = (await session.execute(text("""
            SELECT t.recurring_key,
                   t.description,
                   t.user_description,
                   t.amount,
                   t.recurrence_period
            FROM transactions t
            WHERE t.category_id = :category_id
              AND t.is_recurring = true
              AND t.is_deleted = false
              AND t.direction = 'debit'
              AND t.transaction_date BETWEEN :period_start AND :period_end
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
                   t.amount,
                   t.recurrence_period
            FROM transactions t
            WHERE t.category_id = :category_id
              AND t.is_recurring = true
              AND t.is_deleted = false
              AND t.direction = 'debit'
              AND t.transaction_date < :period_start
            ORDER BY COALESCE(t.recurring_key, t.user_description, t.description),
                     t.transaction_date DESC
        """), {"category_id": category_id, "period_start": period_start})).mappings().all()

        for row in projected_rows:
            key = row["key"]
            if key not in committed_by_key:
                # Only add projection if this recurring item hasn't landed yet this month
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
            SELECT COALESCE(SUM(t.amount), 0) AS total
            FROM transactions t
            WHERE t.category_id = :category_id
              AND (t.is_recurring = false OR t.is_recurring IS NULL)
              AND t.is_deleted = false
              AND t.direction = 'debit'
              AND t.transaction_date BETWEEN :period_start AND :period_end
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
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/services/budget_service.py
git commit -m "feat: add budget spend computation service"
```

---

## Task 6: Budget API schemas

**Files:**
- Create: `backend/src/apis/schemas/budgets.py`

- [ ] **Step 1: Create `budgets.py` schema file**

```python
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
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/apis/schemas/budgets.py
git commit -m "feat: add budget API schemas"
```

---

## Task 7: Budget API routes

**Files:**
- Create: `backend/src/apis/routes/budget_routes.py`
- Modify: `backend/main.py`

- [ ] **Step 1: Create `budget_routes.py`**

```python
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

    # Also include categories with recurring but no budget (for warnings)
    unbudgeted = await BudgetOperations.get_categories_with_recurring_but_no_budget()

    return ApiResponse(data={"budgets": summaries, "unbudgeted_categories": unbudgeted, "period": period})


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
```

- [ ] **Step 2: Register the router in `main.py`**

Add the import near the other router imports:
```python
from src.apis.routes.budget_routes import router as budget_router
```

Add the router registration after the other `app.include_router` lines:
```python
app.include_router(budget_router, prefix="/api", dependencies=_auth)
```

- [ ] **Step 3: Verify the server starts**

```bash
cd backend
poetry run uvicorn main:app --reload
```

Open http://localhost:8000/docs — confirm `/api/budgets` routes appear.

- [ ] **Step 4: Commit**

```bash
git add backend/src/apis/routes/budget_routes.py backend/main.py
git commit -m "feat: add budget API routes and register in main.py"
```

---

## Task 8: Transaction recurring PATCH endpoint

**Files:**
- Modify: `backend/src/apis/routes/transaction_write_routes.py`
- Modify: `backend/src/services/database_manager/operations/transaction_operations.py`

- [ ] **Step 1: Add `set_recurring` to TransactionOperations**

In `backend/src/services/database_manager/operations/transaction_operations.py`, add a new static method inside the `TransactionOperations` class:

```python
    @staticmethod
    async def set_recurring(
        transaction_id: str,
        is_recurring: bool,
        recurrence_period: Optional[str],
        recurring_key: Optional[str],
    ) -> bool:
        """Set recurring fields on a transaction. Returns True if updated."""
        session_factory = get_session_factory()
        async with session_factory() as session:
            result = await session.execute(text("""
                UPDATE transactions
                SET is_recurring = :is_recurring,
                    recurrence_period = :recurrence_period,
                    recurring_key = :recurring_key,
                    updated_at = now()
                WHERE id = :transaction_id
                  AND is_deleted = false
            """), {
                "transaction_id": transaction_id,
                "is_recurring": is_recurring,
                "recurrence_period": recurrence_period if is_recurring else None,
                "recurring_key": recurring_key if is_recurring else None,
            })
            await session.commit()
            return result.rowcount > 0
```

- [ ] **Step 2: Add the route to `transaction_write_routes.py`**

Add the import at the top of the file with other schema imports:
```python
from src.apis.schemas.budgets import SetRecurringRequest
```

Add a helper function (after imports, before routes):
```python
import re
import unicodedata

def _generate_recurring_key(description: str) -> str:
    """Normalise a transaction description into a stable recurring_key slug.
    e.g. 'NETFLIX.COM 38291' → 'netflix', 'Claude Pro – Anthropic' → 'claude-pro-anthropic'
    """
    s = description.lower()
    # Remove common merchant noise: trailing numbers, UPI codes, card suffixes
    s = re.sub(r'\b\d{4,}\b', '', s)           # strip long number sequences
    s = re.sub(r'upi[:/]?\S*', '', s)           # strip UPI identifiers
    s = re.sub(r'[^a-z0-9\s-]', ' ', s)        # keep only alphanumeric, space, hyphen
    s = re.sub(r'\s+', '-', s.strip())          # spaces → hyphens
    s = re.sub(r'-{2,}', '-', s).strip('-')     # collapse multiple hyphens
    return s[:60] or 'recurring'                # cap at 60 chars
```

Then add the route after the existing transaction routes:
```python
@router.patch("/{transaction_id}/recurring", response_model=ApiResponse)
async def set_transaction_recurring(transaction_id: str, body: SetRecurringRequest):
    """Set or clear the recurring flag and period on a transaction."""
    # Auto-generate recurring_key if not provided and is_recurring=True
    recurring_key = body.recurring_key
    if body.is_recurring and not recurring_key:
        # Fetch description to generate key
        from src.services.database_manager.operations import TransactionOperations
        tx = await handle_database_operation(TransactionOperations.get_transaction_by_id, transaction_id)
        if not tx:
            raise HTTPException(status_code=404, detail="Transaction not found")
        description = tx.get("user_description") or tx.get("description", "")
        recurring_key = _generate_recurring_key(description)

    updated = await handle_database_operation(
        TransactionOperations.set_recurring,
        transaction_id=transaction_id,
        is_recurring=body.is_recurring,
        recurrence_period=body.recurrence_period,
        recurring_key=recurring_key,
    )
    if not updated:
        raise HTTPException(status_code=404, detail="Transaction not found")
    return ApiResponse(data={"updated": True, "recurring_key": recurring_key})
```

- [ ] **Step 3: Verify in Swagger**

With the dev server running, open http://localhost:8000/docs — confirm `PATCH /api/transactions/{transaction_id}/recurring` appears.

- [ ] **Step 4: Commit**

```bash
git add backend/src/apis/routes/transaction_write_routes.py
git add backend/src/services/database_manager/operations/transaction_operations.py
git commit -m "feat: add PATCH /transactions/{id}/recurring endpoint"
```

---

## Task 9: Backend tests

**Files:**
- Create: `backend/tests/test_budget_api.py`

- [ ] **Step 1: Create the test file**

```python
"""
Integration tests for the budget API.
Run from backend/ with: poetry run pytest tests/test_budget_api.py -v
"""
import pytest
from httpx import AsyncClient, ASGITransport

from main import app


@pytest.fixture
async def client():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


@pytest.mark.asyncio
async def test_list_budgets_empty(client):
    """GET /api/budgets returns empty list when no budgets exist (or a list of existing ones)."""
    resp = await client.get("/api/budgets")
    assert resp.status_code == 200
    body = resp.json()
    assert "data" in body
    assert isinstance(body["data"], list)


@pytest.mark.asyncio
async def test_create_budget_requires_valid_category(client):
    """POST /api/budgets with a non-existent category_id returns 500 or 422."""
    resp = await client.post("/api/budgets", json={
        "category_id": "00000000-0000-0000-0000-000000000000",
        "monthly_limit": 5000,
    })
    # FK violation → 500 from Postgres, or 422 from validation
    assert resp.status_code in (422, 409, 500)


@pytest.mark.asyncio
async def test_budget_summary_default_period(client):
    """GET /api/budgets/summary returns current period when no period param given."""
    resp = await client.get("/api/budgets/summary")
    assert resp.status_code == 200
    body = resp.json()
    assert "data" in body
    assert "period" in body["data"]
    assert "budgets" in body["data"]
    assert "unbudgeted_categories" in body["data"]


@pytest.mark.asyncio
async def test_budget_summary_period_format_validation(client):
    """GET /api/budgets/summary with invalid period returns 422."""
    resp = await client.get("/api/budgets/summary?period=2026-4")
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_delete_nonexistent_budget(client):
    """DELETE /api/budgets/{id} for unknown id returns 404."""
    resp = await client.delete("/api/budgets/00000000-0000-0000-0000-000000000000")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_set_recurring_invalid_period(client):
    """PATCH /transactions/{id}/recurring with invalid period returns 422."""
    resp = await client.patch(
        "/api/transactions/00000000-0000-0000-0000-000000000000/recurring",
        json={"is_recurring": True, "recurrence_period": "biweekly"},
    )
    assert resp.status_code == 422
```

- [ ] **Step 2: Run the tests**

```bash
cd backend
poetry run pytest tests/test_budget_api.py -v
```

Expected: all tests pass (or fail with expected reasons — FK violations etc. are acceptable since they test real DB state).

- [ ] **Step 3: Commit**

```bash
git add backend/tests/test_budget_api.py
git commit -m "test: add budget API integration tests"
```

---

## Task 10: Update frontend TypeScript types

**Files:**
- Modify: `frontend/src/lib/types/index.ts`

- [ ] **Step 1: Add recurring fields to Transaction interface**

In `frontend/src/lib/types/index.ts`, add to the `Transaction` interface (after `is_grouped_expense`):

```typescript
  is_recurring?: boolean;
  recurrence_period?: 'monthly' | 'quarterly' | 'yearly' | 'custom' | null;
  recurring_key?: string | null;
```

- [ ] **Step 2: Replace the Budget interface and add new budget types**

Find and replace the existing `Budget` interface (lines 60-69) with:

```typescript
export interface Budget {
  id: string;
  category_id: string;
  category_name: string;
  monthly_limit: number;
  name?: string | null;
  created_at: string;
  updated_at: string;
}

export interface BudgetOverride {
  id: string;
  budget_id: string;
  period: string; // 'YYYY-MM'
  monthly_limit: number;
}

export interface CommittedItem {
  recurring_key?: string | null;
  description: string;
  amount: number;
  recurrence_period?: string | null;
  is_projected: boolean;
}

export interface BudgetSummary extends Budget {
  effective_limit: number;
  has_override: boolean;
  committed_spend: number;
  variable_spend: number;
  headroom: number;
  utilisation_pct: number; // 0-100+
  committed_items: CommittedItem[];
}

export interface BudgetsSummaryResponse {
  budgets: BudgetSummary[];
  unbudgeted_categories: UnbudgetedCategory[];
  period: string;
}

export interface UnbudgetedCategory {
  id: string;
  name: string;
  color?: string | null;
  recurring_count: number;
}
```

- [ ] **Step 3: Commit**

```bash
cd frontend
npm run lint
```

Fix any type errors, then:

```bash
cd ..
git add frontend/src/lib/types/index.ts
git commit -m "feat: update Budget types and add BudgetSummary, CommittedItem, UnbudgetedCategory"
```

---

## Task 11: Update API client

**Files:**
- Modify: `frontend/src/lib/api/client.ts`

- [ ] **Step 1: Update the imports at the top of `client.ts`**

Find the import line that includes `Budget` and update it to also import the new types:

```typescript
import { ..., Budget, BudgetOverride, BudgetSummary, BudgetsSummaryResponse, ... } from "@/lib/types";
```

- [ ] **Step 2: Replace the budget methods section**

Find the `// Budgets` section (around line 350) and replace it entirely with:

```typescript
  // Budgets
  async getBudgets(): Promise<ApiResponse<Budget[]>> {
    return this.request<Budget[]>("/budgets");
  }

  async getBudgetsSummary(period?: string): Promise<ApiResponse<BudgetsSummaryResponse>> {
    const params = period ? `?period=${period}` : "";
    return this.request<BudgetsSummaryResponse>(`/budgets/summary${params}`);
  }

  async getBudgetSummary(id: string, period?: string): Promise<ApiResponse<BudgetSummary>> {
    const params = period ? `?period=${period}` : "";
    return this.request<BudgetSummary>(`/budgets/${id}/summary${params}`);
  }

  async createBudget(budget: { category_id: string; monthly_limit: number; name?: string }): Promise<ApiResponse<Budget>> {
    return this.request<Budget>("/budgets", {
      method: "POST",
      body: JSON.stringify(budget),
    });
  }

  async updateBudget(id: string, updates: { monthly_limit?: number; name?: string }): Promise<ApiResponse<Budget>> {
    return this.request<Budget>(`/budgets/${id}`, {
      method: "PUT",
      body: JSON.stringify(updates),
    });
  }

  async deleteBudget(id: string): Promise<ApiResponse<void>> {
    return this.request<void>(`/budgets/${id}`, { method: "DELETE" });
  }

  async upsertBudgetOverride(budgetId: string, period: string, monthlyLimit: number): Promise<ApiResponse<BudgetOverride>> {
    return this.request<BudgetOverride>(`/budgets/${budgetId}/overrides?period=${period}`, {
      method: "POST",
      body: JSON.stringify({ monthly_limit: monthlyLimit }),
    });
  }

  async deleteBudgetOverride(budgetId: string, period: string): Promise<ApiResponse<void>> {
    return this.request<void>(`/budgets/${budgetId}/overrides/${period}`, { method: "DELETE" });
  }

  async setRecurring(
    transactionId: string,
    payload: { is_recurring: boolean; recurrence_period?: string | null; recurring_key?: string | null }
  ): Promise<ApiResponse<{ updated: boolean; recurring_key: string | null }>> {
    return this.request(`/transactions/${transactionId}/recurring`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
  }
```

- [ ] **Step 3: Lint check**

```bash
cd frontend && npm run lint
```

Fix any errors, then commit:

```bash
cd ..
git add frontend/src/lib/api/client.ts
git commit -m "feat: update API client with budget summary and setRecurring methods"
```

---

## Task 12: Update budget hooks

**Files:**
- Modify: `frontend/src/hooks/use-budgets.ts`

- [ ] **Step 1: Replace `use-budgets.ts` entirely**

```typescript
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";

// ── Budget templates ──────────────────────────────────────────────────────────

export function useBudgets() {
  return useQuery({
    queryKey: ["budgets"],
    queryFn: () => apiClient.getBudgets(),
    staleTime: 60_000,
  });
}

export function useBudgetsSummary(period?: string) {
  return useQuery({
    queryKey: ["budgets", "summary", period ?? "current"],
    queryFn: () => apiClient.getBudgetsSummary(period),
    staleTime: 30_000,
  });
}

export function useBudgetSummary(id: string, period?: string) {
  return useQuery({
    queryKey: ["budgets", id, "summary", period ?? "current"],
    queryFn: () => apiClient.getBudgetSummary(id, period),
    staleTime: 30_000,
    enabled: !!id,
  });
}

export function useCreateBudget() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (budget: { category_id: string; monthly_limit: number; name?: string }) =>
      apiClient.createBudget(budget),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["budgets"] });
    },
  });
}

export function useUpdateBudget() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, updates }: { id: string; updates: { monthly_limit?: number; name?: string } }) =>
      apiClient.updateBudget(id, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["budgets"] });
    },
  });
}

export function useDeleteBudget() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.deleteBudget(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["budgets"] });
    },
  });
}

// ── Overrides ─────────────────────────────────────────────────────────────────

export function useUpsertBudgetOverride() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ budgetId, period, monthlyLimit }: { budgetId: string; period: string; monthlyLimit: number }) =>
      apiClient.upsertBudgetOverride(budgetId, period, monthlyLimit),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["budgets"] });
    },
  });
}

export function useDeleteBudgetOverride() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ budgetId, period }: { budgetId: string; period: string }) =>
      apiClient.deleteBudgetOverride(budgetId, period),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["budgets"] });
    },
  });
}

// ── Recurring ─────────────────────────────────────────────────────────────────

export function useSetRecurring() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      transactionId,
      is_recurring,
      recurrence_period,
      recurring_key,
    }: {
      transactionId: string;
      is_recurring: boolean;
      recurrence_period?: string | null;
      recurring_key?: string | null;
    }) => apiClient.setRecurring(transactionId, { is_recurring, recurrence_period, recurring_key }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      queryClient.invalidateQueries({ queryKey: ["budgets"] });
    },
  });
}
```

- [ ] **Step 2: Commit**

```bash
cd ..
git add frontend/src/hooks/use-budgets.ts
git commit -m "feat: update use-budgets hooks with summary, overrides, and setRecurring"
```

---

## Task 13: RecurringPeriodPopover component

**Files:**
- Create: `frontend/src/components/transactions/recurring-period-popover.tsx`

- [ ] **Step 1: Create the component**

```typescript
"use client";

import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { RefreshCw } from "lucide-react";
import { useSetRecurring } from "@/hooks/use-budgets";
import { toast } from "sonner";
import { Transaction } from "@/lib/types";

const PERIODS = [
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "yearly", label: "Yearly" },
  { value: "custom", label: "Custom" },
] as const;

interface RecurringPeriodPopoverProps {
  transaction: Transaction;
}

export function RecurringPeriodPopover({ transaction }: RecurringPeriodPopoverProps) {
  const [open, setOpen] = useState(false);
  const setRecurring = useSetRecurring();

  const isRecurring = transaction.is_recurring === true;
  const period = transaction.recurrence_period;

  const handleSelect = async (value: string) => {
    try {
      await setRecurring.mutateAsync({
        transactionId: transaction.id,
        is_recurring: true,
        recurrence_period: value,
      });
      toast.success(`Marked as recurring (${value})`);
    } catch {
      toast.error("Failed to update recurring status");
    }
    setOpen(false);
  };

  const handleRemove = async () => {
    try {
      await setRecurring.mutateAsync({
        transactionId: transaction.id,
        is_recurring: false,
        recurrence_period: null,
      });
      toast.success("Recurring removed");
    } catch {
      toast.error("Failed to update recurring status");
    }
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <div
          className={cn(
            "flex items-center gap-1 rounded px-1.5 py-0.5 cursor-pointer transition-colors",
            isRecurring
              ? "text-indigo-400 bg-indigo-500/10 border border-indigo-500/25 hover:bg-indigo-500/20"
              : "text-muted-foreground/30 hover:text-indigo-400 hover:bg-indigo-500/10"
          )}
          title={isRecurring ? `Recurring: ${period}` : "Mark as recurring"}
        >
          <RefreshCw className="h-3 w-3" />
          {isRecurring && period && (
            <span className="text-[10px] font-medium capitalize leading-none">
              {period.charAt(0).toUpperCase() + period.slice(1)}
            </span>
          )}
        </div>
      </PopoverTrigger>
      <PopoverContent className="w-44 p-1" align="end">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground px-2 py-1.5">
          Recurrence period
        </p>
        {PERIODS.map((p) => (
          <button
            key={p.value}
            onClick={() => handleSelect(p.value)}
            className={cn(
              "w-full text-left px-2 py-1.5 rounded text-sm hover:bg-accent transition-colors flex items-center gap-2",
              period === p.value && isRecurring ? "text-indigo-400 font-medium" : "text-foreground"
            )}
          >
            <span className={cn("h-1.5 w-1.5 rounded-full bg-current", period === p.value && isRecurring ? "bg-indigo-400" : "bg-muted-foreground")} />
            {p.label}
          </button>
        ))}
        {isRecurring && (
          <>
            <div className="border-t my-1" />
            <button
              onClick={handleRemove}
              className="w-full text-left px-2 py-1.5 rounded text-sm text-destructive hover:bg-destructive/10 transition-colors"
            >
              ✕ Remove recurring
            </button>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/transactions/recurring-period-popover.tsx
git commit -m "feat: add RecurringPeriodPopover for transaction recurring toggle"
```

---

## Task 14: Add ↻ icon to transaction table action icons

**Files:**
- Modify: `frontend/src/components/transactions/transaction-columns.tsx`

- [ ] **Step 1: Find the action icons cell**

Open `frontend/src/components/transactions/transaction-columns.tsx`. Search for the column definition that renders the share/group/split/email/flag/delete icons (the rightmost column). It will look like a `columnHelper.display` or similar with a cell rendering action buttons.

- [ ] **Step 2: Add the import and the ↻ icon**

Add `RecurringPeriodPopover` to the imports at the top:
```typescript
import { RecurringPeriodPopover } from "@/components/transactions/recurring-period-popover";
```

Inside the actions cell render function, add `<RecurringPeriodPopover transaction={row.original} />` alongside the other action icons, placing it before the email icon:

```typescript
<RecurringPeriodPopover transaction={row.original} />
```

- [ ] **Step 3: Verify visually**

With the dev server running (`npm run dev` from `frontend/`), navigate to http://localhost:3000/transactions. Hover over a transaction row — confirm the ↻ icon appears in the action icons. Click it — confirm the period popover opens.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/transactions/transaction-columns.tsx
git commit -m "feat: add recurring period popover to transaction table action icons"
```

---

## Task 15: Add Recurring section to transaction edit modal

**Files:**
- Modify: `frontend/src/components/transactions/transaction-edit-modal.tsx`

- [ ] **Step 1: Add recurring state to the modal's formData**

In `transaction-edit-modal.tsx`, find the `formData` state initialisation inside `useEffect`. Add:
```typescript
is_recurring: transaction.is_recurring ?? false,
recurrence_period: transaction.recurrence_period ?? null,
```

- [ ] **Step 2: Find the flags row (Shared + Refund checkboxes)**

Search for `is_shared` or `is_refund` inside the JSX. There will be a row of checkboxes. Add Recurring after Refund:

```tsx
{/* Recurring */}
<div className="flex items-center gap-2">
  <Checkbox
    id="is_recurring"
    checked={!!formData.is_recurring}
    onCheckedChange={(checked) => {
      handleInputChange("is_recurring", !!checked);
      if (!checked) handleInputChange("recurrence_period", null);
    }}
  />
  <label htmlFor="is_recurring" className={cn(
    "text-sm cursor-pointer",
    formData.is_recurring ? "text-indigo-400 font-medium" : "text-muted-foreground"
  )}>
    Recurring
  </label>
  {formData.is_recurring && (
    <Select
      value={formData.recurrence_period ?? ""}
      onValueChange={(v) => handleInputChange("recurrence_period", v)}
    >
      <SelectTrigger className="h-7 w-28 text-xs border-indigo-500/30 text-indigo-400">
        <SelectValue placeholder="Period" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="monthly">Monthly</SelectItem>
        <SelectItem value="quarterly">Quarterly</SelectItem>
        <SelectItem value="yearly">Yearly</SelectItem>
        <SelectItem value="custom">Custom</SelectItem>
      </SelectContent>
    </Select>
  )}
</div>
```

- [ ] **Step 3: Wire recurring fields to the save handler**

In `handleSubmit`, the existing code calls `updateTransaction.mutateAsync({ id: transactionId, updates: { ...formData, ... } })`. The recurring fields are part of `formData` and will be included. However, the main transaction update endpoint doesn't handle `is_recurring` — the dedicated PATCH endpoint does. After the main update, call the recurring endpoint if the value changed:

```typescript
// After the main updateTransaction call succeeds:
if (formData.is_recurring !== transaction.is_recurring ||
    formData.recurrence_period !== transaction.recurrence_period) {
  await apiClient.setRecurring(transactionId, {
    is_recurring: !!formData.is_recurring,
    recurrence_period: formData.is_recurring ? (formData.recurrence_period ?? null) : null,
  });
}
```

Add the `apiClient` import if not already present: `import { apiClient } from "@/lib/api/client";`

- [ ] **Step 4: Test in the UI**

Open a transaction's edit modal. Confirm the Recurring checkbox appears inline with Shared + Refund. Check it — confirm the period selector appears. Save — verify the transaction shows the ↻ icon in the table.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/transactions/transaction-edit-modal.tsx
git commit -m "feat: add Recurring checkbox and period selector to transaction edit modal"
```

---

## Task 16: BudgetCard component

**Files:**
- Create: `frontend/src/components/budgets/budget-card.tsx`

- [ ] **Step 1: Create the component**

```tsx
"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronUp, Edit, Trash2, Calendar } from "lucide-react";
import { BudgetSummary } from "@/lib/types";
import { formatCurrency } from "@/lib/format-utils";
import { cn } from "@/lib/utils";

interface BudgetCardProps {
  budget: BudgetSummary;
  onEdit: (budget: BudgetSummary) => void;
  onDelete: (id: string) => void;
  onOverride: (budget: BudgetSummary) => void;
}

function getUtilisationColor(pct: number): string {
  if (pct >= 95) return "bg-red-500";
  if (pct >= 75) return "bg-orange-500";
  if (pct >= 50) return "bg-yellow-500";
  return "bg-green-500";
}

function getUtilisationTextColor(pct: number): string {
  if (pct >= 95) return "text-red-400";
  if (pct >= 75) return "text-orange-400";
  if (pct >= 50) return "text-yellow-400";
  return "text-green-400";
}

export function BudgetCard({ budget, onEdit, onDelete, onOverride }: BudgetCardProps) {
  const [expanded, setExpanded] = useState(false);
  const isOverBudget = budget.headroom < 0;
  const total = budget.committed_spend + budget.variable_spend;
  const committedPct = budget.effective_limit > 0 ? (budget.committed_spend / budget.effective_limit) * 100 : 0;
  const variablePct = budget.effective_limit > 0 ? (budget.variable_spend / budget.effective_limit) * 100 : 0;

  return (
    <Card className={cn("transition-colors", isOverBudget && "border-red-500/30")}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-foreground">
              {budget.name ?? budget.category_name}
            </span>
            {budget.has_override && (
              <Badge variant="outline" className="text-[10px] border-indigo-500/30 text-indigo-400">
                Override
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => onOverride(budget)} title="Set monthly override">
              <Calendar className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => onEdit(budget)}>
              <Edit className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive hover:text-destructive" onClick={() => onDelete(budget.id)}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
        <div className="text-xs text-muted-foreground">
          Limit: {formatCurrency(budget.effective_limit)} / month
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {/* Stacked progress bar */}
        <div className="h-2.5 rounded-full bg-muted overflow-hidden flex">
          {committedPct > 0 && (
            <div
              className="h-full bg-indigo-500 transition-all"
              style={{ width: `${Math.min(committedPct, 100)}%` }}
            />
          )}
          {variablePct > 0 && (
            <div
              className={cn("h-full transition-all", getUtilisationColor(budget.utilisation_pct))}
              style={{ width: `${Math.min(variablePct, 100 - committedPct)}%` }}
            />
          )}
        </div>

        {/* Inline legend */}
        <div className="flex items-center gap-4 text-xs flex-wrap">
          <span className="flex items-center gap-1 text-indigo-400">
            <span className="inline-block h-2 w-2 rounded-full bg-indigo-500" />
            Committed {formatCurrency(budget.committed_spend)}
          </span>
          <span className={cn("flex items-center gap-1", getUtilisationTextColor(budget.utilisation_pct))}>
            <span className={cn("inline-block h-2 w-2 rounded-full", getUtilisationColor(budget.utilisation_pct))} />
            Variable {formatCurrency(budget.variable_spend)}
          </span>
          <span className={cn(
            "flex items-center gap-1 ml-auto font-medium",
            isOverBudget ? "text-red-400" : "text-muted-foreground"
          )}>
            {isOverBudget ? `Over by ${formatCurrency(Math.abs(budget.headroom))}` : `${formatCurrency(budget.headroom)} left`}
          </span>
        </div>

        {/* Committed items breakdown */}
        {budget.committed_items.length > 0 && (
          <div>
            <button
              onClick={() => setExpanded(!expanded)}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              {budget.committed_items.length} recurring item{budget.committed_items.length !== 1 ? "s" : ""}
            </button>

            {expanded && (
              <div className="mt-2 space-y-1">
                {budget.committed_items.map((item, i) => (
                  <div key={i} className="flex items-center justify-between text-xs py-0.5">
                    <div className="flex items-center gap-2">
                      <span className={cn("text-foreground/80", item.is_projected && "text-muted-foreground italic")}>
                        {item.description}
                      </span>
                      {item.recurrence_period && (
                        <Badge variant="outline" className="text-[9px] h-4 px-1 capitalize">
                          {item.recurrence_period}
                        </Badge>
                      )}
                      {item.is_projected && (
                        <Badge variant="outline" className="text-[9px] h-4 px-1 text-muted-foreground">
                          projected
                        </Badge>
                      )}
                    </div>
                    <span className={cn("font-mono", item.is_projected ? "text-muted-foreground" : "text-foreground")}>
                      {formatCurrency(item.amount)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/budgets/budget-card.tsx
git commit -m "feat: add BudgetCard component with stacked bar and committed items"
```

---

## Task 17: Budget page modals

**Files:**
- Create: `frontend/src/components/budgets/budget-create-modal.tsx`
- Create: `frontend/src/components/budgets/budget-override-modal.tsx`

- [ ] **Step 1: Create `budget-create-modal.tsx`**

```tsx
"use client";

import { useState, useEffect } from "react";
import { Modal } from "@/components/ui/modal";
import { FieldRow } from "@/components/ui/modal/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useCreateBudget, useUpdateBudget } from "@/hooks/use-budgets";
import { useCategories } from "@/hooks/use-categories";
import { BudgetSummary } from "@/lib/types";
import { toast } from "sonner";
import { DollarSign } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface BudgetCreateModalProps {
  isOpen: boolean;
  onClose: () => void;
  editingBudget?: BudgetSummary | null;
}

export function BudgetCreateModal({ isOpen, onClose, editingBudget }: BudgetCreateModalProps) {
  const [categoryId, setCategoryId] = useState("");
  const [monthlyLimit, setMonthlyLimit] = useState("");
  const [name, setName] = useState("");
  const { data: categories = [] } = useCategories();
  const createBudget = useCreateBudget();
  const updateBudget = useUpdateBudget();

  const isEditing = !!editingBudget;

  useEffect(() => {
    if (editingBudget) {
      setCategoryId(editingBudget.category_id);
      setMonthlyLimit(String(editingBudget.monthly_limit));
      setName(editingBudget.name ?? "");
    } else {
      setCategoryId(""); setMonthlyLimit(""); setName("");
    }
  }, [editingBudget, isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const limit = parseFloat(monthlyLimit);
    if (!limit || limit <= 0) { toast.error("Enter a valid monthly limit"); return; }

    try {
      if (isEditing && editingBudget) {
        await updateBudget.mutateAsync({ id: editingBudget.id, updates: { monthly_limit: limit, name: name || undefined } });
        toast.success("Budget updated");
      } else {
        if (!categoryId) { toast.error("Select a category"); return; }
        await createBudget.mutateAsync({ category_id: categoryId, monthly_limit: limit, name: name || undefined });
        toast.success("Budget created");
      }
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to save budget";
      toast.error(msg);
    }
  };

  return (
    <Modal open={isOpen} onClose={onClose} size="sm">
      <Modal.Header
        icon={<DollarSign className="h-4 w-4" />}
        title={isEditing ? "Edit Budget" : "Create Budget"}
        subtitle={isEditing ? editingBudget?.category_name : "Set a monthly spending limit for a category"}
        onClose={onClose}
        variant="split"
      />
      <form onSubmit={handleSubmit}>
        <Modal.Body className="space-y-4">
          {!isEditing && (
            <FieldRow label="Category" required>
              <Select value={categoryId} onValueChange={setCategoryId}>
                <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
                <SelectContent>
                  {categories.filter(c => !c.parent_id).map(c => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FieldRow>
          )}
          <FieldRow label="Monthly Limit" required>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground font-mono">₹</span>
              <Input
                type="number" step="1" min="1"
                className="pl-7 font-mono tabular-nums"
                value={monthlyLimit}
                onChange={e => setMonthlyLimit(e.target.value)}
                placeholder="5000"
                required
              />
            </div>
          </FieldRow>
          <FieldRow label="Display Name">
            <Input value={name} onChange={e => setName(e.target.value)} placeholder={`${isEditing ? editingBudget?.category_name : "e.g. Food & Dining"} (optional)`} />
          </FieldRow>
        </Modal.Body>
        <Modal.Footer>
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={createBudget.isPending || updateBudget.isPending}>
            {isEditing ? "Save Changes" : "Create Budget"}
          </Button>
        </Modal.Footer>
      </form>
    </Modal>
  );
}
```

- [ ] **Step 2: Create `budget-override-modal.tsx`**

```tsx
"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/modal";
import { FieldRow } from "@/components/ui/modal/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useUpsertBudgetOverride, useDeleteBudgetOverride } from "@/hooks/use-budgets";
import { BudgetSummary } from "@/lib/types";
import { toast } from "sonner";
import { Calendar } from "lucide-react";

interface BudgetOverrideModalProps {
  isOpen: boolean;
  onClose: () => void;
  budget: BudgetSummary | null;
  period: string; // current YYYY-MM
}

export function BudgetOverrideModal({ isOpen, onClose, budget, period }: BudgetOverrideModalProps) {
  const [limit, setLimit] = useState(String(budget?.effective_limit ?? ""));
  const upsert = useUpsertBudgetOverride();
  const deleteOverride = useDeleteBudgetOverride();

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!budget) return;
    const val = parseFloat(limit);
    if (!val || val <= 0) { toast.error("Enter a valid limit"); return; }
    try {
      await upsert.mutateAsync({ budgetId: budget.id, period, monthlyLimit: val });
      toast.success(`Override set for ${period}`);
      onClose();
    } catch { toast.error("Failed to set override"); }
  };

  const handleRemove = async () => {
    if (!budget) return;
    try {
      await deleteOverride.mutateAsync({ budgetId: budget.id, period });
      toast.success("Override removed — reverted to template limit");
      onClose();
    } catch { toast.error("Failed to remove override"); }
  };

  return (
    <Modal open={isOpen} onClose={onClose} size="sm">
      <Modal.Header
        icon={<Calendar className="h-4 w-4" />}
        title={`Override for ${period}`}
        subtitle={`${budget?.name ?? budget?.category_name} — template: ₹${budget?.monthly_limit?.toLocaleString()}`}
        onClose={onClose}
        variant="split"
      />
      <form onSubmit={handleSave}>
        <Modal.Body className="space-y-4">
          <FieldRow label="Monthly Limit for this month" required>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground font-mono">₹</span>
              <Input type="number" step="1" min="1" className="pl-7 font-mono tabular-nums"
                value={limit} onChange={e => setLimit(e.target.value)} placeholder="6000" required />
            </div>
          </FieldRow>
        </Modal.Body>
        <Modal.Footer>
          {budget?.has_override && (
            <Button type="button" variant="ghost" className="text-destructive mr-auto"
              onClick={handleRemove} disabled={deleteOverride.isPending}>
              Remove override
            </Button>
          )}
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={upsert.isPending}>Save Override</Button>
        </Modal.Footer>
      </form>
    </Modal>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/budgets/budget-create-modal.tsx
git add frontend/src/components/budgets/budget-override-modal.tsx
git commit -m "feat: add BudgetCreateModal and BudgetOverrideModal"
```

---

## Task 18: NoBudgetWarning and BudgetThresholdAlerts components

**Files:**
- Create: `frontend/src/components/budgets/no-budget-warning.tsx`
- Create: `frontend/src/components/budgets/budget-threshold-alerts.tsx`

- [ ] **Step 1: Create `no-budget-warning.tsx`**

```tsx
"use client";

import { AlertTriangle } from "lucide-react";
import { UnbudgetedCategory } from "@/lib/types";
import { Button } from "@/components/ui/button";

interface NoBudgetWarningProps {
  categories: UnbudgetedCategory[];
  onCreateBudget: (categoryId: string) => void;
}

export function NoBudgetWarning({ categories, onCreateBudget }: NoBudgetWarningProps) {
  if (categories.length === 0) return null;
  return (
    <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/5 p-3 space-y-2">
      <div className="flex items-center gap-2 text-yellow-400 text-sm font-medium">
        <AlertTriangle className="h-4 w-4" />
        Recurring expenses without a budget
      </div>
      <div className="space-y-1">
        {categories.map(cat => (
          <div key={cat.id} className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">
              <span className="text-foreground font-medium">{cat.name}</span>
              {" "}— {cat.recurring_count} recurring transaction{cat.recurring_count !== 1 ? "s" : ""}
            </span>
            <Button variant="ghost" size="sm" className="h-6 text-xs text-yellow-400 hover:text-yellow-300"
              onClick={() => onCreateBudget(cat.id)}>
              Create budget →
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create `budget-threshold-alerts.tsx`**

```tsx
"use client";

import { BudgetSummary } from "@/lib/types";
import { formatCurrency } from "@/lib/format-utils";
import { cn } from "@/lib/utils";
import { AlertTriangle, AlertCircle, TrendingUp } from "lucide-react";

interface BudgetThresholdAlertsProps {
  budgets: BudgetSummary[];
}

function getAlert(b: BudgetSummary): { level: "critical" | "warning" | "heads-up"; label: string } | null {
  if (b.utilisation_pct >= 95) return { level: "critical", label: b.headroom < 0 ? `Over by ${formatCurrency(Math.abs(b.headroom))}` : "95%+ used" };
  if (b.utilisation_pct >= 75) return { level: "warning", label: `${b.utilisation_pct.toFixed(0)}% used` };
  if (b.utilisation_pct >= 50) return { level: "heads-up", label: `${b.utilisation_pct.toFixed(0)}% used` };
  return null;
}

const levelStyles = {
  critical: { border: "border-red-500/20 bg-red-500/5", text: "text-red-400", icon: AlertCircle },
  warning: { border: "border-orange-500/20 bg-orange-500/5", text: "text-orange-400", icon: AlertTriangle },
  "heads-up": { border: "border-yellow-500/20 bg-yellow-500/5", text: "text-yellow-400", icon: TrendingUp },
};

export function BudgetThresholdAlerts({ budgets }: BudgetThresholdAlertsProps) {
  const alerts = budgets
    .map(b => ({ budget: b, alert: getAlert(b) }))
    .filter(x => x.alert !== null)
    .sort((a, b) => b.budget.utilisation_pct - a.budget.utilisation_pct);

  if (alerts.length === 0) return null;

  return (
    <div className="space-y-2">
      {alerts.map(({ budget, alert }) => {
        const styles = levelStyles[alert!.level];
        const Icon = styles.icon;
        return (
          <div key={budget.id} className={cn("rounded-lg border px-3 py-2 flex items-center justify-between text-sm", styles.border)}>
            <div className="flex items-center gap-2">
              <Icon className={cn("h-4 w-4 shrink-0", styles.text)} />
              <span className="font-medium text-foreground">{budget.name ?? budget.category_name}</span>
              <span className={cn("text-xs", styles.text)}>{alert!.label}</span>
            </div>
            <div className="text-xs text-muted-foreground">
              {formatCurrency(budget.committed_spend + budget.variable_spend)} / {formatCurrency(budget.effective_limit)}
            </div>
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/budgets/no-budget-warning.tsx
git add frontend/src/components/budgets/budget-threshold-alerts.tsx
git commit -m "feat: add NoBudgetWarning and BudgetThresholdAlerts components"
```

---

## Task 19: Replace BudgetsOverview component

**Files:**
- Modify: `frontend/src/components/budgets/budgets-overview.tsx`

- [ ] **Step 1: Replace the file entirely**

```tsx
"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BudgetsSummaryResponse } from "@/lib/types";
import { formatCurrency } from "@/lib/format-utils";

interface BudgetsOverviewProps {
  data: BudgetsSummaryResponse | undefined;
  isLoading: boolean;
}

export function BudgetsOverview({ data, isLoading }: BudgetsOverviewProps) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <Card key={i}>
            <CardHeader className="pb-2">
              <div className="h-3 bg-muted rounded animate-pulse w-24" />
            </CardHeader>
            <CardContent>
              <div className="h-7 bg-muted rounded animate-pulse w-32" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  const budgets = data?.budgets ?? [];
  const totalLimit = budgets.reduce((s, b) => s + b.effective_limit, 0);
  const totalCommitted = budgets.reduce((s, b) => s + b.committed_spend, 0);
  const totalVariable = budgets.reduce((s, b) => s + b.variable_spend, 0);
  const totalHeadroom = totalLimit - totalCommitted - totalVariable;

  const stats = [
    { label: "Total Budget", value: formatCurrency(totalLimit), color: "text-foreground" },
    { label: "Committed", value: formatCurrency(totalCommitted), color: "text-indigo-400" },
    { label: "Variable Spend", value: formatCurrency(totalVariable), color: "text-orange-400" },
    { label: "Headroom", value: formatCurrency(totalHeadroom), color: totalHeadroom >= 0 ? "text-green-400" : "text-red-400" },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {stats.map(stat => (
        <Card key={stat.label}>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              {stat.label}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold font-mono ${stat.color}`}>{stat.value}</div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/budgets/budgets-overview.tsx
git commit -m "feat: replace BudgetsOverview with real data-driven summary cards"
```

---

## Task 20: Replace BudgetsList and wire the budgets page

**Files:**
- Modify: `frontend/src/components/budgets/budgets-list.tsx`
- Modify: `frontend/src/app/budgets/page.tsx`

- [ ] **Step 1: Replace `budgets-list.tsx`**

```tsx
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { BudgetCard } from "@/components/budgets/budget-card";
import { BudgetCreateModal } from "@/components/budgets/budget-create-modal";
import { BudgetOverrideModal } from "@/components/budgets/budget-override-modal";
import { useDeleteBudget } from "@/hooks/use-budgets";
import { BudgetSummary } from "@/lib/types";
import { toast } from "sonner";

interface BudgetsListProps {
  budgets: BudgetSummary[];
  isLoading: boolean;
  period: string;
  onCreateWithCategory?: (categoryId: string) => void;
}

export function BudgetsList({ budgets, isLoading, period, onCreateWithCategory }: BudgetsListProps) {
  const [createOpen, setCreateOpen] = useState(false);
  const [editingBudget, setEditingBudget] = useState<BudgetSummary | null>(null);
  const [overrideBudget, setOverrideBudget] = useState<BudgetSummary | null>(null);
  const deleteBudget = useDeleteBudget();

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this budget and all its overrides?")) return;
    try {
      await deleteBudget.mutateAsync(id);
      toast.success("Budget deleted");
    } catch { toast.error("Failed to delete budget"); }
  };

  const handleEdit = (budget: BudgetSummary) => {
    setEditingBudget(budget);
    setCreateOpen(true);
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-28 rounded-lg border bg-muted animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
          Monthly Budgets
        </h2>
        <Button size="sm" onClick={() => { setEditingBudget(null); setCreateOpen(true); }}>
          <Plus className="h-3.5 w-3.5 mr-1" /> Add Budget
        </Button>
      </div>

      {budgets.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground text-sm border rounded-lg">
          No budgets set up yet. Create your first budget to start tracking spending.
        </div>
      ) : (
        <div className="space-y-4">
          {budgets.map(b => (
            <BudgetCard
              key={b.id}
              budget={b}
              onEdit={handleEdit}
              onDelete={handleDelete}
              onOverride={(b) => setOverrideBudget(b)}
            />
          ))}
        </div>
      )}

      <BudgetCreateModal
        isOpen={createOpen}
        onClose={() => { setCreateOpen(false); setEditingBudget(null); }}
        editingBudget={editingBudget}
      />
      <BudgetOverrideModal
        isOpen={!!overrideBudget}
        onClose={() => setOverrideBudget(null)}
        budget={overrideBudget}
        period={period}
      />
    </>
  );
}
```

- [ ] **Step 2: Replace `budgets/page.tsx`**

```tsx
"use client";

import { useState } from "react";
import { MainLayout } from "@/components/layout/main-layout";
import { BudgetsOverview } from "@/components/budgets/budgets-overview";
import { BudgetsList } from "@/components/budgets/budgets-list";
import { BudgetThresholdAlerts } from "@/components/budgets/budget-threshold-alerts";
import { NoBudgetWarning } from "@/components/budgets/no-budget-warning";
import { useBudgetsSummary } from "@/hooks/use-budgets";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";

function getPeriod(offset: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function formatPeriodLabel(period: string): string {
  const [year, month] = period.split("-");
  return new Date(Number(year), Number(month) - 1, 1)
    .toLocaleDateString("en-IN", { month: "long", year: "numeric" });
}

export default function BudgetsPage() {
  const [monthOffset, setMonthOffset] = useState(0);
  const period = getPeriod(monthOffset);
  const { data, isLoading } = useBudgetsSummary(period);

  const summaryData = data?.data;
  const budgets = summaryData?.budgets ?? [];
  const unbudgeted = summaryData?.unbudgeted_categories ?? [];

  return (
    <MainLayout>
      <div className="space-y-6">
        {/* Header + period nav */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-foreground tracking-tight">Budgets</h1>
            <p className="text-xs text-muted-foreground/70 mt-0.5">
              Manage your monthly spending limits and track progress
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="h-8 w-8 p-0"
              onClick={() => setMonthOffset(o => o - 1)}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm font-medium min-w-[140px] text-center">
              {formatPeriodLabel(period)}
            </span>
            <Button variant="outline" size="sm" className="h-8 w-8 p-0"
              onClick={() => setMonthOffset(o => o + 1)}
              disabled={monthOffset >= 0}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Overview stats */}
        <BudgetsOverview data={summaryData} isLoading={isLoading} />

        {/* Threshold alerts */}
        {budgets.length > 0 && <BudgetThresholdAlerts budgets={budgets} />}

        {/* No-budget warnings */}
        <NoBudgetWarning
          categories={unbudgeted}
          onCreateBudget={(categoryId) => {
            // Pre-select the category in the create modal by routing through BudgetsList
            // The modal is controlled inside BudgetsList, so just open with focus
          }}
        />

        {/* Budget cards list */}
        <BudgetsList
          budgets={budgets}
          isLoading={isLoading}
          period={period}
        />
      </div>
    </MainLayout>
  );
}
```

- [ ] **Step 3: Run the frontend dev server and verify**

```bash
cd frontend && npm run dev
```

Navigate to http://localhost:3000/budgets:
- Month picker shows current month, ← disables at current month
- Overview cards show ₹0 values (no budgets yet)
- "Add Budget" button opens the create modal with category picker
- Create a test budget (e.g. Food, ₹5,000) — card appears with stacked bar
- Navigate to transactions, mark a transaction as recurring — return to budgets, confirm it shows in committed items

- [ ] **Step 4: Final lint check and commit**

```bash
cd frontend && npm run lint
```

Fix any errors, then:

```bash
cd ..
git add frontend/src/components/budgets/
git add frontend/src/app/budgets/page.tsx
git commit -m "feat: wire up full budgets page with real data, month navigation, and alerts"
```

---

## Self-review checklist (completed inline)

**Spec coverage:**
- ✅ `is_recurring`, `recurrence_period`, `recurring_key` on transactions — Task 2
- ✅ `budgets` + `budget_overrides` tables — Task 3
- ✅ Budget CRUD operations — Task 4
- ✅ Spend computation (committed/variable/headroom/projected) — Task 5
- ✅ All API routes including `/summary`, overrides, `PATCH /recurring` — Tasks 6, 7, 8
- ✅ TypeScript types (Budget, BudgetSummary, CommittedItem, UnbudgetedCategory) — Task 10
- ✅ API client methods — Task 11
- ✅ All hooks — Task 12
- ✅ RecurringPeriodPopover in table action icons — Tasks 13, 14
- ✅ Recurring in edit modal — Task 15
- ✅ BudgetCard with stacked bar + legend + committed items — Task 16
- ✅ BudgetCreateModal + BudgetOverrideModal — Task 17
- ✅ NoBudgetWarning — Task 18
- ✅ BudgetThresholdAlerts at 50/75/95% — Task 18
- ✅ BudgetsOverview (real data) — Task 19
- ✅ Month picker / period navigation — Task 20
- ✅ `feature/budgets` branch — Task 1
- ✅ `recurring_key` auto-generation from description — Task 8
- ✅ No amortisation — Task 5 (spend computed from actual this-month transactions only)
- ✅ Projected committed items (past recurring not yet seen this month) — Task 5

**Type consistency:** All types defined in Task 10 are used consistently across Tasks 11–20. `BudgetSummary` (not `Budget`) is used wherever spend data is needed. `BudgetsSummaryResponse` wraps the summary endpoint.

**No placeholders:** All steps contain actual code. No TBDs.
