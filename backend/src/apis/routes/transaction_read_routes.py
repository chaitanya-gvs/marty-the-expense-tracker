"""
Read-only (GET) routes for transactions, categories, and tags.
"""

from __future__ import annotations

from datetime import date as DateType, datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse
from sqlalchemy import text

from src.apis.schemas.common import ApiResponse
from src.apis.schemas.transactions import TransferSuggestion
from src.services.cloud_storage.gcs_service import GoogleCloudStorageService
from src.services.database_manager.connection import get_session_factory
from src.services.database_manager.operations import CategoryOperations, SuggestionOperations, TagOperations, TransactionOperations
from src.services.email_ingestion.client import EmailClient
from src.utils.db_utils import handle_database_operation
from src.utils.logger import get_logger
from src.utils.settings import get_settings
from src.utils.transaction_utils import _convert_db_tag_to_response, _convert_db_transaction_to_response

logger = get_logger(__name__)
router = APIRouter(prefix="/transactions", tags=["transactions"])


@router.get("", response_model=ApiResponse)
@router.get("/", response_model=ApiResponse)
async def get_transactions(
    date_range_start: Optional[DateType] = Query(None, description="Start date for filtering"),
    date_range_end: Optional[DateType] = Query(None, description="End date for filtering"),
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
    is_grouped_expense: Optional[bool] = Query(None, description="Filter transactions by grouped expense status (True to show only grouped transactions)"),
    participants: Optional[str] = Query(None, description="Comma-separated participant names to include"),
    exclude_participants: Optional[str] = Query(None, description="Comma-separated participant names to exclude"),
    sort_field: Optional[str] = Query("date", description="Field to sort by"),
    sort_direction: Optional[str] = Query("desc", pattern="^(asc|desc)$", description="Sort direction"),
    page: int = Query(1, ge=1, description="Page number"),
    limit: int = Query(50, ge=1, le=500, description="Items per page"),
):
    """Get transactions with filtering, sorting, and pagination."""
    logger.info("Fetching transactions: page=%d, limit=%d", page, limit)
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
            is_flagged is not None or is_shared is not None or is_split is not None or is_grouped_expense is not None
        )

        # If filters are present, fetch ALL transactions first, then filter and paginate
        # If no filters, we can paginate at the database level for better performance
        if has_filters:
            # Fetch all transactions (use a very large limit to get all)
            if date_range_start or date_range_end:
                transactions = await handle_database_operation(
                    TransactionOperations.get_transactions_by_date_range,
                    start_date=date_range_start or DateType.min,
                    end_date=date_range_end or DateType.max,
                    limit=1000000,  # Very large limit to get all transactions in range
                    offset=0,
                    order_by="DESC" if sort_direction == "desc" else "ASC",
                )
            else:
                transactions = await handle_database_operation(
                    TransactionOperations.get_all_transactions,
                    limit=1000000,  # Very large limit to get all transactions
                    offset=0,
                    order_by="DESC" if sort_direction == "desc" else "ASC",
                )
        else:
            # No filters - paginate at database level for performance
            if date_range_start or date_range_end:
                transactions = await handle_database_operation(
                    TransactionOperations.get_transactions_by_date_range,
                    start_date=date_range_start or DateType.min,
                    end_date=date_range_end or DateType.max,
                    limit=limit,
                    offset=(page - 1) * limit,
                    order_by="DESC" if sort_direction == "desc" else "ASC",
                )
            else:
                transactions = await handle_database_operation(
                    TransactionOperations.get_all_transactions,
                    limit=limit,
                    offset=(page - 1) * limit,
                    order_by="DESC" if sort_direction == "desc" else "ASC",
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
            if txn.get('transaction_group_id') and (txn.get('is_split') is True):
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

            # Apply is_grouped_expense filter (e.g., to show only grouped transactions)
            if is_grouped_expense is not None:
                transaction_is_grouped = transaction.get('is_grouped_expense')
                if transaction_is_grouped is None:
                    transaction_is_grouped = False
                if bool(transaction_is_grouped) != is_grouped_expense:
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
                    start_date=date_range_start or DateType.min,
                    end_date=date_range_end or DateType.max,
                    limit=1000000,
                    offset=0,
                    order_by="DESC" if sort_direction == "desc" else "ASC",
                )
            else:
                all_transactions_for_count = await handle_database_operation(
                    TransactionOperations.get_all_transactions,
                    limit=1000000,
                    offset=0,
                    order_by="DESC" if sort_direction == "desc" else "ASC",
                )
            total_count = len(all_transactions_for_count)
            total_pages = (total_count + limit - 1) // limit if limit > 0 else 1
            paginated_transactions = filtered_transactions  # Already paginated from DB

        # Compute aggregate totals over the FULL filtered set (not just the current page)
        full_set = filtered_transactions if has_filters else all_transactions_for_count
        total_debits = sum(
            float(t.get('split_share_amount') or t.get('amount', 0))
            for t in full_set
            if t.get('direction') == 'debit'
        )
        total_credits = sum(
            float(t.get('split_share_amount') or t.get('amount', 0))
            for t in full_set
            if t.get('direction') == 'credit'
        )

        # Convert to response format
        response_transactions = [_convert_db_transaction_to_response(t) for t in paginated_transactions]

        logger.info("Returned %d transactions (total=%d)", len(response_transactions), total_count)
        return ApiResponse(
            data=response_transactions,
            pagination={
                "page": page,
                "limit": limit,
                "total": total_count,
                "total_pages": total_pages,
                "total_debits": total_debits,
                "total_credits": total_credits,
            },
        )

    except Exception:
        logger.error("Failed to get transactions", exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get("/search", response_model=ApiResponse)
async def search_transactions(
    query: str = Query(..., description="Search query"),
    limit: int = Query(100, ge=1, le=500, description="Maximum results to return"),
    offset: int = Query(0, ge=0, description="Number of results to skip"),
):
    """Search transactions by description, notes, or reference number."""
    logger.info("Searching transactions: query=%r", query)
    try:
        transactions = await handle_database_operation(
            TransactionOperations.search_transactions,
            query=query,
            limit=limit,
            offset=offset,
        )

        response_transactions = [_convert_db_transaction_to_response(t) for t in transactions]

        logger.info("Returned %d search results", len(response_transactions))
        return ApiResponse(data=response_transactions)

    except Exception:
        logger.error("Failed to search transactions", exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get("/field-values/{field_name}", response_model=ApiResponse)
async def get_unique_field_values(
    field_name: str,
    query: Optional[str] = Query(None, description="Filter by partial match"),
    limit: int = Query(20, ge=1, le=100, description="Maximum number of results"),
):
    """Get unique values for a transaction field (for autocomplete)."""
    logger.info("Fetching field values: field=%s", field_name)
    try:
        # Map field names from API to database column names
        field_mapping = {
            "description": "description",
            "account": "account",
            "notes": "notes",
            "paid_by": "paid_by",
        }

        if field_name not in field_mapping:
            raise HTTPException(status_code=400, detail=f"Field '{field_name}' not supported")

        db_field = field_mapping[field_name]

        async with get_session_factory()() as session:
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
                        {"search_term": search_term, "query": query, "limit": limit},
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
                        {"query": f"%{query}%", "limit": limit},
                    )
            else:
                target_field = "COALESCE(user_description, description)" if field_name == "description" else db_field

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

            logger.info("Returned %d field values for %s", len(values), field_name)
            return ApiResponse(data=values)

    except HTTPException:
        raise
    except Exception:
        logger.error("Failed to get unique field values for field=%s", field_name, exc_info=True)


@router.get("/predict-category", response_model=ApiResponse)
async def predict_category(
    description: str = Query(..., description="Details to predict category from"),
):
    """Predict category based on transaction description."""
    logger.info("Predicting category: description=%r", description)
    try:
        prediction = await TransactionOperations.predict_category(description)
        logger.info("Category prediction complete")
        return ApiResponse(data=prediction)
    except Exception:
        logger.error("Failed to predict category", exc_info=True)
        # Return null data instead of error for prediction
        return ApiResponse(data=None, message="Category prediction failed")


@router.get("/analytics", response_model=ApiResponse)
async def get_expense_analytics(
    date_range_start: Optional[DateType] = Query(None, description="Start date for filtering"),
    date_range_end: Optional[DateType] = Query(None, description="End date for filtering"),
    accounts: Optional[str] = Query(None, description="Comma-separated account names"),
    exclude_accounts: Optional[str] = Query(None, description="Comma-separated account names to exclude"),
    categories: Optional[str] = Query(None, description="Comma-separated category names"),
    exclude_categories: Optional[str] = Query(None, description="Comma-separated category names to exclude"),
    tags: Optional[str] = Query(None, description="Comma-separated tag names"),
    exclude_tags: Optional[str] = Query(None, description="Comma-separated tag names to exclude"),
    direction: Optional[str] = Query("debit", pattern="^(debit|credit)$", description="Transaction direction"),
    group_by: str = Query("category", description="Group by: category, tag, month, account, category_month, tag_month"),
):
    """Get expense analytics aggregated by various dimensions."""
    logger.info("Fetching expense analytics: group_by=%s", group_by)
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
                detail=f"Invalid group_by. Must be one of: {', '.join(valid_group_by)}",
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
            group_by=group_by,
        )

        logger.info("Returned analytics data grouped by %s", group_by)
        return ApiResponse(data=analytics_data)

    except HTTPException:
        raise
    except Exception:
        logger.error("Failed to get expense analytics", exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get("/suggestions/transfers", response_model=ApiResponse)
async def get_transfer_suggestions(
    days_back: int = Query(30, ge=1, le=365, description="Days to look back for transactions"),
    min_amount: float = Query(10.0, ge=0.01, description="Minimum transaction amount"),
    max_time_diff_hours: int = Query(24, ge=1, le=168, description="Maximum time difference in hours"),
):
    """Get suggestions for potential transfer pairs."""
    logger.info("Fetching transfer suggestions: days_back=%d", days_back)
    try:
        suggestions = await SuggestionOperations.find_transfer_suggestions(
            days_back=days_back,
            min_amount=min_amount,
            max_time_diff_hours=max_time_diff_hours,
        )

        # Convert to response format
        response_suggestions = []
        for suggestion in suggestions:
            response_suggestions.append(
                TransferSuggestion(
                    transactions=suggestion["transactions"],
                    confidence=suggestion["confidence"],
                    reason=suggestion["reason"],
                )
            )

        logger.info("Returned %d transfer suggestions", len(response_suggestions))
        return ApiResponse(data=response_suggestions)

    except Exception:
        logger.error("Failed to get transfer suggestions", exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get("/suggestions/refunds", response_model=ApiResponse)
async def get_refund_suggestions(
    days_back: int = Query(90, ge=1, le=365, description="Days to look back for transactions"),
    min_amount: float = Query(5.0, ge=0.01, description="Minimum transaction amount"),
):
    """Get suggestions for potential refund pairs."""
    logger.info("Fetching refund suggestions: days_back=%d", days_back)
    try:
        # Simplified refund suggestions - would need full implementation
        suggestions: List[Any] = []

        logger.info("Returned %d refund suggestions", len(suggestions))
        return ApiResponse(data=suggestions)

    except Exception:
        logger.error("Failed to get refund suggestions", exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get("/suggestions/summary", response_model=ApiResponse)
async def get_suggestions_summary():
    """Get summary of available suggestions."""
    logger.info("Fetching suggestions summary")
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
                "low_confidence": len([c for c in transfer_confidences if c < 0.4]),
            },
            "refund_suggestions": {
                "count": 0,
                "high_confidence": 0,
                "medium_confidence": 0,
                "low_confidence": 0,
            },
            "last_updated": datetime.now().isoformat(),
        }

        logger.info("Returned suggestions summary")
        return ApiResponse(data=summary)

    except Exception:
        logger.error("Failed to get suggestions summary", exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get("/tags", response_model=ApiResponse)
async def get_tags():
    """Get all tags with usage counts."""
    logger.info("Fetching all tags")
    try:
        tags = await TagOperations.get_all_tags()
        response_tags = [_convert_db_tag_to_response(t) for t in tags]

        logger.info("Returned %d tags", len(response_tags))
        return ApiResponse(data=response_tags)

    except Exception:
        logger.error("Failed to get tags", exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get("/tags/search", response_model=ApiResponse)
async def search_tags(
    query: str = Query(..., description="Search query for tag names"),
    limit: int = Query(20, ge=1, le=100, description="Maximum number of results"),
):
    """Search tags by name."""
    logger.info("Searching tags: query=%r", query)
    try:
        tags = await TagOperations.search_tags(query, limit)
        response_tags = [_convert_db_tag_to_response(t) for t in tags]

        logger.info("Returned %d matching tags", len(response_tags))
        return ApiResponse(data=response_tags)

    except Exception:
        logger.error("Failed to search tags", exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get("/tags/{tag_id}", response_model=ApiResponse)
async def get_tag(tag_id: str):
    """Get a specific tag by ID."""
    logger.info("Fetching tag id=%s", tag_id)
    try:
        tag = await TagOperations.get_tag_by_id(tag_id)
        if not tag:
            raise HTTPException(status_code=404, detail="Tag not found")

        response_tag = _convert_db_tag_to_response(tag)
        logger.info("Returned tag id=%s", tag_id)
        return ApiResponse(data=response_tag)

    except HTTPException:
        raise
    except Exception:
        logger.error("Failed to get tag id=%s", tag_id, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get("/categories", response_model=ApiResponse)
async def get_categories(
    transaction_type: Optional[str] = Query(None, description="Filter by transaction type: 'debit' or 'credit'"),
):
    """Get all active categories, optionally filtered by transaction type."""
    logger.info("Fetching categories: transaction_type=%s", transaction_type)
    try:
        categories = await CategoryOperations.get_all_categories(transaction_type=transaction_type)
        logger.info("Returned %d categories", len(categories))
        return ApiResponse(data=categories)

    except Exception:
        logger.error("Failed to get categories", exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get("/categories/search", response_model=ApiResponse)
async def search_categories(
    query: str = Query(..., description="Search query for category names"),
    limit: int = Query(20, ge=1, le=100, description="Maximum number of results"),
    transaction_type: Optional[str] = Query(None, description="Filter by transaction type: 'debit' or 'credit'"),
):
    """Search categories by name, optionally filtered by transaction type."""
    logger.info("Searching categories: query=%r", query)
    try:
        categories = await CategoryOperations.search_categories(query, limit, transaction_type=transaction_type)
        logger.info("Returned %d matching categories", len(categories))
        return ApiResponse(data=categories)

    except Exception:
        logger.error("Failed to search categories", exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get("/categories/{category_id}", response_model=ApiResponse)
async def get_category(category_id: str):
    """Get a specific category by ID."""
    logger.info("Fetching category id=%s", category_id)
    try:
        category = await CategoryOperations.get_category_by_id(category_id)
        if not category:
            raise HTTPException(status_code=404, detail="Category not found")

        logger.info("Returned category id=%s", category_id)
        return ApiResponse(data=category)

    except HTTPException:
        raise
    except Exception:
        logger.error("Failed to get category id=%s", category_id, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get("/{transaction_id}", response_model=ApiResponse)
async def get_transaction(transaction_id: str):
    """Get a single transaction by ID."""
    logger.info("Fetching transaction id=%s", transaction_id)
    try:
        transaction = await handle_database_operation(
            TransactionOperations.get_transaction_by_id,
            transaction_id,
        )
        if not transaction:
            raise HTTPException(status_code=404, detail="Transaction not found")

        # Get tags for the transaction
        transaction_tags = await TagOperations.get_tags_for_transaction(transaction_id)
        tag_names = [tag['name'] for tag in transaction_tags]
        transaction['tags'] = tag_names

        response_transaction = _convert_db_transaction_to_response(transaction)
        logger.info("Returned transaction id=%s", transaction_id)
        return ApiResponse(data=response_transaction)

    except HTTPException:
        raise
    except Exception:
        logger.error("Failed to get transaction id=%s", transaction_id, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get("/{transaction_id}/related", response_model=ApiResponse)
async def get_related_transactions(transaction_id: str):
    """Get all related transactions for a transaction (group members)."""
    logger.info("Fetching related transactions for id=%s", transaction_id)
    try:
        # Get the transaction first
        transaction = await handle_database_operation(
            TransactionOperations.get_transaction_by_id,
            transaction_id,
        )
        if not transaction:
            raise HTTPException(status_code=404, detail="Transaction not found")

        related_data: Dict[str, Any] = {
            "transaction": _convert_db_transaction_to_response(transaction),
            "group": [],
        }

        # Get group members if this transaction is in a group
        if transaction.get('transaction_group_id'):
            group_members = await handle_database_operation(
                TransactionOperations.get_transfer_group_transactions,
                str(transaction.get('transaction_group_id')),
            )
            if group_members:
                # Tags are already included in get_transfer_group_transactions
                related_data["group"] = [_convert_db_transaction_to_response(t) for t in group_members]

        logger.info("Returned related transactions for id=%s", transaction_id)
        return ApiResponse(data=related_data)

    except HTTPException:
        raise
    except Exception:
        logger.error("Failed to get related transactions for id=%s", transaction_id, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get("/{transaction_id}/children", response_model=ApiResponse)
async def get_child_transactions(transaction_id: str):
    """Get all child transactions (refunds/adjustments) for a parent transaction."""
    logger.info("Fetching child transactions for id=%s", transaction_id)
    try:
        children = await handle_database_operation(
            TransactionOperations.get_child_transactions,
            transaction_id,
        )

        # Tags are already included in get_child_transactions
        response_transactions = [_convert_db_transaction_to_response(t) for t in children]
        logger.info("Returned %d child transactions for id=%s", len(response_transactions), transaction_id)
        return ApiResponse(data=response_transactions)

    except Exception:
        logger.error("Failed to get child transactions for id=%s", transaction_id, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get("/{transaction_id}/group", response_model=ApiResponse)
async def get_group_transactions(transaction_id: str):
    """Get all transactions in the same group (transfer, split, or grouped expense)."""
    logger.info("Fetching group transactions for id=%s", transaction_id)
    try:
        transaction = await handle_database_operation(
            TransactionOperations.get_transaction_by_id,
            transaction_id,
        )
        if not transaction:
            raise HTTPException(status_code=404, detail="Transaction not found")

        if not transaction.get('transaction_group_id'):
            raise HTTPException(status_code=404, detail="This transaction is not in a group")

        group_members = await handle_database_operation(
            TransactionOperations.get_transfer_group_transactions,
            str(transaction.get('transaction_group_id')),
        )

        # Tags are already included in get_transfer_group_transactions
        response_transactions = [_convert_db_transaction_to_response(t) for t in group_members]

        # If this is a grouped expense, filter to only return individual transactions (not the collapsed one)
        if transaction.get('is_grouped_expense'):
            response_transactions = [t for t in response_transactions if not t.is_grouped_expense]
            logger.info("Returned %d group transactions for id=%s", len(response_transactions), transaction_id)
            return ApiResponse(data=response_transactions)

        logger.info("Returned %d group transactions for id=%s", len(response_transactions), transaction_id)
        return ApiResponse(data=response_transactions)

    except HTTPException:
        raise
    except Exception:
        logger.error("Failed to get group transactions for id=%s", transaction_id, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get("/{transaction_id}/emails/search", response_model=ApiResponse)
async def search_transaction_emails(
    transaction_id: str,
    date_offset_days: int = Query(1, ge=0, le=30, description="Days to search before/after transaction date"),
    include_amount_filter: bool = Query(True, description="Whether to filter by amount"),
    start_date: Optional[str] = Query(None, description="Custom start date (YYYY-MM-DD)"),
    end_date: Optional[str] = Query(None, description="Custom end date (YYYY-MM-DD)"),
    custom_search_term: Optional[str] = Query(None, description="Custom search term (e.g., 'Uber', 'Ola', 'Swiggy')"),
    search_amount: Optional[float] = Query(None, description="Optional override for search amount (e.g., rounded amount for UPI)"),
    also_search_amount_minus_one: bool = Query(False, description="Also search for amount-1 (for UPI rounding scenarios)"),
    amount_tolerance: Optional[int] = Query(None, ge=0, le=20, description="Search for amounts in range [amount - tolerance, amount] (integer steps)"),
    verify_body_amount: bool = Query(False, description="Fetch each candidate email body and verify fare amount vs bank debit. Only meaningful when include_amount_filter=False."),
):
    """Search Gmail for emails related to a transaction across both accounts."""
    logger.info("Searching emails for transaction id=%s", transaction_id)
    try:
        # Get transaction details
        transaction = await handle_database_operation(
            TransactionOperations.get_transaction_by_id,
            transaction_id,
        )

        if not transaction:
            raise HTTPException(status_code=404, detail="Transaction not found")

        all_emails = []

        # Search primary account
        try:
            logger.info("Searching primary Gmail account")
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
                also_search_amount_minus_one=also_search_amount_minus_one,
                amount_tolerance=amount_tolerance,
                verify_body_amount=verify_body_amount,
            )
            all_emails.extend(primary_emails)
            logger.info("Found %d emails in primary account", len(primary_emails))
        except Exception:
            logger.error("Error searching primary account", exc_info=True)
            # Continue to secondary account even if primary fails

        # Search secondary account if configured
        try:
            settings = get_settings()
            if settings.GOOGLE_REFRESH_TOKEN_2:
                logger.info("Searching secondary Gmail account")
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
                    also_search_amount_minus_one=also_search_amount_minus_one,
                    amount_tolerance=amount_tolerance,
                    verify_body_amount=verify_body_amount,
                )
                all_emails.extend(secondary_emails)
                logger.info("Found %d emails in secondary account", len(secondary_emails))
            else:
                logger.info("Secondary account not configured, skipping")
        except Exception:
            logger.error("Error searching secondary account", exc_info=True)
            # Continue even if secondary fails

        # Sort by date (most recent first)
        all_emails.sort(key=lambda x: x.get("date", ""), reverse=True)

        logger.info("Found %d emails for transaction id=%s", len(all_emails), transaction_id)
        return ApiResponse(data=all_emails, message=f"Found {len(all_emails)} emails across accounts")

    except HTTPException:
        raise
    except Exception:
        logger.error("Failed to search emails for transaction id=%s", transaction_id, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get("/{transaction_id}/emails/{message_id}", response_model=ApiResponse)
async def get_email_details(transaction_id: str, message_id: str):
    """Get full details of a specific email from either account."""
    logger.info("Fetching email details: message_id=%s, transaction_id=%s", message_id, transaction_id)
    try:
        # Verify transaction exists
        transaction = await handle_database_operation(
            TransactionOperations.get_transaction_by_id,
            transaction_id,
        )

        if not transaction:
            raise HTTPException(status_code=404, detail="Transaction not found")

        email_content = None
        last_error = None

        # Try primary account first
        try:
            primary_client = EmailClient(account_id="primary")
            email_content = primary_client.get_email_content(message_id)
            logger.info("Email message_id=%s found in primary account", message_id)
        except Exception as e:
            last_error = e
            logger.warning("Email message_id=%s not found in primary account", message_id)

            # Try secondary account
            try:
                settings = get_settings()
                if settings.GOOGLE_REFRESH_TOKEN_2:
                    secondary_client = EmailClient(account_id="secondary")
                    email_content = secondary_client.get_email_content(message_id)
                    logger.info("Email message_id=%s found in secondary account", message_id)
            except Exception as e2:
                last_error = e2
                logger.warning("Email message_id=%s not found in secondary account", message_id)

        if not email_content:
            raise HTTPException(
                status_code=404,
                detail=f"Email not found in any account. Last error: {str(last_error)}",
            )

        logger.info("Returned email message_id=%s", message_id)
        return ApiResponse(data=email_content, message="Email retrieved successfully")

    except HTTPException:
        raise
    except Exception:
        logger.error("Failed to get email message_id=%s for transaction id=%s", message_id, transaction_id, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get("/{transaction_id}/source-pdf")
async def get_transaction_source_pdf(transaction_id: str):
    """Get the source PDF statement for a transaction."""
    logger.info("Fetching source PDF for transaction id=%s", transaction_id)
    try:
        # Get transaction details
        transaction = await handle_database_operation(
            TransactionOperations.get_transaction_by_id,
            transaction_id,
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

        logger.info("Searching for PDF with account keywords: %s", account_keywords)

        # Get month/year from transaction date
        transaction_date = transaction.get('transaction_date')
        if not transaction_date:
            raise HTTPException(status_code=400, detail="Transaction has no date")

        # Convert to datetime if it's a date object
        if isinstance(transaction_date, DateType):
            month_year = transaction_date.strftime("%Y-%m")
        else:
            # Parse string date
            try:
                if isinstance(transaction_date, str):
                    transaction_date_obj = datetime.fromisoformat(transaction_date.replace('Z', '+00:00'))
                else:
                    transaction_date_obj = transaction_date
                month_year = transaction_date_obj.strftime("%Y-%m")
            except Exception:
                logger.error("Failed to parse transaction date", exc_info=True)
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
                detail=f"No PDF files found in {prefix}",
            )

        # Find the PDF file that matches the account keywords
        # Use a scoring system: prefer PDFs that match more keywords
        matching_pdf = None
        best_match_score = 0

        logger.info("Searching for PDF with account: %r, keywords: %s", transaction.get('account'), account_keywords)
        logger.info("Found %d PDF files in %s", len(pdf_files), prefix)
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

        # Only use the match if at least one keyword matched
        if matching_pdf and best_match_score > 0:
            logger.info("Found matching PDF: %s (matched %d/%d keywords)", matching_pdf['name'], best_match_score, len(account_keywords))
        else:
            # If no match, use the first PDF file (fallback)
            matching_pdf = pdf_files[0]
            logger.warning("No matching PDF found for account %r, using first available: %s", transaction.get('account'), matching_pdf['name'])

        gcs_path = matching_pdf['name']
        pdf_filename = Path(gcs_path).name
        logger.info("Selected PDF for transaction id=%s: %s", transaction_id, gcs_path)

        # Download PDF to temporary file
        download_result = gcs_service.download_to_temp_file(gcs_path)

        if not download_result.get("success"):
            error_msg = download_result.get("error", "Unknown error")
            logger.error("Failed to download PDF from GCS: %s", error_msg)
            raise HTTPException(
                status_code=404,
                detail=f"PDF not found in cloud storage: {gcs_path}. Error: {error_msg}",
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
                "X-PDF-Filename": pdf_filename,
            },
        )

    except HTTPException:
        raise
    except Exception:
        logger.error("Failed to get source PDF for transaction id=%s", transaction_id, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")
