from __future__ import annotations

from fastapi import APIRouter, HTTPException

from src.apis.schemas.email_ingestion import (
    ReviewQueueResponse, ReviewQueueItemResponse,
    ConfirmReviewItemRequest, LinkReviewItemRequest, BulkConfirmRequest,
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
    """Insert statement-only item as a new statement_extraction transaction."""
    items = await ReviewQueueOperations.get_unresolved()
    item = next((i for i in items if str(i["id"]) == item_id), None)
    if not item:
        raise HTTPException(404, "Item not found or already resolved")

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
    resolved = await ReviewQueueOperations.resolve(item_id, "linked")
    if not resolved:
        raise HTTPException(404, "Item not found or already resolved")
    await TransactionOperations.mark_statement_confirmed(request.transaction_id)
    return {"status": "linked"}


@router.delete("/{item_id}")
async def delete_review_item(item_id: str):
    resolved = await ReviewQueueOperations.resolve(item_id, "deleted")
    if not resolved:
        raise HTTPException(404, "Item not found or already resolved")
    return {"status": "deleted"}


@router.post("/bulk-confirm")
async def bulk_confirm(request: BulkConfirmRequest):
    """Confirm all statement-only items in batch."""
    items = await ReviewQueueOperations.get_unresolved("statement_only")
    id_set = set(request.item_ids)
    to_confirm = [i for i in items if str(i["id"]) in id_set]
    txs = [{**(i.get("raw_data") or {})} for i in to_confirm]
    if txs:
        await TransactionOperations.bulk_insert_transactions(
            txs,
            transaction_source="statement_extraction",
        )
    count = await ReviewQueueOperations.bulk_resolve(request.item_ids, "confirmed")
    return {"confirmed": count}
