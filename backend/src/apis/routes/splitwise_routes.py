"""
FastAPI routes for Splitwise integration.
"""

from datetime import datetime, timedelta
from typing import List, Optional
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from src.utils.logger import get_logger
from src.services.splitwise_processor.service import SplitwiseService
from src.schemas.extraction.splitwise import ProcessedSplitwiseTransaction, SplitwiseTransactionFilter

logger = get_logger(__name__)

router = APIRouter(prefix="/splitwise", tags=["splitwise"])


class SplitwiseTransactionResponse(BaseModel):
    """Response model for Splitwise transactions."""
    transactions: List[ProcessedSplitwiseTransaction]
    summary: dict
    total_count: int


class SplitwiseSummaryResponse(BaseModel):
    """Response model for Splitwise summary."""
    total_transactions: int
    total_amount: float
    total_my_share: float
    categories: dict
    groups: dict
    participants: dict
    created_by: dict


@router.get("/transactions/past-month", response_model=SplitwiseTransactionResponse)
async def get_past_month_transactions(
    exclude_created_by_me: bool = Query(True, description="Exclude transactions created by current user"),
    include_only_my_transactions: bool = Query(True, description="Include only transactions where user is involved")
):
    """
    Get Splitwise transactions from the past month.
    
    Args:
        exclude_created_by_me: If True, exclude transactions created by the current user
        include_only_my_transactions: If True, only include transactions where the user is involved
    
    Returns:
        List of processed transactions with summary
    """
    try:
        service = SplitwiseService()
        
        transactions = service.get_transactions_for_past_month(
            exclude_created_by_me=exclude_created_by_me,
            include_only_my_transactions=include_only_my_transactions
        )
        
        summary = service.get_transaction_summary(transactions)
        
        return SplitwiseTransactionResponse(
            transactions=transactions,
            summary=summary,
            total_count=len(transactions)
        )
        
    except Exception as e:
        logger.error(f"Failed to get past month transactions: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/transactions/filtered", response_model=SplitwiseTransactionResponse)
async def get_filtered_transactions(
    start_date: Optional[datetime] = Query(None, description="Start date for filtering"),
    end_date: Optional[datetime] = Query(None, description="End date for filtering"),
    exclude_created_by_me: bool = Query(True, description="Exclude transactions created by current user"),
    include_only_my_transactions: bool = Query(True, description="Include only transactions where user is involved"),
    min_amount: Optional[float] = Query(None, description="Minimum transaction amount"),
    max_amount: Optional[float] = Query(None, description="Maximum transaction amount"),
    categories: Optional[List[str]] = Query(None, description="Filter by categories"),
    groups: Optional[List[str]] = Query(None, description="Filter by groups")
):
    """
    Get Splitwise transactions with custom filters.
    
    Returns:
        List of processed transactions matching the filter criteria
    """
    try:
        service = SplitwiseService()
        
        filter_criteria = SplitwiseTransactionFilter(
            start_date=start_date,
            end_date=end_date,
            exclude_created_by_me=exclude_created_by_me,
            include_only_my_transactions=include_only_my_transactions,
            min_amount=min_amount,
            max_amount=max_amount,
            categories=categories,
            groups=groups
        )
        
        transactions = service.get_transactions_with_filter(filter_criteria)
        summary = service.get_transaction_summary(transactions)
        
        return SplitwiseTransactionResponse(
            transactions=transactions,
            summary=summary,
            total_count=len(transactions)
        )
        
    except Exception as e:
        logger.error(f"Failed to get filtered transactions: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/summary", response_model=SplitwiseSummaryResponse)
async def get_transaction_summary(
    exclude_created_by_me: bool = Query(True, description="Exclude transactions created by current user"),
    include_only_my_transactions: bool = Query(True, description="Include only transactions where user is involved")
):
    """
    Get summary of Splitwise transactions from the past month.
    
    Returns:
        Summary statistics of transactions
    """
    try:
        service = SplitwiseService()
        
        transactions = service.get_transactions_for_past_month(
            exclude_created_by_me=exclude_created_by_me,
            include_only_my_transactions=include_only_my_transactions
        )
        
        summary = service.get_transaction_summary(transactions)
        
        return SplitwiseSummaryResponse(**summary)
        
    except Exception as e:
        logger.error(f"Failed to get transaction summary: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/user")
async def get_current_user():
    """
    Get current Splitwise user information.
    
    Returns:
        Current user details
    """
    try:
        service = SplitwiseService()
        user = service.get_current_user()
        
        return {
            "id": user.id,
            "first_name": user.first_name,
            "last_name": user.last_name,
            "email": user.email
        }
        
    except Exception as e:
        logger.error(f"Failed to get current user: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/health")
async def health_check():
    """
    Health check for Splitwise integration.
    
    Returns:
        Service health status
    """
    try:
        service = SplitwiseService()
        user = service.get_current_user()
        
        return {
            "status": "healthy",
            "service": "splitwise",
            "user": f"{user.first_name} {user.last_name}",
            "timestamp": datetime.now().isoformat()
        }
        
    except Exception as e:
        logger.error(f"Splitwise health check failed: {e}")
        return {
            "status": "unhealthy",
            "service": "splitwise",
            "error": str(e),
            "timestamp": datetime.now().isoformat()
        }
