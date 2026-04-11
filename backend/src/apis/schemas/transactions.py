"""
External API schemas for transaction-related endpoints.

All models here represent the HTTP contract between frontend and backend.
"""

from __future__ import annotations

from datetime import date as DateType, datetime
from decimal import Decimal
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field, field_validator


# ============================================================================
# TRANSACTION SCHEMAS
# ============================================================================


class TransactionCreate(BaseModel):
    """Request model for creating a transaction."""

    date: DateType
    account: str
    description: str
    category: str
    subcategory: Optional[str] = None
    direction: str = Field(..., pattern="^(debit|credit)$")
    amount: Decimal
    split_share_amount: Optional[Decimal] = None
    tags: List[str] = []
    notes: Optional[str] = None
    is_shared: bool = False
    is_refund: bool = False
    is_split: bool = False
    is_transfer: bool = False
    is_flagged: bool = False
    is_grouped_expense: bool = False
    split_breakdown: Optional[Dict[str, Any]] = None
    transaction_group_id: Optional[str] = None
    related_mails: List[str] = []
    source_file: Optional[str] = None
    raw_data: Optional[Dict[str, Any]] = None
    transaction_source: Optional[str] = None  # manual_entry (default) or email_ingestion


class TransactionUpdate(BaseModel):
    """Request model for updating a transaction."""

    date: Optional[DateType] = None
    account: Optional[str] = None
    description: Optional[str] = None
    category: Optional[str] = None
    subcategory: Optional[str] = None
    direction: Optional[str] = Field(None, pattern="^(debit|credit)$")
    amount: Optional[Decimal] = None
    split_share_amount: Optional[Decimal] = None
    tags: Optional[List[str]] = None
    notes: Optional[str] = None
    is_shared: Optional[bool] = None
    is_refund: Optional[bool] = None
    is_split: Optional[bool] = None
    is_transfer: Optional[bool] = None
    is_flagged: Optional[bool] = None
    is_grouped_expense: Optional[bool] = None
    split_breakdown: Optional[Dict[str, Any]] = None
    paid_by: Optional[str] = None
    transaction_group_id: Optional[str] = None
    related_mails: Optional[List[str]] = None
    source_file: Optional[str] = None
    raw_data: Optional[Dict[str, Any]] = None
    is_deleted: Optional[bool] = None
    deleted_at: Optional[datetime] = None


class BulkTransactionUpdate(BaseModel):
    """Request model for bulk updating multiple transactions."""

    transaction_ids: List[str] = Field(..., min_length=1, description="List of transaction IDs to update")
    updates: TransactionUpdate = Field(..., description="Updates to apply to all selected transactions")


class TransactionResponse(BaseModel):
    """Response model for transaction data."""

    id: str
    date: str
    transaction_time: Optional[str] = None  # HH:MM:SS, only present when captured (e.g. email ingestion)
    account: str
    description: str
    category: Optional[str] = None
    subcategory: Optional[str] = None
    direction: str
    amount: float
    split_share_amount: Optional[float] = None
    tags: List[str]
    notes: Optional[str] = None
    is_shared: bool
    is_refund: bool
    is_split: bool
    is_transfer: bool
    is_flagged: Optional[bool] = False
    is_grouped_expense: Optional[bool] = False
    split_breakdown: Optional[Dict[str, Any]] = None
    paid_by: Optional[str] = None
    transaction_group_id: Optional[str] = None
    related_mails: List[str] = []
    source_file: Optional[str] = None
    raw_data: Optional[Dict[str, Any]] = None
    created_at: str
    updated_at: str
    status: str = "reviewed"
    is_deleted: bool = False
    deleted_at: Optional[str] = None
    original_date: Optional[str] = None


class TransactionFilters(BaseModel):
    """Request model for transaction filtering."""

    date_range: Optional[Dict[str, str]] = None
    accounts: Optional[List[str]] = None
    categories: Optional[List[str]] = None
    subcategories: Optional[List[str]] = None
    tags: Optional[List[str]] = None
    amount_range: Optional[Dict[str, float]] = None
    direction: Optional[str] = Field(None, pattern="^(debit|credit)$")
    transaction_type: Optional[str] = Field(None, pattern="^(all|shared|refunds|transfers)$")
    search: Optional[str] = None
    include_uncategorized: Optional[bool] = None
    is_flagged: Optional[bool] = None


class TransactionSort(BaseModel):
    """Request model for transaction sorting."""

    field: str
    direction: str = Field(..., pattern="^(asc|desc)$")


class PaginationParams(BaseModel):
    """Request model for pagination."""

    page: int = Field(1, ge=1)
    limit: int = Field(50, ge=1, le=500)


# ============================================================================
# SPLIT / GROUP SCHEMAS
# ============================================================================


class GroupTransferRequest(BaseModel):
    """Request model for grouping transfers."""

    transaction_ids: List[str]


class GroupExpenseRequest(BaseModel):
    """Request model for grouping multiple transactions into a single expense."""

    transaction_ids: List[str] = Field(..., min_length=1)
    description: str = Field(..., description="Description for the collapsed grouped expense")
    category: Optional[str] = Field(None, description="Optional category override for the grouped expense")


