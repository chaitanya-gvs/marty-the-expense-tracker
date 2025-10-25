from __future__ import annotations

from datetime import datetime
from typing import List
from uuid import UUID

from sqlalchemy import Boolean, DateTime, Index, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.services.database_manager.connection import Base


class Tag(Base):
    """Transaction tag model"""
    
    __tablename__ = "tags"
    
    id: Mapped[UUID] = mapped_column(primary_key=True, server_default=func.gen_random_uuid())
    name: Mapped[str] = mapped_column(Text, nullable=False)
    slug: Mapped[str] = mapped_column(Text, nullable=False)
    color: Mapped[str] = mapped_column(Text, nullable=True)
    description: Mapped[str] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    
    # Relationships
    transactions: Mapped[List["Transaction"]] = relationship("Transaction", secondary="transaction_tags", back_populates="tags_rel")

    # Indexes and constraints
    __table_args__ = (
        Index('ix_tags_active', 'is_active'),
        Index('ix_tags_slug', 'slug'),
        UniqueConstraint('name', name='uq_tags_name'),
        UniqueConstraint('slug', name='uq_tags_slug'),
    )
