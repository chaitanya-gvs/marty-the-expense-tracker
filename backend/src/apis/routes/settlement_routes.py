from __future__ import annotations

import json
from datetime import date
from decimal import Decimal
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from src.apis.routes.transaction_routes import ApiResponse
from src.schemas.api.settlements import (
    SettlementDetail,
    SettlementEntry,
    SettlementFilters,
    SettlementSummary,
    SettlementTransaction,
)
from src.services.database_manager.connection import get_db_session
from src.utils.logger import get_logger

logger = get_logger(__name__)

router = APIRouter(prefix="/settlements", tags=["settlements"])


def _calculate_participant_share(split_breakdown: Dict[str, Any], participant: str, total_amount: float) -> float:
    """Calculate a participant's share from split breakdown."""
    if not split_breakdown or not isinstance(split_breakdown, dict):
        return 0.0
    
    mode = split_breakdown.get("mode", "equal")
    entries = split_breakdown.get("entries", [])
    
    if mode == "equal":
        # Equal split: total amount divided by number of participants
        if entries:
            return total_amount / len(entries)
        return 0.0
    elif mode == "custom":
        # Custom split: find the participant's specific amount
        for entry in entries:
            if entry.get("participant") == participant:
                return float(entry.get("amount", 0))
        return 0.0
    
    return 0.0


def _get_participants_from_split_breakdown(split_breakdown: Dict[str, Any]) -> List[str]:
    """Extract all participants from split breakdown."""
    if not split_breakdown or not isinstance(split_breakdown, dict):
        return []
    
    entries = split_breakdown.get("entries", [])
    participants = []
    
    for entry in entries:
        participant = entry.get("participant")
        if participant and participant not in participants:
            participants.append(participant)
    
    return participants


async def _get_settlement_transactions(
    db_session: AsyncSession,
    filters: SettlementFilters,
    participant: Optional[str] = None
) -> List[Dict[str, Any]]:
    """Get transactions for settlement calculations."""
    
    # Build the base query
    query = """
        SELECT 
            id, transaction_date, description, amount, split_share_amount,
            split_breakdown, account, direction, transaction_type
        FROM transactions 
        WHERE is_shared = true 
        AND split_breakdown IS NOT NULL
    """
    
    params = {}
    
    # Add date filters
    if filters.date_range_start:
        query += " AND transaction_date >= :date_start"
        params["date_start"] = filters.date_range_start
    
    if filters.date_range_end:
        query += " AND transaction_date <= :date_end"
        params["date_end"] = filters.date_range_end
    
    # Add amount filter
    if filters.min_amount is not None:
        query += " AND amount >= :min_amount"
        params["min_amount"] = filters.min_amount
    
    # Order by date
    query += " ORDER BY transaction_date DESC"
    
    result = await db_session.execute(text(query), params)
    transactions = result.fetchall()
    
    # Convert to list of dicts and filter by participant if specified
    filtered_transactions = []
    for row in transactions:
        transaction_dict = {
            "id": str(row.id),
            "date": row.transaction_date.isoformat(),
            "description": row.description,
            "amount": float(row.amount),
            "split_share_amount": float(row.split_share_amount) if row.split_share_amount else 0.0,
            "split_breakdown": row.split_breakdown if row.split_breakdown else {},
            "account": row.account,
            "direction": row.direction,
            "transaction_type": row.transaction_type,
        }
        
        # Filter by participant if specified
        if participant:
            participants = _get_participants_from_split_breakdown(transaction_dict["split_breakdown"])
            if participant not in participants:
                continue
        
        filtered_transactions.append(transaction_dict)
    
    return filtered_transactions


def _calculate_settlements(transactions: List[Dict[str, Any]]) -> SettlementSummary:
    """Calculate settlements from transaction data."""
    
    # Track balances per participant
    participant_balances: Dict[str, Dict[str, float]] = {}
    
    for transaction in transactions:
        split_breakdown = transaction.get("split_breakdown", {})
        if not split_breakdown:
            continue
        
        total_amount = transaction["amount"]
        participants = _get_participants_from_split_breakdown(split_breakdown)
        
        # Determine who paid (assumption: the account owner paid)
        paid_by = "me"  # This could be made more sophisticated
        
        for participant in participants:
            if participant not in participant_balances:
                participant_balances[participant] = {
                    "amount_owed_to_me": 0.0,
                    "amount_i_owe": 0.0,
                    "transaction_count": 0
                }
            
            participant_share = _calculate_participant_share(split_breakdown, participant, total_amount)
            my_share = _calculate_participant_share(split_breakdown, "me", total_amount)
            
            if paid_by == "me":
                # I paid, so participant owes me their share
                participant_balances[participant]["amount_owed_to_me"] += participant_share
            elif paid_by == participant:
                # Participant paid, so I owe them my share
                participant_balances[participant]["amount_i_owe"] += my_share
            
            participant_balances[participant]["transaction_count"] += 1
    
    # Convert to settlement entries
    settlements = []
    total_owed_to_me = 0.0
    total_i_owe = 0.0
    
    for participant, balance in participant_balances.items():
        if participant == "me":
            continue  # Skip self-references
        
        net_balance = balance["amount_owed_to_me"] - balance["amount_i_owe"]
        
        # Skip zero balances if not including settled
        if net_balance == 0.0:
            continue
        
        settlement_entry = SettlementEntry(
            participant=participant,
            amount_owed_to_me=balance["amount_owed_to_me"],
            amount_i_owe=balance["amount_i_owe"],
            net_balance=net_balance,
            transaction_count=balance["transaction_count"]
        )
        
        settlements.append(settlement_entry)
        total_owed_to_me += balance["amount_owed_to_me"]
        total_i_owe += balance["amount_i_owe"]
    
    # Sort by absolute net balance (highest first)
    settlements.sort(key=lambda x: abs(x.net_balance), reverse=True)
    
    return SettlementSummary(
        total_amount_owed_to_me=total_owed_to_me,
        total_amount_i_owe=total_i_owe,
        net_total_balance=total_owed_to_me - total_i_owe,
        participant_count=len(settlements),
        settlements=settlements
    )


