"""
Write (POST/PATCH/DELETE) routes for transactions, categories, tags, and email linking.
"""

from __future__ import annotations

import re
import random
from datetime import datetime
from typing import Any, Dict, List
from uuid import UUID

from fastapi import APIRouter, HTTPException

from src.apis.schemas.budgets import SetRecurringRequest
from src.apis.schemas.common import ApiResponse
from src.apis.schemas.transactions import (
    BulkTransactionUpdate,
    CategoryCreate,
    CategoryUpdate,
    EmailLinkRequest,
    TagCreate,
    TagUpdate,
    TransactionCreate,
    TransactionUpdate,
)
from src.services.database_manager.operations import CategoryOperations, TagOperations, TransactionOperations
from src.utils.db_utils import handle_database_operation
from src.utils.logger import get_logger
from src.utils.transaction_utils import _calculate_split_share_amount, _convert_db_transaction_to_response

logger = get_logger(__name__)
router = APIRouter(prefix="/transactions", tags=["transactions"])

# Tag colors used when auto-creating tags during bulk update
_TAG_COLORS: List[str] = [
    "#ef4444", "#f97316", "#f59e0b", "#eab308", "#84cc16",
    "#22c55e", "#10b981", "#14b8a6", "#06b6d4", "#0ea5e9",
    "#3b82f6", "#6366f1", "#8b5cf6", "#a855f7", "#d946ef",
    "#ec4899", "#f43f5e",
]


def _generate_recurring_key(description: str) -> str:
    """Normalise a transaction description into a stable recurring_key slug."""
    s = description.lower()
    s = re.sub(r'\b\d{4,}\b', '', s)
    s = re.sub(r'upi[:/]?\S*', '', s)
    s = re.sub(r'[^a-z0-9\s-]', ' ', s)
    s = re.sub(r'\s+', '-', s.strip())
    s = re.sub(r'-{2,}', '-', s).strip('-')
    return s[:60] or 'recurring'


