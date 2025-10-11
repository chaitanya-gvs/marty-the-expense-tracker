from __future__ import annotations

from datetime import date, datetime, time
from decimal import Decimal
from typing import Any, Dict, List, Optional
from uuid import UUID

from sqlalchemy import ARRAY, Boolean, Date, DateTime, ForeignKey, Index, Numeric, String, Text, Time, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.services.database_manager.connection import Base


class Transaction(Base):
    """Transaction model"""
    
    __tablename__ = "transactions"
    
    id: Mapped[UUID] = mapped_column(primary_key=True, server_default=func.gen_random_uuid())
    link_parent_id: Mapped[Optional[UUID]] = mapped_column(ForeignKey("transactions.id"), nullable=True)
    transfer_group_id: Mapped[Optional[UUID]] = mapped_column(nullable=True)
    transaction_date: Mapped[date] = mapped_column(Date, nullable=False)
    transaction_time: Mapped[Optional[time]] = mapped_column(Time, nullable=True)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    amount: Mapped[Decimal] = mapped_column(Numeric, nullable=False)
    split_share_amount: Mapped[Optional[Decimal]] = mapped_column(Numeric, nullable=True)
    direction: Mapped[str] = mapped_column(Text, nullable=False)  # credit, debit
    transaction_type: Mapped[str] = mapped_column(Text, nullable=False)
    is_partial_refund: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True, default=False)
    is_shared: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True, default=False)
    split_breakdown: Mapped[Optional[Dict[str, Any]]] = mapped_column(JSONB, nullable=True)
    paid_by: Mapped[Optional[str]] = mapped_column(Text, nullable=True)  # Who actually paid for this transaction
    account: Mapped[str] = mapped_column(Text, nullable=False)
    category_id: Mapped[Optional[UUID]] = mapped_column(ForeignKey("categories.id"), nullable=True)
    sub_category: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    reference_number: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    related_mails: Mapped[Optional[List[str]]] = mapped_column(ARRAY(Text), nullable=True)
    source_file: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    raw_data: Mapped[Optional[Dict[str, Any]]] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True, server_default=func.current_timestamp())
    updated_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True, server_default=func.current_timestamp())
    tags: Mapped[Optional[List[str]]] = mapped_column(ARRAY(Text), nullable=True, server_default="{}")
    
    # Relationships
    category_rel: Mapped[Optional["Category"]] = relationship("Category")
    tags_rel: Mapped[List["Tag"]] = relationship("Tag", secondary="transaction_tags", back_populates="transactions")

    # Indexes
    __table_args__ = (
        Index('idx_transactions_account', 'account'),
        Index('idx_transactions_category_id', 'category_id'),
        Index('idx_transactions_date', 'transaction_date'),
        Index('idx_transactions_direction', 'direction'),
        Index('idx_transactions_type', 'transaction_type'),
    )
