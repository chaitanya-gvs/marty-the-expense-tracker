"""Add participants table

Revision ID: d3e4f5g6h7i8
Revises: c1d2e3f4g5h6
Create Date: 2025-10-25 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd3e4f5g6h7i8'
down_revision: Union[str, Sequence[str], None] = 'c1d2e3f4g5h6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'participants',
        sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
        sa.Column('name', sa.String(length=255), nullable=False),
        sa.Column('splitwise_id', sa.BigInteger(), nullable=True),
        sa.Column('splitwise_email', sa.String(length=255), nullable=True),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('name', name='uq_participants_name'),
        sa.UniqueConstraint('splitwise_id', name='uq_participants_splitwise_id')
    )
    op.create_index('ix_participants_name', 'participants', ['name'])
    op.create_index('ix_participants_splitwise_id', 'participants', ['splitwise_id'])


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index('ix_participants_splitwise_id', table_name='participants')
    op.drop_index('ix_participants_name', table_name='participants')
    op.drop_table('participants')

