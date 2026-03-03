"""Backup transactions table and add transaction_source column

Revision ID: a1b2c3d4e5f6
Revises: 8f045365e344
Create Date: 2026-02-18

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a1b2c3d4e5f6'
down_revision: Union[str, Sequence[str], None] = '8f045365e344'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Step 1: Create a copy of the transactions table (backup before schema change).
    # Skip if table already exists (e.g. created manually via CLI).
    op.execute("""
        DO $$
        BEGIN
            CREATE TABLE transactions_backup_20260218 AS SELECT * FROM transactions;
        EXCEPTION
            WHEN duplicate_table THEN NULL;
        END $$;
    """)

    # Step 2: Add transaction_source column: statement_extraction, email_ingestion, or manual_entry
    op.add_column(
        'transactions',
        sa.Column('transaction_source', sa.Text(), nullable=True)
    )


def downgrade() -> None:
    op.drop_column('transactions', 'transaction_source')
    # Backup table transactions_backup_20260218 is left in place for manual recovery if needed
    # To remove it: op.execute("DROP TABLE IF EXISTS transactions_backup_20260218")
