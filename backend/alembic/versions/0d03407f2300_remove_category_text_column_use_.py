"""remove_category_text_column_use_category_id_only

Revision ID: 0d03407f2300
Revises: e8f7aea1fe10
Create Date: 2025-10-02 16:35:49.912093

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0d03407f2300'
down_revision: Union[str, Sequence[str], None] = 'e8f7aea1fe10'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # First, populate category_id for existing transactions based on category name
    # This will match category names to their IDs in the categories table
    op.execute("""
        UPDATE transactions t
        SET category_id = c.id
        FROM categories c
        WHERE LOWER(t.category) = LOWER(c.name)
        AND t.category_id IS NULL
        AND t.category IS NOT NULL
    """)
    
    # Drop the category text column since we now have category_id
    op.drop_column('transactions', 'category')


def downgrade() -> None:
    """Downgrade schema."""
    # Add the category column back
    op.add_column('transactions', 
        sa.Column('category', sa.Text(), nullable=False, server_default='Uncategorized')
    )
    
    # Populate category names from category_id
    op.execute("""
        UPDATE transactions t
        SET category = c.name
        FROM categories c
        WHERE t.category_id = c.id
    """)
    
    # Remove the server default
    op.alter_column('transactions', 'category', server_default=None)
