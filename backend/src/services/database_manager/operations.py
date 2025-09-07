from __future__ import annotations

from typing import List, Optional, Dict, Any
from datetime import date, time
from decimal import Decimal
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from .connection import get_session_factory


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
        """Get account by statement sender email"""
        session_factory = get_session_factory()
        session = session_factory()
        try:
            result = await session.execute(
                text("""
                    SELECT * FROM accounts 
                    WHERE statement_sender = :email AND is_active = true
                """), {"email": email}
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
        """Get account nickname by statement sender email"""
        session_factory = get_session_factory()
        session = session_factory()
        try:
            result = await session.execute(
                text("""
                    SELECT nickname FROM accounts 
                    WHERE statement_sender = :sender_email AND is_active = true
                """), {"sender_email": sender_email}
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


class TransactionOperations:
    """Operations for managing transactions"""
    
    @staticmethod
    async def create_transaction(
        transaction_date: date,
        amount: Decimal,
        transaction_type: str,
        account: str,
        category: str,
        description: str,
        transaction_time: Optional[time] = None,
        split_share_amount: Optional[Decimal] = None,
        is_partial_refund: bool = False,
        is_shared: bool = False,
        split_breakdown: Optional[Dict[str, Any]] = None,
        sub_category: Optional[str] = None,
        notes: Optional[str] = None,
        reference_number: Optional[str] = None,
        related_mails: Optional[List[str]] = None,
        source_file: Optional[str] = None,
        raw_data: Optional[Dict[str, Any]] = None,
        link_parent_id: Optional[str] = None,
        transfer_group_id: Optional[str] = None
    ) -> str:
        """Create a new transaction and return its ID"""
        session_factory = get_session_factory()
        session = session_factory()
        try:
            result = await session.execute(
                text("""
                    INSERT INTO transactions (
                        transaction_date, transaction_time, amount, split_share_amount,
                        transaction_type, is_partial_refund, is_shared, split_breakdown,
                        account, category, sub_category, description, notes, reference_number,
                        related_mails, source_file, raw_data, link_parent_id, transfer_group_id
                    ) VALUES (
                        :transaction_date, :transaction_time, :amount, :split_share_amount,
                        :transaction_type, :is_partial_refund, :is_shared, :split_breakdown,
                        :account, :category, :sub_category, :description, :notes, :reference_number,
                        :related_mails, :source_file, :raw_data, :link_parent_id, :transfer_group_id
                    ) RETURNING id
                """), {
                    "transaction_date": transaction_date,
                    "transaction_time": transaction_time,
                    "amount": amount,
                    "split_share_amount": split_share_amount,
                    "transaction_type": transaction_type,
                    "is_partial_refund": is_partial_refund,
                    "is_shared": is_shared,
                    "split_breakdown": split_breakdown,
                    "account": account,
                    "category": category,
                    "sub_category": sub_category,
                    "description": description,
                    "notes": notes,
                    "reference_number": reference_number,
                    "related_mails": related_mails,
                    "source_file": source_file,
                    "raw_data": raw_data,
                    "link_parent_id": link_parent_id,
                    "transfer_group_id": transfer_group_id
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
                    SELECT * FROM transactions 
                    WHERE id = :transaction_id
                """), {"transaction_id": transaction_id}
            )
            row = result.fetchone()
            return dict(row._mapping) if row else None
        finally:
            await session.close()
    
    @staticmethod
    async def get_transactions_by_date_range(
        start_date: date, 
        end_date: date, 
        limit: int = 100, 
        offset: int = 0
    ) -> List[Dict[str, Any]]:
        """Get transactions within a date range"""
        session_factory = get_session_factory()
        session = session_factory()
        try:
            result = await session.execute(
                text("""
                    SELECT * FROM transactions 
                    WHERE transaction_date BETWEEN :start_date AND :end_date
                    ORDER BY transaction_date DESC, created_at DESC
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
                    SELECT * FROM transactions 
                    WHERE account = :account
                    ORDER BY transaction_date DESC, created_at DESC
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
        category: str, 
        limit: int = 100, 
        offset: int = 0
    ) -> List[Dict[str, Any]]:
        """Get transactions for a specific category"""
        session_factory = get_session_factory()
        session = session_factory()
        try:
            result = await session.execute(
                text("""
                    SELECT * FROM transactions 
                    WHERE category = :category
                    ORDER BY transaction_date DESC, created_at DESC
                    LIMIT :limit OFFSET :offset
                """), {
                    "category": category,
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
                    SELECT * FROM transactions 
                    WHERE is_shared = true
                    ORDER BY transaction_date DESC, created_at DESC
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
    async def get_transfer_group_transactions(transfer_group_id: str) -> List[Dict[str, Any]]:
        """Get all transactions in a transfer group"""
        session_factory = get_session_factory()
        session = session_factory()
        try:
            result = await session.execute(
                text("""
                    SELECT * FROM transactions 
                    WHERE transfer_group_id = :transfer_group_id
                    ORDER BY transaction_date, created_at
                """), {"transfer_group_id": transfer_group_id}
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
                    SELECT * FROM transactions 
                    WHERE link_parent_id = :parent_id
                    ORDER BY created_at
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
            # Build dynamic UPDATE query
            set_clauses = []
            params = {"transaction_id": transaction_id}
            
            for field, value in updates.items():
                if field in [
                    'transaction_date', 'transaction_time', 'amount', 'split_share_amount',
                    'transaction_type', 'is_partial_refund', 'is_shared', 'split_breakdown',
                    'account', 'category', 'sub_category', 'description', 'notes', 
                    'reference_number', 'related_mails', 'source_file', 'raw_data',
                    'link_parent_id', 'transfer_group_id'
                ]:
                    set_clauses.append(f"{field} = :{field}")
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
                    SELECT * FROM transactions 
                    WHERE LOWER(description) LIKE :search_term
                       OR LOWER(notes) LIKE :search_term
                       OR LOWER(reference_number) LIKE :search_term
                    ORDER BY transaction_date DESC, created_at DESC
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
