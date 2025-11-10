"""
FastAPI routes for transaction management including categories, tags, and suggestions.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import List, Optional, Dict, Any
import json
from fastapi import APIRouter, HTTPException, Query, Depends
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
import asyncpg

from src.services.database_manager.operations import TransactionOperations, CategoryOperations, TagOperations
from src.services.database_manager.connection import get_session_factory, refresh_connection_pool
from src.services.email_ingestion.client import EmailClient
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
    split_share_amount: Optional[float] = None
    tags: List[str]
    notes: Optional[str] = None
    is_shared: bool
    is_refund: bool
    is_split: bool
    is_transfer: bool
    is_flagged: Optional[bool] = False
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
    color: str = Field(..., pattern="^#[0-9A-Fa-f]{6}$")


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

def _convert_db_transaction_to_response(transaction: Dict[str, Any]) -> TransactionResponse:
    """Convert database transaction to API response format."""
    is_flagged = transaction.get('is_flagged')
    # Handle None or missing is_flagged - default to False
    if is_flagged is None:
        is_flagged = False
    
    return TransactionResponse(
        id=str(transaction.get('id', '')),
        date=transaction.get('transaction_date', '').isoformat() if transaction.get('transaction_date') else '',
        account=transaction.get('account', ''),
        description=transaction.get('description', ''),
        category=transaction.get('category', ''),  # This now comes from the JOIN with categories table
        subcategory=transaction.get('sub_category'),
        direction=transaction.get('direction', 'debit'),
        amount=float(transaction.get('amount', 0)),
        split_share_amount=float(transaction.get('split_share_amount')) if transaction.get('split_share_amount') else None,
        tags=transaction.get('tags', []) or [],
        notes=transaction.get('notes'),
        is_shared=transaction.get('is_shared', False),
        is_refund=transaction.get('is_partial_refund', False),
        is_split=transaction.get('is_split', False),
        is_transfer=bool(transaction.get('transaction_group_id')),
        is_flagged=is_flagged,
        split_breakdown=transaction.get('split_breakdown'),
        paid_by=transaction.get('paid_by'),
        link_parent_id=str(transaction.get('link_parent_id')) if transaction.get('link_parent_id') else None,
        transaction_group_id=str(transaction.get('transaction_group_id')) if transaction.get('transaction_group_id') else None,
        related_mails=transaction.get('related_mails', []) or [],
        source_file=transaction.get('source_file'),
        raw_data=_parse_raw_data(transaction.get('raw_data')),
        created_at=transaction.get('created_at', '').isoformat() if transaction.get('created_at') else '',
        updated_at=transaction.get('updated_at', '').isoformat() if transaction.get('updated_at') else '',
        status="reviewed",
        is_deleted=transaction.get('is_deleted', False),
        deleted_at=transaction.get('deleted_at', '').isoformat() if transaction.get('deleted_at') else None
    )


def _convert_db_tag_to_response(tag: Dict[str, Any]) -> TagResponse:
    """Convert database tag to API response format."""
    return TagResponse(
        id=tag["id"],
        name=tag["name"],
        color=tag["color"],
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
    categories: Optional[str] = Query(None, description="Comma-separated category names"),
    include_uncategorized: bool = Query(False, description="Include uncategorized transactions when filtering by category"),
    tags: Optional[str] = Query(None, description="Comma-separated tag names"),
    amount_min: Optional[float] = Query(None, description="Minimum amount"),
    amount_max: Optional[float] = Query(None, description="Maximum amount"),
    direction: Optional[str] = Query(None, pattern="^(debit|credit)$", description="Transaction direction"),
    transaction_type: Optional[str] = Query(None, pattern="^(all|shared|refunds|transfers)$", description="Transaction type filter"),
    search: Optional[str] = Query(None, description="Search in description and notes"),
    is_flagged: Optional[bool] = Query(None, description="Filter transactions by flagged status"),
    sort_field: Optional[str] = Query("date", description="Field to sort by"),
    sort_direction: Optional[str] = Query("desc", pattern="^(asc|desc)$", description="Sort direction"),
    page: int = Query(1, ge=1, description="Page number"),
    limit: int = Query(50, ge=1, le=500, description="Items per page")
):
    """Get transactions with filtering, sorting, and pagination."""
    try:
        # Handle query parameters for backward compatibility
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
        
        # Prepare filter values
        account_filter_values = [account.strip() for account in accounts.split(',')] if accounts else []
        account_filter_values = [account for account in account_filter_values if account]
        category_filter_values = [category.strip() for category in categories.split(',')] if categories else []
        category_filter_values = [category for category in category_filter_values if category]
        tag_filter_values = [tag.strip() for tag in tags.split(',')] if tags else []
        tag_filter_values = [tag for tag in tag_filter_values if tag]

        # Apply additional filters
        filtered_transactions = []
        for transaction in transactions:
            # Apply account filter
            if account_filter_values and transaction.get('account') not in account_filter_values:
                continue
            
            # Apply category filter
            transaction_category = transaction.get('category')
            is_transaction_uncategorized = transaction_category is None or str(transaction_category).strip() == ''
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
            
            # Apply search filter
            if search:
                search_lower = search.lower()
                description = transaction.get('description', '').lower()
                notes = transaction.get('notes', '').lower() if transaction.get('notes') else ''
                if search_lower not in description and search_lower not in notes:
                    continue
            
            filtered_transactions.append(transaction)
        
        # Convert to response format
        response_transactions = [_convert_db_transaction_to_response(t) for t in filtered_transactions]
        
        # Calculate pagination info
        total_count = len(response_transactions)
        total_pages = (total_count + limit - 1) // limit
        
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
        tag_id = await TagOperations.create_tag(
            name=tag_data.name,
            color=tag_data.color
        )
        
        return ApiResponse(data={"id": tag_id}, message="Tag created successfully")
        
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Failed to create tag: {e}")
        raise HTTPException(status_code=500, detail=str(e))


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
                sql_query = text(f"""
                    SELECT DISTINCT {db_field} as value
                    FROM transactions
                    WHERE {db_field} IS NOT NULL 
                    AND {db_field} != ''
                    AND LOWER({db_field}) LIKE LOWER(:query)
                    ORDER BY {db_field}
                    LIMIT :limit
                """)
                result = await session.execute(
                    sql_query, 
                    {"query": f"%{query}%", "limit": limit}
                )
            else:
                sql_query = text(f"""
                    SELECT DISTINCT {db_field} as value, COUNT(*) as usage_count
                    FROM transactions
                    WHERE {db_field} IS NOT NULL 
                    AND {db_field} != ''
                    GROUP BY {db_field}
                    ORDER BY usage_count DESC, {db_field}
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
                
                # Update the transaction
                success = await TransactionOperations.update_transaction(
                    transaction_id,
                    **update_data
                )
                
                if success:
                    # Handle tags if provided
                    if tag_names is not None:
                        tag_ids = []
                        for tag_name in tag_names:
                            tag = await TagOperations.get_tag_by_name(tag_name)
                            if tag:
                                tag_ids.append(tag["id"])
                            else:
                                # Create tag if it doesn't exist
                                new_tag_id = await TagOperations.create_tag(tag_name)
                                if new_tag_id:
                                    tag_ids.append(new_tag_id)
                        
                        # Set tags for the transaction
                        await TagOperations.set_transaction_tags(transaction_id, tag_ids)
                    
                    # Fetch the updated transaction
                    updated_transaction = await TransactionOperations.get_transaction_by_id(transaction_id)
                    if updated_transaction:
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
            # Get all transactions in the split group
            result = await session.execute(
                text("""
                    SELECT id, description, amount, created_at, is_split
                    FROM transactions
                    WHERE transaction_group_id = :group_id
                    AND is_split = true
                    ORDER BY created_at ASC
                """),
                {"group_id": request.transaction_group_id}
            )
            transactions = result.fetchall()
            
            if not transactions:
                raise HTTPException(status_code=404, detail="Split group not found")
            
            # The original transaction (if it exists) would be the first one created
            # and would have a more complex description (original transaction description)
            # Split parts would have simpler descriptions like "A", "B", "Internet", "Mobile"
            
            original_transaction = None
            split_parts = []
            
            # Find the original vs split parts
            # Original will have been created first and likely has the original description
            for t in transactions:
                if len(transactions) > 1:
                    # If we have multiple transactions, the first one is likely the original
                    if t == transactions[0]:
                        original_transaction = t
                    else:
                        split_parts.append(t)
                else:
                    # If only one transaction, it's either a lone split part or the original
                    split_parts.append(t)
            
            # Delete all split parts
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
                    part_split_breakdown = {
                        "mode": "custom",
                        "include_me": True,
                        "entries": [
                            {"participant": "me", "amount": part.amount}
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
            # Mark the original transaction as split and add it to the group
            await handle_database_operation(
                TransactionOperations.update_transaction,
                request.transaction_id,
                is_split=True,
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
        success = await CategoryOperations.update_category(
            category_id=category_id,
            name=category_data.name,
            color=category_data.color,
            parent_id=category_data.parent_id,
            sort_order=category_data.sort_order,
            transaction_type=category_data.transaction_type
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
# SUGGESTION ROUTES (within transactions)
# ============================================================================

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
