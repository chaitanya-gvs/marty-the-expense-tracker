"""migrate_refunds_to_groups

Revision ID: 8f045365e344
Revises: 3636dd5158d8
Create Date: 2026-02-17 19:55:55.564096

"""
from typing import Sequence, Union
import uuid
from decimal import Decimal
import json

from alembic import op
import sqlalchemy as sa
from sqlalchemy import text
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = '8f045365e344'
down_revision: Union[str, Sequence[str], None] = '3636dd5158d8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema: Convert parent-child refund links to grouped expenses."""
    
    conn = op.get_bind()
    
    # Step 1: Migrate parent-child refund relationships to grouped expenses
    print("Migrating parent-child refund relationships to grouped expenses...")
    
    # Get all distinct parent transactions (transactions that have children)
    parents_query = text("""
        SELECT DISTINCT link_parent_id 
        FROM transactions 
        WHERE link_parent_id IS NOT NULL 
        AND is_deleted = false
    """)
    parent_ids = [row[0] for row in conn.execute(parents_query).fetchall()]
    
    print(f"Found {len(parent_ids)} parent transactions with refunds")
    
    for parent_id in parent_ids:
        # Get parent transaction
        parent_query = text("""
            SELECT id, transaction_date, transaction_time, description, user_description,
                   amount, direction, transaction_type, account, category_id, 
                   sub_category, notes, paid_by, is_shared, split_share_amount,
                   split_breakdown, reference_number, related_mails, source_file,
                   raw_data, created_at, updated_at, tags
            FROM transactions 
            WHERE id = :parent_id AND is_deleted = false
        """)
        parent = conn.execute(parent_query, {"parent_id": parent_id}).fetchone()
        
        if not parent:
            continue
        
        # Get all child transactions (refunds)
        children_query = text("""
            SELECT id, amount, direction
            FROM transactions 
            WHERE link_parent_id = :parent_id AND is_deleted = false
        """)
        children = conn.execute(children_query, {"parent_id": parent_id}).fetchall()
        
        if not children:
            continue
        
        # Calculate net amount (parent amount - sum of credit children)
        parent_amount = parent.amount
        total_refund = sum(
            child.amount for child in children 
            if child.direction == 'credit'
        )
        net_amount = parent_amount - total_refund
        
        # Determine direction of collapsed transaction
        collapsed_direction = 'debit' if net_amount >= 0 else 'credit'
        collapsed_amount = abs(net_amount)
        
        # Generate new transaction_group_id
        group_id = uuid.uuid4()
        
        # Create collapsed transaction
        collapsed_id = uuid.uuid4()
        insert_collapsed = text("""
            INSERT INTO transactions (
                id, transaction_group_id, transaction_date, transaction_time,
                description, user_description, amount, direction, transaction_type,
                account, category_id, sub_category, notes, paid_by, is_shared,
                split_share_amount, split_breakdown, reference_number,
                related_mails, source_file, raw_data, created_at, updated_at,
                tags, is_grouped_expense, is_deleted, is_partial_refund, is_split
            ) VALUES (
                :id, :group_id, :transaction_date, :transaction_time,
                :description, :user_description, :amount, :direction, :transaction_type,
                :account, :category_id, :sub_category, :notes, :paid_by, :is_shared,
                :split_share_amount, CAST(:split_breakdown AS jsonb), :reference_number,
                :related_mails, :source_file, CAST(:raw_data AS jsonb), :created_at, :updated_at,
                :tags, true, false, false, false
            )
        """)
        
        conn.execute(insert_collapsed, {
            "id": collapsed_id,
            "group_id": group_id,
            "transaction_date": parent.transaction_date,
            "transaction_time": parent.transaction_time,
            "description": parent.user_description or parent.description,
            "user_description": parent.user_description,
            "amount": collapsed_amount,
            "direction": collapsed_direction,
            "transaction_type": parent.transaction_type,
            "account": parent.account,
            "category_id": parent.category_id,
            "sub_category": parent.sub_category,
            "notes": parent.notes,
            "paid_by": parent.paid_by,
            "is_shared": parent.is_shared,
            "split_share_amount": parent.split_share_amount,
            "split_breakdown": json.dumps(parent.split_breakdown) if parent.split_breakdown else None,
            "reference_number": parent.reference_number,
            "related_mails": parent.related_mails,
            "source_file": parent.source_file,
            "raw_data": json.dumps(parent.raw_data) if parent.raw_data else None,
            "created_at": parent.created_at,
            "updated_at": parent.updated_at,
            "tags": parent.tags
        })
        
        # Update parent transaction
        update_parent = text("""
            UPDATE transactions 
            SET transaction_group_id = :group_id,
                is_grouped_expense = false,
                link_parent_id = NULL
            WHERE id = :parent_id
        """)
        conn.execute(update_parent, {"group_id": group_id, "parent_id": parent_id})
        
        # Update all child transactions
        update_children = text("""
            UPDATE transactions 
            SET transaction_group_id = :group_id,
                is_grouped_expense = false,
                link_parent_id = NULL
            WHERE link_parent_id = :parent_id
        """)
        conn.execute(update_children, {"group_id": group_id, "parent_id": parent_id})
    
    print(f"Migrated {len(parent_ids)} refund groups to grouped expenses")
    
    # Step 2: Handle existing transfer groups (create collapsed transactions)
    print("Processing existing transfer groups...")
    
    # Get all existing transfer groups (transaction_group_id but not is_split and not already grouped)
    transfer_groups_query = text("""
        SELECT DISTINCT transaction_group_id
        FROM transactions
        WHERE transaction_group_id IS NOT NULL
        AND (is_split IS NULL OR is_split = false)
        AND (is_grouped_expense IS NULL OR is_grouped_expense = false)
        AND is_deleted = false
    """)
    transfer_group_ids = [row[0] for row in conn.execute(transfer_groups_query).fetchall()]
    
    print(f"Found {len(transfer_group_ids)} existing transfer groups")
    
    for group_id in transfer_group_ids:
        # Get all transactions in this group
        group_txns_query = text("""
            SELECT id, transaction_date, transaction_time, description, user_description,
                   amount, direction, transaction_type, account, category_id,
                   sub_category, notes, paid_by, is_shared, split_share_amount,
                   split_breakdown, reference_number, related_mails, source_file,
                   raw_data, created_at, updated_at, tags
            FROM transactions
            WHERE transaction_group_id = :group_id AND is_deleted = false
            ORDER BY created_at ASC
        """)
        group_txns = conn.execute(group_txns_query, {"group_id": group_id}).fetchall()
        
        if not group_txns or len(group_txns) == 0:
            continue
        
        # Calculate net amount (credits - debits)
        net_amount = sum(
            txn.amount if txn.direction == 'credit' else -txn.amount
            for txn in group_txns
        )
        
        # Use first transaction as template
        first_txn = group_txns[0]
        
        # Determine direction of collapsed transaction
        collapsed_direction = 'credit' if net_amount >= 0 else 'debit'
        collapsed_amount = abs(net_amount)
        
        # Create collapsed transaction for this transfer group
        collapsed_id = uuid.uuid4()
        
        # Create description that indicates it's a transfer group
        group_description = f"Transfer Group ({len(group_txns)} transactions)"
        if first_txn.user_description:
            group_description = first_txn.user_description
        elif first_txn.description:
            group_description = first_txn.description
        
        insert_collapsed = text("""
            INSERT INTO transactions (
                id, transaction_group_id, transaction_date, transaction_time,
                description, user_description, amount, direction, transaction_type,
                account, category_id, sub_category, notes, paid_by, is_shared,
                split_share_amount, split_breakdown, reference_number,
                related_mails, source_file, raw_data, created_at, updated_at,
                tags, is_grouped_expense, is_deleted, is_partial_refund, is_split
            ) VALUES (
                :id, :group_id, :transaction_date, :transaction_time,
                :description, :user_description, :amount, :direction, :transaction_type,
                :account, :category_id, :sub_category, :notes, :paid_by, :is_shared,
                :split_share_amount, :split_breakdown, :reference_number,
                :related_mails, :source_file, CAST(:raw_data AS jsonb), :created_at, :updated_at,
                :tags, true, false, false, false
            )
        """)
        
        conn.execute(insert_collapsed, {
            "id": collapsed_id,
            "group_id": group_id,
            "transaction_date": first_txn.transaction_date,
            "transaction_time": first_txn.transaction_time,
            "description": group_description,
            "user_description": first_txn.user_description,
            "amount": collapsed_amount,
            "direction": collapsed_direction,
            "transaction_type": first_txn.transaction_type,
            "account": first_txn.account,
            "category_id": first_txn.category_id,
            "sub_category": first_txn.sub_category,
            "notes": first_txn.notes,
            "paid_by": first_txn.paid_by,
            "is_shared": first_txn.is_shared,
            "split_share_amount": None,
            "split_breakdown": None,
            "reference_number": first_txn.reference_number,
            "related_mails": first_txn.related_mails,
            "source_file": first_txn.source_file,
            "raw_data": json.dumps(first_txn.raw_data) if first_txn.raw_data else None,
            "created_at": first_txn.created_at,
            "updated_at": first_txn.updated_at,
            "tags": first_txn.tags
        })
    
    print(f"Processed {len(transfer_group_ids)} transfer groups")
    
    # Step 3: Drop link_parent_id foreign key constraint and column
    print("Dropping link_parent_id constraint and column...")
    op.drop_constraint('transactions_link_parent_id_fkey', 'transactions', type_='foreignkey')
    op.drop_column('transactions', 'link_parent_id')
    
    # Step 4: Drop is_partial_refund column
    print("Dropping is_partial_refund column...")
    op.drop_column('transactions', 'is_partial_refund')
    
    print("Migration completed successfully!")


