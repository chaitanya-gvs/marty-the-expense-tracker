"""add partial unique index to review_queue to prevent duplicate unresolved entries

Revision ID: m8n9o0p1q2r3
Revises: l7m8n9o0p1q2
Create Date: 2026-06-29

Prevents the same unresolved review queue item from being inserted twice
when the workflow is run multiple times on the same statement.
"""
from alembic import op

revision = "m8n9o0p1q2r3"
down_revision = "l7m8n9o0p1q2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE UNIQUE INDEX uq_review_queue_unresolved_item
        ON review_queue (review_type, description, amount, transaction_date, direction, account)
        WHERE resolved_at IS NULL
    """)


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS uq_review_queue_unresolved_item")
