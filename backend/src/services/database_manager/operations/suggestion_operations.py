from __future__ import annotations

from datetime import datetime, timedelta
from typing import List, Dict, Any

from sqlalchemy import text

from ..connection import get_session_factory
from src.utils.logger import get_logger

logger = get_logger(__name__)


class SuggestionOperations:
    """Operations for generating transaction suggestions."""

    @staticmethod
    async def find_transfer_suggestions(
        days_back: int = 30,
        min_amount: float = 10.0,
        max_time_diff_hours: int = 24
    ) -> List[Dict[str, Any]]:
        """Find potential transfer pairs based on amount similarity and timing."""
        session_factory = get_session_factory()
        async with session_factory() as session:
            start_date = datetime.now() - timedelta(days=days_back)

            result = await session.execute(
                text("""
                    SELECT
                        t1.id as t1_id, t1.transaction_date as t1_date, t1.amount as t1_amount,
                        t1.direction as t1_direction, t1.account as t1_account,
                        t1.description as t1_description,
                        t2.id as t2_id, t2.transaction_date as t2_date, t2.amount as t2_amount,
                        t2.direction as t2_direction, t2.account as t2_account,
                        t2.description as t2_description,
                        ABS(t1.amount + t2.amount) as amount_diff,
                        ABS(EXTRACT(EPOCH FROM (t1.transaction_date - t2.transaction_date))/3600) as time_diff_hours
                    FROM transactions t1
                    JOIN transactions t2 ON (
                        t1.id != t2.id
                        AND t1.transaction_date >= :start_date
                        AND t2.transaction_date >= :start_date
                        AND ABS(t1.amount + t2.amount) < :amount_tolerance
                        AND ABS(EXTRACT(EPOCH FROM (t1.transaction_date - t2.transaction_date))/3600) < :max_time_diff
                        AND t1.direction != t2.direction
                        AND ABS(t1.amount) >= :min_amount
                        AND ABS(t2.amount) >= :min_amount
                        AND t1.transaction_group_id IS NULL
                        AND t2.transaction_group_id IS NULL
                    )
                    WHERE t1.id < t2.id
                    ORDER BY amount_diff ASC, time_diff_hours ASC
                    LIMIT 50
                """), {
                    "start_date": start_date,
                    "amount_tolerance": min_amount * 0.1,
                    "max_time_diff": max_time_diff_hours,
                    "min_amount": min_amount
                }
            )

            rows = result.fetchall()
            suggestions = []

            for row in rows:
                amount_confidence = max(0, 1 - (row.amount_diff / min_amount))
                time_confidence = max(0, 1 - (row.time_diff_hours / max_time_diff_hours))
                confidence = (amount_confidence + time_confidence) / 2

                if confidence > 0.3:
                    suggestions.append({
                        "transactions": [
                            {
                                "id": row.t1_id,
                                "amount": float(row.t1_amount),
                                "direction": row.t1_direction,
                                "account": row.t1_account,
                                "description": row.t1_description
                            },
                            {
                                "id": row.t2_id,
                                "amount": float(row.t2_amount),
                                "direction": row.t2_direction,
                                "account": row.t2_account,
                                "description": row.t2_description
                            }
                        ],
                        "confidence": confidence,
                        "reason": f"Similar amounts ({row.amount_diff:.2f} difference) within {row.time_diff_hours:.1f} hours"
                    })

            return suggestions
