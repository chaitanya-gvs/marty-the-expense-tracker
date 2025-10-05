from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Any, Dict, List, Optional
from uuid import UUID

from pydantic import BaseModel, Field


class SettlementEntry(BaseModel):
    """Individual settlement entry for a participant."""
    participant: str = Field(..., description="Name of the participant")
    amount_owed_to_me: float = Field(..., description="Amount this participant owes me")
    amount_i_owe: float = Field(..., description="Amount I owe this participant")
    net_balance: float = Field(..., description="Net balance (amount_owed_to_me - amount_i_owe)")
    transaction_count: int = Field(..., description="Number of shared transactions with this participant")


class SettlementSummary(BaseModel):
    """Summary of all settlements."""
    total_amount_owed_to_me: float = Field(..., description="Total amount others owe me")
    total_amount_i_owe: float = Field(..., description="Total amount I owe others")
    net_total_balance: float = Field(..., description="Net total balance")
    participant_count: int = Field(..., description="Number of participants with outstanding balances")
    settlements: List[SettlementEntry] = Field(default_factory=list, description="List of individual settlements")


class SettlementTransaction(BaseModel):
    """Transaction details for settlement breakdown."""
    id: str = Field(..., description="Transaction ID")
    date: str = Field(..., description="Transaction date")
    description: str = Field(..., description="Transaction description")
    amount: float = Field(..., description="Total transaction amount")
    my_share: float = Field(..., description="My share of the transaction")
    participant_share: float = Field(..., description="Participant's share of the transaction")
    paid_by: str = Field(..., description="Who paid for this transaction")
    split_breakdown: Dict[str, Any] = Field(..., description="Original split breakdown")


class SettlementDetail(BaseModel):
    """Detailed settlement information for a specific participant."""
    participant: str = Field(..., description="Name of the participant")
    net_balance: float = Field(..., description="Net balance with this participant")
    transactions: List[SettlementTransaction] = Field(default_factory=list, description="List of shared transactions")
    total_shared_amount: float = Field(..., description="Total amount of shared transactions")


class SettlementFilters(BaseModel):
    """Filters for settlement calculations."""
    date_range_start: Optional[date] = Field(None, description="Start date for filtering transactions")
    date_range_end: Optional[date] = Field(None, description="End date for filtering transactions")
    participant: Optional[str] = Field(None, description="Filter by specific participant")
    include_settled: bool = Field(True, description="Include transactions with zero balances")
    min_amount: Optional[float] = Field(None, description="Minimum transaction amount to include")
