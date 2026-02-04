from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Any, Dict, Optional, List

from fastapi import APIRouter, Query
from pydantic import BaseModel
from sqlalchemy import text

from src.services.database_manager.connection import get_session_factory
from src.apis.routes.transaction_routes import ApiResponse
from src.utils.logger import get_logger

logger = get_logger(__name__)

router = APIRouter(prefix="/email-alerts", tags=["email-alerts"])


class MissingEmailTransaction(BaseModel):
    id: str
    date: str
    account: str
    description: str
    amount: float
    direction: str
    reference_number: Optional[str] = None


@router.get("/missing", response_model=ApiResponse)
async def get_missing_email_transactions(
    start_date: Optional[str] = Query(None, description="YYYY-MM-DD"),
    end_date: Optional[str] = Query(None, description="YYYY-MM-DD"),
    account: Optional[str] = Query(None, description="Filter by account name"),
    limit: int = Query(200, ge=1, le=1000),
):
    """Return statement transactions that did not match email alerts."""
    session_factory = get_session_factory()
    session = session_factory()
    try:
        if start_date:
            start = datetime.strptime(start_date, "%Y-%m-%d").date()
        else:
            start = (datetime.now() - timedelta(days=30)).date()

        if end_date:
            end = datetime.strptime(end_date, "%Y-%m-%d").date()
        else:
            end = datetime.now().date()

        query = """
            SELECT id, transaction_date, account, description, amount, direction, reference_number
            FROM transactions
            WHERE source_type = 'statement'
              AND email_matched = false
              AND is_deleted = false
              AND transaction_date BETWEEN :start_date AND :end_date
        """
        params: Dict[str, Any] = {
            "start_date": start,
            "end_date": end,
            "limit": limit,
        }

        if account:
            query += " AND account = :account"
            params["account"] = account

        query += " ORDER BY transaction_date DESC LIMIT :limit"

        result = await session.execute(text(query), params)
        rows = result.fetchall()

        data: List[MissingEmailTransaction] = []
        for row in rows:
            data.append(MissingEmailTransaction(
                id=str(row.id),
                date=row.transaction_date.isoformat(),
                account=row.account,
                description=row.description,
                amount=float(row.amount),
                direction=row.direction,
                reference_number=row.reference_number,
            ))

        return ApiResponse(data=data, message=f"Found {len(data)} missing email transactions")
    finally:
        await session.close()
