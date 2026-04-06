from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Any, Dict, List, Optional

from sqlalchemy import text

from ..connection import get_session_factory
from src.utils.logger import get_logger

logger = get_logger(__name__)


class ReviewQueueOperations:

    @staticmethod
    async def add_item(
        review_type: str,
        transaction_date: date,
        amount: Decimal,
        description: str,
        account: str,
        direction: str,
        transaction_type: str,
        reference_number: Optional[str] = None,
        raw_data: Optional[Dict[str, Any]] = None,
        ambiguous_candidate_ids: Optional[List[str]] = None,
    ) -> str:
        """Insert a review queue item. Returns the new item's UUID."""
        import json
        session_factory = get_session_factory()
        async with session_factory() as session:
            result = await session.execute(
                text("""
                    INSERT INTO review_queue
                        (review_type, transaction_date, amount, description, account,
                         direction, transaction_type, reference_number, raw_data, ambiguous_candidate_ids)
                    VALUES
                        (:review_type, :transaction_date, :amount, :description, :account,
                         :direction, :transaction_type, :reference_number, :raw_data::jsonb,
                         :ambiguous_candidate_ids)
                    RETURNING id
                """),
                {
                    "review_type": review_type,
                    "transaction_date": transaction_date,
                    "amount": str(amount),
                    "description": description,
                    "account": account,
                    "direction": direction,
                    "transaction_type": transaction_type,
                    "reference_number": reference_number,
                    "raw_data": json.dumps(raw_data) if raw_data else None,
                    "ambiguous_candidate_ids": ambiguous_candidate_ids,
                }
            )
            await session.commit()
            return str(result.scalar())

    @staticmethod
    async def get_unresolved(review_type: Optional[str] = None) -> List[Dict[str, Any]]:
        session_factory = get_session_factory()
        async with session_factory() as session:
            where = "WHERE resolved_at IS NULL"
            params: Dict[str, Any] = {}
            if review_type:
                where += " AND review_type = :review_type"
                params["review_type"] = review_type
            result = await session.execute(
                text(f"SELECT * FROM review_queue {where} ORDER BY transaction_date DESC, created_at DESC"),
                params
            )
            return [dict(row._mapping) for row in result.fetchall()]

    @staticmethod
    async def resolve(item_id: str, resolution: str) -> bool:
        session_factory = get_session_factory()
        async with session_factory() as session:
            result = await session.execute(
                text("""
                    UPDATE review_queue
                    SET resolved_at = now(), resolution = :resolution
                    WHERE id = :id AND resolved_at IS NULL
                """),
                {"id": item_id, "resolution": resolution}
            )
            await session.commit()
            return result.rowcount > 0

    @staticmethod
    async def bulk_resolve(item_ids: List[str], resolution: str) -> int:
        session_factory = get_session_factory()
        async with session_factory() as session:
            result = await session.execute(
                text("""
                    UPDATE review_queue
                    SET resolved_at = now(), resolution = :resolution
                    WHERE id = ANY(:ids) AND resolved_at IS NULL
                """),
                {"ids": item_ids, "resolution": resolution}
            )
            await session.commit()
            return result.rowcount
