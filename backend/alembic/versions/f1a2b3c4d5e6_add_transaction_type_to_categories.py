"""add_transaction_type_to_categories

Revision ID: f1a2b3c4d5e6
Revises: dc5561557077
Create Date: 2025-01-15 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f1a2b3c4d5e6'
down_revision: Union[str, Sequence[str], None] = 'dc5561557077'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # Add transaction_type column to categories table
    op.add_column('categories', sa.Column('transaction_type', sa.Text(), nullable=True))
    
    # Create index on transaction_type for better query performance
    op.create_index('ix_categories_transaction_type', 'categories', ['transaction_type'])


def downgrade() -> None:
    """Downgrade schema."""
    # Drop index
    op.drop_index('ix_categories_transaction_type', table_name='categories')
    
    # Drop column
    op.drop_column('categories', 'transaction_type')

