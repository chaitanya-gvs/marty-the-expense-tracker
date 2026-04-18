from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import List, Optional
from uuid import UUID

from sqlalchemy import DateTime, ForeignKey, Index, Numeric, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.services.database_manager.connection import Base


class Budget(Base):
    """Budget template — one per category, defines the monthly spending limit."""

    __tablename__ = "budgets"

    id: Mapped[UUID] = mapped_column(primary_key=True, server_default=func.gen_random_uuid())
    category_id: Mapped[UUID] = mapped_column(ForeignKey("categories.id", ondelete="CASCADE"), nullable=False)
    monthly_limit: Mapped[Decimal] = mapped_column(Numeric, nullable=False)
    name: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
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
