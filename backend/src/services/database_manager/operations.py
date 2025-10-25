from __future__ import annotations

from typing import List, Optional, Dict, Any
from datetime import date, time, datetime
from decimal import Decimal
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
import hashlib
import json
import pandas as pd

from .connection import get_session_factory
from src.utils.logger import get_logger

logger = get_logger(__name__)


class AccountOperations:
    """Operations for managing bank accounts"""
    
    @staticmethod
    async def get_all_accounts() -> List[dict]:
        """Get all active bank accounts"""
        session_factory = get_session_factory()
        session = session_factory()
        try:
            result = await session.execute(
                text("""
                    SELECT 
                        id, account_number, account_type, bank_name, card_type, 
                        nickname, notes, statement_sender, statement_password,
                        last_statement_date, last_processed_at, credit_limit,
                        available_credit, due_date, billing_cycle_start, 
                        billing_cycle_end, is_active, created_at, updated_at
                    FROM accounts 
                    WHERE is_active = true
                    ORDER BY account_type, bank_name
                """)
            )
            rows = result.fetchall()
            return [dict(row._mapping) for row in rows]
        finally:
            await session.close()
    
    @staticmethod
    async def get_accounts_by_type(account_type: str) -> List[dict]:
        """Get accounts by type (credit_card, savings, current)"""
        session_factory = get_session_factory()
        session = session_factory()
        try:
            result = await session.execute(
                text("""
                    SELECT * FROM accounts 
                    WHERE account_type = :account_type AND is_active = true
                    ORDER BY bank_name
                """), {"account_type": account_type}
            )
            rows = result.fetchall()
            return [dict(row._mapping) for row in rows]
        finally:
            await session.close()
    
    @staticmethod
    async def get_credit_cards() -> List[dict]:
        """Get all credit card accounts"""
        return await AccountOperations.get_accounts_by_type("credit_card")
    
    @staticmethod
    async def get_bank_accounts() -> List[dict]:
        """Get all savings and current accounts"""
        session_factory = get_session_factory()
        session = session_factory()
        try:
            result = await session.execute(
                text("""
                    SELECT * FROM accounts 
                    WHERE account_type IN ('savings', 'current') AND is_active = true
                    ORDER BY account_type, bank_name
                """)
            )
            rows = result.fetchall()
            return [dict(row._mapping) for row in rows]
        finally:
            await session.close()
    
    @staticmethod
    async def get_account_by_statement_sender(email: str) -> Optional[dict]:
        """Get account by statement sender email (handles comma-separated senders)"""
        session_factory = get_session_factory()
        session = session_factory()
        try:
            # First try exact match
            result = await session.execute(
                text("""
                    SELECT * FROM accounts 
                    WHERE statement_sender = :email AND is_active = true
                """), {"email": email}
            )
            row = result.fetchone()
            if row:
                return dict(row._mapping)
            
            # If no exact match, try comma-separated senders
            result = await session.execute(
                text("""
                    SELECT * FROM accounts 
                    WHERE statement_sender LIKE :email_pattern AND is_active = true
                """), {"email_pattern": f"%{email}%"}
            )
            row = result.fetchone()
            return dict(row._mapping) if row else None
        finally:
            await session.close()
    
    @staticmethod
    async def get_account_by_id(account_id: str) -> Optional[dict]:
        """Get account by ID"""
        session_factory = get_session_factory()
        session = session_factory()
        try:
            result = await session.execute(
                text("""
                    SELECT * FROM accounts 
                    WHERE id = :account_id AND is_active = true
                """), {"account_id": account_id}
            )
            row = result.fetchone()
            return dict(row._mapping) if row else None
        finally:
            await session.close()
    
    @staticmethod
    async def update_last_statement_date(account_id: str, statement_date: str) -> bool:
        """Update the last statement date for an account"""
        session_factory = get_session_factory()
        session = session_factory()
        try:
                result = await session.execute(
                    text("""
                        UPDATE accounts 
                        SET last_statement_date = :statement_date, 
                            updated_at = CURRENT_TIMESTAMP
                        WHERE id = :account_id
                    """), {
                        "account_id": account_id,
                        "statement_date": statement_date
                    }
                )
                await session.commit()
                return result.rowcount > 0
        finally:
            await session.close()

    @staticmethod
    async def update_last_processed_at(account_id: str) -> bool:
        """Update the last processed timestamp for an account"""
        session_factory = get_session_factory()
        session = session_factory()
        try:
            result = await session.execute(
                text("""
                    UPDATE accounts 
                    SET last_processed_at = CURRENT_TIMESTAMP, 
                        updated_at = CURRENT_TIMESTAMP
                    WHERE id = :account_id
                """), {"account_id": account_id}
            )
            await session.commit()
            return result.rowcount > 0
        finally:
            await session.close()
    
    @staticmethod
    async def get_account_nickname_by_sender(sender_email: str) -> Optional[str]:
        """Get account nickname by statement sender email (handles comma-separated senders)"""
        session_factory = get_session_factory()
        session = session_factory()
        try:
            # First try exact match
            result = await session.execute(
                text("""
                    SELECT nickname FROM accounts 
                    WHERE statement_sender = :sender_email AND is_active = true
                """), {"sender_email": sender_email}
            )
            row = result.fetchone()
            if row:
                return row[0]
            
            # If no exact match, try comma-separated senders
            result = await session.execute(
                text("""
                    SELECT nickname FROM accounts 
                    WHERE statement_sender LIKE :sender_pattern AND is_active = true
                """), {"sender_pattern": f"%{sender_email}%"}
            )
            row = result.fetchone()
            return row[0] if row else None
        finally:
            await session.close()
    
    @staticmethod
    async def get_all_statement_senders() -> List[str]:
        """Get all unique statement sender emails from active accounts"""
        session_factory = get_session_factory()
        session = session_factory()
        try:
            result = await session.execute(
                text("""
                    SELECT DISTINCT statement_sender 
                    FROM accounts 
                    WHERE statement_sender IS NOT NULL 
                    AND statement_sender != '' 
                    AND is_active = true
                    ORDER BY statement_sender
                """)
            )
            rows = result.fetchall()
            return [row[0] for row in rows if row[0]]
        finally:
            await session.close()
    
    @staticmethod
    async def get_account_nickname_by_pattern(search_pattern: str) -> Optional[str]:
        """Get account nickname by search pattern (partial match)"""
        session_factory = get_session_factory()
        session = session_factory()
        try:
            result = await session.execute(
                text("""
                    SELECT nickname FROM accounts 
                    WHERE LOWER(nickname) LIKE LOWER(:pattern) 
                    AND is_active = true
                    LIMIT 1
                """), {"pattern": f"%{search_pattern}%"}
            )
            row = result.fetchone()
            return row[0] if row else None
        finally:
            await session.close()


