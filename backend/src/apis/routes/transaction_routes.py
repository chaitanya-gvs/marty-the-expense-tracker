"""
FastAPI routes for transaction management including categories, tags, and suggestions.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import List, Optional, Dict, Any
import json
import traceback
from fastapi import APIRouter, HTTPException, Query, Depends
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
import asyncpg
from pathlib import Path
import tempfile

from src.services.database_manager.operations import TransactionOperations, CategoryOperations, TagOperations
from src.services.database_manager.connection import get_session_factory, refresh_connection_pool
from src.services.email_ingestion.client import EmailClient
from src.services.cloud_storage.gcs_service import GoogleCloudStorageService
from src.utils.logger import get_logger

logger = get_logger(__name__)

router = APIRouter(prefix="/transactions", tags=["transactions"])


async def handle_database_operation(operation_func, *args, **kwargs):
    """
    Handle database operations with automatic retry on InvalidCachedStatementError
    """
    max_retries = 2
    
    for attempt in range(max_retries):
        try:
            return await operation_func(*args, **kwargs)
        except asyncpg.exceptions.InvalidCachedStatementError as e:
            logger.warning(f"InvalidCachedStatementError on attempt {attempt + 1}: {e}")
            if attempt < max_retries - 1:
                # Refresh connection pool and retry
                await refresh_connection_pool()
                logger.info("Refreshed connection pool, retrying operation")
                continue
            else:
                # Final attempt failed
                logger.error(f"Database operation failed after {max_retries} attempts")
                raise e
        except Exception as e:
            # For other exceptions, don't retry
            raise e


# ============================================================================
# TRANSACTION MODELS AND OPERATIONS
# ============================================================================

class TransactionCreate(BaseModel):
    """Request model for creating a transaction."""
    date: date
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
    link_parent_id: Optional[str] = None
    transaction_group_id: Optional[str] = None
    related_mails: List[str] = []
    source_file: Optional[str] = None
    raw_data: Optional[Dict[str, Any]] = None


class TransactionUpdate(BaseModel):
    """Request model for updating a transaction."""
    date: Optional[date] = None
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
    link_parent_id: Optional[str] = None
    transaction_group_id: Optional[str] = None
    related_mails: Optional[List[str]] = None
    source_file: Optional[str] = None
    raw_data: Optional[Dict[str, Any]] = None
    is_deleted: Optional[bool] = None
    deleted_at: Optional[datetime] = None


class BulkTransactionUpdate(BaseModel):
    """Request model for bulk updating multiple transactions."""
    transaction_ids: List[str] = Field(..., min_items=1, description="List of transaction IDs to update")
    updates: TransactionUpdate = Field(..., description="Updates to apply to all selected transactions")


class TransactionResponse(BaseModel):
    """Response model for transaction data."""
    id: str
    date: str
    account: str
    description: str
    category: Optional[str] = None
    subcategory: Optional[str] = None
    direction: str
    amount: float
    net_amount: Optional[float] = None
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
    link_parent_id: Optional[str] = None
    transaction_group_id: Optional[str] = None
    related_mails: List[str] = []
    source_file: Optional[str] = None
    raw_data: Optional[Dict[str, Any]] = None
    created_at: str
    updated_at: str
    status: str = "reviewed"
    is_deleted: bool = False
    deleted_at: Optional[str] = None


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


class LinkRefundRequest(BaseModel):
    """Request model for linking refunds."""
    child_id: str
    parent_id: str


class GroupTransferRequest(BaseModel):
    """Request model for grouping transfers."""
    transaction_ids: List[str]


class GroupExpenseRequest(BaseModel):
    """Request model for grouping multiple transactions into a single expense."""
    transaction_ids: List[str] = Field(..., min_items=1)
    description: str = Field(..., description="Description for the collapsed grouped expense")
    category: Optional[str] = Field(None, description="Optional category override for the grouped expense")


class UngroupExpenseRequest(BaseModel):
    """Request model for ungrouping expense transactions."""
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
    parts: List[SplitTransactionPart] = Field(..., min_items=2)
    delete_original: bool = Field(default=False, description="Whether to delete the original transaction after splitting")


# ============================================================================
# CATEGORY MODELS AND OPERATIONS
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
# TAG MODELS AND OPERATIONS
# ============================================================================

class TagCreate(BaseModel):
    """Request model for creating a tag."""
    name: str = Field(..., min_length=1, max_length=50)
    color: str = Field(..., description="Color in hex format (e.g., #RRGGBB)")
    
    @field_validator('color')
    @classmethod
    def validate_color(cls, v: str) -> str:
        """Validate and normalize color format"""
        if not v:
            return "#3B82F6"  # Default color
        
        # Remove # if present
        color_hex = v.lstrip('#')
        
        # Expand shorthand (e.g., FFF -> FFFFFF)
        if len(color_hex) == 3:
            color_hex = ''.join(c * 2 for c in color_hex)
        
        # Validate hex format
        if len(color_hex) != 6:
            raise ValueError(f"Color must be 6 hex digits, got {len(color_hex)}: {v}")
        
        if not all(c in '0123456789ABCDEFabcdef' for c in color_hex):
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
# SUGGESTION MODELS
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
# SHARED MODELS
# ============================================================================

class ApiResponse(BaseModel):
    """Standard API response wrapper."""
    data: Any
    pagination: Optional[Dict[str, Any]] = None
    message: Optional[str] = None


# ============================================================================
# OPERATIONS CLASSES
# ============================================================================

# TagOperations is now imported from operations.py


class SuggestionOperations:
    """Operations for generating transaction suggestions."""
    
    @staticmethod
    async def find_transfer_suggestions(
        days_back: int = 30,
        min_amount: float = 10.0,
        max_time_diff_hours: int = 24
    ) -> List[Dict[str, Any]]:
        """Find potential transfer pairs based on amount similarity and timing."""
        session_factory = get_session_factory()
        session = session_factory()
        try:
            start_date = datetime.now() - timedelta(days=days_back)
            
            result = await session.execute(
                text("""
                    SELECT 
                        t1.id as t1_id, t1.transaction_date as t1_date, t1.amount as t1_amount,
                        t1.direction as t1_direction, t1.account as t1_account, 
                        t1.description as t1_description,
                        t2.id as t2_id, t2.transaction_date as t2_date, t2.amount as t2_amount,
                        t2.direction as t2_direction, t2.account as t2_account,
                        t2.description as t2_description,
                        ABS(t1.amount + t2.amount) as amount_diff,
                        ABS(EXTRACT(EPOCH FROM (t1.transaction_date - t2.transaction_date))/3600) as time_diff_hours
                    FROM transactions t1
                    JOIN transactions t2 ON (
                        t1.id != t2.id
                        AND t1.transaction_date >= :start_date
                        AND t2.transaction_date >= :start_date
                        AND ABS(t1.amount + t2.amount) < :amount_tolerance
                        AND ABS(EXTRACT(EPOCH FROM (t1.transaction_date - t2.transaction_date))/3600) < :max_time_diff
                        AND t1.direction != t2.direction
                        AND ABS(t1.amount) >= :min_amount
                        AND ABS(t2.amount) >= :min_amount
                        AND t1.transaction_group_id IS NULL
                        AND t2.transaction_group_id IS NULL
                    )
                    WHERE t1.id < t2.id
                    ORDER BY amount_diff ASC, time_diff_hours ASC
                    LIMIT 50
                """), {
                    "start_date": start_date,
                    "amount_tolerance": min_amount * 0.1,
                    "max_time_diff": max_time_diff_hours,
                    "min_amount": min_amount
                }
            )
            
            rows = result.fetchall()
            suggestions = []
            
            for row in rows:
                amount_confidence = max(0, 1 - (row.amount_diff / min_amount))
                time_confidence = max(0, 1 - (row.time_diff_hours / max_time_diff_hours))
                confidence = (amount_confidence + time_confidence) / 2
                
                if confidence > 0.3:
                    suggestions.append({
                        "transactions": [
                            {
                                "id": row.t1_id,
                                "amount": float(row.t1_amount),
                                "direction": row.t1_direction,
                                "account": row.t1_account,
                                "description": row.t1_description
                            },
                            {
                                "id": row.t2_id,
                                "amount": float(row.t2_amount),
                                "direction": row.t2_direction,
                                "account": row.t2_account,
                                "description": row.t2_description
                            }
                        ],
                        "confidence": confidence,
                        "reason": f"Similar amounts ({row.amount_diff:.2f} difference) within {row.time_diff_hours:.1f} hours"
                    })
            
            return suggestions
            
        finally:
            await session.close()


# ============================================================================
# UTILITY FUNCTIONS
# ============================================================================

def _parse_raw_data(raw_data: Any) -> Optional[Dict[str, Any]]:
    """Parse raw_data from string to dictionary if needed."""
    if raw_data is None:
        return None
    if isinstance(raw_data, dict):
        return raw_data
    if isinstance(raw_data, str):
        try:
            return json.loads(raw_data)
        except json.JSONDecodeError:
            return None
    return None

def _convert_decimal_to_float(data: Any) -> Any:
    """Recursively convert Decimal values to float for JSON serialization."""
    from decimal import Decimal
    
    if data is None:
        return None
    if isinstance(data, Decimal):
        return float(data)
    if isinstance(data, dict):
        return {k: _convert_decimal_to_float(v) for k, v in data.items()}
    if isinstance(data, list):
        return [_convert_decimal_to_float(item) for item in data]
    return data

def _convert_db_transaction_to_response(transaction: Dict[str, Any]) -> TransactionResponse:
    """Convert database transaction to API response format."""
    # Handle None values for boolean fields - default to False
    is_flagged = transaction.get('is_flagged')
    if is_flagged is None:
        is_flagged = False
    
    is_shared = transaction.get('is_shared')
    if is_shared is None:
        is_shared = False
    
    is_refund = transaction.get('is_partial_refund')
    if is_refund is None:
        is_refund = False
    
    is_split = transaction.get('is_split')
    if is_split is None:
        is_split = False
    
    is_deleted = transaction.get('is_deleted')
    if is_deleted is None:
        is_deleted = False
    
    is_grouped_expense = transaction.get('is_grouped_expense')
    if is_grouped_expense is None:
        is_grouped_expense = False
    
    # Convert Decimal values in split_breakdown to float for JSON serialization
    split_breakdown = transaction.get('split_breakdown')
    if split_breakdown:
        split_breakdown = _convert_decimal_to_float(split_breakdown)
    
    # Calculate net amount (original amount minus refunds)
    original_amount = float(transaction.get('amount', 0))
    net_amount_raw = transaction.get('net_amount')
    if net_amount_raw is not None:
        net_amount = float(net_amount_raw)
    else:
        net_amount = original_amount
    
    # Only include net_amount in response if refunds actually exist (net < original)
    # This ensures we don't send net_amount when it equals original_amount
    net_amount_for_response = None
    if net_amount < original_amount:
        net_amount_for_response = net_amount
    
    # Recalculate split_share_amount based on net_amount for shared transactions
    split_share_amount = None
    if is_shared and split_breakdown:
        # Recalculate split_share_amount based on net_amount instead of original amount
        split_share_amount = _calculate_split_share_amount(split_breakdown, net_amount)
    else:
        # Use stored split_share_amount if not shared or no split_breakdown
        split_share_amount = float(transaction.get('split_share_amount')) if transaction.get('split_share_amount') else None
    
    return TransactionResponse(
        id=str(transaction.get('id', '')),
        date=transaction.get('transaction_date', '').isoformat() if transaction.get('transaction_date') else '',
        account=transaction.get('account', ''),
        description=transaction.get('description', ''),
        category=transaction.get('category', ''),  # This now comes from the JOIN with categories table
        subcategory=transaction.get('sub_category'),
        direction=transaction.get('direction', 'debit'),
        amount=original_amount,
        net_amount=net_amount_for_response,  # Only include if refunds exist (net < original)
        split_share_amount=split_share_amount,
        tags=transaction.get('tags', []) or [],
        notes=transaction.get('notes'),
        is_shared=is_shared,
        is_refund=is_refund,
        is_split=is_split,
        is_transfer=bool(transaction.get('transaction_group_id')),
        is_flagged=is_flagged,
        is_grouped_expense=is_grouped_expense,
        split_breakdown=split_breakdown,
        paid_by=transaction.get('paid_by'),
        link_parent_id=str(transaction.get('link_parent_id')) if transaction.get('link_parent_id') else None,
        transaction_group_id=str(transaction.get('transaction_group_id')) if transaction.get('transaction_group_id') else None,
        related_mails=transaction.get('related_mails', []) or [],
        source_file=transaction.get('source_file'),
        raw_data=_parse_raw_data(transaction.get('raw_data')),
        created_at=transaction.get('created_at', '').isoformat() if transaction.get('created_at') else '',
        updated_at=transaction.get('updated_at', '').isoformat() if transaction.get('updated_at') else '',
        status="reviewed",
        is_deleted=is_deleted,
        deleted_at=transaction.get('deleted_at', '').isoformat() if transaction.get('deleted_at') else None
    )


def _convert_db_tag_to_response(tag: Dict[str, Any]) -> TagResponse:
    """Convert database tag to API response format."""
    # Convert UUID to string if needed
    tag_id = tag.get("id")
    if tag_id is not None:
        tag_id = str(tag_id)
    
    return TagResponse(
        id=tag_id or "",
        name=tag.get("name", ""),
        color=tag.get("color") or "#3B82F6",
        usage_count=tag.get("usage_count", 0)
    )


def _calculate_split_share_amount(split_breakdown: Dict[str, Any], total_amount: float) -> float:
    """Calculate the user's share amount from split breakdown."""
    if not split_breakdown or not isinstance(split_breakdown, dict):
        return 0.0
    
    include_me = split_breakdown.get("include_me", False)
    if not include_me:
        return 0.0
    
    mode = split_breakdown.get("mode", "equal")
    entries = split_breakdown.get("entries", [])
    
    if mode == "equal":
        # Equal split: total amount divided by number of participants
        if entries:
            return total_amount / len(entries)
        return 0.0
    elif mode == "custom":
        # Custom split: find the user's specific amount
        for entry in entries:
            if entry.get("participant") == "me":
                return float(entry.get("amount", 0))
        return 0.0
    
    return 0.0


