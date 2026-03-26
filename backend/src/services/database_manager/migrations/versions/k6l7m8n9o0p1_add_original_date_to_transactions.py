"""add original_date to transactions

Revision ID: k6l7m8n9o0p1
Revises: j5k6l7m8n9o0
Create Date: 2026-03-27

"""
from alembic import op
import sqlalchemy as sa

revision = 'k6l7m8n9o0p1'
down_revision = 'c36d9877a6ee'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('transactions', sa.Column('original_date', sa.Date(), nullable=True))


def downgrade() -> None:
    op.drop_column('transactions', 'original_date')
