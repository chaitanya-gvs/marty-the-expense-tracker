from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Any, Dict, List, Optional
from uuid import UUID

from sqlalchemy import ARRAY, Date, DateTime, Index, Numeric, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy import text as sa_text

from src.services.database_manager.connection import Base


class ReviewQueue(Base):
    """Staging table for statement transactions awaiting manual review."""

    __tablename__ = "review_queue"

    id: Mapped[UUID] = mapped_column(primary_key=True, server_default=func.gen_random_uuid())
    review_type: Mapped[str] = mapped_column(Text, nullable=False)  # 'statement_only' | 'ambiguous'
    transaction_date: Mapped[date] = mapped_column(Date, nullable=False)
    amount: Mapped[Decimal] = mapped_column(Numeric, nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    account: Mapped[str] = mapped_column(Text, nullable=False)
    direction: Mapped[str] = mapped_column(Text, nullable=False)  # 'debit' | 'credit'
    transaction_type: Mapped[str] = mapped_column(Text, nullable=False)
    reference_number: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    raw_data: Mapped[Optional[Dict[str, Any]]] = mapped_column(JSONB, nullable=True)
    ambiguous_candidate_ids: Mapped[Optional[List[str]]] = mapped_column(ARRAY(Text), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.current_timestamp())
    resolved_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    resolution: Mapped[Optional[str]] = mapped_column(Text, nullable=True)  # 'confirmed' | 'linked' | 'deleted'

    __table_args__ = (
        Index('idx_review_queue_unresolved', 'review_type', postgresql_where=sa_text("resolved_at IS NULL")),
    )
