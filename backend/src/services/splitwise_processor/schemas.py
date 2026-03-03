"""
Data models for Splitwise transactions and related entities.
"""

from datetime import datetime
from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field


class SplitwiseUser(BaseModel):
    """Splitwise user model."""
    id: int
    first_name: str = ""
    last_name: Optional[str] = None  # Some users may not have a last name
    email: Optional[str] = None  # Some users may not have an email set
    picture: Optional[Dict[str, str]] = None


class SplitwiseExpenseUser(BaseModel):
    """User involved in a Splitwise expense."""
    user: SplitwiseUser
    paid_share: float
    owed_share: float
    net_balance: Optional[float] = None


class SplitwiseCategory(BaseModel):
    """Splitwise expense category."""
    id: int
    name: str
    icon: Optional[str] = None


class SplitwiseGroup(BaseModel):
    """Splitwise group."""
    id: int
    name: str
    group_type: Optional[str] = None


class SplitwiseExpense(BaseModel):
    """Splitwise expense model."""
    id: int
    description: str
    cost: float
    currency_code: str
    date: datetime
    created_at: datetime
    updated_at: datetime
    category: Optional[SplitwiseCategory] = None
    group: Optional[SplitwiseGroup] = None
    users: List[SplitwiseExpenseUser] = Field(default_factory=list)
    created_by: Optional[SplitwiseUser] = None
    updated_by: Optional[SplitwiseUser] = None
    deleted_at: Optional[datetime] = None
    deleted_by: Optional[SplitwiseUser] = None
    details: Optional[str] = None
    payment: Optional[bool] = None
    receipt: Optional[Dict[str, Optional[str]]] = None
    repeat_interval: Optional[str] = None
    email_reminder: Optional[bool] = None
    email_reminder_in_advance: Optional[int] = None
    next_repeat: Optional[datetime] = None
    comments_count: Optional[int] = None
    transaction_method: Optional[str] = None
    transaction_confirmed: Optional[bool] = None
    expense_bundle_id: Optional[int] = None
    friendship_id: Optional[int] = None


class ProcessedSplitwiseTransaction(BaseModel):
    """Processed Splitwise transaction for our expense tracker."""
    splitwise_id: int
    description: str
    amount: float
    currency: str
    date: datetime
    category: str
    group_name: Optional[str] = None
    source: str = "splitwise"
    created_by: Optional[str] = None
    my_share: float = 0.0
    total_participants: int = 0
    participants: List[str] = Field(default_factory=list)
    paid_by: Optional[str] = None  # Who actually paid for this transaction
    is_payment: bool = False
    raw_data: Dict[str, Any] = Field(default_factory=dict)


class SplitwiseTransactionFilter(BaseModel):
    """Filter criteria for Splitwise transactions."""
    start_date: Optional[datetime] = None
    end_date: Optional[datetime] = None
    exclude_created_by_me: bool = True
    include_only_my_transactions: bool = True
    min_amount: Optional[float] = None
    max_amount: Optional[float] = None
    categories: Optional[List[str]] = None
    groups: Optional[List[str]] = None