@router.post("", response_model=ApiResponse, status_code=201)
@router.post("/", response_model=ApiResponse, status_code=201)
async def create_transaction(transaction_data: TransactionCreate):
    """Create a new transaction."""
    logger.info("Creating transaction: amount=%s, account=%s", transaction_data.amount, transaction_data.account)
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
            is_shared=transaction_data.is_shared,
            split_breakdown=transaction_data.split_breakdown,
            sub_category=transaction_data.subcategory,
            tags=transaction_data.tags,
            notes=transaction_data.notes,
            reference_number=None,
            related_mails=transaction_data.related_mails,
            source_file=transaction_data.source_file,
            raw_data=transaction_data.raw_data,
            transaction_group_id=transaction_data.transaction_group_id,
            transaction_source=transaction_data.transaction_source or "manual_entry",
        )

        # Fetch the created transaction
        created_transaction = await handle_database_operation(
            TransactionOperations.get_transaction_by_id,
            transaction_id,
        )
        response_transaction = _convert_db_transaction_to_response(created_transaction)

        logger.info("Created transaction id=%s", transaction_id)
        return ApiResponse(data=response_transaction, message="Transaction created successfully")

    except Exception:
        logger.error("Failed to create transaction", exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.patch("/bulk-update", response_model=ApiResponse)
async def bulk_update_transactions(request: BulkTransactionUpdate):
    """Bulk update multiple transactions with the same changes."""
    logger.info("Bulk updating %d transactions", len(request.transaction_ids))
    try:
        updated_transactions = []
        failed_updates = []

        for transaction_id in request.transaction_ids:
            try:
                # Convert updates to database format
                update_data: Dict[str, Any] = {}
                for field, value in request.updates.model_dump(exclude_unset=True).items():
                    if field == "date":
                        update_data["transaction_date"] = value
                    elif field == "subcategory":
                        update_data["sub_category"] = value
                    elif field == "is_refund":
                        # Legacy; is_partial_refund removed with unified grouping
                        continue
                    elif field == "is_transfer":
                        # This would need special handling for transfer groups
                        continue
                    elif field == "category":
                        # Handle category - could be either name or ID
                        if value:
                            # Check if it's a UUID (category ID) or a name
                            try:
                                # Try to parse as UUID - if successful, it's an ID
                                UUID(value)
                                # It's a valid UUID, use it directly
                                logger.info("Using category ID directly: %s", value)
                                update_data["category_id"] = value
                            except (ValueError, AttributeError):
                                # It's a category name, look it up
                                logger.info("Looking up category by name: %s", value)
                                category = await CategoryOperations.get_category_by_name(value)
                                if category:
                                    logger.info("Found category ID: %s", category['id'])
                                    update_data["category_id"] = category["id"]
                                else:
                                    logger.warning("Category not found: %s", value)
                    else:
                        update_data[field] = value

                # Handle soft delete: set deleted_at when is_deleted is set to true
                if "is_deleted" in update_data and update_data["is_deleted"] is True:
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
                        **update_data,
                    )
                    if not success:
                        logger.warning("Transaction update failed for id=%s", transaction_id)
                else:
                    logger.info("Only tags update for transaction id=%s, skipping update_transaction call", transaction_id)

                if success:
                    # Handle tags if provided
                    if tag_names is not None:
                        tag_ids = []
                        # Ensure tag_names is a list
                        if not isinstance(tag_names, list):
                            logger.warning("tags field is not a list for transaction id=%s", transaction_id)
                            tag_names = []

                        for tag_name in tag_names:
                            if not tag_name or not isinstance(tag_name, str):
                                logger.warning("Invalid tag name for transaction id=%s", transaction_id)
                                continue

                            tag = await TagOperations.get_tag_by_name(tag_name)
                            if tag:
                                tag_ids.append(tag["id"])
                            else:
                                # Create tag if it doesn't exist (with a random default color)
                                default_color = random.choice(_TAG_COLORS)
                                try:
                                    new_tag_id = await TagOperations.create_tag(
                                        name=tag_name,
                                        color=default_color,
                                    )
                                    if new_tag_id:
                                        tag_ids.append(new_tag_id)
                                except ValueError:
                                    # Tag might have been created by another concurrent request
                                    logger.warning("Tag creation failed, may already exist: %s", tag_name)
                                    # Try to fetch it again
                                    tag = await TagOperations.get_tag_by_name(tag_name)
                                    if tag:
                                        tag_ids.append(tag["id"])
                                except Exception:
                                    logger.error("Failed to create tag %r", tag_name, exc_info=True)
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

            except Exception:
                logger.error("Failed to update transaction id=%s", transaction_id, exc_info=True)
                failed_updates.append(transaction_id)

        if failed_updates:
            logger.info("Bulk update: %d succeeded, %d failed", len(updated_transactions), len(failed_updates))
            return ApiResponse(
                data={
                    "updated_transactions": updated_transactions,
                    "failed_transaction_ids": failed_updates,
                    "success_count": len(updated_transactions),
                    "failure_count": len(failed_updates),
                },
                message=f"Bulk update completed with {len(updated_transactions)} successes and {len(failed_updates)} failures",
            )
        else:
            logger.info("Bulk update: %d transactions updated", len(updated_transactions))
            return ApiResponse(
                data=updated_transactions,
                message=f"Successfully updated {len(updated_transactions)} transactions",
            )

    except Exception:
        logger.error("Failed to bulk update transactions", exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.patch("/{transaction_id}", response_model=ApiResponse)
async def update_transaction(transaction_id: str, updates: TransactionUpdate):
    """Update a transaction."""
    logger.info("Updating transaction id=%s", transaction_id)
    try:
        # Convert updates to database format
        update_data: Dict[str, Any] = {}
        for field, value in updates.model_dump(exclude_unset=True).items():
            if field == "date":
                update_data["transaction_date"] = value
            elif field == "subcategory":
                update_data["sub_category"] = value
            elif field == "is_refund":
                # Legacy; is_partial_refund removed with unified grouping
                continue
            elif field == "is_transfer":
                # This would need special handling for transfer groups
                continue
            else:
                update_data[field] = value

        # Handle soft delete: set deleted_at when is_deleted is set to true
        if "is_deleted" in update_data and update_data["is_deleted"] is True:
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
                        transaction_id,
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
                **update_data,
            )

        if not success:
            raise HTTPException(status_code=404, detail="Transaction not found or update failed")

        # Fetch the updated transaction with tags
        updated_transaction = await handle_database_operation(
            TransactionOperations.get_transaction_by_id,
            transaction_id,
        )
        # Get tags for the transaction
        transaction_tags = await TagOperations.get_tags_for_transaction(transaction_id)
        fetched_tag_names = [tag['name'] for tag in transaction_tags]
        updated_transaction['tags'] = fetched_tag_names

        response_transaction = _convert_db_transaction_to_response(updated_transaction)

        logger.info("Updated transaction id=%s", transaction_id)
        return ApiResponse(data=response_transaction, message="Transaction updated successfully")

    except HTTPException:
        raise
    except Exception:
        logger.error("Failed to update transaction id=%s", transaction_id, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.delete("/{transaction_id}", status_code=204)
async def delete_transaction(transaction_id: str):
    """Delete a transaction."""
    logger.info("Deleting transaction id=%s", transaction_id)
    try:
        success = await handle_database_operation(
            TransactionOperations.delete_transaction,
            transaction_id,
        )
        if not success:
            raise HTTPException(status_code=404, detail="Transaction not found")

        logger.info("Deleted transaction id=%s", transaction_id)

    except HTTPException:
        raise
    except Exception:
        logger.error("Failed to delete transaction id=%s", transaction_id, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.post("/{transaction_id}/emails/link", response_model=ApiResponse)
async def link_email_to_transaction(transaction_id: str, request: EmailLinkRequest):
    """Link an email to a transaction by adding its message ID to related_mails."""
    logger.info("Linking email to transaction id=%s", transaction_id)
    try:
        # Get current transaction
        transaction = await handle_database_operation(
            TransactionOperations.get_transaction_by_id,
            transaction_id,
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
            related_mails=related_mails,
        )

        if updated_count == 0:
            raise HTTPException(status_code=404, detail="Transaction not found")

        # Fetch updated transaction
        updated_transaction = await handle_database_operation(
            TransactionOperations.get_transaction_by_id,
            transaction_id,
        )

        response_transaction = _convert_db_transaction_to_response(updated_transaction)

        logger.info("Linked email to transaction id=%s", transaction_id)
        return ApiResponse(data=response_transaction, message="Email linked successfully")

    except HTTPException:
        raise
    except Exception:
        logger.error("Failed to link email to transaction id=%s", transaction_id, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.delete("/{transaction_id}/emails/{message_id}", response_model=ApiResponse)
async def unlink_email_from_transaction(transaction_id: str, message_id: str):
    """Remove an email link from a transaction."""
    logger.info("Unlinking email from transaction id=%s", transaction_id)
    try:
        # Get current transaction
        transaction = await handle_database_operation(
            TransactionOperations.get_transaction_by_id,
            transaction_id,
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
            related_mails=related_mails,
        )

        if updated_count == 0:
            raise HTTPException(status_code=404, detail="Transaction not found")

        # Fetch updated transaction
        updated_transaction = await handle_database_operation(
            TransactionOperations.get_transaction_by_id,
            transaction_id,
        )

        response_transaction = _convert_db_transaction_to_response(updated_transaction)

        logger.info("Unlinked email from transaction id=%s", transaction_id)
        return ApiResponse(data=response_transaction, message="Email unlinked successfully")

    except HTTPException:
        raise
    except Exception:
        logger.error("Failed to unlink email from transaction id=%s", transaction_id, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


# ============================================================================
# CATEGORY WRITE ROUTES
# ============================================================================


@router.post("/categories", response_model=ApiResponse, status_code=201)
async def create_category(category_data: CategoryCreate):
    """Create a new category."""
    logger.info("Creating category: name=%s", category_data.name)
    try:
        category_id = await CategoryOperations.create_category(
            name=category_data.name,
            color=category_data.color,
            parent_id=category_data.parent_id,
            sort_order=category_data.sort_order,
            transaction_type=category_data.transaction_type,
        )

        logger.info("Created category id=%s", category_id)
        return ApiResponse(data={"id": category_id}, message="Category created successfully")

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception:
        logger.error("Failed to create category", exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.put("/categories/{category_id}", response_model=ApiResponse)
async def update_category(category_id: str, category_data: CategoryUpdate):
    """Update a category."""
    logger.info("Updating category id=%s", category_id)
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
            transaction_type=transaction_type_for_update,
        )

        if not success:
            raise HTTPException(status_code=404, detail="Category not found")

        logger.info("Updated category id=%s", category_id)
        return ApiResponse(data={"success": True}, message="Category updated successfully")

    except HTTPException:
        raise
    except Exception:
        logger.error("Failed to update category id=%s", category_id, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.delete("/categories/{category_id}", status_code=204)
async def delete_category(category_id: str):
    """Delete a category (soft delete)."""
    logger.info("Deleting category id=%s", category_id)
    try:
        success = await CategoryOperations.delete_category(category_id)
        if not success:
            raise HTTPException(status_code=404, detail="Category not found")

        logger.info("Deleted category id=%s", category_id)

    except HTTPException:
        raise
    except Exception:
        logger.error("Failed to delete category id=%s", category_id, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.post("/categories/upsert", response_model=ApiResponse)
async def upsert_category(category_data: CategoryCreate):
    """Upsert a category (create if not exists, update if exists)."""
    logger.info("Upserting category: name=%s", category_data.name)
    try:
        # For upsert, we need to update the method to accept transaction_type
        # For now, we'll create/update without transaction_type in upsert
        # This can be enhanced later if needed
        category_id = await CategoryOperations.upsert_category(
            name=category_data.name,
            color=category_data.color,
            parent_id=category_data.parent_id,
            sort_order=category_data.sort_order,
        )

        # If transaction_type is provided, update it
        if category_data.transaction_type is not None:
            await CategoryOperations.update_category(
                category_id=category_id,
                transaction_type=category_data.transaction_type,
            )

        logger.info("Upserted category id=%s", category_id)
        return ApiResponse(data={"id": category_id}, message="Category upserted successfully")

    except Exception:
        logger.error("Failed to upsert category", exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


# ============================================================================
# TAG WRITE ROUTES
# ============================================================================


@router.post("/tags", response_model=ApiResponse, status_code=201)
async def create_tag(tag_data: TagCreate):
    """Create a new tag."""
    logger.info("Creating tag: name=%s", tag_data.name)
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
            color=tag_data.color,
        )

        logger.info("Created tag id=%s", tag_id)
        return ApiResponse(data={"id": tag_id}, message="Tag created successfully")

    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception:
        logger.error("Failed to create tag", exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.put("/tags/{tag_id}", response_model=ApiResponse)
async def update_tag(tag_id: str, tag_data: TagUpdate):
    """Update a tag."""
    logger.info("Updating tag id=%s", tag_id)
    try:
        success = await TagOperations.update_tag(
            tag_id=tag_id,
            name=tag_data.name,
            color=tag_data.color,
        )

        if not success:
            raise HTTPException(status_code=404, detail="Tag not found")

        logger.info("Updated tag id=%s", tag_id)
        return ApiResponse(message="Tag updated successfully")

    except HTTPException:
        raise
    except Exception:
        logger.error("Failed to update tag id=%s", tag_id, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.delete("/tags/{tag_id}", status_code=204)
async def delete_tag(tag_id: str):
    """Delete a tag (soft delete)."""
    logger.info("Deleting tag id=%s", tag_id)
    try:
        success = await TagOperations.delete_tag(tag_id)
        if not success:
            raise HTTPException(status_code=404, detail="Tag not found")

        logger.info("Deleted tag id=%s", tag_id)

    except HTTPException:
        raise
    except Exception:
        logger.error("Failed to delete tag id=%s", tag_id, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.post("/tags/upsert", response_model=ApiResponse)
async def upsert_tag(tag_data: TagCreate):
    """Upsert a tag (create if not exists, update if exists)."""
    logger.info("Upserting tag: name=%s", tag_data.name)
    try:
        tag_id = await TagOperations.upsert_tag(
            name=tag_data.name,
            color=tag_data.color,
        )

        logger.info("Upserted tag id=%s", tag_id)
        return ApiResponse(data={"id": tag_id}, message="Tag upserted successfully")

    except Exception:
        logger.error("Failed to upsert tag", exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.patch("/{transaction_id}/recurring", response_model=ApiResponse)
async def set_transaction_recurring(transaction_id: str, body: SetRecurringRequest):
    """Set or clear the recurring flag and period on a transaction."""
    logger.info("Setting recurring on transaction id=%s is_recurring=%s", transaction_id, body.is_recurring)
    try:
        recurring_key = body.recurring_key
        if body.is_recurring and not recurring_key:
            tx = await handle_database_operation(TransactionOperations.get_transaction_by_id, transaction_id)
            if not tx:
                raise HTTPException(status_code=404, detail="Transaction not found")
            description = tx.get("user_description") or tx.get("description", "")
            recurring_key = _generate_recurring_key(description)

        updated = await handle_database_operation(
            TransactionOperations.set_recurring,
            transaction_id=transaction_id,
            is_recurring=body.is_recurring,
            recurrence_period=body.recurrence_period,
            recurring_key=recurring_key,
        )
        if not updated:
            raise HTTPException(status_code=404, detail="Transaction not found")

        logger.info("Set recurring on transaction id=%s recurring_key=%s", transaction_id, recurring_key)
        return ApiResponse(data={"updated": True, "recurring_key": recurring_key})

    except HTTPException:
        raise
    except Exception:
        logger.error("Failed to set recurring on transaction id=%s", transaction_id, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")
