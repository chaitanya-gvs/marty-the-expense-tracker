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

# Current user name variations to exclude from settlements
CURRENT_USER_NAMES = {"me", "chaitanya gvs", "chaitanya"}


def _normalize_participant_name(name: str) -> str:
    """
    Normalize participant name to a canonical form (title case).
    This handles case variations like 'prachi rai' vs 'Prachi Rai'.
    """
    if not name:
        return name
    
    # Keep "me" as-is (special case)
    if name.lower() == "me":
        return "me"
    
    # Convert to title case (e.g., "prachi rai" -> "Prachi Rai")
    # Split by spaces and title-case each word
    parts = name.split()
    normalized = " ".join(word.capitalize() for word in parts)
    
    return normalized


def _is_current_user(name: str) -> bool:
    """Check if a participant name represents the current user."""
    if not name:
        return False
    return name.lower() in CURRENT_USER_NAMES


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
        # Use case-insensitive comparison for participant matching
        normalized_participant = _normalize_participant_name(participant)
        for entry in entries:
            entry_participant = entry.get("participant")
            if entry_participant and _normalize_participant_name(entry_participant) == normalized_participant:
                return float(entry.get("amount", 0))
        return 0.0
    
    return 0.0


def _infer_paid_by(transaction: Dict[str, Any]) -> Optional[str]:
    """
    Infer who paid for a transaction when paid_by is None.
    
    Logic:
    1. If account is not "Splitwise", it's likely from a bank statement, so "me" paid
    2. Otherwise, check split_breakdown entries to find who has the highest paid_share
    """
    paid_by = transaction.get("paid_by")
    if paid_by:
        return paid_by
    
    # If account is not Splitwise, it's from a bank statement, so I likely paid
    account = transaction.get("account", "")
    if account and account.lower() != "splitwise":
        return "me"
    
    # Otherwise, check split_breakdown to find who paid the most
    split_breakdown = transaction.get("split_breakdown", {})
    if not split_breakdown or not isinstance(split_breakdown, dict):
        return None
    
    entries = split_breakdown.get("entries", [])
    if not entries:
        return None
    
    # Find the entry with the highest paid_share
    max_paid_share = 0.0
    payer = None
    
    for entry in entries:
        paid_share = entry.get("paid_share", 0.0)
        if paid_share > max_paid_share:
            max_paid_share = paid_share
            payer = entry.get("participant")
    
    return payer if max_paid_share > 0 else None


def _get_participants_from_split_breakdown(split_breakdown: Dict[str, Any], normalize: bool = True) -> List[str]:
    """
    Extract all participants from split breakdown.
    
    Args:
        split_breakdown: The split breakdown dictionary
        normalize: If True, normalize names to canonical form and exclude current user
    """
    if not split_breakdown or not isinstance(split_breakdown, dict):
        return []
    
    entries = split_breakdown.get("entries", [])
    participants = []
    seen_normalized = set()
    
    for entry in entries:
        participant = entry.get("participant")
        if not participant:
            continue
        
        # Exclude current user variations
        if normalize and _is_current_user(participant):
            continue
        
        # Normalize name if requested
        if normalize:
            normalized = _normalize_participant_name(participant)
            if normalized not in seen_normalized:
                seen_normalized.add(normalized)
                participants.append(normalized)
        else:
            if participant not in participants:
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
            id, transaction_date, 
            COALESCE(user_description, description) as description,
            amount, split_share_amount,
            (amount - COALESCE((
                SELECT SUM(child.amount)
                FROM transactions child
                WHERE child.link_parent_id = transactions.id
                  AND child.direction = 'credit'
                  AND child.is_deleted = false
            ), 0)) as net_amount,
            split_breakdown, paid_by, account, direction, transaction_type
        FROM transactions 
        WHERE is_shared = true 
        AND split_breakdown IS NOT NULL
        AND is_deleted = false
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
            "net_amount": float(row.net_amount) if hasattr(row, 'net_amount') and row.net_amount is not None else float(row.amount),
            "split_share_amount": float(row.split_share_amount) if row.split_share_amount else 0.0,
            "split_breakdown": row.split_breakdown if row.split_breakdown else {},
            "paid_by": row.paid_by,  # Who actually paid for this transaction
            "account": row.account,
            "direction": row.direction,
            "transaction_type": row.transaction_type,
        }
        
        # Filter by participant if specified (use normalized comparison)
        if participant:
            participants = _get_participants_from_split_breakdown(transaction_dict["split_breakdown"], normalize=True)
            normalized_participant = _normalize_participant_name(participant)
            if normalized_participant not in participants:
                continue
        
        filtered_transactions.append(transaction_dict)
    
    return filtered_transactions


