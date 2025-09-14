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

from src.services.database_manager.operations import TransactionOperations
from src.services.database_manager.connection import get_session_factory
from src.utils.logger import get_logger

logger = get_logger(__name__)

router = APIRouter(prefix="/transactions", tags=["transactions"])


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
    is_transfer: bool = False
    split_breakdown: Optional[Dict[str, Any]] = None
    link_parent_id: Optional[str] = None
    transfer_group_id: Optional[str] = None
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
    is_transfer: Optional[bool] = None
    split_breakdown: Optional[Dict[str, Any]] = None
    link_parent_id: Optional[str] = None
    transfer_group_id: Optional[str] = None
    related_mails: Optional[List[str]] = None
    source_file: Optional[str] = None
    raw_data: Optional[Dict[str, Any]] = None


class TransactionResponse(BaseModel):
    """Response model for transaction data."""
    id: str
    date: str
    account: str
    description: str
    category: str
    subcategory: Optional[str] = None
    direction: str
    amount: float
    split_share_amount: Optional[float] = None
    tags: List[str]
    notes: Optional[str] = None
    is_shared: bool
    is_refund: bool
    is_transfer: bool
    split_breakdown: Optional[Dict[str, Any]] = None
    link_parent_id: Optional[str] = None
    transfer_group_id: Optional[str] = None
    related_mails: List[str] = []
    source_file: Optional[str] = None
    raw_data: Optional[Dict[str, Any]] = None
    created_at: str
    updated_at: str
    status: str = "reviewed"


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


# ============================================================================
# CATEGORY MODELS AND OPERATIONS
# ============================================================================

class CategoryCreate(BaseModel):
    """Request model for creating a category."""
    name: str = Field(..., min_length=1, max_length=100)
    color: str = Field(..., pattern="^#[0-9A-Fa-f]{6}$")
    is_hidden: bool = False


class CategoryUpdate(BaseModel):
    """Request model for updating a category."""
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    color: Optional[str] = Field(None, pattern="^#[0-9A-Fa-f]{6}$")
    is_hidden: Optional[bool] = None


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
    color: str
    subcategories: List[SubcategoryResponse]
    is_hidden: bool


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

class CategoryOperations:
    """Operations for managing categories."""
    
    @staticmethod
    async def get_all_categories(include_hidden: bool = False) -> List[Dict[str, Any]]:
        """Get all categories with their subcategories."""
        session_factory = get_session_factory()
        session = session_factory()
        try:
            # Get categories
            where_clause = "" if include_hidden else "WHERE is_hidden = false"
            result = await session.execute(
                text(f"""
                    SELECT id, name, color, is_hidden, created_at, updated_at
                    FROM categories 
                    {where_clause}
                    ORDER BY name
                """)
            )
            categories = result.fetchall()
            
            # Get subcategories for each category
            category_dict = {}
            for category in categories:
                category_id = category.id
                category_dict[category_id] = {
                    "id": category_id,
                    "name": category.name,
                    "color": category.color,
                    "is_hidden": category.is_hidden,
                    "created_at": category.created_at,
                    "updated_at": category.updated_at,
                    "subcategories": []
                }
            
            # Get subcategories
            subcategory_where = "" if include_hidden else "WHERE is_hidden = false"
            subcategory_result = await session.execute(
                text(f"""
                    SELECT id, name, color, is_hidden, category_id, created_at, updated_at
                    FROM subcategories 
                    {subcategory_where}
                    ORDER BY name
                """)
            )
            subcategories = subcategory_result.fetchall()
            
            # Group subcategories by category
            for subcategory in subcategories:
                category_id = subcategory.category_id
                if category_id in category_dict:
                    category_dict[category_id]["subcategories"].append({
                        "id": subcategory.id,
                        "name": subcategory.name,
                        "color": subcategory.color,
                        "is_hidden": subcategory.is_hidden,
                        "created_at": subcategory.created_at,
                        "updated_at": subcategory.updated_at
                    })
            
            return list(category_dict.values())
            
        finally:
            await session.close()
    
    @staticmethod
    async def create_category(name: str, color: str, is_hidden: bool = False) -> str:
        """Create a new category."""
        session_factory = get_session_factory()
        session = session_factory()
        try:
            result = await session.execute(
                text("""
                    INSERT INTO categories (name, color, is_hidden)
                    VALUES (:name, :color, :is_hidden)
                    RETURNING id
                """), {
                    "name": name,
                    "color": color,
                    "is_hidden": is_hidden
                }
            )
            category_id = result.fetchone()[0]
            await session.commit()
            return str(category_id)
            
        finally:
            await session.close()


