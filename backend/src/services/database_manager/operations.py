from __future__ import annotations

from typing import List, Optional, Dict, Any, Tuple
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
        try:
            logger.info("Retrieving all active bank accounts")
            session_factory = get_session_factory()
            session = session_factory()
            logger.debug("Database session created")
            
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
            accounts = [dict(row._mapping) for row in rows]
            logger.info(f"Retrieved {len(accounts)} active accounts")
            return accounts
        except Exception as e:
            logger.error("Error retrieving all accounts", exc_info=True)
            raise
        finally:
            await session.close()
    
    @staticmethod
    async def get_accounts_by_type(account_type: str) -> List[dict]:
        """Get accounts by type (credit_card, savings, current)"""
        try:
            logger.info(f"Retrieving accounts of type: {account_type}")
            session_factory = get_session_factory()
            session = session_factory()
            logger.debug("Database session created")
            
            result = await session.execute(
                text("""
                    SELECT * FROM accounts 
                    WHERE account_type = :account_type AND is_active = true
                    ORDER BY bank_name
                """), {"account_type": account_type}
            )
            rows = result.fetchall()
            accounts = [dict(row._mapping) for row in rows]
            logger.info(f"Retrieved {len(accounts)} accounts of type {account_type}")
            return accounts
        except Exception as e:
            logger.error(f"Error retrieving accounts by type {account_type}", exc_info=True)
            raise
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
    def _process_transaction_description(transaction_dict: Dict[str, Any]) -> Dict[str, Any]:
        """Process transaction to use user_description if available, otherwise use original description"""
        if transaction_dict.get('user_description'):
            transaction_dict['description'] = transaction_dict['user_description']
        return transaction_dict
    
    @staticmethod
    def _process_transactions(transactions: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Process a list of transactions to use user_description if available"""
        return [TransactionOperations._process_transaction_description(t) for t in transactions]

    @staticmethod
    def _deduplicate_grouped_expense_collapsed(transactions: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Ensure at most one collapsed row per transaction_group_id (fixes duplicate display from migration)."""
        # For each group_id, keep only the collapsed row with the smallest id (original)
        group_collapsed: Dict[Any, str] = {}  # group_id -> id to keep
        for t in transactions:
            if t.get("is_grouped_expense") is not True:
                continue
            group_id = t.get("transaction_group_id")
            if not group_id:
                continue
            t_id = str(t.get("id", ""))
            if group_id not in group_collapsed or t_id < group_collapsed[group_id]:
                group_collapsed[group_id] = t_id
        keep_ids = set(group_collapsed.values()) if group_collapsed else set()
        # Include non-collapsed rows; for collapsed, include only the one we're keeping per group
        return [
            t for t in transactions
            if not (t.get("transaction_group_id") and t.get("is_grouped_expense") is True)
            or str(t.get("id", "")) in keep_ids
        ]

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
        transaction_group_id: Optional[str] = None,
        is_split: Optional[bool] = None,
        is_grouped_expense: Optional[bool] = None,
        transaction_source: Optional[str] = "manual_entry",
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
                        direction, transaction_type, is_shared, is_split, is_grouped_expense, split_breakdown, paid_by,
                        account, category_id, sub_category, tags, description, notes, reference_number,
                        related_mails, source_file, raw_data, transaction_group_id, transaction_source
                    ) VALUES (
                        :transaction_date, :transaction_time, :amount, :split_share_amount,
                        :direction, :transaction_type, :is_shared, :is_split, :is_grouped_expense, :split_breakdown, :paid_by,
                        :account, :category_id, :sub_category, :tags, :description, :notes, :reference_number,
                        :related_mails, :source_file, :raw_data, :transaction_group_id, :transaction_source
                    ) RETURNING id
                """), {
                    "transaction_date": transaction_date,
                    "transaction_time": transaction_time,
                    "amount": amount,
                    "split_share_amount": split_share_amount,
                    "direction": direction,
                    "transaction_type": transaction_type,
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
                    "transaction_group_id": transaction_group_id,
                    "is_split": is_split,
                    "is_grouped_expense": is_grouped_expense,
                    "transaction_source": transaction_source,
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
                    SELECT t.*, 
                           c.name as category
                    FROM transactions t
                    LEFT JOIN categories c ON t.category_id = c.id
                    WHERE t.id = :transaction_id
                      AND t.is_deleted = false
                """), {"transaction_id": transaction_id}
            )
            row = result.fetchone()
            if row:
                transaction_dict = dict(row._mapping)
                return TransactionOperations._process_transaction_description(transaction_dict)
            return None
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
                    WHERE t.is_deleted = false
                      AND (t.transaction_group_id IS NULL 
                           OR t.is_grouped_expense = TRUE 
                           OR t.is_split = TRUE
                           OR (t.transaction_group_id IS NOT NULL 
                               AND COALESCE(t.is_grouped_expense, false) = false 
                               AND COALESCE(t.is_split, false) = false
                               AND NOT EXISTS (
                                 SELECT 1 FROM transactions t2
                                 WHERE t2.transaction_group_id = t.transaction_group_id
                                   AND t2.is_grouped_expense = true
                                   AND t2.is_deleted = false
                               )))
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
            processed = TransactionOperations._process_transactions(transactions)
            return TransactionOperations._deduplicate_grouped_expense_collapsed(processed)
        finally:
            await session.close()
    
    @staticmethod
    async def get_last_transaction_date() -> Optional[date]:
        """Get the date of the most recent transaction in the database"""
        session_factory = get_session_factory()
        session = session_factory()
        try:
            result = await session.execute(
                text("""
                    SELECT MAX(transaction_date) as last_date
                    FROM transactions
                    WHERE is_deleted = false
                """)
            )
            row = result.fetchone()
            if row and row.last_date:
                return row.last_date
            return None
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
                    WHERE t.transaction_date BETWEEN :start_date AND :end_date
                      AND t.is_deleted = false
                      AND (t.transaction_group_id IS NULL 
                           OR t.is_grouped_expense = TRUE 
                           OR t.is_split = TRUE
                           OR (t.transaction_group_id IS NOT NULL 
                               AND COALESCE(t.is_grouped_expense, false) = false 
                               AND COALESCE(t.is_split, false) = false
                               AND NOT EXISTS (
                                 SELECT 1 FROM transactions t2
                                 WHERE t2.transaction_group_id = t.transaction_group_id
                                   AND t2.is_grouped_expense = true
                                   AND t2.is_deleted = false
                               )))
                    GROUP BY t.id, c.name
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
            transactions = []
            for row in rows:
                transaction_dict = dict(row._mapping)
                # Convert tags string to array
                if transaction_dict.get('tags'):
                    transaction_dict['tags'] = transaction_dict['tags'].split(',')
                else:
                    transaction_dict['tags'] = []
                transactions.append(transaction_dict)
            processed = TransactionOperations._process_transactions(transactions)
            return TransactionOperations._deduplicate_grouped_expense_collapsed(processed)
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
                      AND t.is_deleted = false
                    ORDER BY t.transaction_date DESC, t.created_at DESC
                    LIMIT :limit OFFSET :offset
                """), {
                    "account": account,
                    "limit": limit,
                    "offset": offset
                }
            )
            rows = result.fetchall()
            transactions = [dict(row._mapping) for row in rows]
            return TransactionOperations._process_transactions(transactions)
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
                      AND is_deleted = false
                    ORDER BY transaction_date DESC, created_at DESC
                    LIMIT :limit OFFSET :offset
                """), {
                    "category_id": category_data['id'],
                    "limit": limit,
                    "offset": offset
                }
            )
            rows = result.fetchall()
            transactions = [dict(row._mapping) for row in rows]
            return TransactionOperations._process_transactions(transactions)
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
                      AND t.is_deleted = false
                    ORDER BY t.transaction_date DESC, t.created_at DESC
                    LIMIT :limit OFFSET :offset
                """), {
                    "limit": limit,
                    "offset": offset
                }
            )
            rows = result.fetchall()
            transactions = [dict(row._mapping) for row in rows]
            return TransactionOperations._process_transactions(transactions)
        finally:
            await session.close()
    
    @staticmethod
    async def get_transfer_group_transactions(transaction_group_id: str) -> List[Dict[str, Any]]:
        """Get all transactions in a transfer group or split group"""
        session_factory = get_session_factory()
        session = session_factory()
        try:
            result = await session.execute(
                text("""
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
                    WHERE t.transaction_group_id = :transaction_group_id
                      AND t.is_deleted = false
                    GROUP BY t.id, c.name
                    ORDER BY t.transaction_date, t.created_at
                """), {"transaction_group_id": transaction_group_id}
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
            return TransactionOperations._process_transactions(transactions)
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
            
            # If description is being updated, store it in user_description instead
            # This preserves the original description while allowing user updates
            if 'description' in updates:
                description_value = updates.pop('description')
                updates['user_description'] = description_value
            
            # Build dynamic UPDATE query
            set_clauses = []
            params = {"transaction_id": transaction_id}
            
            for field, value in updates.items():
                if field in [
                    'transaction_date', 'transaction_time', 'amount', 'split_share_amount',
                    'direction', 'transaction_type', 'is_shared', 'is_flagged', 'split_breakdown',
                    'account', 'category_id', 'sub_category', 'tags', 'user_description', 'notes', 
                    'reference_number', 'related_mails', 'source_file', 'raw_data',
                    'transaction_group_id', 'is_deleted', 'deleted_at'
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
                    UPDATE transactions
                    SET is_deleted = true,
                        deleted_at = COALESCE(deleted_at, NOW()),
                        updated_at = NOW()
                    WHERE id = :transaction_id
                      AND is_deleted = false
                """),
                {"transaction_id": transaction_id}
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
                    WHERE t.is_deleted = false
                      AND (t.transaction_group_id IS NULL 
                           OR t.is_grouped_expense = TRUE 
                           OR t.is_split = TRUE
                           OR (t.transaction_group_id IS NOT NULL 
                               AND COALESCE(t.is_grouped_expense, false) = false 
                               AND COALESCE(t.is_split, false) = false
                               AND NOT EXISTS (
                                 SELECT 1 FROM transactions t2
                                 WHERE t2.transaction_group_id = t.transaction_group_id
                                   AND t2.is_grouped_expense = true
                                   AND t2.is_deleted = false
                               )))
                      AND (
                        LOWER(t.description) LIKE :search_term
                        OR LOWER(COALESCE(t.user_description, '')) LIKE :search_term
                        OR LOWER(t.notes) LIKE :search_term
                        OR LOWER(t.reference_number) LIKE :search_term
                      )
                    ORDER BY t.transaction_date DESC, t.created_at DESC
                    LIMIT :limit OFFSET :offset
                """), {
                    "search_term": search_term,
                    "limit": limit,
                    "offset": offset
                }
            )
            rows = result.fetchall()
            transactions = [dict(row._mapping) for row in rows]
            processed = TransactionOperations._process_transactions(transactions)
            return TransactionOperations._deduplicate_grouped_expense_collapsed(processed)
        finally:
            await session.close()
            
    @staticmethod
    async def predict_category(description: str) -> Optional[Dict[str, Any]]:
        """Predict category based on most frequent usage for a given description"""
        if not description:
            return None
            
        session_factory = get_session_factory()
        session = session_factory()
        try:
            # Check exact matches first, then fuzzy matches if needed (but exact is best for prediction)
            result = await session.execute(
                text("""
                    SELECT c.id, c.name, c.color, COUNT(*) as usage_count
                    FROM transactions t
                    JOIN categories c ON t.category_id = c.id
                    WHERE 
                        (LOWER(t.description) = LOWER(:description) OR LOWER(t.user_description) = LOWER(:description))
                        AND t.is_deleted = false
                        AND t.category_id IS NOT NULL
                    GROUP BY c.id, c.name, c.color
                    ORDER BY usage_count DESC
                    LIMIT 1
                """), {
                    "description": description.strip()
                }
            )
            row = result.fetchone()
            if row:
                return dict(row._mapping)
            return None
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
                      AND t.is_deleted = false
                    ORDER BY t.transaction_date DESC, t.created_at DESC
                    LIMIT :limit OFFSET :offset
                """), {
                    "direction": direction,
                    "limit": limit,
                    "offset": offset
                }
            )
            rows = result.fetchall()
            transactions = [dict(row._mapping) for row in rows]
            return TransactionOperations._process_transactions(transactions)
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
                      AND t.is_deleted = false
                    ORDER BY t.transaction_date DESC, t.created_at DESC
                    LIMIT :limit OFFSET :offset
                """), {
                    "tags": tags,
                    "limit": limit,
                    "offset": offset
                }
            )
            rows = result.fetchall()
            transactions = [dict(row._mapping) for row in rows]
            return TransactionOperations._process_transactions(transactions)
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
                      AND t.is_deleted = false
                    ORDER BY t.transaction_date DESC, t.created_at DESC
                    LIMIT :limit OFFSET :offset
                """), {
                    "transaction_type": transaction_type,
                    "limit": limit,
                    "offset": offset
                }
            )
            rows = result.fetchall()
            transactions = [dict(row._mapping) for row in rows]
            return TransactionOperations._process_transactions(transactions)
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
    async def clear_all_transactions() -> Dict[str, Any]:
        """Clear all transactions from the database"""
        session_factory = get_session_factory()
        session = session_factory()
        try:
            # Soft delete all active transactions
            result = await session.execute(
                text("""
                    UPDATE transactions
                    SET is_deleted = true,
                        deleted_at = COALESCE(deleted_at, NOW()),
                        updated_at = NOW()
                    WHERE is_deleted = false
                """)
            )
            await session.commit()
            
            deleted_count = result.rowcount
            logger.info(f"Cleared {deleted_count} transactions from database")
            
            return {
                "success": True,
                "deleted_count": deleted_count
            }
        except Exception as e:
            await session.rollback()
            logger.error("Failed to clear transactions", exc_info=True)
            return {
                "success": False,
                "error": str(e),
                "deleted_count": 0
            }
        finally:
            await session.close()
    
    @staticmethod
    async def bulk_insert_transactions(
        transactions: List[Dict[str, Any]],
        check_duplicates: bool = True,
        upsert_splitwise: bool = False,
        transaction_source: str = "statement_extraction",
    ) -> Dict[str, Any]:
        """
        Bulk insert transactions with optional duplicate checking and Splitwise upsert support
        
        Args:
            transactions: List of transaction dictionaries
            check_duplicates: Whether to check for duplicates before inserting
            upsert_splitwise: If True, update existing Splitwise transactions instead of skipping
            
        Returns:
            Dictionary with insert results and statistics
        """
        if not transactions:
            return {
                "success": True,
                "inserted_count": 0,
                "updated_count": 0,
                "skipped_count": 0,
                "error_count": 0,
                "errors": []
            }
        
        
        session_factory = get_session_factory()
        session = session_factory()
        
        result = {
            "success": True,
            "inserted_count": 0,
            "updated_count": 0,
            "skipped_count": 0,
            "error_count": 0,
            "errors": []
        }
        
        try:
            # Separate Splitwise and non-Splitwise transactions
            splitwise_transactions = [t for t in transactions if t.get('account', '').lower() == 'splitwise']
            non_splitwise_transactions = [t for t in transactions if t.get('account', '').lower() != 'splitwise']
            
            splitwise_to_insert = []
            was_upsert_used = False
            
            # Handle Splitwise transactions with upsert if enabled
            if splitwise_transactions and upsert_splitwise:
                updated_count, splitwise_to_insert = await TransactionOperations._upsert_splitwise_transactions(
                    session, splitwise_transactions
                )
                result["updated_count"] = updated_count
                was_upsert_used = True
                # After upsert, check for duplicates in remaining transactions before insert
                # (in case upsert failed to find some and they already exist)
                if check_duplicates and splitwise_to_insert:
                    splitwise_to_insert = await TransactionOperations._filter_duplicate_transactions(
                        session, splitwise_to_insert
                    )
            elif splitwise_transactions:
                # Regular duplicate checking for Splitwise
                if check_duplicates:
                    splitwise_to_insert = await TransactionOperations._filter_duplicate_transactions(
                        session, splitwise_transactions
                    )
                else:
                    splitwise_to_insert = splitwise_transactions
            
            # Check for duplicates for non-Splitwise transactions if requested
            non_splitwise_to_insert = non_splitwise_transactions
            if check_duplicates and non_splitwise_transactions:
                non_splitwise_to_insert = await TransactionOperations._filter_duplicate_transactions(
                    session, non_splitwise_transactions
                )
            
            # Combine all transactions to insert
            transactions_to_insert = splitwise_to_insert + non_splitwise_to_insert
            
            # Sort transactions by date (chronological order - oldest first)
            transactions_to_insert = TransactionOperations._sort_transactions_by_date(transactions_to_insert)
            result["skipped_count"] = len(transactions) - len(transactions_to_insert) - result.get("updated_count", 0)
            
            if not transactions_to_insert:
                logger.info("No new transactions to insert after duplicate filtering/upserting")
                return result
            
            # Prepare bulk insert data
            insert_data = []
            for transaction in transactions_to_insert:
                try:
                    # Convert transaction data to database format
                    insert_row = TransactionOperations._prepare_transaction_for_insert(
                        transaction, default_source=transaction_source
                    )
                    insert_data.append(insert_row)
                except Exception as e:
                    result["error_count"] += 1
                    error_msg = f"Error preparing transaction {transaction.get('description', 'unknown')}: {e}"
                    result["errors"].append(error_msg)
                    logger.error(error_msg, exc_info=True)
                    import traceback
                    logger.error(f"Traceback: {traceback.format_exc()}")
                    continue
            
            if not insert_data:
                logger.warning("No valid transactions to insert after preparation")
                return result
            
            # Perform bulk insert (category_id will be NULL, can be set later via API)
            insert_query = text("""
                INSERT INTO transactions (
                    transaction_date, transaction_time, amount, split_share_amount,
                    direction, transaction_type, is_shared, split_breakdown,
                    account, sub_category, tags, description, notes, reference_number,
                    related_mails, source_file, raw_data, transaction_group_id, transaction_source
                ) VALUES (
                    :transaction_date, :transaction_time, :amount, :split_share_amount,
                    :direction, :transaction_type, :is_shared, :split_breakdown,
                    :account, :sub_category, :tags, :description, :notes, :reference_number,
                    :related_mails, :source_file, :raw_data, :transaction_group_id, :transaction_source
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
            logger.error("Bulk insert failed", exc_info=True)
            return result
        finally:
            await session.close()
    
    @staticmethod
    async def _filter_duplicate_transactions(
        session: AsyncSession, 
        transactions: List[Dict[str, Any]]
    ) -> List[Dict[str, Any]]:
        """Filter out duplicate transactions based on composite key or Splitwise ID"""
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
            
            # Separate Splitwise and non-Splitwise transactions
            splitwise_transactions = [t for t in transactions if t.get('account', '').lower() == 'splitwise']
            non_splitwise_transactions = [t for t in transactions if t.get('account', '').lower() != 'splitwise']
            
            # Query existing Splitwise transactions by reference_number (splitwise_id)
            # For Splitwise, we check globally (not just date range) since the same expense
            # could be processed multiple times across different date ranges
            # Note: Transactions with is_split=true can have the same reference_number (legitimate splits)
            existing_splitwise_ids = set()
            existing_splitwise_keys = set()  # For split transactions, use composite key
            if splitwise_transactions:
                # Query all existing Splitwise transactions to check for duplicates
                splitwise_query = text("""
                    SELECT reference_number, raw_data, is_split, transaction_date, amount, description
                    FROM transactions 
                    WHERE account = 'Splitwise'
                      AND is_deleted = false
                """)
                
                result = await session.execute(splitwise_query)
                existing_splitwise_rows = result.fetchall()
                
                for row in existing_splitwise_rows:
                    # For split transactions, use composite key instead of just reference_number
                    if row.is_split and row.reference_number:
                        # Create composite key for split transactions
                        split_key = TransactionOperations._create_transaction_key(
                            row.transaction_date,
                            float(row.amount) if row.amount else 0,
                            'Splitwise',
                            row.description or '',
                            'splitwise_data',
                            row.raw_data or {}
                        )
                        existing_splitwise_keys.add(split_key)
                    elif row.reference_number:
                        # For non-split transactions, use reference_number for duplicate checking
                        existing_splitwise_ids.add(str(row.reference_number))
                    
                    # Also check raw_data for id field as fallback (only for non-split)
                    if not row.is_split and row.raw_data:
                        try:
                            raw_data = row.raw_data if isinstance(row.raw_data, dict) else json.loads(row.raw_data)
                            if isinstance(raw_data, dict) and 'id' in raw_data:
                                existing_splitwise_ids.add(str(raw_data['id']))
                        except (json.JSONDecodeError, TypeError):
                            pass
            
            # Query existing non-Splitwise transactions in the date range
            existing_keys = set()
            if non_splitwise_transactions:
                existing_query = text("""
                    SELECT transaction_date, amount, account, description, source_file, raw_data
                    FROM transactions 
                    WHERE transaction_date BETWEEN :min_date AND :max_date
                          AND account != 'Splitwise'
                      AND is_deleted = false
                """)
                
                result = await session.execute(existing_query, {
                    "min_date": min_date,
                    "max_date": max_date
                })
                existing_transactions = result.fetchall()
                
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
            
            # Process Splitwise transactions
            for transaction in splitwise_transactions:
                is_split = transaction.get('is_split', False)
                splitwise_id = TransactionOperations._extract_splitwise_id(transaction)
                
                # For split transactions, use composite key instead of just reference_number
                if is_split:
                    key = TransactionOperations._create_transaction_key(
                        transaction.get('transaction_date'),
                        float(transaction.get('amount', 0)),
                        transaction.get('account', ''),
                        transaction.get('description', ''),
                        transaction.get('source_file', ''),
                        transaction.get('raw_data', {})
                    )
                    if key not in existing_splitwise_keys:
                        unique_transactions.append(transaction)
                        existing_splitwise_keys.add(key)  # Prevent duplicates within the batch
                elif splitwise_id and str(splitwise_id) not in existing_splitwise_ids:
                    # For non-split transactions, use reference_number for duplicate checking
                    unique_transactions.append(transaction)
                    existing_splitwise_ids.add(str(splitwise_id))  # Prevent duplicates within the batch
                elif not splitwise_id:
                    # If no splitwise_id found, fall back to composite key check
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
                        existing_keys.add(key)
            
            # Process non-Splitwise transactions
            for transaction in non_splitwise_transactions:
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
            
            logger.info(f"Duplicate filtering: {len(transactions)} -> {len(unique_transactions)} transactions "
                       f"(Splitwise: {len(splitwise_transactions)} -> {len([t for t in unique_transactions if t.get('account', '').lower() == 'splitwise'])})")
            return unique_transactions
            
        except Exception as e:
            logger.error("Error filtering duplicate transactions", exc_info=True)
            import traceback
            logger.error(f"Traceback: {traceback.format_exc()}")
            return transactions  # Return all if filtering fails
    
    @staticmethod
    async def _upsert_splitwise_transactions(
        session: AsyncSession,
        transactions: List[Dict[str, Any]]
    ) -> Tuple[int, List[Dict[str, Any]]]:
        """
        Upsert Splitwise transactions: update existing ones, return new ones for insert
        
        Args:
            session: Database session
            transactions: List of Splitwise transaction dictionaries
            
        Returns:
            Tuple of (updated_count, transactions_to_insert)
        """
        updated_count = 0
        transactions_to_insert = []
        
        try:
            if not transactions:
                return 0, []
            
            # Extract all splitwise_ids from incoming transactions
            splitwise_id_to_transaction = {}
            for transaction in transactions:
                splitwise_id = TransactionOperations._extract_splitwise_id(transaction)
                if splitwise_id:
                    splitwise_id_to_transaction[str(splitwise_id)] = transaction
            
            if not splitwise_id_to_transaction:
                # No splitwise_ids found, return all for insert
                return 0, transactions
            
            # Query existing Splitwise transactions with these IDs
            splitwise_ids_list = list(splitwise_id_to_transaction.keys())
            placeholders = ','.join([f':id_{i}' for i in range(len(splitwise_ids_list))])
            query = text(f"""
                SELECT id, reference_number, raw_data
                FROM transactions 
                WHERE account = 'Splitwise'
                  AND is_deleted = false
                  AND (
                    reference_number IN ({placeholders})
                    OR raw_data::jsonb->>'id' IN ({placeholders})
                  )
            """)
            
            params = {}
            for i, splitwise_id in enumerate(splitwise_ids_list):
                params[f'id_{i}'] = splitwise_id
            
            result = await session.execute(query, params)
            existing_rows = result.fetchall()
            
            # Create mapping of splitwise_id to transaction_id
            existing_transaction_ids = {}
            processed_ids = set()
            
            for row in existing_rows:
                # Try to get splitwise_id from reference_number or raw_data
                splitwise_id = None
                if row.reference_number:
                    try:
                        splitwise_id = str(int(str(row.reference_number).strip()))
                    except (ValueError, TypeError):
                        pass
                
                if not splitwise_id and row.raw_data:
                    try:
                        raw_data = row.raw_data if isinstance(row.raw_data, dict) else json.loads(row.raw_data)
                        if isinstance(raw_data, dict):
                            if 'id' in raw_data:
                                splitwise_id = str(int(raw_data['id']))
                            elif 'splitwise_id' in raw_data:
                                splitwise_id = str(int(raw_data['splitwise_id']))
                    except (json.JSONDecodeError, TypeError, ValueError, KeyError):
                        pass
                
                if splitwise_id:
                    existing_transaction_ids[splitwise_id] = str(row.id)
                    processed_ids.add(splitwise_id)
            
            # Update existing transactions and collect new ones
            for splitwise_id, transaction in splitwise_id_to_transaction.items():
                if splitwise_id in existing_transaction_ids:
                    # Update existing transaction
                    transaction_id = existing_transaction_ids[splitwise_id]
                    try:
                        # Prepare update data
                        prepared_data = TransactionOperations._prepare_transaction_for_insert(
                            transaction, default_source="statement_extraction"
                        )
                        
                        # Build update query with named parameters
                        update_fields = [
                            'transaction_date', 'transaction_time', 'amount', 'split_share_amount',
                            'direction', 'transaction_type', 'is_shared', 'split_breakdown', 'paid_by',
                            'account', 'description', 'reference_number', 'source_file', 'raw_data',
                            'transaction_source', 'updated_at'
                        ]
                        
                        set_clauses = []
                        update_params = {}
                        
                        for field in update_fields:
                            if field in prepared_data and prepared_data[field] is not None:
                                if field == 'updated_at':
                                    set_clauses.append(f"{field} = NOW()")
                                else:
                                    set_clauses.append(f"{field} = :{field}")
                                    # split_breakdown and raw_data are already JSON strings
                                    update_params[field] = prepared_data[field]
                        
                        if set_clauses:
                            # Convert transaction_id to UUID if it's a string
                            from uuid import UUID
                            transaction_uuid = UUID(transaction_id) if isinstance(transaction_id, str) else transaction_id
                            update_params['transaction_id'] = transaction_uuid
                            
                            update_query = text(f"""
                                UPDATE transactions
                                SET {', '.join(set_clauses)}
                                WHERE id = :transaction_id
                                  AND is_deleted = false
                            """)
                            
                            await session.execute(update_query, update_params)
                            updated_count += 1
                            logger.debug(f"Updated Splitwise transaction {transaction_id} (splitwise_id: {splitwise_id})")
                    except Exception as e:
                        logger.error(f"Error updating Splitwise transaction {transaction_id}", exc_info=True)
                        # On error, add to insert list as fallback
                        transactions_to_insert.append(transaction)
                else:
                    # New transaction, add to insert list
                    transactions_to_insert.append(transaction)
            
            await session.commit()
            logger.info(f"Upserted {updated_count} Splitwise transactions, {len(transactions_to_insert)} to insert")
            return updated_count, transactions_to_insert
            
        except Exception as e:
            await session.rollback()
            logger.error("Error upserting Splitwise transactions", exc_info=True)
            import traceback
            logger.error(f"Traceback: {traceback.format_exc()}")
            # On error, return all for insert as fallback
            return 0, transactions
    
    @staticmethod
    def _extract_splitwise_id(transaction: Dict[str, Any]) -> Optional[int]:
        """Extract Splitwise ID from transaction data"""
        try:
            # First, try reference_number (most reliable - set during standardization)
            reference_number = transaction.get('reference_number', '')
            if reference_number and str(reference_number).strip():
                try:
                    return int(str(reference_number).strip())
                except (ValueError, TypeError):
                    pass
            
            # Second, try raw_data
            raw_data = transaction.get('raw_data', {})
            if raw_data:
                # Handle both dict and JSON string
                if isinstance(raw_data, str):
                    try:
                        raw_data = json.loads(raw_data)
                    except json.JSONDecodeError:
                        return None
                
                if isinstance(raw_data, dict):
                    # Check for 'id' field (Splitwise expense ID)
                    if 'id' in raw_data:
                        try:
                            return int(raw_data['id'])
                        except (ValueError, TypeError):
                            pass
                    
                    # Also check for 'splitwise_id' field (from ProcessedSplitwiseTransaction)
                    if 'splitwise_id' in raw_data:
                        try:
                            return int(raw_data['splitwise_id'])
                        except (ValueError, TypeError):
                            pass
            
            return None
        except Exception as e:
            logger.warning(f"Error extracting Splitwise ID from transaction: {e}")
            return None
    
    @staticmethod
    async def remove_duplicate_splitwise_transactions(dry_run: bool = True) -> Dict[str, Any]:
        """
        Remove duplicate Splitwise transactions, keeping the oldest one for each splitwise_id
        
        Args:
            dry_run: If True, only report what would be deleted without actually deleting
            
        Returns:
            Dictionary with statistics about duplicates found and removed
        """
        session_factory = get_session_factory()
        session = session_factory()
        
        result = {
            "success": True,
            "dry_run": dry_run,
            "total_splitwise_transactions": 0,
            "duplicate_groups": 0,
            "duplicates_found": 0,
            "duplicates_removed": 0,
            "errors": []
        }
        
        try:
            # Get all Splitwise transactions
            # IMPORTANT: Exclude is_split=true transactions from duplicate detection
            # Split transactions can legitimately share the same splitwise_id (from parent)
            # and should never be considered duplicates
            query = text("""
                SELECT id, reference_number, raw_data, transaction_date, created_at, is_split
                FROM transactions 
                WHERE account = 'Splitwise'
                  AND is_deleted = false
                ORDER BY transaction_date ASC, created_at ASC
            """)
            
            rows = await session.execute(query)
            all_transactions = rows.fetchall()
            result["total_splitwise_transactions"] = len(all_transactions)
            
            # Separate split transactions from regular transactions
            split_transactions = []
            regular_transactions = []
            
            for row in all_transactions:
                if row.is_split:
                    # Split transactions should never be considered duplicates
                    split_transactions.append(row)
                else:
                    regular_transactions.append(row)
            
            logger.info(f"Found {len(split_transactions)} split transactions (excluded from duplicate detection)")
            logger.info(f"Found {len(regular_transactions)} regular transactions (checked for duplicates)")
            
            # Group only REGULAR (non-split) transactions by splitwise_id
            transactions_by_id: Dict[str, List[Dict[str, Any]]] = {}
            
            for row in regular_transactions:
                splitwise_id = None
                
                # Try to extract splitwise_id from reference_number
                if row.reference_number:
                    try:
                        splitwise_id = str(int(str(row.reference_number).strip()))
                    except (ValueError, TypeError):
                        pass
                
                # Fallback to raw_data
                if not splitwise_id and row.raw_data:
                    try:
                        raw_data = row.raw_data if isinstance(row.raw_data, dict) else json.loads(row.raw_data)
                        if isinstance(raw_data, dict):
                            if 'id' in raw_data:
                                splitwise_id = str(int(raw_data['id']))
                            elif 'splitwise_id' in raw_data:
                                splitwise_id = str(int(raw_data['splitwise_id']))
                    except (json.JSONDecodeError, TypeError, ValueError, KeyError):
                        pass
                
                if splitwise_id:
                    if splitwise_id not in transactions_by_id:
                        transactions_by_id[splitwise_id] = []
                    transactions_by_id[splitwise_id].append({
                        'id': str(row.id),
                        'reference_number': row.reference_number,
                        'transaction_date': row.transaction_date,
                        'created_at': row.created_at
                    })
            
            # Find duplicates (groups with more than 1 transaction)
            duplicate_groups = {k: v for k, v in transactions_by_id.items() if len(v) > 1}
            result["duplicate_groups"] = len(duplicate_groups)
            
            # Calculate total duplicates (excluding the one we'll keep)
            total_duplicates = sum(len(v) - 1 for v in duplicate_groups.values())
            result["duplicates_found"] = total_duplicates
            
            if not duplicate_groups:
                logger.info("No duplicate Splitwise transactions found")
                return result
            
            logger.info(f"Found {len(duplicate_groups)} groups with {total_duplicates} duplicate transactions")
            
            # Process each duplicate group
            transaction_ids_to_delete = []
            
            for splitwise_id, transactions in duplicate_groups.items():
                # Sort by transaction_date and created_at (oldest first)
                # Keep the oldest one, mark others for deletion
                sorted_transactions = sorted(
                    transactions,
                    key=lambda x: (x['transaction_date'], x['created_at'] or datetime.min)
                )
                
                # Keep the first (oldest), mark the rest for deletion
                for transaction in sorted_transactions[1:]:
                    transaction_ids_to_delete.append(transaction['id'])
                    logger.debug(f"Marking transaction {transaction['id']} (splitwise_id: {splitwise_id}) for deletion")
            
            result["duplicates_removed"] = len(transaction_ids_to_delete)
            
            if not dry_run and transaction_ids_to_delete:
                # Soft delete duplicates - use IN clause with parameterized query
                from uuid import UUID
                uuid_ids = [UUID(tid) for tid in transaction_ids_to_delete]
                
                # Build parameterized IN clause
                placeholders = ','.join([f':id_{i}' for i in range(len(uuid_ids))])
                delete_query = text(f"""
                    UPDATE transactions
                    SET is_deleted = true,
                        deleted_at = COALESCE(deleted_at, NOW()),
                        updated_at = NOW()
                    WHERE id IN ({placeholders})
                      AND is_deleted = false
                """)
                
                # Build parameters dict
                params = {f'id_{i}': uuid_id for i, uuid_id in enumerate(uuid_ids)}
                
                delete_result = await session.execute(delete_query, params)
                await session.commit()
                
                deleted_count = delete_result.rowcount
                result["duplicates_removed"] = deleted_count
                logger.info(f"Successfully soft-deleted {deleted_count} duplicate Splitwise transactions")
            else:
                logger.info(f"DRY RUN: Would delete {len(transaction_ids_to_delete)} duplicate transactions")
            
            return result
            
        except Exception as e:
            await session.rollback()
            result["success"] = False
            result["errors"].append(str(e))
            logger.error("Error removing duplicate Splitwise transactions", exc_info=True)
            import traceback
            logger.error(f"Traceback: {traceback.format_exc()}")
            return result
        finally:
            await session.close()
    
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
        """Clean data for JSON serialization by converting NaN to None, Decimal to float, and datetime to ISO format"""
        from datetime import datetime, date, time
        from decimal import Decimal
        
        if isinstance(data, dict):
            return {k: TransactionOperations._clean_data_for_json(v) for k, v in data.items()}
        elif isinstance(data, list):
            return [TransactionOperations._clean_data_for_json(item) for item in data]
        elif isinstance(data, Decimal):
            return float(data)
        elif isinstance(data, (datetime, date)):
            return data.isoformat()
        elif isinstance(data, time):
            return data.isoformat()
        elif pd.isna(data):
            return None
        else:
            return data
    
    @staticmethod
    def _prepare_raw_data_for_json(raw_data: Any) -> Optional[str]:
        """Prepare raw_data for JSON serialization, handling string representations from CSV"""
        if not raw_data:
            return None
        
        # If it's already a string, try to parse it
        if isinstance(raw_data, str):
            try:
                # Try JSON first
                parsed = json.loads(raw_data)
            except json.JSONDecodeError:
                try:
                    # Try eval for Python dict string representation (with single quotes)
                    import ast
                    parsed = ast.literal_eval(raw_data)
                except (ValueError, SyntaxError):
                    logger.warning(f"Could not parse raw_data string: {raw_data[:100]}")
                    return None
        else:
            parsed = raw_data
        
        # Convert to JSON string
        if isinstance(parsed, dict):
            return json.dumps(TransactionOperations._clean_data_for_json(parsed))
        else:
            return None
    
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
            logger.error("Error sorting transactions by date", exc_info=True)
            return transactions
    
    @staticmethod
    def _prepare_transaction_for_insert(
        transaction: Dict[str, Any], default_source: str = "statement_extraction"
    ) -> Dict[str, Any]:
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
        
        # Determine if transaction is shared
        has_split_breakdown = transaction.get('split_breakdown') is not None
        is_shared = transaction.get('is_shared', False) or has_split_breakdown
        
        # Get my_share - for Splitwise transactions, this is explicitly provided
        my_share = transaction.get('my_share', 0)
        
        # Get split_breakdown and convert to JSON if present
        split_breakdown = transaction.get('split_breakdown')
        if split_breakdown:
            if isinstance(split_breakdown, str):
                # Try to parse string representation (from CSV)
                try:
                    # Try JSON first
                    split_breakdown = json.loads(split_breakdown)
                except json.JSONDecodeError:
                    try:
                        # Try eval for Python dict string representation (with single quotes)
                        import ast
                        split_breakdown = ast.literal_eval(split_breakdown)
                    except (ValueError, SyntaxError):
                        logger.warning(f"Could not parse split_breakdown string: {split_breakdown[:100]}")
                        split_breakdown = None
            
            if isinstance(split_breakdown, dict):
                split_breakdown = json.dumps(TransactionOperations._clean_data_for_json(split_breakdown))
            else:
                split_breakdown = None
        elif split_breakdown is None:
            # Try to extract from raw_data if not directly provided
            raw_data = transaction.get('raw_data', {})
            if raw_data:
                if isinstance(raw_data, str):
                    try:
                        raw_data = json.loads(raw_data)
                    except json.JSONDecodeError:
                        try:
                            import ast
                            raw_data = ast.literal_eval(raw_data)
                        except (ValueError, SyntaxError):
                            raw_data = {}
                if isinstance(raw_data, dict) and 'split_breakdown' in raw_data:
                    split_breakdown = json.dumps(TransactionOperations._clean_data_for_json(raw_data['split_breakdown']))
        
        # Get paid_by from transaction or raw_data
        paid_by = transaction.get('paid_by')
        if not paid_by:
            # Try to extract from raw_data if not directly provided
            raw_data = transaction.get('raw_data', {})
            if raw_data:
                if isinstance(raw_data, str):
                    try:
                        raw_data = json.loads(raw_data)
                    except json.JSONDecodeError:
                        raw_data = {}
                if isinstance(raw_data, dict):
                    # Check raw_data directly or in split_breakdown
                    if 'paid_by' in raw_data:
                        paid_by = raw_data['paid_by']
                    elif 'split_breakdown' in raw_data and isinstance(raw_data['split_breakdown'], dict):
                        paid_by = raw_data['split_breakdown'].get('paid_by')
        
        # Map standardized fields to database fields
        return {
            "transaction_date": transaction_date,
            "transaction_time": transaction_time,
            "amount": Decimal(str(transaction.get('amount', 0))),  # Full transaction amount
            "split_share_amount": Decimal(str(my_share)) if (is_shared and my_share) else None,  # My share of the split
            "direction": transaction.get('transaction_type', 'debit'),  # Map transaction_type to direction (debit/credit)
            "transaction_type": "purchase",  # Default to purchase for Splitwise transactions
            "is_shared": is_shared,
            "split_breakdown": split_breakdown,
            "paid_by": paid_by,  # Who actually paid for this transaction
            "account": transaction.get('account', ''),
            "sub_category": None,
            "tags": [],
            "description": transaction.get('description', ''),
            "notes": None,
            "reference_number": str(transaction.get('reference_number', '')),
            "related_mails": [],
            "source_file": transaction.get('source_file', ''),
            "raw_data": TransactionOperations._prepare_raw_data_for_json(transaction.get('raw_data')),
            "transaction_group_id": None,
            "transaction_source": transaction.get("transaction_source") or default_source,
        }


    @staticmethod
    async def get_expense_analytics(
        start_date: Optional[date] = None,
        end_date: Optional[date] = None,
        accounts: Optional[List[str]] = None,
        exclude_accounts: Optional[List[str]] = None,
        categories: Optional[List[str]] = None,
        exclude_categories: Optional[List[str]] = None,
        tags: Optional[List[str]] = None,
        exclude_tags: Optional[List[str]] = None,
        direction: Optional[str] = "debit",  # Default to debit for expenses
        group_by: str = "category"  # category, tag, month, account, category_month, tag_month
    ) -> Dict[str, Any]:
        """
        Get expense analytics aggregated by various dimensions.
        
        Important: Only considers debit transactions. Excludes:
        - Individual transactions in groups (only collapsed transactions counted)
        - Split transactions (uses split_share_amount to avoid double counting)
        
        Args:
            start_date: Start date for filtering
            end_date: End date for filtering
            accounts: List of account names to include
            exclude_accounts: List of account names to exclude
            categories: List of category names to include
            exclude_categories: List of category names to exclude
            tags: List of tag names to include
            exclude_tags: List of tag names to exclude
            direction: Transaction direction (always forced to 'debit' for expenses)
            group_by: How to group the data ('category', 'tag', 'month', 'account', 'category_month', 'tag_month')
        
        Returns:
            Dictionary with aggregated expense data
        """
        session_factory = get_session_factory()
        session = session_factory()
        try:
            # Build WHERE clause - always force debit for expense analytics
            where_conditions = [
                "t.is_deleted = false",
                "t.direction = 'debit'",  # Only consider debit transactions
                # Exclude parent transactions in split groups - only count the split parts (is_split = True)
                # Include collapsed grouped expenses (is_grouped_expense = True)
                "(t.transaction_group_id IS NULL OR t.is_split = true OR t.is_grouped_expense = true)"
            ]
            params = {}
            
            # Use user-provided exclude_categories
            all_exclude_categories = set()
            if exclude_categories:
                all_exclude_categories.update(exclude_categories)
            
            if start_date:
                where_conditions.append("t.transaction_date >= :start_date")
                params["start_date"] = start_date
            if end_date:
                where_conditions.append("t.transaction_date <= :end_date")
                params["end_date"] = end_date
            if accounts:
                where_conditions.append("t.account = ANY(:accounts)")
                params["accounts"] = accounts
            if exclude_accounts:
                where_conditions.append("t.account != ALL(:exclude_accounts)")
                params["exclude_accounts"] = exclude_accounts
            if categories:
                where_conditions.append("c.name = ANY(:categories)")
                params["categories"] = categories
            if all_exclude_categories:
                where_conditions.append("(c.name IS NULL OR c.name != ALL(:exclude_categories))")
                params["exclude_categories"] = list(all_exclude_categories)
            
            where_clause = " AND ".join(where_conditions)
            
            # Build GROUP BY and SELECT based on group_by parameter
            # For split transactions, use split_share_amount; otherwise use amount
            # This ensures we don't count split transactions twice
            net_amount_expr = "COALESCE(t.split_share_amount, t.amount)"
            
            join_tags = ""
            if group_by == "category":
                select_clause = f"""
                    COALESCE(c.name, 'Uncategorized') as group_key,
                    c.color as color,
                    SUM({net_amount_expr}) as total_amount,
                    COUNT(t.id) as transaction_count
                """
                group_by_clause = "COALESCE(c.name, 'Uncategorized'), c.color"
                order_by_clause = "total_amount DESC"
                
            elif group_by == "tag":
                select_clause = f"""
                    tag.name as group_key,
                    tag.color as color,
                    SUM({net_amount_expr}) as total_amount,
                    COUNT(DISTINCT t.id) as transaction_count
                """
                group_by_clause = "tag.name, tag.color"
                order_by_clause = "total_amount DESC"
                join_tags = """
                    INNER JOIN transaction_tags tt ON t.id = tt.transaction_id
                    INNER JOIN tags tag ON tt.tag_id = tag.id AND tag.is_active = true
                """
                if tags:
                    where_clause += " AND tag.name = ANY(:filter_tags)"
                    params["filter_tags"] = tags
                if exclude_tags:
                    where_clause += " AND tag.name != ALL(:exclude_filter_tags)"
                    params["exclude_filter_tags"] = exclude_tags
                    
            elif group_by == "month":
                select_clause = f"""
                    TO_CHAR(t.transaction_date, 'YYYY-MM') as group_key,
                    NULL as color,
                    SUM({net_amount_expr}) as total_amount,
                    COUNT(t.id) as transaction_count
                """
                group_by_clause = "TO_CHAR(t.transaction_date, 'YYYY-MM')"
                order_by_clause = "group_key ASC"
                
            elif group_by == "account":
                select_clause = f"""
                    t.account as group_key,
                    NULL as color,
                    SUM({net_amount_expr}) as total_amount,
                    COUNT(t.id) as transaction_count
                """
                group_by_clause = "t.account"
                order_by_clause = "total_amount DESC"
                
            elif group_by == "category_month":
                select_clause = f"""
                    COALESCE(c.name, 'Uncategorized') as category,
                    TO_CHAR(t.transaction_date, 'YYYY-MM') as month,
                    (COALESCE(c.name, 'Uncategorized') || ' - ' || TO_CHAR(t.transaction_date, 'YYYY-MM')) as group_key,
                    c.color as color,
                    SUM({net_amount_expr}) as total_amount,
                    COUNT(t.id) as transaction_count
                """
                group_by_clause = "COALESCE(c.name, 'Uncategorized'), TO_CHAR(t.transaction_date, 'YYYY-MM'), c.color"
                order_by_clause = "month ASC, total_amount DESC"
                
            elif group_by == "tag_month":
                select_clause = f"""
                    tag.name as tag,
                    TO_CHAR(t.transaction_date, 'YYYY-MM') as month,
                    (tag.name || ' - ' || TO_CHAR(t.transaction_date, 'YYYY-MM')) as group_key,
                    tag.color as color,
                    SUM({net_amount_expr}) as total_amount,
                    COUNT(DISTINCT t.id) as transaction_count
                """
                group_by_clause = "tag.name, TO_CHAR(t.transaction_date, 'YYYY-MM'), tag.color"
                order_by_clause = "month ASC, total_amount DESC"
                join_tags = """
                    INNER JOIN transaction_tags tt ON t.id = tt.transaction_id
                    INNER JOIN tags tag ON tt.tag_id = tag.id AND tag.is_active = true
                """
                if tags:
                    where_clause += " AND tag.name = ANY(:filter_tags)"
                    params["filter_tags"] = tags
                if exclude_tags:
                    where_clause += " AND tag.name != ALL(:exclude_filter_tags)"
                    params["exclude_filter_tags"] = exclude_tags
            
            elif group_by == "tag_category":
                select_clause = f"""
                    tag.name as tag,
                    COALESCE(c.name, 'Uncategorized') as category,
                    (tag.name || ' - ' || COALESCE(c.name, 'Uncategorized')) as group_key,
                    tag.color as color,
                    SUM({net_amount_expr}) as total_amount,
                    COUNT(DISTINCT t.id) as transaction_count
                """
                group_by_clause = "tag.name, COALESCE(c.name, 'Uncategorized'), tag.color"
                order_by_clause = "tag.name ASC, total_amount DESC"
                join_tags = """
                    INNER JOIN transaction_tags tt ON t.id = tt.transaction_id
                    INNER JOIN tags tag ON tt.tag_id = tag.id AND tag.is_active = true
                """
                if tags:
                    where_clause += " AND tag.name = ANY(:filter_tags)"
                    params["filter_tags"] = tags
                if exclude_tags:
                    where_clause += " AND tag.name != ALL(:exclude_filter_tags)"
                    params["exclude_filter_tags"] = exclude_tags
            else:
                raise ValueError(f"Invalid group_by value: {group_by}")
            
            # Build the query
            # Note: We filter for net_amount > 0 using HAVING clause to exclude cases where
            # refunds exceeded the original expense (which would result in negative or zero net)
            query = f"""
                SELECT {select_clause}
                FROM transactions t
                LEFT JOIN categories c ON t.category_id = c.id
                {join_tags}
                WHERE {where_clause}
                GROUP BY {group_by_clause}
                HAVING SUM({net_amount_expr}) > 0
                ORDER BY {order_by_clause}
            """
            
            logger.debug(f"Analytics query: {query}")
            logger.debug(f"Analytics params: {params}")
            
            result = await session.execute(text(query), params)
            rows = result.fetchall()
            
            # Convert to list of dictionaries
            analytics_data = []
            total_amount = 0
            total_count = 0
            
            for row in rows:
                row_dict = dict(row._mapping)
                # Convert Decimal to float for JSON serialization
                amount = float(row_dict['total_amount']) if row_dict['total_amount'] else 0.0
                count = int(row_dict['transaction_count']) if row_dict['transaction_count'] else 0
                
                item = {
                    'group_key': row_dict['group_key'],
                    'color': row_dict.get('color'),
                    'amount': amount,
                    'count': count
                }
                
                # Add additional fields for combined groupings
                if group_by == "category_month":
                    item['category'] = row_dict.get('category')
                    item['month'] = row_dict.get('month')
                elif group_by == "tag_month":
                    item['tag'] = row_dict.get('tag')
                    item['month'] = row_dict.get('month')
                elif group_by == "tag_category":
                    item['tag'] = row_dict.get('tag')
                    item['category'] = row_dict.get('category')
                
                analytics_data.append(item)
                
                total_amount += amount
                total_count += count
            
            return {
                'group_by': group_by,
                'data': analytics_data,
                'summary': {
                    'total_amount': total_amount,
                    'total_count': total_count,
                    'average_amount': total_amount / total_count if total_count > 0 else 0
                }
            }
            
        finally:
            await session.close()


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
            if row:
                tag_dict = dict(row._mapping)
                # Convert UUID to string
                tag_dict['id'] = str(tag_dict['id'])
                return tag_dict
            return None
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
        except ValueError:
            # Re-raise ValueError (tag already exists) without rollback
            raise
        except Exception as e:
            await session.rollback()
            logger.error(f"Failed to create tag '{name}'", exc_info=True)
            import traceback
            logger.error(f"Traceback: {traceback.format_exc()}")
            raise
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
            logger.error("Failed to add tags to transaction", exc_info=True)
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
            logger.error("Failed to remove tags from transaction", exc_info=True)
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
            logger.error("Failed to set tags for transaction", exc_info=True)
            return False
        finally:
            await session.close()


class CategoryOperations:
    """Operations for managing transaction categories"""
    
    @staticmethod
    async def get_all_categories(transaction_type: Optional[str] = None) -> List[dict]:
        """Get all active categories, optionally filtered by transaction_type
        
        Args:
            transaction_type: Optional filter by 'debit', 'credit', or None for all
        """
        session_factory = get_session_factory()
        session = session_factory()
        try:
            query = """
                SELECT id, name, slug, color, parent_id, sort_order,
                       is_active, transaction_type, created_at, updated_at
                FROM categories 
                WHERE is_active = true
            """
            params = {}
            
            # Filter by transaction_type if provided
            # When filtering by transaction_type, show categories that match that type OR categories with NULL (applicable to both)
            if transaction_type:
                query += " AND (transaction_type = :transaction_type OR transaction_type IS NULL)"
                params["transaction_type"] = transaction_type
            
            query += " ORDER BY sort_order, name"
            
            result = await session.execute(text(query), params)
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
    async def search_categories(query: str, limit: int = 20, transaction_type: Optional[str] = None) -> List[dict]:
        """Search categories by name (case-insensitive partial match)
        
        Args:
            query: Search query string
            limit: Maximum number of results
            transaction_type: Optional filter by 'debit', 'credit', or None for all
        """
        session_factory = get_session_factory()
        session = session_factory()
        try:
            sql_query = """
                SELECT * FROM categories 
                WHERE LOWER(name) LIKE LOWER(:query) AND is_active = true
            """
            params = {
                "query": f"%{query}%",
                "exact_query": query,
                "limit": limit
            }
            
            # Filter by transaction_type if provided
            # When filtering by transaction_type, show categories that match that type OR categories with NULL (applicable to both)
            if transaction_type:
                sql_query += " AND (transaction_type = :transaction_type OR transaction_type IS NULL)"
                params["transaction_type"] = transaction_type
            
            sql_query += """
                ORDER BY 
                    CASE WHEN LOWER(name) = LOWER(:exact_query) THEN 1 ELSE 2 END,
                    name
                LIMIT :limit
            """
            
            result = await session.execute(text(sql_query), params)
            rows = result.fetchall()
            return [dict(row._mapping) for row in rows]
        finally:
            await session.close()
    
    @staticmethod
    async def create_category(
        name: str,
        color: Optional[str] = None,
        parent_id: Optional[str] = None,
        sort_order: Optional[int] = None,
        transaction_type: Optional[str] = None
    ) -> str:
        """Create a new category and return its ID
        
        Args:
            name: Category name
            color: Optional color hex code
            parent_id: Optional parent category ID
            sort_order: Optional sort order
            transaction_type: Optional transaction type ('debit', 'credit', or None for both)
        """
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
            
            # Validate transaction_type if provided
            if transaction_type is not None and transaction_type not in ("debit", "credit"):
                raise ValueError(f"Invalid transaction_type: {transaction_type}. Must be 'debit', 'credit', or None")
            
            result = await session.execute(
                text("""
                    INSERT INTO categories (name, slug, color, parent_id, sort_order, is_active, transaction_type)
                    VALUES (:name, :slug, :color, :parent_id, :sort_order, true, :transaction_type)
                    RETURNING id
                """), {
                    "name": name,
                    "slug": slug,
                    "color": color,
                    "parent_id": parent_id,
                    "sort_order": sort_order,
                    "transaction_type": transaction_type
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
        sort_order: Optional[int] = None,
        transaction_type: Optional[str] = None
    ) -> bool:
        """Update a category
        
        Args:
            category_id: Category ID to update
            name: Optional new name
            color: Optional new color
            parent_id: Optional new parent ID
            sort_order: Optional new sort order
            transaction_type: Optional transaction type ('debit', 'credit', or None for both)
        """
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
            # Handle transaction_type update
            # Allow setting to NULL by passing empty string, or setting to a value
            if transaction_type is not None:
                if transaction_type == "":
                    # Empty string means set to NULL - use SQL NULL directly
                    set_clauses.append("transaction_type = NULL")
                else:
                    # Validate transaction_type value
                    if transaction_type not in ("debit", "credit"):
                        raise ValueError(f"Invalid transaction_type: {transaction_type}. Must be 'debit', 'credit', or empty string for NULL")
                    set_clauses.append("transaction_type = :transaction_type")
                    params["transaction_type"] = transaction_type
            
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
