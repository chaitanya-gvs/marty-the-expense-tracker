from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Optional
from uuid import UUID

from sqlalchemy import Boolean, Date, DateTime, Index, Numeric, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from src.services.database_manager.connection import Base


class Account(Base):
    """Bank account model"""
    
    __tablename__ = "accounts"
    
    id: Mapped[UUID] = mapped_column(primary_key=True, server_default=func.gen_random_uuid())
    account_number: Mapped[str] = mapped_column(String, nullable=False)
    account_type: Mapped[str] = mapped_column(String, nullable=False)  # credit_card, savings, current
    bank_name: Mapped[str] = mapped_column(String, nullable=False)
    card_type: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    nickname: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    statement_sender: Mapped[str] = mapped_column(String, nullable=False)
    statement_password: Mapped[str] = mapped_column(String, nullable=False)
    last_statement_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    last_processed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    credit_limit: Mapped[Optional[Decimal]] = mapped_column(Numeric, nullable=True)
    available_credit: Mapped[Optional[Decimal]] = mapped_column(Numeric, nullable=True)
    due_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    billing_cycle_start: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    billing_cycle_end: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    is_active: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True, default=True)
    created_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True, server_default=func.current_timestamp())
    updated_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True, server_default=func.current_timestamp())

    # Indexes
    __table_args__ = (
        Index('idx_bank_accounts_account_type', 'account_type'),
        Index('idx_bank_accounts_bank_name', 'bank_name'),
        Index('idx_bank_accounts_statement_sender', 'statement_sender'),
    )
