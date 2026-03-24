from __future__ import annotations

from datetime import date, datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class SettlementEntry(BaseModel):
    """Individual settlement entry for a participant."""
    participant: str = Field(..., description="Name of the participant")
    amount_owed_to_me: float = Field(..., description="Amount this participant owes me")
    amount_i_owe: float = Field(..., description="Amount I owe this participant")
    net_balance: float = Field(..., description="Net balance (amount_owed_to_me - amount_i_owe)")
    transaction_count: int = Field(..., description="Number of shared transactions with this participant")
    payment_count: int = Field(0, description="Number of payment transactions with this participant")
    splitwise_balance: Optional[float] = Field(None, description="Authoritative balance from Splitwise API")
    balance_synced_at: Optional[str] = Field(None, description="ISO timestamp of last Splitwise balance sync")
    has_discrepancy: bool = Field(False, description="True when local balance differs from Splitwise balance (e.g. simplified debts)")


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
    paid_by: Optional[str] = Field(None, description="Who paid for this transaction")
    split_breakdown: Dict[str, Any] = Field(..., description="Original split breakdown")
    group_name: Optional[str] = Field(None, description="Splitwise group name for this transaction")


class PaymentHistoryEntry(BaseModel):
    """A payment/repayment transaction entry."""
    id: str = Field(..., description="Transaction ID")
    date: str = Field(..., description="Payment date")
    amount: float = Field(..., description="Amount paid")
    description: str = Field(..., description="Payment description")
    paid_by: Optional[str] = Field(None, description="Who made this payment")


class SettlementDetail(BaseModel):
    """Detailed settlement information for a specific participant."""
    participant: str = Field(..., description="Name of the participant")
    net_balance: float = Field(..., description="Net balance with this participant")
    transactions: List[SettlementTransaction] = Field(default_factory=list, description="List of shared transactions")
    total_shared_amount: float = Field(..., description="Total amount of shared transactions")
    payment_history: List[PaymentHistoryEntry] = Field(default_factory=list, description="Timeline of repayment transactions")
    splitwise_balance: Optional[float] = Field(None, description="Authoritative balance from Splitwise")
    balance_synced_at: Optional[str] = Field(None, description="ISO timestamp of last Splitwise balance sync")
    has_discrepancy: bool = Field(False, description="True when local and Splitwise balances differ")


class SettlementFilters(BaseModel):
    """Filters for settlement calculations."""
    date_range_start: Optional[date] = Field(None, description="Start date for filtering transactions")
    date_range_end: Optional[date] = Field(None, description="End date for filtering transactions")
    participant: Optional[str] = Field(None, description="Filter by specific participant")
    include_settled: bool = Field(True, description="Include transactions with zero balances")
    min_amount: Optional[float] = Field(None, description="Minimum transaction amount to include")