class TagOperations:
    """Operations for managing tags."""
    
    @staticmethod
    async def get_all_tags() -> List[Dict[str, Any]]:
        """Get all tags with usage counts."""
        session_factory = get_session_factory()
        session = session_factory()
        try:
            result = await session.execute(
                text("""
                    SELECT 
                        t.id, t.name, t.color, t.created_at, t.updated_at,
                        COUNT(CASE WHEN tr.transaction_id IS NOT NULL THEN 1 END) as usage_count
                    FROM tags t
                    LEFT JOIN transaction_tags tr ON t.id = tr.tag_id
                    GROUP BY t.id, t.name, t.color, t.created_at, t.updated_at
                    ORDER BY usage_count DESC, t.name
                """)
            )
            rows = result.fetchall()
            return [dict(row._mapping) for row in rows]
            
        finally:
            await session.close()
    
    @staticmethod
    async def create_tag(name: str, color: str) -> str:
        """Create a new tag."""
        session_factory = get_session_factory()
        session = session_factory()
        try:
            result = await session.execute(
                text("""
                    INSERT INTO tags (name, color)
                    VALUES (:name, :color)
                    RETURNING id
                """), {
                    "name": name,
                    "color": color
                }
            )
            tag_id = result.fetchone()[0]
            await session.commit()
            return str(tag_id)
            
        finally:
            await session.close()


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
                        AND t1.transfer_group_id IS NULL
                        AND t2.transfer_group_id IS NULL
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
    return TransactionResponse(
        id=str(transaction.get('id', '')),
        date=transaction.get('transaction_date', '').isoformat() if transaction.get('transaction_date') else '',
        account=transaction.get('account', ''),
        description=transaction.get('description', ''),
        category=transaction.get('category', ''),
        subcategory=transaction.get('sub_category'),
        direction=transaction.get('direction', 'debit'),
        amount=float(transaction.get('amount', 0)),
        split_share_amount=float(transaction.get('split_share_amount')) if transaction.get('split_share_amount') else None,
        tags=transaction.get('tags', []) or [],
        notes=transaction.get('notes'),
        is_shared=transaction.get('is_shared', False),
        is_refund=transaction.get('is_partial_refund', False),
        is_transfer=bool(transaction.get('transfer_group_id')),
        split_breakdown=transaction.get('split_breakdown'),
        link_parent_id=transaction.get('link_parent_id'),
        transfer_group_id=transaction.get('transfer_group_id'),
        related_mails=transaction.get('related_mails', []) or [],
        source_file=transaction.get('source_file'),
        raw_data=_parse_raw_data(transaction.get('raw_data')),
        created_at=transaction.get('created_at', '').isoformat() if transaction.get('created_at') else '',
        updated_at=transaction.get('updated_at', '').isoformat() if transaction.get('updated_at') else '',
        status="reviewed"
    )


def _convert_db_category_to_response(category: Dict[str, Any]) -> CategoryResponse:
    """Convert database category to API response format."""
    return CategoryResponse(
        id=category["id"],
        name=category["name"],
        color=category["color"],
        is_hidden=category["is_hidden"],
        subcategories=[
            SubcategoryResponse(
                id=sub["id"],
                name=sub["name"],
                color=sub["color"],
                is_hidden=sub["is_hidden"]
            )
            for sub in category["subcategories"]
        ]
    )


def _convert_db_tag_to_response(tag: Dict[str, Any]) -> TagResponse:
    """Convert database tag to API response format."""
    return TagResponse(
        id=tag["id"],
        name=tag["name"],
        color=tag["color"],
        usage_count=tag.get("usage_count", 0)
    )


# ============================================================================
# TRANSACTION ROUTES
# ============================================================================

@router.get("/", response_model=ApiResponse)
async def get_transactions(
    date_range_start: Optional[date] = Query(None, description="Start date for filtering"),
    date_range_end: Optional[date] = Query(None, description="End date for filtering"),
    accounts: Optional[str] = Query(None, description="Comma-separated account names"),
    categories: Optional[str] = Query(None, description="Comma-separated category names"),
    subcategories: Optional[str] = Query(None, description="Comma-separated subcategory names"),
    tags: Optional[str] = Query(None, description="Comma-separated tag names"),
    amount_min: Optional[float] = Query(None, description="Minimum amount"),
    amount_max: Optional[float] = Query(None, description="Maximum amount"),
    direction: Optional[str] = Query(None, pattern="^(debit|credit)$", description="Transaction direction"),
    transaction_type: Optional[str] = Query(None, pattern="^(all|shared|refunds|transfers)$", description="Transaction type filter"),
    search: Optional[str] = Query(None, description="Search in description and notes"),
    sort_field: Optional[str] = Query("date", description="Field to sort by"),
    sort_direction: Optional[str] = Query("desc", pattern="^(asc|desc)$", description="Sort direction"),
    page: int = Query(1, ge=1, description="Page number"),
    limit: int = Query(50, ge=1, le=500, description="Items per page")
):
    """Get transactions with filtering, sorting, and pagination."""
    try:
        # Handle query parameters for backward compatibility
        if date_range_start or date_range_end:
            transactions = await TransactionOperations.get_transactions_by_date_range(
                start_date=date_range_start or date.min,
                end_date=date_range_end or date.max,
                limit=limit,
                offset=(page - 1) * limit,
                order_by="DESC" if sort_direction == "desc" else "ASC"
            )
        else:
            transactions = await TransactionOperations.get_all_transactions(
                limit=limit,
                offset=(page - 1) * limit,
                order_by="DESC" if sort_direction == "desc" else "ASC"
            )
        
        # Apply additional filters
        filtered_transactions = []
        for transaction in transactions:
            # Apply account filter
            if accounts and transaction.get('account') not in accounts.split(','):
                continue
            
            # Apply category filter
            if categories and transaction.get('category') not in categories.split(','):
                continue
            
            # Apply subcategory filter
            if subcategories and transaction.get('sub_category') not in subcategories.split(','):
                continue
            
            # Apply tag filter
            if tags:
                transaction_tags = transaction.get('tags', []) or []
                if not any(tag in transaction_tags for tag in tags.split(',')):
                    continue
            
            # Apply amount filter
            if amount_min is not None and float(transaction.get('amount', 0)) < amount_min:
                continue
            if amount_max is not None and float(transaction.get('amount', 0)) > amount_max:
                continue
            
            # Apply direction filter
            if direction and transaction.get('direction') != direction:
                continue
            
            # Apply transaction type filter
            if transaction_type:
                if transaction_type == "shared" and not transaction.get('is_shared'):
                    continue
                elif transaction_type == "refunds" and not transaction.get('is_partial_refund'):
                    continue
                elif transaction_type == "transfers" and not transaction.get('transfer_group_id'):
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


