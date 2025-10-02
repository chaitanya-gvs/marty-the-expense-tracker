from __future__ import annotations

from datetime import datetime
from typing import Optional
from uuid import UUID

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.services.database_manager.connection import Base


class Category(Base):
    """Transaction category model"""
    
    __tablename__ = "categories"
    
    id: Mapped[UUID] = mapped_column(primary_key=True, server_default=func.gen_random_uuid())
    name: Mapped[str] = mapped_column(Text, nullable=False)
    slug: Mapped[str] = mapped_column(Text, nullable=False)
    parent_id: Mapped[Optional[UUID]] = mapped_column(ForeignKey("categories.id", ondelete="SET NULL"), nullable=True)
    color: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    
    # Relationships
    parent: Mapped[Optional["Category"]] = relationship("Category", remote_side=[id])
    children: Mapped[list["Category"]] = relationship("Category", back_populates="parent")

    # Indexes and constraints
    __table_args__ = (
        Index('ix_categories_active', 'is_active'),
        Index('ix_categories_parent', 'parent_id'),
        Index('ix_categories_slug', 'slug'),
        UniqueConstraint('parent_id', 'name', name='uq_categories_parent_name'),
        UniqueConstraint('slug', name='uq_categories_slug'),
    )
