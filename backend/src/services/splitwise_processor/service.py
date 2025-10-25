"""
Splitwise service for processing and filtering transactions.
"""

from datetime import datetime, timedelta
from typing import List, Optional, Dict, Any

from src.utils.logger import get_logger
from src.schemas.extraction.splitwise import (
    SplitwiseExpense, 
    ProcessedSplitwiseTransaction, 
    SplitwiseTransactionFilter
)
from .client import SplitwiseAPIClient

logger = get_logger(__name__)


class SplitwiseService:
    """Service for processing Splitwise transactions."""
    
    def __init__(self):
        """Initialize the Splitwise service."""
        self.client = SplitwiseAPIClient()
        self._current_user = None
    
    def get_current_user(self):
        """Get current user information."""
        if not self._current_user:
            self._current_user = self.client.get_current_user()
        return self._current_user
    
    def get_transactions_for_past_month(
        self, 
        exclude_created_by_me: bool = True,
        include_only_my_transactions: bool = True,
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None
    ) -> List[ProcessedSplitwiseTransaction]:
        """
        Get transactions from the past month where the user is involved.
        
        Args:
            exclude_created_by_me: If True, exclude transactions created by the current user
            include_only_my_transactions: If True, only include transactions where the user is involved
        
        Returns:
            List of processed transactions
        """
        # Use provided date range or calculate default past month
        if start_date is None or end_date is None:
            end_date = datetime.now()
            start_date = end_date - timedelta(days=30)
        
        logger.info(f"Fetching Splitwise transactions from {start_date.strftime('%Y-%m-%d')} to {end_date.strftime('%Y-%m-%d')}")
        
        # Get current user
        current_user = self.get_current_user()
        logger.info(f"Current user: {current_user.first_name} {current_user.last_name} (ID: {current_user.id})")
        
        # Fetch all expenses from the past month
        expenses = self.client.get_expenses(start_date=start_date, end_date=end_date)
        
        # Filter and process expenses
        processed_transactions = []
        
        for expense in expenses:
            # Skip deleted expenses
            if expense.deleted_at:
                continue
            
            # Check if current user is involved in this expense
            user_involved = self._is_user_involved(expense, current_user.id)
            if include_only_my_transactions and not user_involved:
                continue
            
            # Check if we should exclude transactions created by current user
            if exclude_created_by_me and expense.created_by and expense.created_by.id == current_user.id:
                continue
            
            # Process the transaction
            processed_transaction = self._process_transaction(expense, current_user)
            if processed_transaction:
                processed_transactions.append(processed_transaction)
        
        logger.info(f"Processed {len(processed_transactions)} transactions for user {current_user.first_name}")
        return processed_transactions
    
    def _is_user_involved(self, expense: SplitwiseExpense, user_id: int) -> bool:
        """Check if a user is involved in an expense."""
        for expense_user in expense.users:
            if expense_user.user.id == user_id:
                return True
        return False
    
    def _process_transaction(self, expense: SplitwiseExpense, current_user) -> Optional[ProcessedSplitwiseTransaction]:
        """Process a Splitwise expense into our transaction format."""
        try:
            # Find current user's involvement in this expense
            my_share = 0.0
            participants = []
            paid_by = None
            max_paid_amount = 0.0
            
            # Create detailed split breakdown structure
            split_breakdown = {
                "mode": "custom",  # Splitwise always has custom amounts
                "entries": [],
                "include_me": True,
                "paid_by": None,
                "total_participants": len(expense.users)
            }
            
            for expense_user in expense.users:
                first_name = expense_user.user.first_name or ""
                last_name = expense_user.user.last_name or ""
                user_name = f"{first_name} {last_name}".strip()
                participants.append(user_name)
                
                if expense_user.user.id == current_user.id:
                    my_share = expense_user.owed_share
                
                # Track who paid the most (primary payer)
                if expense_user.paid_share > max_paid_amount:
                    max_paid_amount = expense_user.paid_share
                    paid_by = user_name
                
                # Add to split breakdown entries
                split_breakdown["entries"].append({
                    "participant": user_name,
                    "amount": float(expense_user.owed_share),
                    "paid_share": float(expense_user.paid_share),
                    "net_balance": float(expense_user.net_balance) if expense_user.net_balance else 0.0
                })
            
            # Set paid_by in split breakdown
            split_breakdown["paid_by"] = paid_by
            
            # Skip if user has no share (shouldn't happen due to filtering, but safety check)
            if my_share == 0.0:
                return None
            
            # Determine if this is a payment transaction
            is_payment = expense.payment is True
            
            # Get category name
            category_name = expense.category.name if expense.category else "Uncategorized"
            
            # Get group name
            group_name = expense.group.name if expense.group else "Non-group"
            
            # Get creator name
            created_by_name = None
            if expense.created_by:
                created_by_name = f"{expense.created_by.first_name} {expense.created_by.last_name}".strip()
            
            # Create processed transaction with enhanced data
            processed_transaction = ProcessedSplitwiseTransaction(
                splitwise_id=expense.id,
                description=expense.description,
                amount=expense.cost,
                currency=expense.currency_code,
                date=expense.date,
                category=category_name,
                group_name=group_name,
                source="splitwise",
                created_by=created_by_name,
                my_share=my_share,
                total_participants=len(participants),
                participants=participants,
                paid_by=paid_by,  # Who actually paid for this transaction
                is_payment=is_payment,
                raw_data={
                    **expense.dict(),
                    "split_breakdown": split_breakdown  # Include enhanced split breakdown
                }
            )
            
            return processed_transaction
            
        except Exception as e:
            logger.error(f"Failed to process transaction {expense.id}: {e}")
            return None
    
    def get_transactions_with_filter(self, filter_criteria: SplitwiseTransactionFilter) -> List[ProcessedSplitwiseTransaction]:
        """
        Get transactions with custom filter criteria.
        
        Args:
            filter_criteria: Filter criteria for transactions
        
        Returns:
            List of processed transactions matching the criteria
        """
        # Get current user
        current_user = self.get_current_user()
        
        # Fetch expenses with date range
        expenses = self.client.get_expenses(
            start_date=filter_criteria.start_date,
            end_date=filter_criteria.end_date
        )
        
        processed_transactions = []
        
        for expense in expenses:
            # Skip deleted expenses
            if expense.deleted_at:
                continue
            
            # Apply filters
            if not self._matches_filter(expense, filter_criteria, current_user):
                continue
            
            # Process the transaction
            processed_transaction = self._process_transaction(expense, current_user)
            if processed_transaction:
                processed_transactions.append(processed_transaction)
        
        logger.info(f"Found {len(processed_transactions)} transactions matching filter criteria")
        return processed_transactions
    
    def _matches_filter(self, expense: SplitwiseExpense, filter_criteria: SplitwiseTransactionFilter, current_user) -> bool:
        """Check if an expense matches the filter criteria."""
        # Check if user is involved (if required)
        if filter_criteria.include_only_my_transactions:
            if not self._is_user_involved(expense, current_user.id):
                return False
        
        # Check if we should exclude transactions created by current user
        if filter_criteria.exclude_created_by_me and expense.created_by and expense.created_by.id == current_user.id:
            return False
        
        # Check amount filters
        if filter_criteria.min_amount is not None and expense.cost < filter_criteria.min_amount:
            return False
        
        if filter_criteria.max_amount is not None and expense.cost > filter_criteria.max_amount:
            return False
        
        # Check category filter
        if filter_criteria.categories:
            category_name = expense.category.name if expense.category else "Uncategorized"
            if category_name not in filter_criteria.categories:
                return False
        
        # Check group filter
        if filter_criteria.groups:
            group_name = expense.group.name if expense.group else "Non-group"
            if group_name not in filter_criteria.groups:
                return False
        
        return True
    
    def get_transaction_summary(self, transactions: List[ProcessedSplitwiseTransaction]) -> Dict[str, Any]:
        """Get a summary of processed transactions."""
        if not transactions:
            return {
                "total_transactions": 0,
                "total_amount": 0.0,
                "total_my_share": 0.0,
                "categories": {},
                "groups": {},
                "participants": {},
                "created_by": {}
            }
        
        total_amount = sum(t.amount for t in transactions)
        total_my_share = sum(t.my_share for t in transactions)
        
        # Category breakdown
        categories = {}
        for t in transactions:
            categories[t.category] = categories.get(t.category, 0) + t.my_share
        
        # Group breakdown
        groups = {}
        for t in transactions:
            group_name = t.group_name or "Non-group"
            groups[group_name] = groups.get(group_name, 0) + t.my_share
        
        # Participant breakdown
        participants = {}
        for t in transactions:
            for participant in t.participants:
                participants[participant] = participants.get(participant, 0) + 1
        
        # Created by breakdown
        created_by = {}
        for t in transactions:
            creator = t.created_by or "Unknown"
            created_by[creator] = created_by.get(creator, 0) + 1
        
        return {
            "total_transactions": len(transactions),
            "total_amount": total_amount,
            "total_my_share": total_my_share,
            "categories": categories,
            "groups": groups,
            "participants": participants,
            "created_by": created_by
        }
