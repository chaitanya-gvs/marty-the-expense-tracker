"""
Internal database schemas for the database_manager service layer.

These TypedDicts represent the shape of data returned by database operations.
They are internal contracts — snake_case, not exposed to HTTP clients.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, TypedDict


class TransactionRow(TypedDict, total=False):
    """Shape returned by TransactionOperations getter methods."""

    id: str
    transaction_date: str
    transaction_time: Optional[str]
    amount: str  # Decimal serialized as string from the DB mapping
    split_share_amount: Optional[str]
    direction: str
    transaction_type: str
    is_shared: bool
    is_refund: bool
    is_split: bool
    is_transfer: bool
    is_flagged: bool
    is_grouped_expense: bool
    is_deleted: bool
    description: str
    user_description: Optional[str]
    notes: Optional[str]
    paid_by: Optional[str]
    account: str
    category_id: Optional[str]
    category: Optional[str]
    sub_category: Optional[str]
    tags: List[str]
    split_breakdown: Optional[Dict[str, Any]]
    transaction_group_id: Optional[str]
    transaction_source: str
    reference_number: Optional[str]
    related_mails: Optional[List[str]]
    source_file: Optional[str]
    raw_data: Optional[Dict[str, Any]]
    original_date: Optional[str]
    created_at: str
    updated_at: str
    deleted_at: Optional[str]


class AccountRow(TypedDict, total=False):
    """Shape returned by AccountOperations getter methods."""

    id: str
    account_number: Optional[str]
    account_type: str
    bank_name: str
    card_type: Optional[str]
    nickname: Optional[str]
    notes: Optional[str]
    statement_sender: Optional[str]
    statement_password: Optional[str]
    last_statement_date: Optional[str]
    last_processed_at: Optional[str]
    credit_limit: Optional[str]
    available_credit: Optional[str]
    due_date: Optional[str]
    billing_cycle_start: Optional[int]
    billing_cycle_end: Optional[int]
    is_active: bool
    created_at: str
    updated_at: str


class StatementLogRow(TypedDict, total=False):
    """Shape returned by StatementLogOperations getter methods."""

    id: str
    normalized_filename: str
    original_filename: Optional[str]
    account_id: Optional[str]
    status: str
    error_message: Optional[str]
    transactions_inserted: Optional[int]
    processing_started_at: Optional[str]
    processing_completed_at: Optional[str]
    created_at: str
    updated_at: str