class UngroupExpenseRequest(BaseModel):
    """Request model for ungrouping expense transactions."""

    transaction_group_id: str


class UngroupSplitRequest(BaseModel):
    """Request model for ungrouping split transactions."""

    transaction_group_id: str


class SplitTransactionPart(BaseModel):
    """Individual part of a split transaction."""

    description: str
    amount: Decimal = Field(..., gt=0)
    category: Optional[str] = None
    subcategory: Optional[str] = None
    tags: List[str] = []
    notes: Optional[str] = None


class SplitTransactionRequest(BaseModel):
    """Request model for splitting a transaction."""

    transaction_id: str
    parts: List[SplitTransactionPart] = Field(..., min_length=2)
    delete_original: bool = Field(default=False, description="Whether to delete the original transaction after splitting")


# ============================================================================
# CATEGORY SCHEMAS
# ============================================================================


class CategoryCreate(BaseModel):
    """Request model for creating a category."""

    name: str = Field(..., min_length=1, max_length=100)
    color: Optional[str] = Field(None, pattern="^#[0-9A-Fa-f]{6}$")
    parent_id: Optional[str] = None
    sort_order: Optional[int] = Field(None, ge=0)
    transaction_type: Optional[str] = Field(None, description="Transaction type: 'debit', 'credit', or None for both")


class CategoryUpdate(BaseModel):
    """Request model for updating a category."""

    name: Optional[str] = Field(None, min_length=1, max_length=100)
    color: Optional[str] = Field(None, pattern="^#[0-9A-Fa-f]{6}$")
    parent_id: Optional[str] = None
    sort_order: Optional[int] = Field(None, ge=0)
    transaction_type: Optional[str] = Field(None, description="Transaction type: 'debit', 'credit', or None for both")


class SubcategoryCreate(BaseModel):
    """Request model for creating a subcategory."""

    name: str = Field(..., min_length=1, max_length=100)
    color: str = Field(..., pattern="^#[0-9A-Fa-f]{6}$")
    is_hidden: bool = False


class SubcategoryUpdate(BaseModel):
    """Request model for updating a subcategory."""

    name: Optional[str] = Field(None, min_length=1, max_length=100)
    color: Optional[str] = Field(None, pattern="^#[0-9A-Fa-f]{6}$")
    is_hidden: Optional[bool] = None


class SubcategoryResponse(BaseModel):
    """Response model for subcategory data."""

    id: str
    name: str
    color: str
    is_hidden: bool


class CategoryResponse(BaseModel):
    """Response model for category data."""

    id: str
    name: str
    slug: str
    color: Optional[str] = None
    parent_id: Optional[str] = None
    sort_order: int
    is_active: bool
    created_at: str
    updated_at: str


# ============================================================================
# TAG SCHEMAS
# ============================================================================


class TagCreate(BaseModel):
    """Request model for creating a tag."""

    name: str = Field(..., min_length=1, max_length=50)
    color: str = Field(..., description="Color in hex format (e.g., #RRGGBB)")

    @field_validator("color")
    @classmethod
    def validate_color(cls, v: str) -> str:
        """Validate and normalize color format."""
        if not v:
            return "#3B82F6"

        color_hex = v.lstrip("#")

        if len(color_hex) == 3:
            color_hex = "".join(c * 2 for c in color_hex)

        if len(color_hex) != 6:
            raise ValueError(f"Color must be 6 hex digits, got {len(color_hex)}: {v}")

        if not all(c in "0123456789ABCDEFabcdef" for c in color_hex):
            raise ValueError(f"Invalid hex color format: {v}")

        return f"#{color_hex.upper()}"


class TagUpdate(BaseModel):
    """Request model for updating a tag."""

    name: Optional[str] = Field(None, min_length=1, max_length=50)
    color: Optional[str] = Field(None, pattern="^#[0-9A-Fa-f]{6}$")


class TagResponse(BaseModel):
    """Response model for tag data."""

    id: str
    name: str
    color: str
    usage_count: int


# ============================================================================
# SUGGESTION SCHEMAS
# ============================================================================


class TransferSuggestion(BaseModel):
    """Response model for transfer suggestions."""

    transactions: List[Dict[str, Any]]
    confidence: float
    reason: str


class RefundSuggestion(BaseModel):
    """Response model for refund suggestions."""

    parent: Dict[str, Any]
    child: Dict[str, Any]
    confidence: float
    reason: str


# ============================================================================
# EMAIL LINKING SCHEMAS
# ============================================================================


class EmailSearchFilters(BaseModel):
    """Filters for searching emails related to a transaction."""

    date_offset_days: int = Field(1, ge=0, le=30, description="Days to search before/after transaction date")
    include_amount_filter: bool = Field(True, description="Whether to filter by amount")
    start_date: Optional[str] = Field(None, description="Custom start date (YYYY-MM-DD)")
    end_date: Optional[str] = Field(None, description="Custom end date (YYYY-MM-DD)")
    amount_tolerance: Optional[int] = Field(None, ge=0, le=20, description="Search for amounts in range [amount - tolerance, amount] (integer steps)")


class EmailLinkRequest(BaseModel):
    """Request to link an email to a transaction."""

    message_id: str = Field(..., description="Gmail message ID to link")
