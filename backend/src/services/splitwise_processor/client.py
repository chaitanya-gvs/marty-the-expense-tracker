"""
Splitwise API client for fetching transactions and user data.
"""

import os
import requests
from datetime import datetime, timedelta
from typing import List, Optional, Dict, Any
from pathlib import Path

from src.utils.logger import get_logger
from src.schemas.extraction.splitwise import SplitwiseExpense, SplitwiseUser, SplitwiseExpenseUser, SplitwiseCategory, SplitwiseGroup

logger = get_logger(__name__)


class SplitwiseAPIClient:
    """Client for interacting with Splitwise API."""
    
    def __init__(self):
        """Initialize the Splitwise API client."""
        self.api_key = os.getenv("SPLITWISE_API_KEY")
        self.base_url = "https://secure.splitwise.com/api/v3.0"
        
        if not self.api_key:
            raise ValueError("SPLITWISE_API_KEY not found in environment variables")
        
        self.headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json"
        }
        
        # Cache for current user info
        self._current_user: Optional[SplitwiseUser] = None
    
    def get_current_user(self) -> SplitwiseUser:
        """Get current user information."""
        if self._current_user:
            return self._current_user
        
        try:
            response = requests.get(f"{self.base_url}/get_current_user", headers=self.headers)
            response.raise_for_status()
            
            data = response.json()
            user_data = data.get("user", {})
            
            self._current_user = SplitwiseUser(
                id=user_data.get("id"),
                first_name=user_data.get("first_name", ""),
                last_name=user_data.get("last_name", ""),
                email=user_data.get("email", ""),
                picture=user_data.get("picture")
            )
            
            logger.info(f"Current user: {self._current_user.first_name} {self._current_user.last_name}")
            return self._current_user
            
        except Exception as e:
            logger.error(f"Failed to get current user: {e}")
            raise
    
    def get_expenses(
        self, 
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None,
        limit: int = 100,
        offset: int = 0
    ) -> List[SplitwiseExpense]:
        """Fetch expenses from Splitwise API."""
        params = {
            "limit": limit,
            "offset": offset
        }
        
        if start_date:
            params["dated_after"] = start_date.strftime("%Y-%m-%d")
        
        if end_date:
            params["dated_before"] = end_date.strftime("%Y-%m-%d")
        
        all_expenses = []
        
        try:
            while True:
                logger.info(f"Fetching expenses (offset: {offset})...")
                
                response = requests.get(f"{self.base_url}/get_expenses", headers=self.headers, params=params)
                response.raise_for_status()
                
                data = response.json()
                expenses_data = data.get("expenses", [])
                
                if not expenses_data:
                    break
                
                # Parse expenses
                for expense_data in expenses_data:
                    expense = self._parse_expense(expense_data)
                    all_expenses.append(expense)
                
                logger.info(f"Fetched {len(expenses_data)} expenses (total: {len(all_expenses)})")
                
                # If we got less than the limit, we've reached the end
                if len(expenses_data) < limit:
                    break
                
                offset += limit
                params["offset"] = offset
            
            logger.info(f"Total expenses fetched: {len(all_expenses)}")
            return all_expenses
            
        except Exception as e:
            logger.error(f"Failed to fetch expenses: {e}")
            raise
    
    def _parse_expense(self, expense_data: Dict[str, Any]) -> SplitwiseExpense:
        """Parse raw expense data into SplitwiseExpense model."""
        # Parse users
        users = []
        for user_data in expense_data.get("users", []):
            user_info = user_data.get("user", {})
            expense_user = SplitwiseExpenseUser(
                user=SplitwiseUser(
                    id=user_info.get("id"),
                    first_name=user_info.get("first_name") or "",
                    last_name=user_info.get("last_name"),
                    email=user_info.get("email"),
                    picture=user_info.get("picture")
                ),
                paid_share=float(user_data.get("paid_share", 0)),
                owed_share=float(user_data.get("owed_share", 0)),
                net_balance=user_data.get("net_balance")
            )
            users.append(expense_user)
        
        # Parse category
        category = None
        if expense_data.get("category"):
            cat_data = expense_data["category"]
            category = SplitwiseCategory(
                id=cat_data.get("id"),
                name=cat_data.get("name", ""),
                icon=cat_data.get("icon")
            )
        
        # Parse group
        group = None
        if expense_data.get("group"):
            group_data = expense_data["group"]
            group = SplitwiseGroup(
                id=group_data.get("id"),
                name=group_data.get("name", ""),
                group_type=group_data.get("group_type")
            )
        
        # Parse created_by user
        created_by = None
        if expense_data.get("created_by"):
            creator_data = expense_data["created_by"]
            created_by = SplitwiseUser(
                id=creator_data.get("id"),
                first_name=creator_data.get("first_name", ""),
                last_name=creator_data.get("last_name", ""),
                email=creator_data.get("email", ""),
                picture=creator_data.get("picture")
            )
        
        # Parse updated_by user
        updated_by = None
        if expense_data.get("updated_by"):
            updater_data = expense_data["updated_by"]
            updated_by = SplitwiseUser(
                id=updater_data.get("id"),
                first_name=updater_data.get("first_name", ""),
                last_name=updater_data.get("last_name", ""),
                email=updater_data.get("email", ""),
                picture=updater_data.get("picture")
            )
        
        # Parse deleted_by user
        deleted_by = None
        if expense_data.get("deleted_by"):
            deleter_data = expense_data["deleted_by"]
            deleted_by = SplitwiseUser(
                id=deleter_data.get("id"),
                first_name=deleter_data.get("first_name", ""),
                last_name=deleter_data.get("last_name", ""),
                email=deleter_data.get("email", ""),
                picture=deleter_data.get("picture")
            )
        
        # Parse dates
        date = self._parse_datetime(expense_data.get("date"))
        created_at = self._parse_datetime(expense_data.get("created_at"))
        updated_at = self._parse_datetime(expense_data.get("updated_at"))
        deleted_at = self._parse_datetime(expense_data.get("deleted_at"))
        next_repeat = self._parse_datetime(expense_data.get("next_repeat"))
        
        return SplitwiseExpense(
            id=expense_data.get("id"),
            description=expense_data.get("description", ""),
            cost=float(expense_data.get("cost", 0)),
            currency_code=expense_data.get("currency_code", "USD"),
            date=date,
            created_at=created_at,
            updated_at=updated_at,
            category=category,
            group=group,
            users=users,
            created_by=created_by,
            updated_by=updated_by,
            deleted_at=deleted_at,
            deleted_by=deleted_by,
            details=expense_data.get("details"),
            payment=expense_data.get("payment"),
            receipt=expense_data.get("receipt"),
            repeat_interval=expense_data.get("repeat_interval"),
            email_reminder=expense_data.get("email_reminder"),
            email_reminder_in_advance=expense_data.get("email_reminder_in_advance"),
            next_repeat=next_repeat,
            comments_count=expense_data.get("comments_count"),
            transaction_method=expense_data.get("transaction_method"),
            transaction_confirmed=expense_data.get("transaction_confirmed"),
            expense_bundle_id=expense_data.get("expense_bundle_id"),
            friendship_id=expense_data.get("friendship_id")
        )
    
    def _parse_datetime(self, date_str: Optional[str]) -> Optional[datetime]:
        """Parse datetime string from Splitwise API."""
        if not date_str:
            return None
        
        try:
            # Splitwise uses ISO format with Z suffix
            if date_str.endswith('Z'):
                date_str = date_str[:-1] + '+00:00'
            return datetime.fromisoformat(date_str)
        except Exception as e:
            logger.warning(f"Failed to parse datetime '{date_str}': {e}")
            return None
