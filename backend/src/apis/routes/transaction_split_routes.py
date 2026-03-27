"""
Routes for split/group/transfer operations on transactions.
"""

from __future__ import annotations

from decimal import Decimal
from uuid import uuid4

from fastapi import APIRouter, HTTPException
from sqlalchemy import text

from src.apis.schemas.common import ApiResponse
from src.apis.schemas.transactions import (
    GroupExpenseRequest,
    GroupTransferRequest,
    SplitTransactionRequest,
    UngroupExpenseRequest,
    UngroupSplitRequest,
)
from src.services.database_manager.connection import get_session_factory
from src.services.database_manager.operations import TransactionOperations
from src.utils.db_utils import handle_database_operation
from src.utils.logger import get_logger
from src.utils.transaction_utils import _convert_db_transaction_to_response

logger = get_logger(__name__)
router = APIRouter(prefix="/transactions", tags=["transactions"])


@router.post("/group-transfer", response_model=ApiResponse)
async def group_transfer(request: GroupTransferRequest):
    """Group transactions as a transfer."""
    logger.info("Grouping %d transactions as transfer", len(request.transaction_ids))
    try:
        # Generate a transfer group ID
        transaction_group_id = str(uuid4())

        # Update all transactions to have the same transfer group ID
        updated_transactions = []
        for transaction_id in request.transaction_ids:
            success = await TransactionOperations.update_transaction(
                transaction_id,
                transaction_group_id=transaction_group_id,
            )
            if success:
                transaction = await TransactionOperations.get_transaction_by_id(transaction_id)
                updated_transactions.append(_convert_db_transaction_to_response(transaction))

        logger.info("Grouped transfer, transaction_group_id=%s", transaction_group_id)
        return ApiResponse(data=updated_transactions, message="Transfer grouped successfully")

    except Exception:
        logger.error("Failed to group transfer, transaction_group_id=%s", transaction_group_id, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


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
    logger.info("Grouping %d transactions as expense", len(request.transaction_ids))
    try:
        transaction_group_id = str(uuid4())

        # Validate all transactions exist
        transactions = []
        for transaction_id in request.transaction_ids:
            transaction = await handle_database_operation(
                TransactionOperations.get_transaction_by_id,
                transaction_id,
            )
            if not transaction:
                raise HTTPException(status_code=404, detail=f"Transaction {transaction_id} not found")

            # Reject only if this row is the collapsed summary of a grouped expense (cannot group that with others)
            if transaction.get('transaction_group_id') and transaction.get('is_grouped_expense'):
                raise HTTPException(
                    status_code=400,
                    detail=f"Transaction {transaction_id} is the summary row of a grouped expense. Ungroup first or select only the individual transactions.",
                )
            # Individuals in a group (or orphaned group) are allowed: we will assign them to the new group
            transactions.append(transaction)

        if not transactions:
            raise HTTPException(status_code=400, detail="No valid transactions to group")

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
                transaction_group_id=transaction_group_id,
            )
            if success:
                updated_tx = await handle_database_operation(
                    TransactionOperations.get_transaction_by_id,
                    str(transaction.get('id')),
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
            transaction_group_id=transaction_group_id,
            is_grouped_expense=True,
            transaction_source="manual_entry",
        )

        # Fetch the created collapsed transaction
        collapsed_transaction = await handle_database_operation(
            TransactionOperations.get_transaction_by_id,
            collapsed_transaction_id,
        )

        logger.info("Grouped %d transactions, transaction_group_id=%s", len(transactions), transaction_group_id)
        return ApiResponse(
            data={
                "collapsed_transaction": _convert_db_transaction_to_response(collapsed_transaction),
                "grouped_transactions": updated_transactions,
                "net_amount": float(net_amount),
                "transaction_group_id": transaction_group_id,
            },
            message=f"Successfully grouped {len(transactions)} transactions into a single expense",
        )

    except HTTPException:
        raise
    except Exception:
        logger.error("Failed to group expense, transaction_group_id=%s", transaction_group_id, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.post("/ungroup-expense", response_model=ApiResponse)
async def ungroup_expense(request: UngroupExpenseRequest):
    """
    Ungroup expense transactions.

    - Deletes the collapsed transaction (where is_grouped_expense = True)
    - Removes transaction_group_id from all individual transactions
    - Individual transactions become visible again in the main view
    """
    logger.info("Ungrouping expense, transaction_group_id=%s", request.transaction_group_id)
    try:
        async with get_session_factory()() as session:
            # Get all transactions in the group
            result = await session.execute(
                text("""
                    SELECT id, is_grouped_expense
                    FROM transactions
                    WHERE transaction_group_id = :group_id
                    AND is_deleted = false
                """),
                {"group_id": request.transaction_group_id},
            )
            transactions = result.fetchall()

            if not transactions:
                # Make this idempotent: if already ungrouped (or never existed), don't error.
                return ApiResponse(
                    data={"restored_transactions": [], "deleted_collapsed": False},
                    message="Grouped expense already ungrouped",
                )

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
                    collapsed_transaction_id,
                )

            # Remove group_id from all individual transactions
            restored_transactions = []
            for transaction_id in individual_transaction_ids:
                success = await handle_database_operation(
                    TransactionOperations.update_transaction,
                    transaction_id,
                    transaction_group_id=None,
                )
                if success:
                    restored = await handle_database_operation(
                        TransactionOperations.get_transaction_by_id,
                        transaction_id,
                    )
                    if restored is not None:
                        restored_transactions.append(_convert_db_transaction_to_response(restored))

            logger.info("Ungrouped expense, transaction_group_id=%s", request.transaction_group_id)
            return ApiResponse(
                data={
                    "restored_transactions": restored_transactions,
                    "deleted_collapsed": collapsed_transaction_id is not None,
                },
                message=f"Ungrouped expense. {len(restored_transactions)} transactions restored.",
            )

    except HTTPException:
        raise
    except Exception:
        logger.error("Failed to ungroup expense, transaction_group_id=%s", request.transaction_group_id, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.post("/ungroup-split", response_model=ApiResponse)
async def ungroup_split_transactions(request: UngroupSplitRequest):
    """
    Ungroup split transactions and restore the original.

    Strategy:
    - If original transaction exists in group (wasn't deleted), restore it
    - Delete all split part transactions
    - If original was deleted during split, there's nothing to restore
    """
    logger.info("Ungrouping split, transaction_group_id=%s", request.transaction_group_id)
    try:
        async with get_session_factory()() as session:
            # Get all transactions in the split group (both parent and children)
            result = await session.execute(
                text("""
                    SELECT id, description, amount, created_at, is_split
                    FROM transactions
                    WHERE transaction_group_id = :group_id
                    ORDER BY created_at ASC
                """),
                {"group_id": request.transaction_group_id},
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
                    str(split_part.id),
                )

            # Restore the original transaction if it exists
            if original_transaction:
                await handle_database_operation(
                    TransactionOperations.update_transaction,
                    str(original_transaction.id),
                    is_split=False,
                    transaction_group_id=None,
                )

                # Fetch the restored transaction
                restored = await handle_database_operation(
                    TransactionOperations.get_transaction_by_id,
                    str(original_transaction.id),
                )

                logger.info("Ungrouped split, transaction_group_id=%s", request.transaction_group_id)
                return ApiResponse(
                    data=_convert_db_transaction_to_response(restored),
                    message=f"Split removed. Original transaction restored. {len(split_parts)} split parts deleted.",
                )
            else:
                logger.info("Ungrouped split, transaction_group_id=%s", request.transaction_group_id)
                return ApiResponse(
                    data={"deleted_count": len(split_parts)},
                    message=f"Split removed. {len(split_parts)} split parts deleted. Original was not in the group.",
                )


    except HTTPException:
        raise
    except Exception:
        logger.error("Failed to ungroup split, transaction_group_id=%s", request.transaction_group_id, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.post("/split-transaction", response_model=ApiResponse)
async def split_transaction(request: SplitTransactionRequest):
    """Split a transaction into multiple parts."""
    logger.info("Splitting transaction id=%s into %d parts", request.transaction_id, len(request.parts))
    try:
        # Generate transaction group ID early so it's available for error logging
        split_group_id = str(uuid4())

        # Get the original transaction
        original_transaction = await handle_database_operation(
            TransactionOperations.get_transaction_by_id,
            request.transaction_id,
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
                detail=f"Sum of split parts ({total_parts_amount}) does not equal expected amount ({expected_amount})",
            )

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
                            {"participant": "me", "amount": float(part.amount)},
                        ],
                        "paid_by": original_paid_by,
                        "total_participants": 1,
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
                    transaction_group_id=split_group_id,
                    transaction_source="manual_entry",
                )

                # Fetch the created transaction
                created_transaction = await handle_database_operation(
                    TransactionOperations.get_transaction_by_id,
                    transaction_id,
                )
                created_transactions.append(_convert_db_transaction_to_response(created_transaction))

            except Exception:
                logger.error(
                    "Failed to create split part %r, transaction_group_id=%s",
                    part.description,
                    split_group_id,
                    exc_info=True,
                )
                # Continue with other parts even if one fails
                continue

        # Handle original transaction
        if request.delete_original:
            # Delete the original transaction
            await handle_database_operation(
                TransactionOperations.delete_transaction,
                request.transaction_id,
            )
        else:
            # Add the original transaction to the group but keep is_split=False
            # This allows us to identify it as the parent transaction
            await handle_database_operation(
                TransactionOperations.update_transaction,
                request.transaction_id,
                is_split=False,  # Keep as False to identify as parent
                transaction_group_id=split_group_id,
            )
            # Fetch the updated original transaction
            updated_original = await handle_database_operation(
                TransactionOperations.get_transaction_by_id,
                request.transaction_id,
            )
            created_transactions.insert(0, _convert_db_transaction_to_response(updated_original))

        logger.info(
            "Split transaction into %d parts, transaction_group_id=%s",
            len(created_transactions),
            split_group_id,
        )
        return ApiResponse(
            data={
                "split_group_id": split_group_id,
                "transactions": created_transactions,
            },
            message=f"Transaction split successfully into {len(created_transactions)} parts",
        )

    except HTTPException:
        raise
    except Exception:
        logger.error(
            "Failed to split transaction, transaction_group_id=%s",
            split_group_id,
            exc_info=True,
        )
        raise HTTPException(status_code=500, detail="Internal server error")