@router.get("/{transaction_id}", response_model=ApiResponse)
async def get_transaction(transaction_id: str):
    """Get a single transaction by ID."""
    try:
        transaction = await TransactionOperations.get_transaction_by_id(transaction_id)
        if not transaction:
            raise HTTPException(status_code=404, detail="Transaction not found")
        
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
        transaction_id = await TransactionOperations.create_transaction(
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
            transfer_group_id=transaction_data.transfer_group_id
        )
        
        # Fetch the created transaction
        created_transaction = await TransactionOperations.get_transaction_by_id(transaction_id)
        response_transaction = _convert_db_transaction_to_response(created_transaction)
        
        return ApiResponse(data=response_transaction, message="Transaction created successfully")
        
    except Exception as e:
        logger.error(f"Failed to create transaction: {e}")
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
        
        success = await TransactionOperations.update_transaction(transaction_id, **update_data)
        if not success:
            raise HTTPException(status_code=404, detail="Transaction not found or update failed")
        
        # Fetch the updated transaction
        updated_transaction = await TransactionOperations.get_transaction_by_id(transaction_id)
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
        success = await TransactionOperations.delete_transaction(transaction_id)
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
        transfer_group_id = str(uuid.uuid4())
        
        # Update all transactions to have the same transfer group ID
        updated_transactions = []
        for transaction_id in request.transaction_ids:
            success = await TransactionOperations.update_transaction(
                transaction_id,
                transfer_group_id=transfer_group_id
            )
            if success:
                transaction = await TransactionOperations.get_transaction_by_id(transaction_id)
                updated_transactions.append(_convert_db_transaction_to_response(transaction))
        
        return ApiResponse(data=updated_transactions, message="Transfer grouped successfully")
        
    except Exception as e:
        logger.error(f"Failed to group transfer: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/search", response_model=ApiResponse)
async def search_transactions(
    query: str = Query(..., description="Search query"),
    limit: int = Query(100, ge=1, le=500, description="Maximum results to return"),
    offset: int = Query(0, ge=0, description="Number of results to skip")
):
    """Search transactions by description, notes, or reference number."""
    try:
        transactions = await TransactionOperations.search_transactions(
            query=query,
            limit=limit,
            offset=offset
        )
        
        response_transactions = [_convert_db_transaction_to_response(t) for t in transactions]
        
        return ApiResponse(data=response_transactions)
        
    except Exception as e:
        logger.error(f"Failed to search transactions: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================================
# CATEGORY ROUTES (within transactions)
# ============================================================================

@router.get("/categories/", response_model=ApiResponse)
async def get_categories(include_hidden: bool = Query(False, description="Include hidden categories")):
    """Get all categories with their subcategories."""
    try:
        categories = await CategoryOperations.get_all_categories(include_hidden=include_hidden)
        response_categories = [_convert_db_category_to_response(c) for c in categories]
        
        return ApiResponse(data=response_categories)
        
    except Exception as e:
        logger.error(f"Failed to get categories: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/categories/", response_model=ApiResponse, status_code=201)
async def create_category(category_data: CategoryCreate):
    """Create a new category."""
    try:
        category_id = await CategoryOperations.create_category(
            name=category_data.name,
            color=category_data.color,
            is_hidden=category_data.is_hidden
        )
        
        return ApiResponse(data={"id": category_id}, message="Category created successfully")
        
    except Exception as e:
        logger.error(f"Failed to create category: {e}")
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


@router.post("/tags/", response_model=ApiResponse, status_code=201)
async def create_tag(tag_data: TagCreate):
    """Create a new tag."""
    try:
        tag_id = await TagOperations.create_tag(
            name=tag_data.name,
            color=tag_data.color
        )
        
        return ApiResponse(data={"id": tag_id}, message="Tag created successfully")
        
    except Exception as e:
        logger.error(f"Failed to create tag: {e}")
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
