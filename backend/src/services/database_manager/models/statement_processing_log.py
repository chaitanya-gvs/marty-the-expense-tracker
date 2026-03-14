from __future__ import annotations

from datetime import datetime
from typing import Optional
from uuid import UUID

from sqlalchemy import DateTime, ForeignKey, Index, Integer, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from src.services.database_manager.connection import Base


class StatementProcessingLog(Base):
    """Tracks the processing status of each bank statement through the pipeline."""

    __tablename__ = "statement_processing_log"

    id: Mapped[UUID] = mapped_column(primary_key=True, server_default=func.gen_random_uuid())
    normalized_filename: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    account_id: Mapped[Optional[UUID]] = mapped_column(
        ForeignKey("accounts.id", ondelete="SET NULL"), nullable=True
    )
    account_nickname: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    sender_email: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    email_date: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    statement_month: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(Text, nullable=False, server_default="downloaded")
    unlocked_cloud_path: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    csv_cloud_path: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    transaction_count: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    db_inserted_count: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    last_error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    workflow_run_id: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    __table_args__ = (
        Index("idx_spl_status", "status"),
        Index("idx_spl_statement_month", "statement_month"),
        Index("idx_spl_account_id", "account_id"),
    )
