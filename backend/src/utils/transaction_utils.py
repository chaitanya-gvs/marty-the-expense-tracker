"""
Shared helper functions for converting and processing transaction data.
"""

from __future__ import annotations

import json
from decimal import Decimal
from typing import Any, Dict, Optional

from src.apis.schemas.transactions import TagResponse, TransactionResponse


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

    is_refund = False  # Legacy field, always False now

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

    original_amount = float(transaction.get('amount', 0))

    # Calculate split_share_amount for shared transactions
    split_share_amount = None
    if is_shared and split_breakdown:
        split_share_amount = _calculate_split_share_amount(split_breakdown, original_amount)
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
        transaction_group_id=str(transaction.get('transaction_group_id')) if transaction.get('transaction_group_id') else None,
        related_mails=transaction.get('related_mails', []) or [],
        source_file=transaction.get('source_file'),
        raw_data=_parse_raw_data(transaction.get('raw_data')),
        created_at=transaction.get('created_at', '').isoformat() if transaction.get('created_at') else '',
        updated_at=transaction.get('updated_at', '').isoformat() if transaction.get('updated_at') else '',
        status="reviewed",
        is_deleted=is_deleted,
        deleted_at=transaction.get('deleted_at', '').isoformat() if transaction.get('deleted_at') else None,
        original_date=transaction.get('original_date', '').isoformat() if transaction.get('original_date') else None,
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
        usage_count=tag.get("usage_count", 0),
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
