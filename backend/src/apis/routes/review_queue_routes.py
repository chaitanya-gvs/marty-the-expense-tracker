from __future__ import annotations

from fastapi import APIRouter, HTTPException

from src.apis.schemas.email_ingestion import (
    ReviewQueueResponse, ReviewQueueItemResponse,
    ConfirmReviewItemRequest, LinkReviewItemRequest,
)
from src.services.database_manager.operations.review_queue_operations import ReviewQueueOperations
from src.services.database_manager.operations.transaction_operations import TransactionOperations
from src.utils.logger import get_logger

logger = get_logger(__name__)
router = APIRouter(prefix="/review-queue", tags=["review-queue"])


@router.get("", response_model=ReviewQueueResponse)
async def get_review_queue(review_type: str | None = None):
    items = await ReviewQueueOperations.get_unresolved(review_type)
    return ReviewQueueResponse(
        items=[ReviewQueueItemResponse(
            **{
                **{k: v for k, v in i.items()},
                "id": str(i["id"]),
                "amount": float(i["amount"]),
                "transaction_date": str(i["transaction_date"]),
                "created_at": str(i["created_at"]),
                "resolved_at": str(i["resolved_at"]) if i.get("resolved_at") else None,
                "ambiguous_candidate_ids": i.get("ambiguous_candidate_ids"),
            }
        ) for i in items],
        total=len(items),
    )


@router.post("/{item_id}/confirm")
async def confirm_review_item(item_id: str, request: ConfirmReviewItemRequest = ConfirmReviewItemRequest()):
    """
    Confirm an ambiguous item with no accepted candidate ("None of these"):
    insert the statement row as a new transaction, unless a matching
    transaction already exists (e.g. entered manually in the meantime).
    """
    items = await ReviewQueueOperations.get_unresolved("ambiguous")
    item = next((i for i in items if str(i["id"]) == item_id), None)
    if not item:
        raise HTTPException(404, "Item not found or already resolved")

    already_exists = await TransactionOperations.exists_matching(
        account=item["account"],
        amount=item["amount"],
        transaction_date=item["transaction_date"],
        direction=item["direction"],
    )
    if not already_exists:
        tx = {**(item.get("raw_data") or {}), **(request.edits or {})}
        await TransactionOperations.bulk_insert_transactions(
            [tx],
            transaction_source="statement_extraction",
        )
    await ReviewQueueOperations.resolve(item_id, "confirmed")
    return {"status": "confirmed"}


@router.post("/{item_id}/link")
async def link_review_item(item_id: str, request: LinkReviewItemRequest):
    """Link ambiguous item to a specific email_ingestion transaction."""
    items = await ReviewQueueOperations.get_unresolved("ambiguous")
    item = next((i for i in items if str(i["id"]) == item_id), None)
    if not item:
        raise HTTPException(404, "Item not found or already resolved")

    candidate_ids = item.get("ambiguous_candidate_ids") or []
    if request.transaction_id not in candidate_ids:
        raise HTTPException(400, "transaction_id is not a candidate for this item")

    resolved = await ReviewQueueOperations.resolve(item_id, "linked")
    if not resolved:
        raise HTTPException(404, "Item not found or already resolved")
    await TransactionOperations.mark_statement_confirmed(request.transaction_id)
    await ReviewQueueOperations.remove_candidate_from_others(request.transaction_id, exclude_item_id=item_id)
    return {"status": "linked"}


@router.post("/{item_id}/reject")
async def reject_review_item(item_id: str):
    """
    Reject a single-candidate ambiguous item (the email-reconciliation-pass
    "is this lone transaction legit?" case): soft-delete the underlying
    transaction and resolve the review item. Only valid when there is exactly
    one candidate — multi-candidate items reject via /confirm's "None of
    these" (insert-new) path instead, since there's no single transaction to
    delete.
    """
    items = await ReviewQueueOperations.get_unresolved("ambiguous")
    item = next((i for i in items if str(i["id"]) == item_id), None)
    if not item:
        raise HTTPException(404, "Item not found or already resolved")

    candidate_ids = item.get("ambiguous_candidate_ids") or []
    if len(candidate_ids) != 1:
        raise HTTPException(400, "Reject is only valid for single-candidate items")

    transaction_id = candidate_ids[0]
    await TransactionOperations.delete_transaction(transaction_id)
    await ReviewQueueOperations.resolve(item_id, "rejected")
    await ReviewQueueOperations.remove_candidate_from_others(transaction_id, exclude_item_id=item_id)
    return {"status": "rejected"}


@router.delete("/{item_id}")
async def delete_review_item(item_id: str):
    resolved = await ReviewQueueOperations.resolve(item_id, "deleted")
    if not resolved:
        raise HTTPException(404, "Item not found or already resolved")
    return {"status": "deleted"}