# ============================================================================
# TRANSACTION ROUTES
# ============================================================================

@router.get("/", response_model=ApiResponse)
async def get_transactions(
    date_range_start: Optional[date] = Query(None, description="Start date for filtering"),
    date_range_end: Optional[date] = Query(None, description="End date for filtering"),
    accounts: Optional[str] = Query(None, description="Comma-separated account names"),
    exclude_accounts: Optional[str] = Query(None, description="Comma-separated account names to exclude"),
    categories: Optional[str] = Query(None, description="Comma-separated category names"),
    exclude_categories: Optional[str] = Query(None, description="Comma-separated category names to exclude"),
    include_uncategorized: bool = Query(False, description="Include uncategorized transactions when filtering by category"),
    tags: Optional[str] = Query(None, description="Comma-separated tag names"),
    amount_min: Optional[float] = Query(None, description="Minimum amount"),
    amount_max: Optional[float] = Query(None, description="Maximum amount"),
    direction: Optional[str] = Query(None, pattern="^(debit|credit)$", description="Transaction direction"),
    transaction_type: Optional[str] = Query(None, pattern="^(all|shared|refunds|transfers)$", description="Transaction type filter"),
    search: Optional[str] = Query(None, description="Search in description and notes"),
    is_flagged: Optional[bool] = Query(None, description="Filter transactions by flagged status"),
    is_shared: Optional[bool] = Query(None, description="Filter transactions by shared status"),
    is_split: Optional[bool] = Query(None, description="Filter transactions by split status (False to exclude split transactions)"),
    participants: Optional[str] = Query(None, description="Comma-separated participant names to include"),
    exclude_participants: Optional[str] = Query(None, description="Comma-separated participant names to exclude"),
    sort_field: Optional[str] = Query("date", description="Field to sort by"),
    sort_direction: Optional[str] = Query("desc", pattern="^(asc|desc)$", description="Sort direction"),
    page: int = Query(1, ge=1, description="Page number"),
    limit: int = Query(50, ge=1, le=500, description="Items per page")
):
    """Get transactions with filtering, sorting, and pagination."""
    try:
        # Prepare filter values
        account_filter_values = [account.strip() for account in accounts.split(',')] if accounts else []
        account_filter_values = [account for account in account_filter_values if account]
        exclude_account_values = [account.strip() for account in exclude_accounts.split(',')] if exclude_accounts else []
        exclude_account_values = [account for account in exclude_account_values if account]

        category_filter_values = [category.strip() for category in categories.split(',')] if categories else []
        category_filter_values = [category for category in category_filter_values if category]
        exclude_category_values = [category.strip() for category in exclude_categories.split(',')] if exclude_categories else []
        exclude_category_values = [category for category in exclude_category_values if category]
        tag_filter_values = [tag.strip() for tag in tags.split(',')] if tags else []
        tag_filter_values = [tag for tag in tag_filter_values if tag]
        
        participant_filter_values = [p.strip() for p in participants.split(',')] if participants else []
        participant_filter_values = [p for p in participant_filter_values if p]
        exclude_participant_values = [p.strip() for p in exclude_participants.split(',')] if exclude_participants else []
        exclude_participant_values = [p for p in exclude_participant_values if p]

        # Check if any filters are present (excluding pagination params)
        has_filters = bool(
            date_range_start or date_range_end or
            account_filter_values or exclude_account_values or
            category_filter_values or exclude_category_values or include_uncategorized or
            tag_filter_values or
            participant_filter_values or exclude_participant_values or
            amount_min is not None or amount_max is not None or
            direction or transaction_type or search or
            is_flagged is not None or is_shared is not None or is_split is not None
        )

        # If filters are present, fetch ALL transactions first, then filter and paginate
        # If no filters, we can paginate at the database level for better performance
        if has_filters:
            # Fetch all transactions (use a very large limit to get all)
            if date_range_start or date_range_end:
                transactions = await handle_database_operation(
                    TransactionOperations.get_transactions_by_date_range,
                    start_date=date_range_start or date.min,
                    end_date=date_range_end or date.max,
                    limit=1000000,  # Very large limit to get all transactions in range
                    offset=0,
                    order_by="DESC" if sort_direction == "desc" else "ASC"
                )
            else:
                transactions = await handle_database_operation(
                    TransactionOperations.get_all_transactions,
                    limit=1000000,  # Very large limit to get all transactions
                    offset=0,
                    order_by="DESC" if sort_direction == "desc" else "ASC"
                )
        else:
            # No filters - paginate at database level for performance
            if date_range_start or date_range_end:
                transactions = await handle_database_operation(
                    TransactionOperations.get_transactions_by_date_range,
                    start_date=date_range_start or date.min,
                    end_date=date_range_end or date.max,
                    limit=limit,
                    offset=(page - 1) * limit,
                    order_by="DESC" if sort_direction == "desc" else "ASC"
                )
            else:
                transactions = await handle_database_operation(
                    TransactionOperations.get_all_transactions,
                    limit=limit,
                    offset=(page - 1) * limit,
                    order_by="DESC" if sort_direction == "desc" else "ASC"
                )

        # Helper function to extract participants from transaction
        def get_transaction_participants(txn: Dict[str, Any]) -> List[str]:
            """Extract all participants from a transaction (from split_breakdown and paid_by)."""
            participants_list = []
            split_breakdown = txn.get('split_breakdown')
            if split_breakdown and isinstance(split_breakdown, dict):
                entries = split_breakdown.get("entries", [])
                for entry in entries:
                    participant = entry.get("participant")
                    if participant and participant not in participants_list:
                        participants_list.append(participant)
            # Also include paid_by if present
            paid_by = txn.get('paid_by')
            if paid_by and paid_by not in participants_list:
                participants_list.append(paid_by)
            return participants_list

        # Identify split parent transactions to exclude
        # A split parent is: has transaction_group_id, is_split=False, and has split children (is_split=True) in the same group
        split_group_ids_with_children = set()
        for txn in transactions:
            if (txn.get('transaction_group_id') and 
                (txn.get('is_split') is True)):
                split_group_ids_with_children.add(txn.get('transaction_group_id'))
        
        # Helper function to check if a transaction is a split parent
        def is_split_parent(txn: Dict[str, Any]) -> bool:
            """Check if transaction is a split parent (has transaction_group_id, is_split=False, and group has split children)."""
            if not txn.get('transaction_group_id'):
                return False
            if txn.get('is_split') is True:
                return False  # This is a split child, not a parent
            # Check if this group has split children
            return txn.get('transaction_group_id') in split_group_ids_with_children

        # Apply filters (if any filters were present, we filter all transactions; otherwise we already have the page)
        filtered_transactions = []
        for transaction in transactions:
            # Exclude split parent transactions (only show the split parts, not the original parent)
            # This matches the frontend behavior and prevents showing duplicate/confusing entries
            if is_split_parent(transaction):
                continue
            
            # Apply excluded accounts filter first
            if exclude_account_values and transaction.get('account') in exclude_account_values:
                continue

            # Apply account filter
            if account_filter_values and transaction.get('account') not in account_filter_values:
                continue
            
            # Apply category filter
            transaction_category = transaction.get('category')
            is_transaction_uncategorized = transaction_category is None or str(transaction_category).strip() == ''
            # Apply excluded categories filter
            if exclude_category_values and transaction_category in exclude_category_values:
                continue

            if category_filter_values:
                if transaction_category not in category_filter_values:
                    if not (include_uncategorized and is_transaction_uncategorized):
                        continue
            elif include_uncategorized and not is_transaction_uncategorized:
                continue
            
            # Apply tag filter
            if tag_filter_values:
                transaction_tags = transaction.get('tags', []) or []
                if not any(tag in transaction_tags for tag in tag_filter_values):
                    continue
            
            # Apply amount filter
            if amount_min is not None and float(transaction.get('amount', 0)) < amount_min:
                continue
            if amount_max is not None and float(transaction.get('amount', 0)) > amount_max:
                continue
            
            # Apply direction filter
            if direction and transaction.get('direction') != direction:
                continue

            # Apply flagged filter
            if is_flagged is not None:
                transaction_flagged = transaction.get('is_flagged')
                if transaction_flagged is None:
                    transaction_flagged = False
                if bool(transaction_flagged) != is_flagged:
                    continue
            
            # Apply transaction type filter
            if transaction_type:
                if transaction_type == "shared" and not transaction.get('is_shared'):
                    continue
                elif transaction_type == "refunds" and not transaction.get('is_partial_refund'):
                    continue
                elif transaction_type == "transfers" and not transaction.get('transaction_group_id'):
                    continue

            # Apply direct is_shared filter (e.g., to hide shared expenses)
            if is_shared is not None:
                transaction_is_shared = transaction.get('is_shared')
                if transaction_is_shared is None:
                    transaction_is_shared = False
                if bool(transaction_is_shared) != is_shared:
                    continue
            
            # Apply is_split filter (e.g., to exclude split transactions)
            if is_split is not None:
                transaction_is_split = transaction.get('is_split')
                if transaction_is_split is None:
                    transaction_is_split = False
                if bool(transaction_is_split) != is_split:
                    continue
            
            # Apply participants filter
            if participant_filter_values or exclude_participant_values:
                transaction_participants = get_transaction_participants(transaction)
                
                # Apply exclude participants filter first
                if exclude_participant_values:
                    if any(p in transaction_participants for p in exclude_participant_values):
                        continue
                
                # Apply include participants filter
                if participant_filter_values:
                    if not any(p in transaction_participants for p in participant_filter_values):
                        continue
            
            # Apply search filter
            if search:
                search_lower = search.lower()
                description = transaction.get('description', '').lower()
                notes = transaction.get('notes', '').lower() if transaction.get('notes') else ''
                if search_lower not in description and search_lower not in notes:
                    continue
            
            filtered_transactions.append(transaction)
        
        # If filters were applied, we now have all filtered transactions - paginate them
        # If no filters, we already have the paginated results
        if has_filters:
            # Calculate total count before pagination
            total_count = len(filtered_transactions)
            total_pages = (total_count + limit - 1) // limit if limit > 0 else 1
            
            # Apply pagination to filtered results
            start_idx = (page - 1) * limit
            end_idx = start_idx + limit
            paginated_transactions = filtered_transactions[start_idx:end_idx]
        else:
            # No filters - we already have the paginated results
            # But we need to get the total count for pagination metadata
            # Fetch total count separately (without pagination)
            if date_range_start or date_range_end:
                all_transactions_for_count = await handle_database_operation(
                    TransactionOperations.get_transactions_by_date_range,
                    start_date=date_range_start or date.min,
                    end_date=date_range_end or date.max,
                    limit=1000000,
                    offset=0,
                    order_by="DESC" if sort_direction == "desc" else "ASC"
                )
            else:
                all_transactions_for_count = await handle_database_operation(
                    TransactionOperations.get_all_transactions,
                    limit=1000000,
                    offset=0,
                    order_by="DESC" if sort_direction == "desc" else "ASC"
                )
            total_count = len(all_transactions_for_count)
            total_pages = (total_count + limit - 1) // limit if limit > 0 else 1
            paginated_transactions = filtered_transactions  # Already paginated from DB
        
        # Convert to response format
        response_transactions = [_convert_db_transaction_to_response(t) for t in paginated_transactions]
        
        return ApiResponse(
            data=response_transactions,
            pagination={
                "page": page,
                "limit": limit,
                "total": total_count,
                "total_pages": total_pages
            }
        )
        
    except Exception as e:
        logger.error(f"Failed to get transactions: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================================
# TAG ROUTES (within transactions)
# ============================================================================

@router.get("/tags/", response_model=ApiResponse)
async def get_tags():
    """Get all tags with usage counts."""
    try:
        tags = await TagOperations.get_all_tags()
        response_tags = [_convert_db_tag_to_response(t) for t in tags]
        
        return ApiResponse(data=response_tags)
        
    except Exception as e:
        logger.error(f"Failed to get tags: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/tags/search", response_model=ApiResponse)
async def search_tags(
    query: str = Query(..., description="Search query for tag names"),
    limit: int = Query(20, ge=1, le=100, description="Maximum number of results")
):
    """Search tags by name."""
    try:
        tags = await TagOperations.search_tags(query, limit)
        response_tags = [_convert_db_tag_to_response(t) for t in tags]
        
        return ApiResponse(data=response_tags)
        
    except Exception as e:
        logger.error(f"Failed to search tags: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/tags/{tag_id}", response_model=ApiResponse)
async def get_tag(tag_id: str):
    """Get a specific tag by ID."""
    try:
        tag = await TagOperations.get_tag_by_id(tag_id)
        if not tag:
            raise HTTPException(status_code=404, detail="Tag not found")
        
        response_tag = _convert_db_tag_to_response(tag)
        return ApiResponse(data=response_tag)
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get tag: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/tags/", response_model=ApiResponse, status_code=201)
async def create_tag(tag_data: TagCreate):
    """Create a new tag."""
    try:
        # Validate color format if provided
        if tag_data.color and not tag_data.color.startswith('#'):
            tag_data.color = f"#{tag_data.color}"
        
        # Ensure color is 6 hex digits
        if tag_data.color:
            # Remove # if present, then ensure it's 6 hex digits
            color_hex = tag_data.color.lstrip('#')
            if len(color_hex) == 3:
                # Expand shorthand (e.g., #FFF -> #FFFFFF)
                color_hex = ''.join(c * 2 for c in color_hex)
            if len(color_hex) != 6 or not all(c in '0123456789ABCDEFabcdef' for c in color_hex):
                raise HTTPException(status_code=400, detail=f"Invalid color format: {tag_data.color}. Expected format: #RRGGBB")
            tag_data.color = f"#{color_hex.upper()}"
        
        tag_id = await TagOperations.create_tag(
            name=tag_data.name,
            color=tag_data.color
        )
        
        return ApiResponse(data={"id": tag_id}, message="Tag created successfully")
        
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Failed to create tag: {e}")
        import traceback
        logger.error(f"Traceback: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"Failed to create tag: {str(e)}")


@router.put("/tags/{tag_id}", response_model=ApiResponse)
async def update_tag(tag_id: str, tag_data: TagUpdate):
    """Update a tag."""
    try:
        success = await TagOperations.update_tag(
            tag_id=tag_id,
            name=tag_data.name,
            color=tag_data.color
        )
        
        if not success:
            raise HTTPException(status_code=404, detail="Tag not found")
        
        return ApiResponse(message="Tag updated successfully")
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to update tag: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/tags/{tag_id}", status_code=204)
async def delete_tag(tag_id: str):
    """Delete a tag (soft delete)."""
    try:
        success = await TagOperations.delete_tag(tag_id)
        if not success:
            raise HTTPException(status_code=404, detail="Tag not found")
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to delete tag: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/tags/upsert", response_model=ApiResponse)
async def upsert_tag(tag_data: TagCreate):
    """Upsert a tag (create if not exists, update if exists)."""
    try:
        tag_id = await TagOperations.upsert_tag(
            name=tag_data.name,
            color=tag_data.color
        )
        
        return ApiResponse(data={"id": tag_id}, message="Tag upserted successfully")
        
    except Exception as e:
        logger.error(f"Failed to upsert tag: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/search", response_model=ApiResponse)
async def search_transactions(
    query: str = Query(..., description="Search query"),
    limit: int = Query(100, ge=1, le=500, description="Maximum results to return"),
    offset: int = Query(0, ge=0, description="Number of results to skip")
):
    """Search transactions by description, notes, or reference number."""
    try:
        transactions = await handle_database_operation(
            TransactionOperations.search_transactions,
            query=query,
            limit=limit,
            offset=offset
        )
        
        response_transactions = [_convert_db_transaction_to_response(t) for t in transactions]
        
        return ApiResponse(data=response_transactions)
        
    except Exception as e:
        logger.error(f"Failed to search transactions: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/field-values/{field_name}", response_model=ApiResponse)
async def get_unique_field_values(
    field_name: str,
    query: Optional[str] = Query(None, description="Filter by partial match"),
    limit: int = Query(20, ge=1, le=100, description="Maximum number of results")
):
    """Get unique values for a transaction field (for autocomplete)."""
    try:
        # Map field names from API to database column names
        field_mapping = {
            "description": "description",
            "account": "account",
            "notes": "notes",
            "paid_by": "paid_by"
        }
        
        if field_name not in field_mapping:
            raise HTTPException(status_code=400, detail=f"Field '{field_name}' not supported")
        
        db_field = field_mapping[field_name]
        
        session_factory = get_session_factory()
        session = session_factory()
        
        try:
            # Build query based on whether we have a search query
            if query:
                if field_name == "description":
                    # Smart Search for description:
                    # 1. Matches logic: COALESCE(user_description, description)
                    # 2. Ranking: Exact Match > Starts With > Contains
                    # 3. Secondary Ranking: Usage Count
                    
                    search_term = f"%{query}%"
                    
                    sql_query = text("""
                        SELECT 
                            COALESCE(user_description, description) as value,
                            COUNT(*) as usage_count
                        FROM transactions
                        WHERE 
                            COALESCE(user_description, description) IS NOT NULL 
                            AND COALESCE(user_description, description) != ''
                            AND COALESCE(user_description, description) ILIKE :search_term
                            AND is_deleted = false
                        GROUP BY 1
                        ORDER BY 
                            CASE 
                                WHEN LOWER(COALESCE(user_description, description)) = LOWER(:query) THEN 0 
                                WHEN LOWER(COALESCE(user_description, description)) LIKE LOWER(:query) || '%' THEN 1 
                                ELSE 2 
                            END,
                            usage_count DESC,
                            value ASC
                        LIMIT :limit
                    """)
                    
                    result = await session.execute(
                        sql_query, 
                        {"search_term": search_term, "query": query, "limit": limit}
                    )
                else:
                    # Standard behavior for other fields
                    sql_query = text(f"""
                        SELECT DISTINCT {db_field} as value
                        FROM transactions
                        WHERE {db_field} IS NOT NULL 
                        AND {db_field} != ''
                        AND LOWER({db_field}) LIKE LOWER(:query)
                        AND is_deleted = false
                        ORDER BY {db_field}
                        LIMIT :limit
                    """)
                    result = await session.execute(
                        sql_query, 
                        {"query": f"%{query}%", "limit": limit}
                    )
            else:
                target_field = f"COALESCE(user_description, description)" if field_name == "description" else db_field
                
                sql_query = text(f"""
                    SELECT DISTINCT {target_field} as value, COUNT(*) as usage_count
                    FROM transactions
                    WHERE {target_field} IS NOT NULL 
                    AND {target_field} != ''
                    AND is_deleted = false
                    GROUP BY 1
                    ORDER BY usage_count DESC, value ASC
                    LIMIT :limit
                """)
                result = await session.execute(sql_query, {"limit": limit})
            
            rows = result.fetchall()
            values = [row.value for row in rows]
            
            return ApiResponse(data=values)
            
        finally:
            await session.close()
            
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get unique field values for {field_name}: {e}")

@router.get("/predict-category", response_model=ApiResponse)
async def predict_category(
    description: str = Query(..., description="Details to predict category from")
):
    """Predict category based on transaction description."""
    try:
        prediction = await TransactionOperations.predict_category(description)
        return ApiResponse(data=prediction)
    except Exception as e:
        logger.error(f"Failed to predict category: {e}")
        # Return null data instead of error for prediction
        return ApiResponse(data=None, message=str(e))


@router.get("/analytics", response_model=ApiResponse)
async def get_expense_analytics(
    date_range_start: Optional[date] = Query(None, description="Start date for filtering"),
    date_range_end: Optional[date] = Query(None, description="End date for filtering"),
    accounts: Optional[str] = Query(None, description="Comma-separated account names"),
    exclude_accounts: Optional[str] = Query(None, description="Comma-separated account names to exclude"),
    categories: Optional[str] = Query(None, description="Comma-separated category names"),
    exclude_categories: Optional[str] = Query(None, description="Comma-separated category names to exclude"),
    tags: Optional[str] = Query(None, description="Comma-separated tag names"),
    exclude_tags: Optional[str] = Query(None, description="Comma-separated tag names to exclude"),
    direction: Optional[str] = Query("debit", pattern="^(debit|credit)$", description="Transaction direction"),
    group_by: str = Query("category", description="Group by: category, tag, month, account, category_month, tag_month")
):
    """Get expense analytics aggregated by various dimensions."""
    try:
        # Parse filter values
        account_filter_values = [account.strip() for account in accounts.split(',')] if accounts else []
        account_filter_values = [account for account in account_filter_values if account]
        exclude_account_values = [account.strip() for account in exclude_accounts.split(',')] if exclude_accounts else []
        exclude_account_values = [account for account in exclude_account_values if account]
        
        category_filter_values = [category.strip() for category in categories.split(',')] if categories else []
        category_filter_values = [category for category in category_filter_values if category]
        exclude_category_values = [category.strip() for category in exclude_categories.split(',')] if exclude_categories else []
        exclude_category_values = [category for category in exclude_category_values if category]
        
        tag_filter_values = [tag.strip() for tag in tags.split(',')] if tags else []
        tag_filter_values = [tag for tag in tag_filter_values if tag]
        exclude_tag_values = [tag.strip() for tag in exclude_tags.split(',')] if exclude_tags else []
        exclude_tag_values = [tag for tag in exclude_tag_values if tag]
        
        # Validate group_by
        valid_group_by = ["category", "tag", "month", "account", "category_month", "tag_month", "tag_category"]
        if group_by not in valid_group_by:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid group_by. Must be one of: {', '.join(valid_group_by)}"
            )
        
        # Get analytics data
        analytics_data = await handle_database_operation(
            TransactionOperations.get_expense_analytics,
            start_date=date_range_start,
            end_date=date_range_end,
            accounts=account_filter_values if account_filter_values else None,
            exclude_accounts=exclude_account_values if exclude_account_values else None,
            categories=category_filter_values if category_filter_values else None,
            exclude_categories=exclude_category_values if exclude_category_values else None,
            tags=tag_filter_values if tag_filter_values else None,
            exclude_tags=exclude_tag_values if exclude_tag_values else None,
            direction=direction,
            group_by=group_by
        )
        
        return ApiResponse(data=analytics_data)
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get expense analytics: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/suggestions/transfers", response_model=ApiResponse)
async def get_transfer_suggestions(
    days_back: int = Query(30, ge=1, le=365, description="Days to look back for transactions"),
    min_amount: float = Query(10.0, ge=0.01, description="Minimum transaction amount"),
    max_time_diff_hours: int = Query(24, ge=1, le=168, description="Maximum time difference in hours")
):
    """Get suggestions for potential transfer pairs."""
    try:
        suggestions = await SuggestionOperations.find_transfer_suggestions(
            days_back=days_back,
            min_amount=min_amount,
            max_time_diff_hours=max_time_diff_hours
        )
        
        # Convert to response format
        response_suggestions = []
        for suggestion in suggestions:
            response_suggestions.append(TransferSuggestion(
                transactions=suggestion["transactions"],
                confidence=suggestion["confidence"],
                reason=suggestion["reason"]
            ))
        
        return ApiResponse(data=response_suggestions)
        
    except Exception as e:
        logger.error(f"Failed to get transfer suggestions: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/suggestions/refunds", response_model=ApiResponse)
async def get_refund_suggestions(
    days_back: int = Query(90, ge=1, le=365, description="Days to look back for transactions"),
    min_amount: float = Query(5.0, ge=0.01, description="Minimum transaction amount")
):
    """Get suggestions for potential refund pairs."""
    try:
        # Simplified refund suggestions - would need full implementation
        suggestions = []
        
        return ApiResponse(data=suggestions)
        
    except Exception as e:
        logger.error(f"Failed to get refund suggestions: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/suggestions/summary", response_model=ApiResponse)
async def get_suggestions_summary():
    """Get summary of available suggestions."""
    try:
        # Get counts of potential suggestions
        transfer_suggestions = await SuggestionOperations.find_transfer_suggestions(days_back=30)
        
        # Calculate confidence distribution
        transfer_confidences = [s["confidence"] for s in transfer_suggestions]
        
        summary = {
            "transfer_suggestions": {
                "count": len(transfer_suggestions),
                "high_confidence": len([c for c in transfer_confidences if c > 0.7]),
                "medium_confidence": len([c for c in transfer_confidences if 0.4 <= c <= 0.7]),
                "low_confidence": len([c for c in transfer_confidences if c < 0.4])
            },
            "refund_suggestions": {
                "count": 0,
                "high_confidence": 0,
                "medium_confidence": 0,
                "low_confidence": 0
            },
            "last_updated": datetime.now().isoformat()
        }
        
        return ApiResponse(data=summary)
        
    except Exception as e:
        logger.error(f"Failed to get suggestions summary: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{transaction_id}", response_model=ApiResponse)
async def get_transaction(transaction_id: str):
    """Get a single transaction by ID."""
    try:
        transaction = await handle_database_operation(
            TransactionOperations.get_transaction_by_id,
            transaction_id
        )
        if not transaction:
            raise HTTPException(status_code=404, detail="Transaction not found")
        
        # Get tags for the transaction
        transaction_tags = await TagOperations.get_tags_for_transaction(transaction_id)
        tag_names = [tag['name'] for tag in transaction_tags]
        transaction['tags'] = tag_names
        
        response_transaction = _convert_db_transaction_to_response(transaction)
        return ApiResponse(data=response_transaction)
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get transaction {transaction_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{transaction_id}/related", response_model=ApiResponse)
async def get_related_transactions(transaction_id: str):
    """Get all related transactions for a transaction (parent, children, and group members)."""
    try:
        # Get the transaction first
        transaction = await handle_database_operation(
            TransactionOperations.get_transaction_by_id,
            transaction_id
        )
        if not transaction:
            raise HTTPException(status_code=404, detail="Transaction not found")
        
        related_data = {
            "transaction": _convert_db_transaction_to_response(transaction),
            "parent": None,
            "children": [],
            "group": []
        }
        
        # Get parent transaction if this is a child (refund)
        if transaction.get('link_parent_id'):
            parent = await handle_database_operation(
                TransactionOperations.get_transaction_by_id,
                str(transaction.get('link_parent_id'))
            )
            if parent:
                # Get tags for parent
                parent_tags = await TagOperations.get_tags_for_transaction(str(parent.get('id')))
                parent['tags'] = [tag['name'] for tag in parent_tags]
                related_data["parent"] = _convert_db_transaction_to_response(parent)
        
        # Get child transactions if this is a parent
        children = await handle_database_operation(
            TransactionOperations.get_child_transactions,
            transaction_id
        )
        if children:
            # Tags are already included in get_child_transactions
            related_data["children"] = [_convert_db_transaction_to_response(t) for t in children]
        
        # Get group members if this transaction is in a group
        if transaction.get('transaction_group_id'):
            group_members = await handle_database_operation(
                TransactionOperations.get_transfer_group_transactions,
                str(transaction.get('transaction_group_id'))
            )
            if group_members:
                # Tags are already included in get_transfer_group_transactions
                related_data["group"] = [_convert_db_transaction_to_response(t) for t in group_members]
        
        return ApiResponse(data=related_data)
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get related transactions for {transaction_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{transaction_id}/parent", response_model=ApiResponse)
async def get_parent_transaction(transaction_id: str):
    """Get the parent transaction for a refund/child transaction."""
    try:
        transaction = await handle_database_operation(
            TransactionOperations.get_transaction_by_id,
            transaction_id
        )
        if not transaction:
            raise HTTPException(status_code=404, detail="Transaction not found")
        
        if not transaction.get('link_parent_id'):
            raise HTTPException(status_code=404, detail="This transaction does not have a parent")
        
        parent = await handle_database_operation(
            TransactionOperations.get_transaction_by_id,
            str(transaction.get('link_parent_id'))
        )
        if not parent:
            raise HTTPException(status_code=404, detail="Parent transaction not found")
        
        # Get tags for parent
        parent_tags = await TagOperations.get_tags_for_transaction(str(parent.get('id')))
        parent['tags'] = [tag['name'] for tag in parent_tags]
        
        response_transaction = _convert_db_transaction_to_response(parent)
        return ApiResponse(data=response_transaction)
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get parent transaction for {transaction_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{transaction_id}/children", response_model=ApiResponse)
async def get_child_transactions(transaction_id: str):
    """Get all child transactions (refunds/adjustments) for a parent transaction."""
    try:
        children = await handle_database_operation(
            TransactionOperations.get_child_transactions,
            transaction_id
        )
        
        # Tags are already included in get_child_transactions
        response_transactions = [_convert_db_transaction_to_response(t) for t in children]
        return ApiResponse(data=response_transactions)
        
    except Exception as e:
        logger.error(f"Failed to get child transactions for {transaction_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{transaction_id}/group", response_model=ApiResponse)
async def get_group_transactions(transaction_id: str):
    """Get all transactions in the same group (transfer or split group)."""
    try:
        transaction = await handle_database_operation(
            TransactionOperations.get_transaction_by_id,
            transaction_id
        )
        if not transaction:
            raise HTTPException(status_code=404, detail="Transaction not found")
        
        if not transaction.get('transaction_group_id'):
            raise HTTPException(status_code=404, detail="This transaction is not in a group")
        
        group_members = await handle_database_operation(
            TransactionOperations.get_transfer_group_transactions,
            str(transaction.get('transaction_group_id'))
        )
        
        # Tags are already included in get_transfer_group_transactions
        response_transactions = [_convert_db_transaction_to_response(t) for t in group_members]
        return ApiResponse(data=response_transactions)
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get group transactions for {transaction_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/", response_model=ApiResponse, status_code=201)
async def create_transaction(transaction_data: TransactionCreate):
    """Create a new transaction."""
    try:
        transaction_id = await handle_database_operation(
            TransactionOperations.create_transaction,
            transaction_date=transaction_data.date,
            amount=transaction_data.amount,
            direction=transaction_data.direction,
            transaction_type="purchase",  # Default type
            account=transaction_data.account,
            category=transaction_data.category,
            description=transaction_data.description,
            transaction_time=None,  # Could be extracted from date if needed
            split_share_amount=transaction_data.split_share_amount,
            is_partial_refund=transaction_data.is_refund,
            is_shared=transaction_data.is_shared,
            split_breakdown=transaction_data.split_breakdown,
            sub_category=transaction_data.subcategory,
            tags=transaction_data.tags,
            notes=transaction_data.notes,
            reference_number=None,
            related_mails=transaction_data.related_mails,
            source_file=transaction_data.source_file,
            raw_data=transaction_data.raw_data,
            link_parent_id=transaction_data.link_parent_id,
            transaction_group_id=transaction_data.transaction_group_id
        )
        
        # Fetch the created transaction
        created_transaction = await handle_database_operation(
            TransactionOperations.get_transaction_by_id,
            transaction_id
        )
        response_transaction = _convert_db_transaction_to_response(created_transaction)
        
        return ApiResponse(data=response_transaction, message="Transaction created successfully")
        
    except Exception as e:
        logger.error(f"Failed to create transaction: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.patch("/bulk-update", response_model=ApiResponse)
async def bulk_update_transactions(request: BulkTransactionUpdate):
    """Bulk update multiple transactions with the same changes."""
    try:
        updated_transactions = []
        failed_updates = []
        
        for transaction_id in request.transaction_ids:
            try:
                # Convert updates to database format
                update_data = {}
                for field, value in request.updates.model_dump(exclude_unset=True).items():
                    if field == "date":
                        update_data["transaction_date"] = value
                    elif field == "subcategory":
                        update_data["sub_category"] = value
                    elif field == "is_refund":
                        update_data["is_partial_refund"] = value
                    elif field == "is_transfer":
                        # This would need special handling for transfer groups
                        continue
                    elif field == "category":
                        # Handle category - could be either name or ID
                        if value:
                            # Check if it's a UUID (category ID) or a name
                            try:
                                # Try to parse as UUID - if successful, it's an ID
                                from uuid import UUID
                                UUID(value)
                                # It's a valid UUID, use it directly
                                logger.info(f"Using category ID directly: {value}")
                                update_data["category_id"] = value
                            except (ValueError, AttributeError):
                                # It's a category name, look it up
                                logger.info(f"Looking up category by name: {value}")
                                category = await CategoryOperations.get_category_by_name(value)
                                if category:
                                    logger.info(f"Found category ID: {category['id']}")
                                    update_data["category_id"] = category["id"]
                                else:
                                    logger.warning(f"Category not found: {value}")
                    else:
                        update_data[field] = value
                
                # Handle soft delete: set deleted_at when is_deleted is set to true
                if "is_deleted" in update_data and update_data["is_deleted"] is True:
                    from datetime import datetime
                    update_data["deleted_at"] = datetime.now()
                elif "is_deleted" in update_data and update_data["is_deleted"] is False:
                    # If restoring, clear deleted_at
                    update_data["deleted_at"] = None
                
                # Extract paid_by from split_breakdown if present
                if "split_breakdown" in update_data:
                    split_breakdown = update_data["split_breakdown"]
                    if split_breakdown and isinstance(split_breakdown, dict):
                        if "paid_by" in split_breakdown and "paid_by" not in update_data:
                            update_data["paid_by"] = split_breakdown["paid_by"]
                
                # Handle tags separately - remove from update_data to handle via TagOperations
                tag_names = None
                if "tags" in update_data:
                    tag_names = update_data.pop("tags")
                
                # Update the transaction (only if there are other fields to update)
                success = True  # Default to True if only tags are being updated
                if update_data:  # Only call update_transaction if there are other fields to update
                    success = await TransactionOperations.update_transaction(
                        transaction_id,
                        **update_data
                    )
                    if not success:
                        logger.warning(f"Transaction update failed for {transaction_id}, update_data: {update_data}")
                else:
                    logger.info(f"Only tags update for transaction {transaction_id}, skipping update_transaction call")
                
                if success:
                    # Handle tags if provided
                    if tag_names is not None:
                        tag_ids = []
                        # Ensure tag_names is a list
                        if not isinstance(tag_names, list):
                            logger.warning(f"tags field is not a list: {type(tag_names)}, value: {tag_names}")
                            tag_names = []
                        
                        for tag_name in tag_names:
                            if not tag_name or not isinstance(tag_name, str):
                                logger.warning(f"Invalid tag name: {tag_name}")
                                continue
                                
                            tag = await TagOperations.get_tag_by_name(tag_name)
                            if tag:
                                tag_ids.append(tag["id"])
                            else:
                                # Create tag if it doesn't exist (with default color)
                                # Generate a random color for new tags
                                import random
                                colors = [
                                    "#ef4444", "#f97316", "#f59e0b", "#eab308", "#84cc16",
                                    "#22c55e", "#10b981", "#14b8a6", "#06b6d4", "#0ea5e9",
                                    "#3b82f6", "#6366f1", "#8b5cf6", "#a855f7", "#d946ef",
                                    "#ec4899", "#f43f5e"
                                ]
                                default_color = random.choice(colors)
                                try:
                                    new_tag_id = await TagOperations.create_tag(
                                        name=tag_name,
                                        color=default_color
                                    )
                                    if new_tag_id:
                                        tag_ids.append(new_tag_id)
                                except ValueError as e:
                                    # Tag might have been created by another concurrent request
                                    logger.warning(f"Tag creation failed (may already exist): {e}")
                                    # Try to fetch it again
                                    tag = await TagOperations.get_tag_by_name(tag_name)
                                    if tag:
                                        tag_ids.append(tag["id"])
                                except Exception as e:
                                    logger.error(f"Failed to create tag '{tag_name}': {e}")
                                    import traceback
                                    logger.error(f"Traceback: {traceback.format_exc()}")
                                    # Continue with other tags even if one fails
                        
                        # Set tags for the transaction (even if empty list - this clears tags)
                        await TagOperations.set_transaction_tags(transaction_id, tag_ids)
                    
                    # Fetch the updated transaction
                    updated_transaction = await TransactionOperations.get_transaction_by_id(transaction_id)
                    if updated_transaction:
                        # Get tags for the transaction
                        transaction_tags = await TagOperations.get_tags_for_transaction(transaction_id)
                        tag_names = [tag['name'] for tag in transaction_tags]
                        updated_transaction['tags'] = tag_names
                        
                        response_transaction = _convert_db_transaction_to_response(updated_transaction)
                        updated_transactions.append(response_transaction)
                else:
                    failed_updates.append(transaction_id)
                    
            except Exception as e:
                logger.error(f"Failed to update transaction {transaction_id}: {e}")
                failed_updates.append(transaction_id)
        
        if failed_updates:
            return ApiResponse(
                data={
                    "updated_transactions": updated_transactions,
                    "failed_transaction_ids": failed_updates,
                    "success_count": len(updated_transactions),
                    "failure_count": len(failed_updates)
                },
                message=f"Bulk update completed with {len(updated_transactions)} successes and {len(failed_updates)} failures"
            )
        else:
            return ApiResponse(
                data=updated_transactions,
                message=f"Successfully updated {len(updated_transactions)} transactions"
            )
        
    except Exception as e:
        logger.error(f"Failed to bulk update transactions: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.patch("/{transaction_id}", response_model=ApiResponse)
async def update_transaction(transaction_id: str, updates: TransactionUpdate):
    """Update a transaction."""
    try:
        # Convert updates to database format
        update_data = {}
        for field, value in updates.model_dump(exclude_unset=True).items():
            if field == "date":
                update_data["transaction_date"] = value
            elif field == "subcategory":
                update_data["sub_category"] = value
            elif field == "is_refund":
                update_data["is_partial_refund"] = value
            elif field == "is_transfer":
                # This would need special handling for transfer groups
                continue
            else:
                update_data[field] = value
        
        # Handle soft delete: set deleted_at when is_deleted is set to true
        if "is_deleted" in update_data and update_data["is_deleted"] is True:
            from datetime import datetime
            update_data["deleted_at"] = datetime.now()
        elif "is_deleted" in update_data and update_data["is_deleted"] is False:
            # If restoring, clear deleted_at
            update_data["deleted_at"] = None
        
        # Auto-calculate split_share_amount if split_breakdown is provided but split_share_amount is not
        # Also extract paid_by from split_breakdown if present
        if "split_breakdown" in update_data:
            split_breakdown = update_data["split_breakdown"]
            if split_breakdown and isinstance(split_breakdown, dict):
                # Extract paid_by from split_breakdown and store it as a top-level field
                if "paid_by" in split_breakdown and "paid_by" not in update_data:
                    update_data["paid_by"] = split_breakdown["paid_by"]
                
                # Calculate split_share_amount if not provided
                if "split_share_amount" not in update_data:
                    # Get the transaction to access the total amount
                    current_transaction = await handle_database_operation(
                        TransactionOperations.get_transaction_by_id,
                        transaction_id
                    )
                    if current_transaction:
                        total_amount = float(current_transaction.get('amount', 0))
                        split_share_amount = _calculate_split_share_amount(split_breakdown, total_amount)
                        update_data["split_share_amount"] = split_share_amount
        
        # Handle tags separately - remove from update_data to handle via TagOperations
        tag_names = None
        if "tags" in update_data:
            tag_names = update_data.pop("tags")
        
        # Handle tags if provided - convert tag names to tag IDs
        if tag_names is not None:
            tag_ids = []
            for tag_name in tag_names:
                tag = await TagOperations.get_tag_by_name(tag_name)
                if tag:
                    tag_ids.append(tag["id"])
            await TagOperations.set_transaction_tags(transaction_id, tag_ids)
        
        # Update transaction fields if any (excluding tags which are handled above)
        success = True  # Default to success if no fields to update
        if update_data:
            success = await handle_database_operation(
                TransactionOperations.update_transaction,
                transaction_id,
                **update_data
            )
        
        if not success:
            raise HTTPException(status_code=404, detail="Transaction not found or update failed")
        
        # Fetch the updated transaction with tags
        updated_transaction = await handle_database_operation(
            TransactionOperations.get_transaction_by_id,
            transaction_id
        )
        # Get tags for the transaction
        transaction_tags = await TagOperations.get_tags_for_transaction(transaction_id)
        tag_names = [tag['name'] for tag in transaction_tags]
        updated_transaction['tags'] = tag_names
        
        response_transaction = _convert_db_transaction_to_response(updated_transaction)
        
        return ApiResponse(data=response_transaction, message="Transaction updated successfully")
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to update transaction {transaction_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/{transaction_id}", status_code=204)
async def delete_transaction(transaction_id: str):
    """Delete a transaction."""
    try:
        success = await handle_database_operation(
            TransactionOperations.delete_transaction,
            transaction_id
        )
        if not success:
            raise HTTPException(status_code=404, detail="Transaction not found")
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to delete transaction {transaction_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/link-refund", response_model=ApiResponse)
async def link_refund(request: LinkRefundRequest):
    """Link a refund transaction to its parent transaction."""
    try:
        # Update the child transaction to link to parent
        success = await TransactionOperations.update_transaction(
            request.child_id,
            link_parent_id=request.parent_id,
            is_partial_refund=True
        )
        
        if not success:
            raise HTTPException(status_code=404, detail="Child transaction not found or update failed")
        
        # Fetch the updated transaction
        updated_transaction = await TransactionOperations.get_transaction_by_id(request.child_id)
        response_transaction = _convert_db_transaction_to_response(updated_transaction)
        
        return ApiResponse(data=response_transaction, message="Refund linked successfully")
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to link refund: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/group-transfer", response_model=ApiResponse)
async def group_transfer(request: GroupTransferRequest):
    """Group transactions as a transfer."""
    try:
        import uuid
        
        # Generate a transfer group ID
        transaction_group_id = str(uuid.uuid4())
        
        # Update all transactions to have the same transfer group ID
        updated_transactions = []
        for transaction_id in request.transaction_ids:
            success = await TransactionOperations.update_transaction(
                transaction_id,
                transaction_group_id=transaction_group_id
            )
            if success:
                transaction = await TransactionOperations.get_transaction_by_id(transaction_id)
                updated_transactions.append(_convert_db_transaction_to_response(transaction))
        
        return ApiResponse(data=updated_transactions, message="Transfer grouped successfully")
        
    except Exception as e:
        logger.error(f"Failed to group transfer: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/group-expense", response_model=ApiResponse)
async def group_expense(request: GroupExpenseRequest):
    """
    Group multiple transactions into a single collapsed expense.
    
    Creates a new collapsed transaction with:
    - Net amount calculated from all grouped transactions (credits - debits)
    - All individual transactions linked via transaction_group_id
    - Individual transactions hidden from main view
    - Collapsed transaction can be shared/split like any other transaction
    """
    try:
        import uuid
        from decimal import Decimal
        
        # Validate all transactions exist
        transactions = []
        for transaction_id in request.transaction_ids:
            transaction = await handle_database_operation(
                TransactionOperations.get_transaction_by_id,
                transaction_id
            )
            if not transaction:
                raise HTTPException(status_code=404, detail=f"Transaction {transaction_id} not found")
            
            # Check if transaction is already in a grouped expense (but allow transfers and splits)
            if transaction.get('transaction_group_id') and transaction.get('is_grouped_expense'):
                raise HTTPException(
                    status_code=400,
                    detail=f"Transaction {transaction_id} is already a grouped expense."
                )
            
            # Check if transaction is part of a group but not the collapsed one
            if transaction.get('transaction_group_id') and not transaction.get('is_split') and not transaction.get('is_grouped_expense'):
                # It's in a transfer group or is an individual in an expense group
                raise HTTPException(
                    status_code=400,
                    detail=f"Transaction {transaction_id} is already in a group. Ungroup it first."
                )
            
            transactions.append(transaction)
        
        if not transactions:
            raise HTTPException(status_code=400, detail="No valid transactions to group")
        
        # Generate a group ID
        transaction_group_id = str(uuid.uuid4())
        
        # Calculate net amount
        # Credits are positive, debits are negative (algebraic sum)
        net_amount = Decimal('0')
        earliest_date = None
        
        for transaction in transactions:
            # For transactions with refunds, use net_amount; otherwise use amount
            amount = transaction.get('net_amount') or transaction.get('amount', 0)
            
            # For shared/split transactions, use split_share_amount if available
            if transaction.get('is_shared') and transaction.get('split_share_amount'):
                amount = transaction.get('split_share_amount')
            
            # Convert to Decimal for accurate calculation
            amount = Decimal(str(amount))
            
            # Credits are positive, debits are negative
            if transaction.get('direction') == 'credit':
                net_amount += amount
            else:  # debit
                net_amount -= amount
            
            # Track earliest date
            tx_date = transaction.get('transaction_date')
            if earliest_date is None or (tx_date and tx_date < earliest_date):
                earliest_date = tx_date
        
        # Determine direction based on net amount
        # Positive net = credit, Negative net = debit
        if net_amount >= 0:
            direction = 'credit'
            amount_abs = net_amount
        else:
            direction = 'debit'
            amount_abs = -net_amount
        
        # Update all individual transactions with the group ID
        updated_transactions = []
        for transaction in transactions:
            success = await handle_database_operation(
                TransactionOperations.update_transaction,
                str(transaction.get('id')),
                transaction_group_id=transaction_group_id
            )
            if success:
                updated_tx = await handle_database_operation(
                    TransactionOperations.get_transaction_by_id,
                    str(transaction.get('id'))
                )
                updated_transactions.append(_convert_db_transaction_to_response(updated_tx))
        
        # Determine category
        category = request.category if request.category else transactions[0].get('category')
        
        # Determine account (use first transaction's account)
        account = transactions[0].get('account', '')
        
        # Create the collapsed transaction
        collapsed_transaction_id = await handle_database_operation(
            TransactionOperations.create_transaction,
            transaction_date=earliest_date,
            amount=amount_abs,
            direction=direction,
            transaction_type="purchase",  # Use valid transaction type; is_grouped_expense=True marks it as grouped
            account=account,
            category=category,
            description=request.description,
            transaction_time=None,
            split_share_amount=None,
            is_partial_refund=False,
            is_shared=False,
            is_split=False,
            split_breakdown=None,
            sub_category=None,
            tags=[],
            notes=f"Grouped expense containing {len(transactions)} transactions",
            reference_number=None,
            related_mails=[],
            source_file=None,
            raw_data=None,
            link_parent_id=None,
            transaction_group_id=transaction_group_id,
            is_grouped_expense=True
        )
        
        # Fetch the created collapsed transaction
        collapsed_transaction = await handle_database_operation(
            TransactionOperations.get_transaction_by_id,
            collapsed_transaction_id
        )
        
        return ApiResponse(
            data={
                "collapsed_transaction": _convert_db_transaction_to_response(collapsed_transaction),
                "grouped_transactions": updated_transactions,
                "net_amount": float(net_amount),
                "transaction_group_id": transaction_group_id
            },
            message=f"Successfully grouped {len(transactions)} transactions into a single expense"
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to group expense: {e}")
        logger.error(traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/ungroup-expense", response_model=ApiResponse)
async def ungroup_expense(request: UngroupExpenseRequest):
    """
    Ungroup expense transactions.
    
    - Deletes the collapsed transaction (where is_grouped_expense = True)
    - Removes transaction_group_id from all individual transactions
    - Individual transactions become visible again in the main view
    """
    try:
        session_factory = get_session_factory()
        session = session_factory()
        
        try:
            # Get all transactions in the group
            result = await session.execute(
                text("""
                    SELECT id, is_grouped_expense
                    FROM transactions
                    WHERE transaction_group_id = :group_id
                    AND is_deleted = false
                """),
                {"group_id": request.transaction_group_id}
            )
            transactions = result.fetchall()
            
            if not transactions:
                raise HTTPException(status_code=404, detail="Grouped expense not found")
            
            # Find the collapsed transaction and individual transactions
            collapsed_transaction_id = None
            individual_transaction_ids = []
            
            for t in transactions:
                if t.is_grouped_expense:
                    collapsed_transaction_id = str(t.id)
                else:
                    individual_transaction_ids.append(str(t.id))
            
            # Delete the collapsed transaction if it exists
            if collapsed_transaction_id:
                await handle_database_operation(
                    TransactionOperations.delete_transaction,
                    collapsed_transaction_id
                )
            
            # Remove group_id from all individual transactions
            restored_transactions = []
            for transaction_id in individual_transaction_ids:
                success = await handle_database_operation(
                    TransactionOperations.update_transaction,
                    transaction_id,
                    transaction_group_id=None
                )
                if success:
                    restored = await handle_database_operation(
                        TransactionOperations.get_transaction_by_id,
                        transaction_id
                    )
                    restored_transactions.append(_convert_db_transaction_to_response(restored))
            
            return ApiResponse(
                data={
                    "restored_transactions": restored_transactions,
                    "deleted_collapsed": collapsed_transaction_id is not None
                },
                message=f"Ungrouped expense. {len(restored_transactions)} transactions restored."
            )
            
        finally:
            await session.close()
            
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to ungroup expense: {e}")
        logger.error(traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))


class UngroupSplitRequest(BaseModel):
    """Request model for ungrouping split transactions."""
    transaction_group_id: str


@router.post("/ungroup-split", response_model=ApiResponse)
async def ungroup_split_transactions(request: UngroupSplitRequest):
    """
    Ungroup split transactions and restore the original.
    
    Strategy:
    - If original transaction exists in group (wasn't deleted), restore it
    - Delete all split part transactions
    - If original was deleted during split, there's nothing to restore
    """
    try:
        session_factory = get_session_factory()
        session = session_factory()
        
        try:
            # Get all transactions in the split group (both parent and children)
            result = await session.execute(
                text("""
                    SELECT id, description, amount, created_at, is_split
                    FROM transactions
                    WHERE transaction_group_id = :group_id
                    ORDER BY created_at ASC
                """),
                {"group_id": request.transaction_group_id}
            )
            transactions = result.fetchall()
            
            if not transactions:
                raise HTTPException(status_code=404, detail="Split group not found")
            
            # Find the parent transaction (is_split=false) and split parts (is_split=true)
            original_transaction = None
            split_parts = []
            
            for t in transactions:
                # Parent transaction has is_split=false
                if not t.is_split:
                        original_transaction = t
                else:
                    # Child transactions have is_split=true
                    split_parts.append(t)
            
            # Delete all split parts (children)
            for split_part in split_parts:
                await handle_database_operation(
                    TransactionOperations.delete_transaction,
                    str(split_part.id)
                )
            
            # Restore the original transaction if it exists
            if original_transaction:
                await handle_database_operation(
                    TransactionOperations.update_transaction,
                    str(original_transaction.id),
                    is_split=False,
                    transaction_group_id=None
                )
                
                # Fetch the restored transaction
                restored = await handle_database_operation(
                    TransactionOperations.get_transaction_by_id,
                    str(original_transaction.id)
                )
                
                return ApiResponse(
                    data=_convert_db_transaction_to_response(restored),
                    message=f"Split removed. Original transaction restored. {len(split_parts)} split parts deleted."
                )
            else:
                return ApiResponse(
                    data={"deleted_count": len(split_parts)},
                    message=f"Split removed. {len(split_parts)} split parts deleted. Original was not in the group."
                )
                
        finally:
            await session.close()
            
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to ungroup split transactions: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/split-transaction", response_model=ApiResponse)
async def split_transaction(request: SplitTransactionRequest):
    """Split a transaction into multiple parts."""
    try:
        import uuid
        
        # Get the original transaction
        original_transaction = await handle_database_operation(
            TransactionOperations.get_transaction_by_id,
            request.transaction_id
        )
        
        if not original_transaction:
            raise HTTPException(status_code=404, detail="Transaction not found")
        
        # Validate that the sum of parts equals the original amount
        # For shared transactions, validate against split_share_amount (the user's share)
        # For regular transactions, validate against the full amount
        total_parts_amount = sum(part.amount for part in request.parts)
        is_shared = original_transaction.get('is_shared', False)
        split_share_amount = original_transaction.get('split_share_amount')
        
        if is_shared and split_share_amount is not None:
            # Splitting a shared transaction - validate against the user's share
            expected_amount = abs(float(split_share_amount))
        else:
            # Splitting a regular transaction - validate against the full amount
            expected_amount = abs(float(original_transaction.get('amount', 0)))
        
        if abs(float(total_parts_amount) - expected_amount) > 0.01:  # Allow small floating point differences
            raise HTTPException(
                status_code=400, 
                detail=f"Sum of split parts ({total_parts_amount}) does not equal expected amount ({expected_amount})"
            )
        
        # Generate a transaction group ID for the split
        split_group_id = str(uuid.uuid4())
        
        # Create new transactions for each split part
        created_transactions = []
        
        # Preserve shared transaction properties if applicable
        original_is_shared = original_transaction.get('is_shared', False)
        original_split_breakdown = original_transaction.get('split_breakdown')
        original_paid_by = original_transaction.get('paid_by')
        
        for part in request.parts:
            try:
                # For shared transactions, each split part inherits the shared properties
                # but with a new split_breakdown that represents just this portion
                if original_is_shared and original_split_breakdown:
                    # This part represents a portion of the user's share
                    # Create a simplified split_breakdown showing that:
                    # - Total amount is the part amount
                    # - User's share is the full part amount (since we're splitting their share)
                    # - Original payer information is preserved
                    part_split_share_amount = part.amount
                    part_is_shared = True
                    
                    # Create a split_breakdown with just "me" as participant for this part
                    # This ensures settlement calculations work correctly
                    # Convert amount to float to ensure JSON serialization works
                    part_split_breakdown = {
                        "mode": "custom",
                        "include_me": True,
                        "entries": [
                            {"participant": "me", "amount": float(part.amount)}
                        ],
                        "paid_by": original_paid_by,
                        "total_participants": 1
                    }
                else:
                    part_split_share_amount = None
                    part_is_shared = False
                    part_split_breakdown = None
                
                # Create the split transaction with the same base properties as the original
                transaction_id = await handle_database_operation(
                    TransactionOperations.create_transaction,
                    transaction_date=original_transaction.get('transaction_date'),
                    amount=part.amount,
                    direction=original_transaction.get('direction'),
                    transaction_type=original_transaction.get('transaction_type', 'purchase'),
                    account=original_transaction.get('account'),
                    category=part.category or original_transaction.get('category'),
                    description=part.description,
                    transaction_time=original_transaction.get('transaction_time'),
                    split_share_amount=part_split_share_amount,
                    is_partial_refund=False,
                    is_shared=part_is_shared,
                    is_split=True,  # Mark as a split transaction
                    split_breakdown=part_split_breakdown,
                    paid_by=original_paid_by if original_is_shared else None,
                    sub_category=part.subcategory or original_transaction.get('sub_category'),
                    tags=part.tags,
                    notes=part.notes,
                    reference_number=original_transaction.get('reference_number'),
                    related_mails=original_transaction.get('related_mails', []),
                    source_file=original_transaction.get('source_file'),
                    raw_data=None,  # Don't copy raw_data to split transactions to avoid serialization issues
                    link_parent_id=None,
                    transaction_group_id=split_group_id
                )
                
                # Fetch the created transaction
                created_transaction = await handle_database_operation(
                    TransactionOperations.get_transaction_by_id,
                    transaction_id
                )
                created_transactions.append(_convert_db_transaction_to_response(created_transaction))
                
            except Exception as e:
                logger.error(f"Failed to create split part {part.description} (amount: {part.amount}): {e}")
                # Continue with other parts even if one fails
                continue
        
        # Handle original transaction
        if request.delete_original:
            # Delete the original transaction
            await handle_database_operation(
                TransactionOperations.delete_transaction,
                request.transaction_id
            )
        else:
            # Add the original transaction to the group but keep is_split=False
            # This allows us to identify it as the parent transaction
            await handle_database_operation(
                TransactionOperations.update_transaction,
                request.transaction_id,
                is_split=False,  # Keep as False to identify as parent
                transaction_group_id=split_group_id
            )
            # Fetch the updated original transaction
            updated_original = await handle_database_operation(
                TransactionOperations.get_transaction_by_id,
                request.transaction_id
            )
            created_transactions.insert(0, _convert_db_transaction_to_response(updated_original))
        
        return ApiResponse(
            data={
                "split_group_id": split_group_id,
                "transactions": created_transactions
            },
            message=f"Transaction split successfully into {len(created_transactions)} parts"
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to split transaction: {e}")
        raise HTTPException(status_code=500, detail=str(e))




# ============================================================================
# CATEGORY ROUTES (within transactions)
# ============================================================================

@router.get("/categories/", response_model=ApiResponse)
async def get_categories(
    transaction_type: Optional[str] = Query(None, description="Filter by transaction type: 'debit' or 'credit'")
):
    """Get all active categories, optionally filtered by transaction type."""
    try:
        categories = await CategoryOperations.get_all_categories(transaction_type=transaction_type)
        return ApiResponse(data=categories)
        
    except Exception as e:
        logger.error(f"Failed to get categories: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/categories/search", response_model=ApiResponse)
async def search_categories(
    query: str = Query(..., description="Search query for category names"),
    limit: int = Query(20, ge=1, le=100, description="Maximum number of results"),
    transaction_type: Optional[str] = Query(None, description="Filter by transaction type: 'debit' or 'credit'")
):
    """Search categories by name, optionally filtered by transaction type."""
    try:
        categories = await CategoryOperations.search_categories(query, limit, transaction_type=transaction_type)
        return ApiResponse(data=categories)
        
    except Exception as e:
        logger.error(f"Failed to search categories: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/categories/{category_id}", response_model=ApiResponse)
async def get_category(category_id: str):
    """Get a specific category by ID."""
    try:
        category = await CategoryOperations.get_category_by_id(category_id)
        if not category:
            raise HTTPException(status_code=404, detail="Category not found")
        
        return ApiResponse(data=category)
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get category: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/categories/", response_model=ApiResponse, status_code=201)
async def create_category(category_data: CategoryCreate):
    """Create a new category."""
    try:
        category_id = await CategoryOperations.create_category(
            name=category_data.name,
            color=category_data.color,
            parent_id=category_data.parent_id,
            sort_order=category_data.sort_order,
            transaction_type=category_data.transaction_type
        )
        
        return ApiResponse(data={"id": category_id}, message="Category created successfully")
        
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Failed to create category: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/categories/{category_id}", response_model=ApiResponse)
async def update_category(category_id: str, category_data: CategoryUpdate):
    """Update a category."""
    try:
        # Check if transaction_type was explicitly provided in the request (even if None)
        # Use model_dump(exclude_unset=True) to see which fields were actually set
        provided_fields = category_data.model_dump(exclude_unset=True)
        
        # Determine transaction_type value:
        # - If field was provided and value is None, convert to "" to signal "set to NULL"
        # - If field was provided and value is a string, use it as-is
        # - If field was not provided, pass None to skip update
        transaction_type_for_update = None
        if "transaction_type" in provided_fields:
            if provided_fields["transaction_type"] is None:
                transaction_type_for_update = ""  # Empty string signals "set to NULL" in the backend
            else:
                transaction_type_for_update = provided_fields["transaction_type"]
        
        success = await CategoryOperations.update_category(
            category_id=category_id,
            name=category_data.name,
            color=category_data.color,
            parent_id=category_data.parent_id,
            sort_order=category_data.sort_order,
            transaction_type=transaction_type_for_update
        )
        
        if not success:
            raise HTTPException(status_code=404, detail="Category not found")
        
        return ApiResponse(data={"success": True}, message="Category updated successfully")
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to update category: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/categories/{category_id}", status_code=204)
async def delete_category(category_id: str):
    """Delete a category (soft delete)."""
    try:
        success = await CategoryOperations.delete_category(category_id)
        if not success:
            raise HTTPException(status_code=404, detail="Category not found")
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to delete category: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/categories/upsert", response_model=ApiResponse)
async def upsert_category(category_data: CategoryCreate):
    """Upsert a category (create if not exists, update if exists)."""
    try:
        # For upsert, we need to update the method to accept transaction_type
        # For now, we'll create/update without transaction_type in upsert
        # This can be enhanced later if needed
        category_id = await CategoryOperations.upsert_category(
            name=category_data.name,
            color=category_data.color,
            parent_id=category_data.parent_id,
            sort_order=category_data.sort_order
        )
        
        # If transaction_type is provided, update it
        if category_data.transaction_type is not None:
            await CategoryOperations.update_category(
                category_id=category_id,
                transaction_type=category_data.transaction_type
            )
        
        return ApiResponse(data={"id": category_id}, message="Category upserted successfully")
        
    except Exception as e:
        logger.error(f"Failed to upsert category: {e}")
        raise HTTPException(status_code=500, detail=str(e))



# ============================================================================
# EMAIL LINKING ROUTES
# ============================================================================

class EmailSearchFilters(BaseModel):
    """Filters for searching emails related to a transaction."""
    date_offset_days: int = Field(1, ge=0, le=30, description="Days to search before/after transaction date")
    include_amount_filter: bool = Field(True, description="Whether to filter by amount")
    start_date: Optional[str] = Field(None, description="Custom start date (YYYY-MM-DD)")
    end_date: Optional[str] = Field(None, description="Custom end date (YYYY-MM-DD)")


class EmailLinkRequest(BaseModel):
    """Request to link an email to a transaction."""
    message_id: str = Field(..., description="Gmail message ID to link")


@router.get("/{transaction_id}/emails/search", response_model=ApiResponse)
async def search_transaction_emails(
    transaction_id: str,
    date_offset_days: int = Query(1, ge=0, le=30, description="Days to search before/after transaction date"),
    include_amount_filter: bool = Query(True, description="Whether to filter by amount"),
    start_date: Optional[str] = Query(None, description="Custom start date (YYYY-MM-DD)"),
    end_date: Optional[str] = Query(None, description="Custom end date (YYYY-MM-DD)"),
    custom_search_term: Optional[str] = Query(None, description="Custom search term (e.g., 'Uber', 'Ola', 'Swiggy')"),
    search_amount: Optional[float] = Query(None, description="Optional override for search amount (e.g., rounded amount for UPI)"),
    also_search_amount_minus_one: bool = Query(False, description="Also search for amount-1 (for UPI rounding scenarios)")
):
    """Search Gmail for emails related to a transaction across both accounts."""
    try:
        # Get transaction details
        transaction = await handle_database_operation(
            TransactionOperations.get_transaction_by_id,
            transaction_id
        )
        
        if not transaction:
            raise HTTPException(status_code=404, detail="Transaction not found")
        
        all_emails = []
        
        # Search primary account
        try:
            logger.info("Searching primary Gmail account...")
            primary_client = EmailClient(account_id="primary")
            primary_emails = primary_client.search_emails_for_transaction(
                transaction_date=str(transaction["transaction_date"]),
                transaction_amount=float(transaction["amount"]),
                date_offset_days=date_offset_days,
                include_amount_filter=include_amount_filter,
                start_date=start_date,
                end_date=end_date,
                custom_search_term=custom_search_term,
                search_amount=search_amount,
                also_search_amount_minus_one=also_search_amount_minus_one
            )
            all_emails.extend(primary_emails)
            logger.info(f"Found {len(primary_emails)} emails in primary account")
        except Exception as e:
            logger.error(f"Error searching primary account: {e}")
            # Continue to secondary account even if primary fails
        
        # Search secondary account if configured
        try:
            from src.utils.settings import get_settings
            settings = get_settings()
            if settings.GOOGLE_REFRESH_TOKEN_2:
                logger.info("Searching secondary Gmail account...")
                secondary_client = EmailClient(account_id="secondary")
                secondary_emails = secondary_client.search_emails_for_transaction(
                    transaction_date=str(transaction["transaction_date"]),
                    transaction_amount=float(transaction["amount"]),
                    date_offset_days=date_offset_days,
                    include_amount_filter=include_amount_filter,
                    start_date=start_date,
                    end_date=end_date,
                    custom_search_term=custom_search_term,
                    search_amount=search_amount,
                    also_search_amount_minus_one=also_search_amount_minus_one
                )
                all_emails.extend(secondary_emails)
                logger.info(f"Found {len(secondary_emails)} emails in secondary account")
            else:
                logger.info("Secondary account not configured, skipping")
        except Exception as e:
            logger.error(f"Error searching secondary account: {e}")
            # Continue even if secondary fails
        
        # Sort by date (most recent first)
        all_emails.sort(key=lambda x: x.get("date", ""), reverse=True)
        
        return ApiResponse(data=all_emails, message=f"Found {len(all_emails)} emails across accounts")
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to search emails for transaction {transaction_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{transaction_id}/emails/{message_id}", response_model=ApiResponse)
async def get_email_details(transaction_id: str, message_id: str):
    """Get full details of a specific email from either account."""
    try:
        # Verify transaction exists
        transaction = await handle_database_operation(
            TransactionOperations.get_transaction_by_id,
            transaction_id
        )
        
        if not transaction:
            raise HTTPException(status_code=404, detail="Transaction not found")
        
        email_content = None
        last_error = None
        
        # Try primary account first
        try:
            primary_client = EmailClient(account_id="primary")
            email_content = primary_client.get_email_content(message_id)
            logger.info(f"Email {message_id} found in primary account")
        except Exception as e:
            last_error = e
            logger.warning(f"Email {message_id} not found in primary account: {e}")
            
            # Try secondary account
            try:
                from src.utils.settings import get_settings
                settings = get_settings()
                if settings.GOOGLE_REFRESH_TOKEN_2:
                    secondary_client = EmailClient(account_id="secondary")
                    email_content = secondary_client.get_email_content(message_id)
                    logger.info(f"Email {message_id} found in secondary account")
            except Exception as e2:
                last_error = e2
                logger.warning(f"Email {message_id} not found in secondary account: {e2}")
        
        if not email_content:
            raise HTTPException(
                status_code=404, 
                detail=f"Email not found in any account. Last error: {str(last_error)}"
            )
        
        return ApiResponse(data=email_content, message="Email retrieved successfully")
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get email {message_id} for transaction {transaction_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{transaction_id}/emails/link", response_model=ApiResponse)
async def link_email_to_transaction(transaction_id: str, request: EmailLinkRequest):
    """Link an email to a transaction by adding its message ID to related_mails."""
    try:
        # Get current transaction
        transaction = await handle_database_operation(
            TransactionOperations.get_transaction_by_id,
            transaction_id
        )
        
        if not transaction:
            raise HTTPException(status_code=404, detail="Transaction not found")
        
        # Get current related_mails list
        related_mails = transaction.get("related_mails", []) or []
        
        # Add new message ID if not already present
        if request.message_id not in related_mails:
            related_mails.append(request.message_id)
        
        # Update transaction
        updated_count = await handle_database_operation(
            TransactionOperations.update_transaction,
            transaction_id=transaction_id,
            related_mails=related_mails
        )
        
        if updated_count == 0:
            raise HTTPException(status_code=404, detail="Transaction not found")
        
        # Fetch updated transaction
        updated_transaction = await handle_database_operation(
            TransactionOperations.get_transaction_by_id,
            transaction_id
        )
        
        response_transaction = _convert_db_transaction_to_response(updated_transaction)
        
        return ApiResponse(data=response_transaction, message="Email linked successfully")
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to link email to transaction {transaction_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/{transaction_id}/emails/{message_id}", response_model=ApiResponse)
async def unlink_email_from_transaction(transaction_id: str, message_id: str):
    """Remove an email link from a transaction."""
    try:
        # Get current transaction
        transaction = await handle_database_operation(
            TransactionOperations.get_transaction_by_id,
            transaction_id
        )
        
        if not transaction:
            raise HTTPException(status_code=404, detail="Transaction not found")
        
        # Get current related_mails list
        related_mails = transaction.get("related_mails", []) or []
        
        # Remove message ID if present
        if message_id in related_mails:
            related_mails.remove(message_id)
        
        # Update transaction
        updated_count = await handle_database_operation(
            TransactionOperations.update_transaction,
            transaction_id=transaction_id,
            related_mails=related_mails
        )
        
        if updated_count == 0:
            raise HTTPException(status_code=404, detail="Transaction not found")
        
        # Fetch updated transaction
        updated_transaction = await handle_database_operation(
            TransactionOperations.get_transaction_by_id,
            transaction_id
        )
        
        response_transaction = _convert_db_transaction_to_response(updated_transaction)
        
        return ApiResponse(data=response_transaction, message="Email unlinked successfully")
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to unlink email from transaction {transaction_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{transaction_id}/source-pdf")
async def get_transaction_source_pdf(transaction_id: str):
    """Get the source PDF statement for a transaction."""
    try:
        # Get transaction details
        transaction = await handle_database_operation(
            TransactionOperations.get_transaction_by_id,
            transaction_id
        )
        
        if not transaction:
            raise HTTPException(status_code=404, detail="Transaction not found")
        
        # Get account name from transaction
        account_name = transaction.get('account', '').lower()
        if not account_name:
            raise HTTPException(status_code=400, detail="Transaction has no account name")
        
        # Extract keywords from account name
        # Remove only very generic words, keep bank names and card types
        # Example: "Axis Atlas Credit Card" -> ["axis", "atlas"]
        # Example: "Amazon Pay ICICI Credit Card" -> ["amazon", "pay", "icici"]
        generic_words = {'credit', 'card', 'savings', 'account'}
        account_keywords = [
            word.lower() for word in account_name.split() 
            if word.lower() not in generic_words
        ]
        
        # If no keywords extracted, use all words from account name
        if not account_keywords:
            account_keywords = [word.lower() for word in account_name.split()]
        
        logger.info(f"Searching for PDF with account keywords: {account_keywords}")
        
        # Get month/year from transaction date
        transaction_date = transaction.get('transaction_date')
        if not transaction_date:
            raise HTTPException(status_code=400, detail="Transaction has no date")
        
        # Convert to datetime if it's a date object
        if isinstance(transaction_date, date):
            month_year = transaction_date.strftime("%Y-%m")
        else:
            # Parse string date
            try:
                if isinstance(transaction_date, str):
                    transaction_date_obj = datetime.fromisoformat(transaction_date.replace('Z', '+00:00'))
                else:
                    transaction_date_obj = transaction_date
                month_year = transaction_date_obj.strftime("%Y-%m")
            except Exception as e:
                logger.error(f"Failed to parse transaction date: {e}")
                raise HTTPException(status_code=400, detail=f"Invalid transaction date format: {transaction_date}")
        
        # Initialize GCS service
        gcs_service = GoogleCloudStorageService()
        
        # List all PDF files in the month/year unlocked_statements folder
        prefix = f"{month_year}/unlocked_statements/"
        pdf_files = gcs_service.list_files(prefix=prefix, max_results=100)
        
        # Filter to only PDF files
        pdf_files = [f for f in pdf_files if f['name'].lower().endswith('.pdf')]
        
        if not pdf_files:
            raise HTTPException(
                status_code=404,
                detail=f"No PDF files found in {prefix}"
            )
        
        # Find the PDF file that matches the account keywords
        # Use a scoring system: prefer PDFs that match more keywords
        matching_pdf = None
        best_match_score = 0
        best_matched_keywords = []
        
        logger.info(f"Searching for PDF with account: '{transaction.get('account')}', keywords: {account_keywords}")
        logger.info(f"Found {len(pdf_files)} PDF files in {prefix}")
        for pdf_file in pdf_files:
            logger.debug(f"  - {pdf_file['name']}")
        
        # Score each PDF based on how many keywords match
        for pdf_file in pdf_files:
            filename_lower = pdf_file['name'].lower()
            matching_keywords = [kw for kw in account_keywords if kw in filename_lower]
            match_score = len(matching_keywords)
            
            # Prefer matches with more keywords
            if match_score > best_match_score:
                best_match_score = match_score
                matching_pdf = pdf_file
                best_matched_keywords = matching_keywords
        
        # Only use the match if at least one keyword matched
        if matching_pdf and best_match_score > 0:
            logger.info(f"Found matching PDF: {matching_pdf['name']} (matched {best_match_score}/{len(account_keywords)} keywords: {best_matched_keywords})")
        else:
            # If no match, use the first PDF file (fallback)
            matching_pdf = pdf_files[0]
            logger.warning(f"No matching PDF found for account '{transaction.get('account')}' with keywords {account_keywords}, using first available: {matching_pdf['name']}")
        
        gcs_path = matching_pdf['name']
        pdf_filename = Path(gcs_path).name
        logger.info(f"Selected PDF for transaction {transaction_id}: {gcs_path}")
        
        # Download PDF to temporary file
        download_result = gcs_service.download_to_temp_file(gcs_path)
        
        if not download_result.get("success"):
            error_msg = download_result.get("error", "Unknown error")
            logger.error(f"Failed to download PDF from GCS: {error_msg}")
            raise HTTPException(
                status_code=404, 
                detail=f"PDF not found in cloud storage: {gcs_path}. Error: {error_msg}"
            )
        
        temp_path = Path(download_result["temp_path"])
        
        # Return PDF as FileResponse with additional metadata in headers
        return FileResponse(
            path=str(temp_path),
            media_type="application/pdf",
            filename=pdf_filename,
            headers={
                "Content-Disposition": f'inline; filename="{pdf_filename}"',
                "X-PDF-Path": gcs_path,  # Include the GCS path in response headers for debugging
                "X-PDF-Filename": pdf_filename
            }
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get source PDF for transaction {transaction_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))