@router.get("/summary", response_model=ApiResponse)
async def get_settlement_summary(
    date_range_start: Optional[date] = Query(None, description="Start date for filtering"),
    date_range_end: Optional[date] = Query(None, description="End date for filtering"),
    min_amount: Optional[float] = Query(None, description="Minimum transaction amount"),
    db_session: AsyncSession = Depends(get_db_session)
):
    """Get summary of all settlements."""
    try:
        filters = SettlementFilters(
            date_range_start=date_range_start,
            date_range_end=date_range_end,
            min_amount=min_amount,
            include_settled=False
        )
        
        transactions = await _get_settlement_transactions(db_session, filters)
        settlement_summary = _calculate_settlements(transactions)
        
        return ApiResponse(
            success=True,
            data=settlement_summary.model_dump(),
            message="Settlement summary retrieved successfully"
        )
        
    except Exception as e:
        logger.error(f"Error getting settlement summary: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/participant/{participant}", response_model=ApiResponse)
async def get_participant_settlement(
    participant: str,
    date_range_start: Optional[date] = Query(None, description="Start date for filtering"),
    date_range_end: Optional[date] = Query(None, description="End date for filtering"),
    min_amount: Optional[float] = Query(None, description="Minimum transaction amount"),
    db_session: AsyncSession = Depends(get_db_session)
):
    """Get detailed settlement information for a specific participant."""
    try:
        filters = SettlementFilters(
            date_range_start=date_range_start,
            date_range_end=date_range_end,
            min_amount=min_amount,
            include_settled=True
        )
        
        transactions = await _get_settlement_transactions(db_session, filters, participant)
        
        # Calculate detailed settlement for this participant
        participant_transactions = []
        total_shared_amount = 0.0
        amount_owed_to_me = 0.0
        amount_i_owe = 0.0
        
        for transaction in transactions:
            split_breakdown = transaction.get("split_breakdown", {})
            if not split_breakdown:
                continue
            
            total_amount = transaction["amount"]
            participant_share = _calculate_participant_share(split_breakdown, participant, total_amount)
            my_share = _calculate_participant_share(split_breakdown, "me", total_amount)
            
            # Determine who paid (simplified assumption)
            paid_by = "me"  # Could be enhanced to determine actual payer
            
            if participant_share > 0 or my_share > 0:
                settlement_transaction = SettlementTransaction(
                    id=transaction["id"],
                    date=transaction["date"],
                    description=transaction["description"],
                    amount=total_amount,
                    my_share=my_share,
                    participant_share=participant_share,
                    paid_by=paid_by,
                    split_breakdown=split_breakdown
                )
                
                participant_transactions.append(settlement_transaction)
                total_shared_amount += total_amount
                
                if paid_by == "me":
                    amount_owed_to_me += participant_share
                else:
                    amount_i_owe += my_share
        
        net_balance = amount_owed_to_me - amount_i_owe
        
        settlement_detail = SettlementDetail(
            participant=participant,
            net_balance=net_balance,
            transactions=participant_transactions,
            total_shared_amount=total_shared_amount
        )
        
        return ApiResponse(
            success=True,
            data=settlement_detail.model_dump(),
            message=f"Settlement details for {participant} retrieved successfully"
        )
        
    except Exception as e:
        logger.error(f"Error getting participant settlement for {participant}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/participants", response_model=ApiResponse)
async def get_all_participants(
    date_range_start: Optional[date] = Query(None, description="Start date for filtering"),
    date_range_end: Optional[date] = Query(None, description="End date for filtering"),
    db_session: AsyncSession = Depends(get_db_session)
):
    """Get list of all participants with shared transactions."""
    try:
        filters = SettlementFilters(
            date_range_start=date_range_start,
            date_range_end=date_range_end,
            include_settled=True
        )
        
        transactions = await _get_settlement_transactions(db_session, filters)
        
        # Collect all unique participants
        all_participants = set()
        for transaction in transactions:
            split_breakdown = transaction.get("split_breakdown", {})
            participants = _get_participants_from_split_breakdown(split_breakdown)
            all_participants.update(participants)
        
        # Remove "me" from the list
        all_participants.discard("me")
        
        participants_list = sorted(list(all_participants))
        
        return ApiResponse(
            success=True,
            data={"participants": participants_list},
            message="Participants list retrieved successfully"
        )
        
    except Exception as e:
        logger.error(f"Error getting participants list: {e}")
        raise HTTPException(status_code=500, detail=str(e))