def _calculate_settlements(transactions: List[Dict[str, Any]]) -> SettlementSummary:
    """Calculate settlements from transaction data."""
    
    # Track balances per participant (using normalized names)
    participant_balances: Dict[str, Dict[str, float]] = {}
    
    for transaction in transactions:
        split_breakdown = transaction.get("split_breakdown", {})
        if not split_breakdown:
            continue
        
        total_amount = transaction.get("net_amount", transaction["amount"])
        # Get normalized participants (excludes current user)
        participants = _get_participants_from_split_breakdown(split_breakdown, normalize=True)
        
        # Infer who paid if paid_by is None
        paid_by = _infer_paid_by(transaction)
        normalized_paid_by = _normalize_participant_name(paid_by) if paid_by else None
        
        for participant in participants:
            # participant is already normalized here
            if participant not in participant_balances:
                participant_balances[participant] = {
                    "amount_owed_to_me": 0.0,
                    "amount_i_owe": 0.0,
                    "transaction_count": 0
                }
            
            # Calculate shares using original participant names from entries
            participant_share = _calculate_participant_share(split_breakdown, participant, total_amount)
            my_share = _calculate_participant_share(split_breakdown, "me", total_amount)
            
            # Handle settlement calculation based on who paid
            # Only include transactions where either I paid or the participant paid
            is_paid_by_me = normalized_paid_by == "me"
            is_paid_by_participant = normalized_paid_by == participant or (paid_by and paid_by == participant)
            
            if is_paid_by_me:
                # I paid for the participant's share, so they owe me their share
                participant_balances[participant]["amount_owed_to_me"] += participant_share
                participant_balances[participant]["transaction_count"] += 1
            elif is_paid_by_participant:
                # Participant paid for my share, so I owe them my share
                participant_balances[participant]["amount_i_owe"] += my_share
                participant_balances[participant]["transaction_count"] += 1
            # If paid_by is someone else, we don't track that in our settlements (skip transaction)
    
    # Convert to settlement entries
    settlements = []
    total_owed_to_me = 0.0
    total_i_owe = 0.0
    
    for participant, balance in participant_balances.items():
        # Exclude current user variations (should already be filtered, but double-check)
        if _is_current_user(participant):
            continue
        
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
            
            total_amount = transaction.get("net_amount", transaction["amount"])
            # Normalize participant name for comparison
            normalized_participant = _normalize_participant_name(participant)
            participant_share = _calculate_participant_share(split_breakdown, normalized_participant, total_amount)
            my_share = _calculate_participant_share(split_breakdown, "me", total_amount)
            
            # Infer who paid if paid_by is None
            paid_by = _infer_paid_by(transaction)
            normalized_paid_by = _normalize_participant_name(paid_by) if paid_by else None
            
            # Only include transactions where either I paid or the participant paid
            # This ensures we don't show duplicate transactions paid by someone else
            is_paid_by_me = normalized_paid_by == "me"
            is_paid_by_participant = normalized_paid_by == normalized_participant or (paid_by and paid_by == participant)
            
            # Skip transactions where neither I nor the participant paid
            if not (is_paid_by_me or is_paid_by_participant):
                continue
            
            # Only include if there's a meaningful share for either party
            if participant_share > 0 or my_share > 0:
                settlement_transaction = SettlementTransaction(
                    id=transaction["id"],
                    date=transaction["date"],
                    description=transaction["description"],
                    amount=total_amount,
                    my_share=my_share,
                    participant_share=participant_share,
                    paid_by=paid_by or "Unknown",  # Show inferred payer or "Unknown" if still can't determine
                    split_breakdown=split_breakdown
                )
                
                participant_transactions.append(settlement_transaction)
                # Only add the relevant shares to total, not the full amount
                if is_paid_by_me:
                    # I paid for the participant's share
                    total_shared_amount += participant_share
                elif is_paid_by_participant:
                    # Participant paid for my share
                    total_shared_amount += my_share
                
                if is_paid_by_me:
                    # I paid for the participant's share, so they owe me their share
                    amount_owed_to_me += participant_share
                elif is_paid_by_participant:
                    # Participant paid for my share, so I owe them my share
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
        
        # Collect all unique participants (normalized)
        all_participants = set()
        for transaction in transactions:
            split_breakdown = transaction.get("split_breakdown", {})
            # Get normalized participants (excludes current user automatically)
            participants = _get_participants_from_split_breakdown(split_breakdown, normalize=True)
            all_participants.update(participants)
        
        # Additional check to exclude current user variations (should already be filtered)
        all_participants = {p for p in all_participants if not _is_current_user(p)}
        
        participants_list = sorted(list(all_participants))
        
        return ApiResponse(
            success=True,
            data={"participants": participants_list},
            message="Participants list retrieved successfully"
        )
        
    except Exception as e:
        logger.error(f"Error getting participants list: {e}")
        raise HTTPException(status_code=500, detail=str(e))
