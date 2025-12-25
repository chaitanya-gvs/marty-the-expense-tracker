#!/usr/bin/env python3
"""
Script to check uncategorized transactions in analytics for a given date range.
This matches the logic used in get_expense_analytics to show which transactions
are being counted as "Uncategorized".
"""

import asyncio
from datetime import date
from sqlalchemy import text
from src.services.database_manager.connection import get_session_factory
from src.utils.logger import get_logger
from decimal import Decimal

logger = get_logger(__name__)


async def check_uncategorized_transactions(start_date: date, end_date: date):
    """Check uncategorized transactions matching analytics logic."""
    session_factory = get_session_factory()
    session = session_factory()
    
    try:
        # Default exclude categories (same as in analytics)
        default_exclude_categories = [
            "Credit Card Payment",
            "Self Transfer",
            "Transfer",
            "Card Payment",
            "Account Transfer"
        ]
        
        # Build the query matching analytics logic
        query = text("""
            SELECT 
                t.id,
                t.transaction_date,
                t.description,
                t.user_description,
                t.amount,
                t.split_share_amount,
                t.direction,
                t.account,
                c.name as category_name,
                t.category_id,
                t.is_split,
                t.link_parent_id,
                -- Calculate net amount (same as analytics)
                (
                    COALESCE(t.split_share_amount, t.amount) - COALESCE((
                        SELECT SUM(child.amount)
                        FROM transactions child
                        WHERE child.link_parent_id = t.id
                          AND child.direction = 'credit'
                          AND child.is_deleted = false
                    ), 0)
                ) as net_amount,
                -- Count refunds
                (
                    SELECT COUNT(*)
                    FROM transactions child
                    WHERE child.link_parent_id = t.id
                      AND child.direction = 'credit'
                      AND child.is_deleted = false
                ) as refund_count,
                -- Sum of refunds
                (
                    SELECT COALESCE(SUM(child.amount), 0)
                    FROM transactions child
                    WHERE child.link_parent_id = t.id
                      AND child.direction = 'credit'
                      AND child.is_deleted = false
                ) as refund_total
            FROM transactions t
            LEFT JOIN categories c ON t.category_id = c.id
            WHERE t.is_deleted = false
              AND t.direction = 'debit'
              AND t.link_parent_id IS NULL
              -- Exclude parent transactions in split groups - only count split parts (is_split = True)
              AND (t.transaction_group_id IS NULL OR t.is_split = true)
              AND t.transaction_date >= :start_date
              AND t.transaction_date <= :end_date
              -- Uncategorized: category_id IS NULL or category name is NULL
              AND (t.category_id IS NULL OR c.name IS NULL)
              -- Exclude default categories (shouldn't match but just in case)
              AND (c.name IS NULL OR c.name != ALL(:exclude_categories))
            ORDER BY t.transaction_date DESC, t.amount DESC
        """)
        
        params = {
            "start_date": start_date,
            "end_date": end_date,
            "exclude_categories": default_exclude_categories
        }
        
        result = await session.execute(query, params)
        rows = result.fetchall()
        
        if not rows:
            logger.info(f"\nNo uncategorized transactions found for {start_date} to {end_date}\n")
            return
        
        logger.info(f"\n{'='*100}")
        logger.info(f"UNCATEGORIZED TRANSACTIONS: {start_date} to {end_date}")
        logger.info(f"{'='*100}\n")
        
        total_net_amount = Decimal('0')
        transaction_count = 0
        
        for row in rows:
            row_dict = dict(row._mapping)
            net_amount = row_dict['net_amount']
            
            # Skip if net amount is <= 0 (refunds exceeded expense)
            if net_amount and net_amount > 0:
                total_net_amount += net_amount
                transaction_count += 1
                
                logger.info(f"Date: {row_dict['transaction_date']}")
                logger.info(f"Amount: ₹{row_dict['amount']:,.2f}")
                if row_dict['split_share_amount']:
                    logger.info(f"Split Share: ₹{row_dict['split_share_amount']:,.2f}")
                logger.info(f"Net Amount: ₹{net_amount:,.2f}")
                if row_dict['refund_count'] > 0:
                    logger.info(f"Refunds: {row_dict['refund_count']} transaction(s), Total: ₹{row_dict['refund_total']:,.2f}")
                logger.info(f"Account: {row_dict['account']}")
                logger.info(f"Description: {row_dict['description']}")
                if row_dict['user_description']:
                    logger.info(f"User Description: {row_dict['user_description']}")
                logger.info(f"Category ID: {row_dict['category_id']}")
                logger.info(f"Category Name: {row_dict['category_name'] or 'NULL'}")
                logger.info(f"Is Split: {row_dict['is_split']}")
                logger.info(f"Transaction ID: {row_dict['id']}")
                logger.info(f"{'-'*100}\n")
        
        logger.info(f"\n{'='*100}")
        logger.info(f"SUMMARY")
        logger.info(f"{'='*100}")
        logger.info(f"Total Transactions (with net amount > 0): {transaction_count}")
        logger.info(f"Total Net Amount: ₹{total_net_amount:,.2f}")
        
        # Also show transactions with net amount <= 0
        zero_or_negative = sum(1 for row in rows if (dict(row._mapping)['net_amount'] or 0) <= 0)
        if zero_or_negative > 0:
            logger.info(f"\nTransactions with net amount <= 0 (excluded from analytics): {zero_or_negative}")
        
        logger.info(f"{'='*100}\n")
        
    except Exception as e:
        logger.error("Error in check_uncategorized_transactions", exc_info=True)
    finally:
        await session.close()


if __name__ == "__main__":
    # Check October 1-31, 2025
    start_date = date(2025, 10, 1)
    end_date = date(2025, 10, 31)
    
    asyncio.run(check_uncategorized_transactions(start_date, end_date))