def downgrade() -> None:
    """Downgrade schema: Restore parent-child refund links."""
    
    conn = op.get_bind()
    
    # Step 1: Re-add is_partial_refund column
    op.add_column('transactions', sa.Column('is_partial_refund', sa.Boolean(), nullable=True, default=False))
    
    # Step 2: Re-add link_parent_id column
    op.add_column('transactions', sa.Column('link_parent_id', postgresql.UUID(), nullable=True))
    
    # Step 3: Re-create foreign key constraint
    op.create_foreign_key('transactions_link_parent_id_fkey', 'transactions', 'transactions', ['link_parent_id'], ['id'])
    
    # Step 4: Delete all collapsed transactions created during migration
    # (Transactions with is_grouped_expense = true that were created by this migration)
    delete_collapsed = text("""
        DELETE FROM transactions
        WHERE is_grouped_expense = true
    """)
    conn.execute(delete_collapsed)
    
    # Step 5: Clear transaction_group_id from remaining transactions
    # (Only for groups that were migrated refunds - this is a simplification)
    clear_groups = text("""
        UPDATE transactions
        SET transaction_group_id = NULL
        WHERE transaction_group_id IS NOT NULL
        AND is_split = false
    """)
    conn.execute(clear_groups)
    
    print("Downgrade completed - manual data restoration may be required")
