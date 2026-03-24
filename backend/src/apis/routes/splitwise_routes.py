"""Live-proxy Splitwise endpoints — no DB cache."""
import requests
from typing import List, Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from src.services.splitwise_processor.client import SplitwiseAPIClient
from src.utils.logger import get_logger

logger = get_logger(__name__)

router = APIRouter(tags=["splitwise"])


class SplitwiseFriendResponse(BaseModel):
    id: int
    first_name: str
    last_name: Optional[str]
    net_balance: float


class SplitwiseExpenseUserResponse(BaseModel):
    name: str
    paid_share: float
    owed_share: float


class SplitwiseFriendExpenseResponse(BaseModel):
    id: int
    description: str
    cost: float
    date: str
    group_name: Optional[str]
    category: Optional[str]
    users: List[SplitwiseExpenseUserResponse]


@router.get("/friends", response_model=List[SplitwiseFriendResponse])
async def get_splitwise_friends() -> List[SplitwiseFriendResponse]:
    """Return all Splitwise friends with net balances, sorted non-zero first."""
    try:
        client = SplitwiseAPIClient()
        raw = client.get_friends_with_balances()
    except Exception:
        logger.error("Failed to fetch Splitwise friends", exc_info=True)
        raise HTTPException(status_code=502, detail="Failed to fetch friends from Splitwise")

    friends = [
        SplitwiseFriendResponse(
            id=f["id"],
            first_name=f["first_name"],
            last_name=f["last_name"] if f["last_name"] else None,
            net_balance=f["net_balance"],
        )
        for f in raw
    ]

    # Non-zero balances first (abs descending), zero-balance last
    non_zero = sorted([f for f in friends if f.net_balance != 0.0], key=lambda f: abs(f.net_balance), reverse=True)
    zero = [f for f in friends if f.net_balance == 0.0]
    return non_zero + zero


@router.get("/friend/{splitwise_id}/expenses", response_model=List[SplitwiseFriendExpenseResponse])
async def get_friend_expenses(splitwise_id: int) -> List[SplitwiseFriendExpenseResponse]:
    """Return the first 100 most-recent Splitwise expenses involving the given friend."""
    try:
        sw_client = SplitwiseAPIClient()
        # Fetch only the first page — intentionally no pagination
        response = requests.get(
            f"{sw_client.base_url}/get_expenses",
            headers=sw_client.headers,
            params={"limit": 100, "offset": 0},
        )
        response.raise_for_status()
        raw_expenses = response.json().get("expenses", [])
    except Exception:
        logger.error(f"Failed to fetch Splitwise expenses for friend {splitwise_id}", exc_info=True)
        raise HTTPException(status_code=502, detail="Failed to fetch expenses from Splitwise")

    result = []
    for exp in raw_expenses:
        # Skip deleted expenses
        if exp.get("deleted_at") is not None:
            continue

        # Skip if this friend is not a participant
        user_ids = [u.get("user", {}).get("id") for u in exp.get("users", [])]
        if splitwise_id not in user_ids:
            continue

        # Flatten user shares
        users_out = []
        for u in exp.get("users", []):
            user_info = u.get("user", {})
            first = user_info.get("first_name") or ""
            last = user_info.get("last_name") or ""
            name = f"{first} {last}".strip()
            users_out.append(SplitwiseExpenseUserResponse(
                name=name,
                paid_share=float(u.get("paid_share", 0)),
                owed_share=float(u.get("owed_share", 0)),
            ))

        # Extract optional fields
        category_name: Optional[str] = None
        if exp.get("category"):
            category_name = exp["category"].get("name") or None

        group_name: Optional[str] = None
        if exp.get("group"):
            group_name = exp["group"].get("name") or None

        # Date as ISO string (date portion only)
        date_raw = exp.get("date") or ""
        date_str = date_raw[:10] if date_raw else ""

        result.append(SplitwiseFriendExpenseResponse(
            id=exp["id"],
            description=exp.get("description", ""),
            cost=float(exp.get("cost", 0)),
            date=date_str,
            group_name=group_name,
            category=category_name,
            users=users_out,
        ))

    # Sort: date descending (empty string sorts last)
    result.sort(key=lambda e: e.date, reverse=True)
    return result