class TransactionOperations:
    """Operations for managing transactions"""
    
    @staticmethod
    async def create_transaction(
        transaction_date: date,
        amount: Decimal,
        direction: str,
        transaction_type: str,
        account: str,
        category: str,  # Category name for backward compatibility
        description: str,
        transaction_time: Optional[time] = None,
        split_share_amount: Optional[Decimal] = None,
        is_partial_refund: bool = False,
        is_shared: bool = False,
        split_breakdown: Optional[Dict[str, Any]] = None,
        paid_by: Optional[str] = None,
        sub_category: Optional[str] = None,
        tags: Optional[List[str]] = None,
        notes: Optional[str] = None,
        reference_number: Optional[str] = None,
        related_mails: Optional[List[str]] = None,
        source_file: Optional[str] = None,
        raw_data: Optional[Dict[str, Any]] = None,
        link_parent_id: Optional[str] = None,
        transaction_group_id: Optional[str] = None,
        is_split: Optional[bool] = None
    ) -> str:
        """Create a new transaction and return its ID"""
        session_factory = get_session_factory()
        session = session_factory()
        try:
            # Look up category_id by category name
            category_id = None
            if category:
                category_data = await CategoryOperations.get_category_by_name(category)
                if category_data:
                    category_id = category_data['id']
            
            result = await session.execute(
                text("""
                    INSERT INTO transactions (
                        transaction_date, transaction_time, amount, split_share_amount,
                        direction, transaction_type, is_partial_refund, is_shared, is_split, split_breakdown, paid_by,
                        account, category_id, sub_category, tags, description, notes, reference_number,
                        related_mails, source_file, raw_data, link_parent_id, transaction_group_id
                    ) VALUES (
                        :transaction_date, :transaction_time, :amount, :split_share_amount,
                        :direction, :transaction_type, :is_partial_refund, :is_shared, :is_split, :split_breakdown, :paid_by,
                        :account, :category_id, :sub_category, :tags, :description, :notes, :reference_number,
                        :related_mails, :source_file, :raw_data, :link_parent_id, :transaction_group_id
                    ) RETURNING id
                """), {
                    "transaction_date": transaction_date,
                    "transaction_time": transaction_time,
                    "amount": amount,
                    "split_share_amount": split_share_amount,
                    "direction": direction,
                    "transaction_type": transaction_type,
                    "is_partial_refund": is_partial_refund,
                    "is_shared": is_shared,
                    "split_breakdown": json.dumps(split_breakdown) if split_breakdown else None,
                    "paid_by": paid_by,
                    "account": account,
                    "category_id": category_id,
                    "sub_category": sub_category,
                    "tags": tags or [],
                    "description": description,
                    "notes": notes,
                    "reference_number": reference_number,
                    "related_mails": related_mails,
                    "source_file": source_file,
                    "raw_data": raw_data,
                    "link_parent_id": link_parent_id,
                    "transaction_group_id": transaction_group_id,
                    "is_split": is_split
                }
            )
            transaction_id = result.fetchone()[0]
            await session.commit()
            return str(transaction_id)
        finally:
            await session.close()
    
    @staticmethod
    async def get_transaction_by_id(transaction_id: str) -> Optional[Dict[str, Any]]:
        """Get a transaction by its ID"""
        session_factory = get_session_factory()
        session = session_factory()
        try:
            result = await session.execute(
                text("""
                    SELECT t.*, c.name as category
                    FROM transactions t
                    LEFT JOIN categories c ON t.category_id = c.id
                    WHERE t.id = :transaction_id
                """), {"transaction_id": transaction_id}
            )
            row = result.fetchone()
            return dict(row._mapping) if row else None
        finally:
            await session.close()
    
    @staticmethod
    async def get_all_transactions(
        limit: int = 1000, 
        offset: int = 0,
        order_by: str = "ASC"  # "ASC" for chronological, "DESC" for newest first
    ) -> List[Dict[str, Any]]:
        """Get all transactions with configurable sorting"""
        session_factory = get_session_factory()
        session = session_factory()
        try:
            result = await session.execute(
                text(f"""
                    SELECT t.*, 
                           c.name as category,
                           COALESCE(
                               STRING_AGG(tag.name, ',' ORDER BY tag.name), 
                               ''
                           ) as tags
                    FROM transactions t
                    LEFT JOIN categories c ON t.category_id = c.id
                    LEFT JOIN transaction_tags tt ON t.id = tt.transaction_id
                    LEFT JOIN tags tag ON tt.tag_id = tag.id AND tag.is_active = true
                    GROUP BY t.id, c.name
                    ORDER BY t.transaction_date {order_by}, t.created_at {order_by}
                    LIMIT :limit OFFSET :offset
                """), {
                    "limit": limit,
                    "offset": offset
                }
            )
            rows = result.fetchall()
            transactions = []
            for row in rows:
                transaction_dict = dict(row._mapping)
                # Convert tags string to array
                if transaction_dict.get('tags'):
                    transaction_dict['tags'] = transaction_dict['tags'].split(',')
                else:
                    transaction_dict['tags'] = []
                transactions.append(transaction_dict)
            return transactions
        finally:
            await session.close()
    
    @staticmethod
    async def get_transactions_by_date_range(
        start_date: date, 
        end_date: date, 
        limit: int = 100, 
        offset: int = 0,
        order_by: str = "ASC"  # "ASC" for chronological, "DESC" for newest first
    ) -> List[Dict[str, Any]]:
        """Get transactions within a date range"""
        session_factory = get_session_factory()
        session = session_factory()
        try:
            result = await session.execute(
                text(f"""
                    SELECT t.*, c.name as category
                    FROM transactions t
                    LEFT JOIN categories c ON t.category_id = c.id
                    WHERE t.transaction_date BETWEEN :start_date AND :end_date
                    ORDER BY t.transaction_date {order_by}, t.created_at {order_by}
                    LIMIT :limit OFFSET :offset
                """), {
                    "start_date": start_date,
                    "end_date": end_date,
                    "limit": limit,
                    "offset": offset
                }
            )
            rows = result.fetchall()
            return [dict(row._mapping) for row in rows]
        finally:
            await session.close()
    
    @staticmethod
    async def get_transactions_by_account(
        account: str, 
        limit: int = 100, 
        offset: int = 0
    ) -> List[Dict[str, Any]]:
        """Get transactions for a specific account"""
        session_factory = get_session_factory()
        session = session_factory()
        try:
            result = await session.execute(
                text("""
                    SELECT t.*, c.name as category
                    FROM transactions t
                    LEFT JOIN categories c ON t.category_id = c.id
                    WHERE t.account = :account
                    ORDER BY t.transaction_date DESC, t.created_at DESC
                    LIMIT :limit OFFSET :offset
                """), {
                    "account": account,
                    "limit": limit,
                    "offset": offset
                }
            )
            rows = result.fetchall()
            return [dict(row._mapping) for row in rows]
        finally:
            await session.close()
    
    @staticmethod
    async def get_transactions_by_category(
        category: str,  # Now accepts category name, looks up by ID
        limit: int = 100, 
        offset: int = 0
    ) -> List[Dict[str, Any]]:
        """Get transactions for a specific category (by name)"""
        session_factory = get_session_factory()
        session = session_factory()
        try:
            # Look up category_id by name
            category_data = await CategoryOperations.get_category_by_name(category)
            if not category_data:
                return []  # Category doesn't exist
            
            result = await session.execute(
                text("""
                    SELECT * FROM transactions 
                    WHERE category_id = :category_id
                    ORDER BY transaction_date DESC, created_at DESC
                    LIMIT :limit OFFSET :offset
                """), {
                    "category_id": category_data['id'],
                    "limit": limit,
                    "offset": offset
                }
            )
            rows = result.fetchall()
            return [dict(row._mapping) for row in rows]
        finally:
            await session.close()
    
    @staticmethod
    async def get_shared_transactions(limit: int = 100, offset: int = 0) -> List[Dict[str, Any]]:
        """Get all shared transactions"""
        session_factory = get_session_factory()
        session = session_factory()
        try:
            result = await session.execute(
                text("""
                    SELECT t.*, c.name as category
                    FROM transactions t
                    LEFT JOIN categories c ON t.category_id = c.id
                    WHERE t.is_shared = true
                    ORDER BY t.transaction_date DESC, t.created_at DESC
                    LIMIT :limit OFFSET :offset
                """), {
                    "limit": limit,
                    "offset": offset
                }
            )
            rows = result.fetchall()
            return [dict(row._mapping) for row in rows]
        finally:
            await session.close()
    
    @staticmethod
    async def get_transfer_group_transactions(transaction_group_id: str) -> List[Dict[str, Any]]:
        """Get all transactions in a transfer group"""
        session_factory = get_session_factory()
        session = session_factory()
        try:
            result = await session.execute(
                text("""
                    SELECT t.*, c.name as category
                    FROM transactions t
                    LEFT JOIN categories c ON t.category_id = c.id
                    WHERE t.transaction_group_id = :transaction_group_id
                    ORDER BY t.transaction_date, t.created_at
                """), {"transaction_group_id": transaction_group_id}
            )
            rows = result.fetchall()
            return [dict(row._mapping) for row in rows]
        finally:
            await session.close()
    
    @staticmethod
    async def get_child_transactions(parent_id: str) -> List[Dict[str, Any]]:
        """Get all child transactions (refunds/adjustments) for a parent transaction"""
        session_factory = get_session_factory()
        session = session_factory()
        try:
            result = await session.execute(
                text("""
                    SELECT t.*, c.name as category
                    FROM transactions t
                    LEFT JOIN categories c ON t.category_id = c.id
                    WHERE t.link_parent_id = :parent_id
                    ORDER BY t.created_at
                """), {"parent_id": parent_id}
            )
            rows = result.fetchall()
            return [dict(row._mapping) for row in rows]
        finally:
            await session.close()
    
    @staticmethod
    async def update_transaction(
        transaction_id: str,
        **updates: Any
    ) -> bool:
        """Update a transaction with provided fields"""
        if not updates:
            return False
            
        session_factory = get_session_factory()
        session = session_factory()
        try:
            # If category name is being updated, look up the category_id
            if 'category' in updates:
                category_name = updates.pop('category')  # Remove category from updates
                if category_name:
                    category_data = await CategoryOperations.get_category_by_name(category_name)
                    if category_data:
                        # Add category_id to the updates
                        updates['category_id'] = category_data['id']
                    else:
                        # Category doesn't exist, set category_id to NULL
                        updates['category_id'] = None
                else:
                    # Empty category, set to NULL
                    updates['category_id'] = None
            
            # Build dynamic UPDATE query
            set_clauses = []
            params = {"transaction_id": transaction_id}
            
            for field, value in updates.items():
                if field in [
                    'transaction_date', 'transaction_time', 'amount', 'split_share_amount',
                    'direction', 'transaction_type', 'is_partial_refund', 'is_shared', 'split_breakdown',
                    'account', 'category_id', 'sub_category', 'tags', 'description', 'notes', 
                    'reference_number', 'related_mails', 'source_file', 'raw_data',
                    'link_parent_id', 'transaction_group_id'
                ]:
                    set_clauses.append(f"{field} = :{field}")
                    # Handle JSON fields that need to be encoded
                    if field in ['split_breakdown', 'raw_data'] and value is not None:
                        import json
                        params[field] = json.dumps(value)
                    else:
                        params[field] = value
            
            if not set_clauses:
                return False
            
            query = f"""
                UPDATE transactions 
                SET {', '.join(set_clauses)}
                WHERE id = :transaction_id
            """
            
            result = await session.execute(text(query), params)
            await session.commit()
            return result.rowcount > 0
        finally:
            await session.close()
    
    @staticmethod
    async def delete_transaction(transaction_id: str) -> bool:
        """Delete a transaction"""
        session_factory = get_session_factory()
        session = session_factory()
        try:
            result = await session.execute(
                text("""
                    DELETE FROM transactions 
                    WHERE id = :transaction_id
                """), {"transaction_id": transaction_id}
            )
            await session.commit()
            return result.rowcount > 0
        finally:
            await session.close()
    
    @staticmethod
    async def search_transactions(
        query: str,
        limit: int = 100,
        offset: int = 0
    ) -> List[Dict[str, Any]]:
        """Search transactions by description, notes, or reference number"""
        session_factory = get_session_factory()
        session = session_factory()
        try:
            search_term = f"%{query.lower()}%"
            result = await session.execute(
                text("""
                    SELECT t.*, c.name as category
                    FROM transactions t
                    LEFT JOIN categories c ON t.category_id = c.id
                    WHERE LOWER(t.description) LIKE :search_term
                       OR LOWER(t.notes) LIKE :search_term
                       OR LOWER(t.reference_number) LIKE :search_term
                    ORDER BY t.transaction_date DESC, t.created_at DESC
                    LIMIT :limit OFFSET :offset
                """), {
                    "search_term": search_term,
                    "limit": limit,
                    "offset": offset
                }
            )
            rows = result.fetchall()
            return [dict(row._mapping) for row in rows]
        finally:
            await session.close()
    
    @staticmethod
    async def get_transactions_by_direction(
        direction: str, 
        limit: int = 100, 
        offset: int = 0
    ) -> List[Dict[str, Any]]:
        """Get transactions by direction (debit/credit)"""
        session_factory = get_session_factory()
        session = session_factory()
        try:
            result = await session.execute(
                text("""
                    SELECT t.*, c.name as category
                    FROM transactions t
                    LEFT JOIN categories c ON t.category_id = c.id
                    WHERE t.direction = :direction
                    ORDER BY t.transaction_date DESC, t.created_at DESC
                    LIMIT :limit OFFSET :offset
                """), {
                    "direction": direction,
                    "limit": limit,
                    "offset": offset
                }
            )
            rows = result.fetchall()
            return [dict(row._mapping) for row in rows]
        finally:
            await session.close()
    
    @staticmethod
    async def get_transactions_by_tags(
        tags: List[str], 
        limit: int = 100, 
        offset: int = 0
    ) -> List[Dict[str, Any]]:
        """Get transactions that contain any of the specified tags"""
        session_factory = get_session_factory()
        session = session_factory()
        try:
            result = await session.execute(
                text("""
                    SELECT t.*, c.name as category
                    FROM transactions t
                    LEFT JOIN categories c ON t.category_id = c.id
                    WHERE t.tags && :tags
                    ORDER BY t.transaction_date DESC, t.created_at DESC
                    LIMIT :limit OFFSET :offset
                """), {
                    "tags": tags,
                    "limit": limit,
                    "offset": offset
                }
            )
            rows = result.fetchall()
            return [dict(row._mapping) for row in rows]
        finally:
            await session.close()
    
    @staticmethod
    async def get_transactions_by_type(
        transaction_type: str, 
        limit: int = 100, 
        offset: int = 0
    ) -> List[Dict[str, Any]]:
        """Get transactions by transaction type"""
        session_factory = get_session_factory()
        session = session_factory()
        try:
            result = await session.execute(
                text("""
                    SELECT t.*, c.name as category
                    FROM transactions t
                    LEFT JOIN categories c ON t.category_id = c.id
                    WHERE t.transaction_type = :transaction_type
                    ORDER BY t.transaction_date DESC, t.created_at DESC
                    LIMIT :limit OFFSET :offset
                """), {
                    "transaction_type": transaction_type,
                    "limit": limit,
                    "offset": offset
                }
            )
            rows = result.fetchall()
            return [dict(row._mapping) for row in rows]
        finally:
            await session.close()
    
    @staticmethod
    def _filter_valid_transactions(transactions: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Filter out invalid transactions that shouldn't be inserted"""
        valid_transactions = []
        
        for transaction in transactions:
            # Skip transactions without valid dates
            if not transaction.get('transaction_date'):
                logger.warning(f"Skipping transaction without date: {transaction.get('description', 'Unknown')}")
                continue
            
            # Skip summary/balance rows
            description = transaction.get('description', '').lower()
            if any(keyword in description for keyword in ['closing balance', 'opening balance', 'total', 'summary']):
                logger.warning(f"Skipping summary row: {transaction.get('description', 'Unknown')}")
                continue
            
            # Skip transactions without amounts
            if not transaction.get('amount') or transaction.get('amount') == 0:
                logger.warning(f"Skipping transaction without amount: {transaction.get('description', 'Unknown')}")
                continue
            
            valid_transactions.append(transaction)
        
        logger.info(f"Filtered {len(transactions)} -> {len(valid_transactions)} valid transactions")
        return valid_transactions
    
    @staticmethod
    async def bulk_insert_transactions(
        transactions: List[Dict[str, Any]],
        check_duplicates: bool = True
    ) -> Dict[str, Any]:
        """
        Bulk insert transactions with optional duplicate checking
        
        Args:
            transactions: List of transaction dictionaries
            check_duplicates: Whether to check for duplicates before inserting
            
        Returns:
            Dictionary with insert results and statistics
        """
        if not transactions:
            return {
                "success": True,
                "inserted_count": 0,
                "skipped_count": 0,
                "error_count": 0,
                "errors": []
            }
        
        
        session_factory = get_session_factory()
        session = session_factory()
        
        result = {
            "success": True,
            "inserted_count": 0,
            "skipped_count": 0,
            "error_count": 0,
            "errors": []
        }
        
        try:
            # Check for duplicates if requested
            transactions_to_insert = transactions
            if check_duplicates:
                transactions_to_insert = await TransactionOperations._filter_duplicate_transactions(
                    session, transactions
                )
            
            # Sort transactions by date (chronological order - oldest first)
            transactions_to_insert = TransactionOperations._sort_transactions_by_date(transactions_to_insert)
            result["skipped_count"] = len(transactions) - len(transactions_to_insert)
            
            if not transactions_to_insert:
                logger.info("No new transactions to insert after duplicate filtering")
                return result
            
            # Prepare bulk insert data
            insert_data = []
            for transaction in transactions_to_insert:
                try:
                    # Convert transaction data to database format
                    insert_row = TransactionOperations._prepare_transaction_for_insert(transaction)
                    insert_data.append(insert_row)
                except Exception as e:
                    result["error_count"] += 1
                    result["errors"].append(f"Error preparing transaction: {e}")
                    continue
            
            if not insert_data:
                logger.warning("No valid transactions to insert after preparation")
                return result
            
            # Perform bulk insert
            insert_query = text("""
                INSERT INTO transactions (
                    transaction_date, transaction_time, amount, split_share_amount,
                    direction, transaction_type, is_partial_refund, is_shared, split_breakdown,
                    account, category, sub_category, tags, description, notes, reference_number,
                    related_mails, source_file, raw_data, link_parent_id, transaction_group_id
                ) VALUES (
                    :transaction_date, :transaction_time, :amount, :split_share_amount,
                    :direction, :transaction_type, :is_partial_refund, :is_shared, :split_breakdown,
                    :account, :category, :sub_category, :tags, :description, :notes, :reference_number,
                    :related_mails, :source_file, :raw_data, :link_parent_id, :transaction_group_id
                )
            """)
            
            await session.execute(insert_query, insert_data)
            await session.commit()
            
            result["inserted_count"] = len(insert_data)
            logger.info(f"Successfully inserted {result['inserted_count']} transactions")
            
            return result
            
        except Exception as e:
            await session.rollback()
            result["success"] = False
            result["errors"].append(f"Bulk insert failed: {e}")
            logger.error(f"Bulk insert failed: {e}")
            return result
        finally:
            await session.close()
    
    @staticmethod
    async def _filter_duplicate_transactions(
        session: AsyncSession, 
        transactions: List[Dict[str, Any]]
    ) -> List[Dict[str, Any]]:
        """Filter out duplicate transactions based on composite key"""
        try:
            # Get existing transactions for the date range
            if not transactions:
                return []
            
            # Extract date range from transactions (convert strings to date objects)
            dates = []
            for t in transactions:
                date_val = t.get('transaction_date')
                if date_val:
                    if isinstance(date_val, str):
                        try:
                            dates.append(datetime.strptime(date_val, "%Y-%m-%d").date())
                        except ValueError:
                            continue
                    elif isinstance(date_val, date):
                        dates.append(date_val)
                    elif hasattr(date_val, 'date'):  # pandas Timestamp
                        dates.append(date_val.date())
            
            if not dates:
                return transactions
            
            min_date = min(dates)
            max_date = max(dates)
            
            # Query existing transactions in the date range
            existing_query = text("""
                SELECT transaction_date, amount, account, description, source_file, raw_data
                FROM transactions 
                WHERE transaction_date BETWEEN :min_date AND :max_date
            """)
            
            result = await session.execute(existing_query, {
                "min_date": min_date,
                "max_date": max_date
            })
            existing_transactions = result.fetchall()
            
            # Create set of existing transaction keys
            existing_keys = set()
            for row in existing_transactions:
                key = TransactionOperations._create_transaction_key(
                    row.transaction_date,
                    float(row.amount),
                    row.account,
                    row.description,
                    row.source_file,
                    row.raw_data
                )
                existing_keys.add(key)
            
            # Filter out duplicates
            unique_transactions = []
            for transaction in transactions:
                key = TransactionOperations._create_transaction_key(
                    transaction.get('transaction_date'),
                    float(transaction.get('amount', 0)),
                    transaction.get('account', ''),
                    transaction.get('description', ''),
                    transaction.get('source_file', ''),
                    transaction.get('raw_data', {})
                )
                
                if key not in existing_keys:
                    unique_transactions.append(transaction)
                    existing_keys.add(key)  # Prevent duplicates within the batch
            
            logger.info(f"Duplicate filtering: {len(transactions)} -> {len(unique_transactions)} transactions")
            return unique_transactions
            
        except Exception as e:
            logger.error(f"Error filtering duplicate transactions: {e}")
            return transactions  # Return all if filtering fails
    
    @staticmethod
    def _create_transaction_key(
        transaction_date: str,
        amount: float,
        account: str,
        description: str,
        source_file: str,
        raw_data: Any
    ) -> str:
        """Create a composite key for duplicate detection"""
        # Normalize description
        normalized_desc = description.lower().strip() if description else ""
        
        # Create hash of raw_data for comparison
        raw_data_str = json.dumps(raw_data, sort_keys=True) if raw_data else ""
        raw_data_hash = hashlib.md5(raw_data_str.encode()).hexdigest()
        
        # Round amount to 2 decimal places
        rounded_amount = round(amount, 2)
        
        return f"{transaction_date}|{rounded_amount}|{account}|{normalized_desc}|{source_file}|{raw_data_hash}"
    
    @staticmethod
    def _clean_data_for_json(data: Any) -> Any:
        """Clean data for JSON serialization by converting NaN to None"""
        if isinstance(data, dict):
            return {k: TransactionOperations._clean_data_for_json(v) for k, v in data.items()}
        elif isinstance(data, list):
            return [TransactionOperations._clean_data_for_json(item) for item in data]
        elif pd.isna(data):
            return None
        else:
            return data
    
    @staticmethod
    def _sort_transactions_by_date(transactions: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Sort transactions by date in chronological order (oldest first)"""
        try:
            if not transactions:
                return transactions
            
            def sort_key(x):
                date_val = x.get('transaction_date')
                time_val = x.get('transaction_time')
                
                # Handle time values - convert None to '00:00:00'
                if time_val is None or pd.isna(time_val):
                    time_val = '00:00:00'
                elif hasattr(time_val, 'isoformat'):  # datetime.time object
                    time_val = time_val.isoformat()
                else:
                    time_val = str(time_val)
                
                # Handle different date types
                if pd.isna(date_val) or date_val is None:
                    return ('9999-12-31', time_val)
                elif hasattr(date_val, 'date'):  # pandas Timestamp
                    return (date_val.date().isoformat(), time_val)
                elif isinstance(date_val, str):
                    return (date_val, time_val)
                elif hasattr(date_val, 'isoformat'):  # datetime.date object
                    return (date_val.isoformat(), time_val)
                else:
                    # Fallback for any other type
                    return ('9999-12-31', time_val)
            
            sorted_transactions = sorted(transactions, key=sort_key)
            logger.info(f"Sorted {len(sorted_transactions)} transactions by date (chronological order)")
            return sorted_transactions
            
        except Exception as e:
            logger.error(f"Error sorting transactions by date: {e}")
            return transactions
    
    @staticmethod
    def _prepare_transaction_for_insert(transaction: Dict[str, Any]) -> Dict[str, Any]:
        """Prepare transaction data for database insert"""
        # Convert date string to date object
        transaction_date = transaction.get('transaction_date')
        if transaction_date and isinstance(transaction_date, str):
            try:
                transaction_date = datetime.strptime(transaction_date, "%Y-%m-%d").date()
            except ValueError:
                logger.warning(f"Could not parse transaction date: {transaction_date}")
                transaction_date = None
        
        # Convert time string to time object if present
        transaction_time = transaction.get('transaction_time')
        if transaction_time and isinstance(transaction_time, str):
            try:
                transaction_time = datetime.strptime(transaction_time, "%H:%M:%S").time()
            except ValueError:
                try:
                    transaction_time = datetime.strptime(transaction_time, "%H:%M").time()
                except ValueError:
                    logger.warning(f"Could not parse transaction time: {transaction_time}")
                    transaction_time = None
        
        # Map standardized fields to database fields
        return {
            "transaction_date": transaction_date,
            "transaction_time": transaction_time,
            "amount": Decimal(str(transaction.get('amount', 0))),
            "split_share_amount": Decimal(str(transaction.get('my_share', 0))) if transaction.get('is_shared', False) else None,
            "direction": transaction.get('transaction_type', 'debit'),  # Map transaction_type to direction (debit/credit)
            "transaction_type": "purchase",  # Default to purchase for Splitwise transactions
            "is_partial_refund": False,
            "is_shared": transaction.get('is_shared', False),
            "split_breakdown": transaction.get('split_breakdown'),
            "paid_by": transaction.get('paid_by'),  # Who actually paid for this transaction
            "account": transaction.get('account', ''),
                "category": transaction.get('category') or 'uncategorized',
            "sub_category": None,
            "tags": [],
            "description": transaction.get('description', ''),
            "notes": None,
            "reference_number": str(transaction.get('reference_number', '')),
            "related_mails": [],
            "source_file": transaction.get('source_file', ''),
                "raw_data": json.dumps(TransactionOperations._clean_data_for_json(transaction.get('raw_data', {}))) if transaction.get('raw_data') else None,
            "link_parent_id": None,
            "transaction_group_id": None
        }


# Convenience functions for backward compatibility
async def get_all_bank_accounts() -> List[dict]:
    """Get all bank accounts (backward compatibility)"""
    return await AccountOperations.get_all_accounts()

async def get_credit_card_accounts() -> List[dict]:
    """Get all credit card accounts (backward compatibility)"""
    return await AccountOperations.get_credit_cards()

async def get_account_by_email(email: str) -> Optional[dict]:
    """Get account by statement sender email (backward compatibility)"""
    return await AccountOperations.get_account_by_statement_sender(email)


class TagOperations:
    """Operations for managing transaction tags"""
    
    @staticmethod
    async def get_all_tags() -> List[dict]:
        """Get all active tags with usage counts"""
        session_factory = get_session_factory()
        session = session_factory()
        try:
            result = await session.execute(
                text("""
                    SELECT 
                        t.id, t.name, t.slug, t.color, t.description,
                        t.is_active, t.created_at, t.updated_at,
                        COUNT(tt.transaction_id) as usage_count
                    FROM tags t
                    LEFT JOIN transaction_tags tt ON t.id = tt.tag_id
                    WHERE t.is_active = true
                    GROUP BY t.id, t.name, t.slug, t.color, t.description, t.is_active, t.created_at, t.updated_at
                    ORDER BY usage_count DESC, t.name
                """)
            )
            rows = result.fetchall()
            tags = []
            for row in rows:
                tag_dict = dict(row._mapping)
                # Convert UUID to string
                tag_dict['id'] = str(tag_dict['id'])
                tags.append(tag_dict)
            return tags
        finally:
            await session.close()
    
    @staticmethod
    async def get_tag_by_id(tag_id: str) -> Optional[dict]:
        """Get tag by ID"""
        session_factory = get_session_factory()
        session = session_factory()
        try:
            result = await session.execute(
                text("""
                    SELECT * FROM tags 
                    WHERE id = :tag_id AND is_active = true
                """), {"tag_id": tag_id}
            )
            row = result.fetchone()
            return dict(row._mapping) if row else None
        finally:
            await session.close()
    
    @staticmethod
    async def get_tag_by_name(name: str) -> Optional[dict]:
        """Get tag by name (case-insensitive)"""
        session_factory = get_session_factory()
        session = session_factory()
        try:
            result = await session.execute(
                text("""
                    SELECT * FROM tags 
                    WHERE LOWER(name) = LOWER(:name) AND is_active = true
                """), {"name": name}
            )
            row = result.fetchone()
            if row:
                tag_dict = dict(row._mapping)
                # Convert UUID to string
                tag_dict['id'] = str(tag_dict['id'])
                return tag_dict
            return None
        finally:
            await session.close()
    
    @staticmethod
    async def search_tags(query: str, limit: int = 20) -> List[dict]:
        """Search tags by name (case-insensitive partial match)"""
        session_factory = get_session_factory()
        session = session_factory()
        try:
            result = await session.execute(
                text("""
                    SELECT 
                        t.id, t.name, t.slug, t.color, t.description,
                        t.is_active, t.created_at, t.updated_at,
                        COUNT(tt.transaction_id) as usage_count
                    FROM tags t
                    LEFT JOIN transaction_tags tt ON t.id = tt.tag_id
                    WHERE LOWER(t.name) LIKE LOWER(:query) AND t.is_active = true
                    GROUP BY t.id, t.name, t.slug, t.color, t.description, t.is_active, t.created_at, t.updated_at
                    ORDER BY 
                        CASE WHEN LOWER(t.name) = LOWER(:exact_query) THEN 1 ELSE 2 END,
                        usage_count DESC,
                        t.name
                    LIMIT :limit
                """), {
                    "query": f"%{query}%",
                    "exact_query": query,
                    "limit": limit
                }
            )
            rows = result.fetchall()
            tags = []
            for row in rows:
                tag_dict = dict(row._mapping)
                # Convert UUID to string
                tag_dict['id'] = str(tag_dict['id'])
                tags.append(tag_dict)
            return tags
        finally:
            await session.close()
    
    @staticmethod
    async def create_tag(
        name: str,
        color: Optional[str] = None,
        description: Optional[str] = None
    ) -> str:
        """Create a new tag and return its ID"""
        session_factory = get_session_factory()
        session = session_factory()
        try:
            # Check if tag already exists
            existing = await TagOperations.get_tag_by_name(name)
            if existing:
                raise ValueError(f"Tag '{name}' already exists")
            
            # Generate slug from name
            slug = name.lower().replace(' ', '-').replace('&', 'and')
            
            result = await session.execute(
                text("""
                    INSERT INTO tags (name, slug, color, description, is_active)
                    VALUES (:name, :slug, :color, :description, true)
                    RETURNING id
                """), {
                    "name": name,
                    "slug": slug,
                    "color": color,
                    "description": description
                }
            )
            tag_id = result.fetchone()[0]
            await session.commit()
            logger.info(f"Created new tag: {name} (ID: {tag_id})")
            return str(tag_id)
        finally:
            await session.close()
    
    @staticmethod
    async def update_tag(
        tag_id: str,
        name: Optional[str] = None,
        color: Optional[str] = None,
        description: Optional[str] = None
    ) -> bool:
        """Update a tag"""
        session_factory = get_session_factory()
        session = session_factory()
        try:
            # Build dynamic UPDATE query
            set_clauses = []
            params = {"tag_id": tag_id}
            
            if name is not None:
                set_clauses.append("name = :name")
                set_clauses.append("slug = :slug")
                params["name"] = name
                params["slug"] = name.lower().replace(' ', '-').replace('&', 'and')
            if color is not None:
                set_clauses.append("color = :color")
                params["color"] = color
            if description is not None:
                set_clauses.append("description = :description")
                params["description"] = description
            
            if not set_clauses:
                return False
            
            set_clauses.append("updated_at = CURRENT_TIMESTAMP")
            
            query = f"""
                UPDATE tags 
                SET {', '.join(set_clauses)}
                WHERE id = :tag_id AND is_active = true
            """
            
            result = await session.execute(text(query), params)
            await session.commit()
            success = result.rowcount > 0
            if success:
                logger.info(f"Updated tag: {tag_id}")
            return success
        finally:
            await session.close()
    
    @staticmethod
    async def delete_tag(tag_id: str) -> bool:
        """Soft delete a tag (set is_active = false)"""
        session_factory = get_session_factory()
        session = session_factory()
        try:
            result = await session.execute(
                text("""
                    UPDATE tags 
                    SET is_active = false, updated_at = CURRENT_TIMESTAMP
                    WHERE id = :tag_id
                """), {"tag_id": tag_id}
            )
            await session.commit()
            success = result.rowcount > 0
            if success:
                logger.info(f"Soft deleted tag: {tag_id}")
            return success
        finally:
            await session.close()
    
    @staticmethod
    async def upsert_tag(
        name: str,
        color: Optional[str] = None,
        description: Optional[str] = None
    ) -> str:
        """Upsert a tag (create if not exists, update if exists)"""
        # First try to get existing tag
        existing = await TagOperations.get_tag_by_name(name)
        if existing:
            # Update existing tag
            await TagOperations.update_tag(
                existing['id'],
                color=color,
                description=description
            )
            return existing['id']
        else:
            # Create new tag
            return await TagOperations.create_tag(
                name=name,
                color=color,
                description=description
            )
    
    @staticmethod
    async def get_tags_for_transaction(transaction_id: str) -> List[dict]:
        """Get all tags for a specific transaction"""
        session_factory = get_session_factory()
        session = session_factory()
        try:
            result = await session.execute(
                text("""
                    SELECT t.id, t.name, t.color, t.description
                    FROM tags t
                    INNER JOIN transaction_tags tt ON t.id = tt.tag_id
                    WHERE tt.transaction_id = :transaction_id AND t.is_active = true
                    ORDER BY t.name
                """), {"transaction_id": transaction_id}
            )
            rows = result.fetchall()
            tags = []
            for row in rows:
                tag_dict = dict(row._mapping)
                # Convert UUID to string
                tag_dict['id'] = str(tag_dict['id'])
                tags.append(tag_dict)
            return tags
        finally:
            await session.close()
    
    @staticmethod
    async def add_tags_to_transaction(transaction_id: str, tag_ids: List[str]) -> bool:
        """Add tags to a transaction"""
        if not tag_ids:
            return True
            
        session_factory = get_session_factory()
        session = session_factory()
        try:
            # Insert tag associations
            for tag_id in tag_ids:
                await session.execute(
                    text("""
                        INSERT INTO transaction_tags (transaction_id, tag_id)
                        VALUES (:transaction_id, :tag_id)
                        ON CONFLICT (transaction_id, tag_id) DO NOTHING
                    """), {
                        "transaction_id": transaction_id,
                        "tag_id": tag_id
                    }
                )
            
            await session.commit()
            logger.info(f"Added {len(tag_ids)} tags to transaction {transaction_id}")
            return True
        except Exception as e:
            await session.rollback()
            logger.error(f"Failed to add tags to transaction: {e}")
            return False
        finally:
            await session.close()
    
    @staticmethod
    async def remove_tags_from_transaction(transaction_id: str, tag_ids: List[str]) -> bool:
        """Remove tags from a transaction"""
        if not tag_ids:
            return True
            
        session_factory = get_session_factory()
        session = session_factory()
        try:
            # Remove tag associations
            await session.execute(
                text("""
                    DELETE FROM transaction_tags 
                    WHERE transaction_id = :transaction_id AND tag_id = ANY(:tag_ids)
                """), {
                    "transaction_id": transaction_id,
                    "tag_ids": tag_ids
                }
            )
            
            await session.commit()
            logger.info(f"Removed {len(tag_ids)} tags from transaction {transaction_id}")
            return True
        except Exception as e:
            await session.rollback()
            logger.error(f"Failed to remove tags from transaction: {e}")
            return False
        finally:
            await session.close()
    
    @staticmethod
    async def set_transaction_tags(transaction_id: str, tag_ids: List[str]) -> bool:
        """Set tags for a transaction (replace all existing tags)"""
        session_factory = get_session_factory()
        session = session_factory()
        try:
            # Remove all existing tags
            await session.execute(
                text("""
                    DELETE FROM transaction_tags 
                    WHERE transaction_id = :transaction_id
                """), {"transaction_id": transaction_id}
            )
            
            # Add new tags
            if tag_ids:
                for tag_id in tag_ids:
                    await session.execute(
                        text("""
                            INSERT INTO transaction_tags (transaction_id, tag_id)
                            VALUES (:transaction_id, :tag_id)
                        """), {
                            "transaction_id": transaction_id,
                            "tag_id": tag_id
                        }
                    )
            
            await session.commit()
            logger.info(f"Set {len(tag_ids)} tags for transaction {transaction_id}")
            return True
        except Exception as e:
            await session.rollback()
            logger.error(f"Failed to set tags for transaction: {e}")
            return False
        finally:
            await session.close()


class CategoryOperations:
    """Operations for managing transaction categories"""
    
    @staticmethod
    async def get_all_categories() -> List[dict]:
        """Get all active categories"""
        session_factory = get_session_factory()
        session = session_factory()
        try:
            result = await session.execute(
                text("""
                    SELECT id, name, slug, color, parent_id, sort_order,
                           is_active, created_at, updated_at
                    FROM categories 
                    WHERE is_active = true
                    ORDER BY sort_order, name
                """)
            )
            rows = result.fetchall()
            return [dict(row._mapping) for row in rows]
        finally:
            await session.close()
    
    @staticmethod
    async def get_category_by_id(category_id: str) -> Optional[dict]:
        """Get category by ID"""
        session_factory = get_session_factory()
        session = session_factory()
        try:
            result = await session.execute(
                text("""
                    SELECT * FROM categories 
                    WHERE id = :category_id AND is_active = true
                """), {"category_id": category_id}
            )
            row = result.fetchone()
            return dict(row._mapping) if row else None
        finally:
            await session.close()
    
    @staticmethod
    async def get_category_by_name(name: str) -> Optional[dict]:
        """Get category by name (case-insensitive)"""
        session_factory = get_session_factory()
        session = session_factory()
        try:
            result = await session.execute(
                text("""
                    SELECT * FROM categories 
                    WHERE LOWER(name) = LOWER(:name) AND is_active = true
                """), {"name": name}
            )
            row = result.fetchone()
            return dict(row._mapping) if row else None
        finally:
            await session.close()
    
    @staticmethod
    async def search_categories(query: str, limit: int = 20) -> List[dict]:
        """Search categories by name (case-insensitive partial match)"""
        session_factory = get_session_factory()
        session = session_factory()
        try:
            result = await session.execute(
                text("""
                    SELECT * FROM categories 
                    WHERE LOWER(name) LIKE LOWER(:query) AND is_active = true
                    ORDER BY 
                        CASE WHEN LOWER(name) = LOWER(:exact_query) THEN 1 ELSE 2 END,
                        name
                    LIMIT :limit
                """), {
                    "query": f"%{query}%",
                    "exact_query": query,
                    "limit": limit
                }
            )
            rows = result.fetchall()
            return [dict(row._mapping) for row in rows]
        finally:
            await session.close()
    
    @staticmethod
    async def create_category(
        name: str,
        color: Optional[str] = None,
        parent_id: Optional[str] = None,
        sort_order: Optional[int] = None
    ) -> str:
        """Create a new category and return its ID"""
        session_factory = get_session_factory()
        session = session_factory()
        try:
            # Check if category already exists
            existing = await CategoryOperations.get_category_by_name(name)
            if existing:
                raise ValueError(f"Category '{name}' already exists")
            
            # Generate unique slug from name
            base_slug = name.lower().replace(' ', '-').replace('&', 'and')
            slug = base_slug
            counter = 1
            
            # Check if slug already exists (including inactive categories)
            while True:
                check_result = await session.execute(
                    text("SELECT id FROM categories WHERE slug = :slug"),
                    {"slug": slug}
                )
                if not check_result.fetchone():
                    break
                slug = f"{base_slug}-{counter}"
                counter += 1
            
            # Get next sort order if not provided
            if sort_order is None:
                result = await session.execute(
                    text("SELECT COALESCE(MAX(sort_order), 0) + 1 FROM categories")
                )
                sort_order = result.fetchone()[0]
            
            result = await session.execute(
                text("""
                    INSERT INTO categories (name, slug, color, parent_id, sort_order, is_active)
                    VALUES (:name, :slug, :color, :parent_id, :sort_order, true)
                    RETURNING id
                """), {
                    "name": name,
                    "slug": slug,
                    "color": color,
                    "parent_id": parent_id,
                    "sort_order": sort_order
                }
            )
            category_id = result.fetchone()[0]
            await session.commit()
            logger.info(f"Created new category: {name} (ID: {category_id})")
            return str(category_id)
        finally:
            await session.close()
    
    @staticmethod
    async def update_category(
        category_id: str,
        name: Optional[str] = None,
        color: Optional[str] = None,
        parent_id: Optional[str] = None,
        sort_order: Optional[int] = None
    ) -> bool:
        """Update a category"""
        session_factory = get_session_factory()
        session = session_factory()
        try:
            # Build dynamic UPDATE query
            set_clauses = []
            params = {"category_id": category_id}
            
            if name is not None:
                set_clauses.append("name = :name")
                set_clauses.append("slug = :slug")
                params["name"] = name
                
                # Generate unique slug
                base_slug = name.lower().replace(' ', '-').replace('&', 'and')
                slug = base_slug
                counter = 1
                
                # Check if slug already exists for a different category (including inactive)
                while True:
                    check_result = await session.execute(
                        text("SELECT id FROM categories WHERE slug = :slug AND id != :category_id"),
                        {"slug": slug, "category_id": category_id}
                    )
                    if not check_result.fetchone():
                        break
                    slug = f"{base_slug}-{counter}"
                    counter += 1
                
                params["slug"] = slug
            if color is not None:
                set_clauses.append("color = :color")
                params["color"] = color
            if parent_id is not None:
                set_clauses.append("parent_id = :parent_id")
                params["parent_id"] = parent_id
            if sort_order is not None:
                set_clauses.append("sort_order = :sort_order")
                params["sort_order"] = sort_order
            
            if not set_clauses:
                return False
            
            set_clauses.append("updated_at = CURRENT_TIMESTAMP")
            
            query = f"""
                UPDATE categories 
                SET {', '.join(set_clauses)}
                WHERE id = :category_id AND is_active = true
            """
            
            result = await session.execute(text(query), params)
            await session.commit()
            success = result.rowcount > 0
            if success:
                logger.info(f"Updated category: {category_id}")
            return success
        finally:
            await session.close()
    
    @staticmethod
    async def delete_category(category_id: str) -> bool:
        """Soft delete a category (set is_active = false)"""
        session_factory = get_session_factory()
        session = session_factory()
        try:
            result = await session.execute(
                text("""
                    UPDATE categories 
                    SET is_active = false, updated_at = CURRENT_TIMESTAMP
                    WHERE id = :category_id
                """), {"category_id": category_id}
            )
            await session.commit()
            success = result.rowcount > 0
            if success:
                logger.info(f"Soft deleted category: {category_id}")
            return success
        finally:
            await session.close()
    
    @staticmethod
    async def upsert_category(
        name: str,
        color: Optional[str] = None,
        parent_id: Optional[str] = None,
        sort_order: Optional[int] = None
    ) -> str:
        """Upsert a category (create if not exists, update if exists)"""
        # First try to get existing category
        existing = await CategoryOperations.get_category_by_name(name)
        if existing:
            # Update existing category
            await CategoryOperations.update_category(
                existing['id'],
                color=color,
                parent_id=parent_id,
                sort_order=sort_order
            )
            return existing['id']
        else:
            # Create new category
            return await CategoryOperations.create_category(
                name=name,
                color=color,
                parent_id=parent_id,
                sort_order=sort_order
            )
