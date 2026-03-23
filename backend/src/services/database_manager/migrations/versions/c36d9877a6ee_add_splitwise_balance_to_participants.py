"""Add splitwise_balance and balance_synced_at to participants

Revision ID: c36d9877a6ee
Revises: j5k6l7m8n9o0
Create Date: 2026-03-23

Cache Splitwise-computed net balances for each participant friend.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c36d9877a6ee'
down_revision: Union[str, Sequence[str], None] = 'j5k6l7m8n9o0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('participants', sa.Column('splitwise_balance', sa.Numeric(12, 2), nullable=True))
    op.add_column('participants', sa.Column('balance_synced_at', sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('participants', 'balance_synced_at')
    op.drop_column('participants', 'splitwise_balance')
