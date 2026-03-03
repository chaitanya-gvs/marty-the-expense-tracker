"""Add is_split and rename transfer_group_id to transaction_group_id

Revision ID: c1d2e3f4g5h6
Revises: ab264540eef4
Create Date: 2025-10-23 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c1d2e3f4g5h6'
down_revision: Union[str, Sequence[str], None] = 'ab264540eef4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # Add is_split column
    op.add_column('transactions', sa.Column('is_split', sa.Boolean(), nullable=True, server_default=sa.false()))
    
    # Rename transfer_group_id to transaction_group_id
    op.alter_column('transactions', 'transfer_group_id', 
                    new_column_name='transaction_group_id',
                    existing_type=sa.UUID(),
                    nullable=True)


def downgrade() -> None:
    """Downgrade schema."""
    # Rename transaction_group_id back to transfer_group_id
    op.alter_column('transactions', 'transaction_group_id',
                    new_column_name='transfer_group_id',
                    existing_type=sa.UUID(),
                    nullable=True)
    
    # Drop is_split column
    op.drop_column('transactions', 'is_split')

