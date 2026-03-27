from __future__ import annotations

from datetime import datetime

from sqlalchemy import text

from ..connection import get_session_factory
from src.utils.logger import get_logger

logger = get_logger(__name__)


class ParticipantOperations:
    """Operations for managing participants."""

    @staticmethod
    async def update_splitwise_balance(
        splitwise_id: int, balance: float, synced_at: datetime
    ) -> None:
        """Update the cached Splitwise balance for a participant."""
        session_factory = get_session_factory()
        async with session_factory() as session:
            try:
                await session.execute(
                    text("""
                        UPDATE participants
                        SET splitwise_balance = :balance, balance_synced_at = :synced_at
                        WHERE splitwise_id = :splitwise_id
                    """),
                    {"balance": balance, "synced_at": synced_at, "splitwise_id": splitwise_id},
                )
                await session.commit()
            except Exception:
                await session.rollback()
                logger.error(
                    "Failed to update Splitwise balance for splitwise_id=%s",
                    splitwise_id,
                    exc_info=True,
                )
                raise
