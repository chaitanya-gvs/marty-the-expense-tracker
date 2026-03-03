from __future__ import annotations

from datetime import datetime
from typing import Optional
from uuid import UUID

from sqlalchemy import BigInteger, DateTime, Index, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from src.services.database_manager.connection import Base


class Participant(Base):
    """Participant model for tracking people involved in split transactions"""
    
    __tablename__ = "participants"
    
    id: Mapped[UUID] = mapped_column(primary_key=True, server_default=func.gen_random_uuid())
    name: Mapped[str] = mapped_column(String(255), nullable=False)  # Display name in our system
    splitwise_id: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)  # Splitwise user ID
    splitwise_email: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)  # Splitwise email for additional mapping
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)  # Additional notes about the participant
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())
    
    # Indexes and constraints
    __table_args__ = (
        Index('ix_participants_name', 'name'),
        Index('ix_participants_splitwise_id', 'splitwise_id'),
        UniqueConstraint('name', name='uq_participants_name'),
        UniqueConstraint('splitwise_id', name='uq_participants_splitwise_id'),
    )

