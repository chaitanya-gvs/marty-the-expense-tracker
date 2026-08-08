"""narrow review_queue dedup index — drop description from the key

Revision ID: n9o0p1q2r3s4
Revises: m8n9o0p1q2r3
Create Date: 2026-08-08

The previous index keyed on description too, which is fragile for UPI-style
descriptions (embedded reference numbers vary slightly per extraction run),
letting logical duplicates slip past the guard. account/date/amount/direction
is already the same tuple tier-2 dedup uses to define "the same matching
situation", so it's the right idempotency key on its own.
"""
from alembic import op

revision = "n9o0p1q2r3s4"
down_revision = "m8n9o0p1q2r3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("DROP INDEX IF EXISTS uq_review_queue_unresolved_item")
    op.execute("""
        UPDATE review_queue
        SET resolved_at = now(), resolution = 'duplicate_migration_cleanup'
        WHERE id IN (
            SELECT id FROM (
                SELECT id,
                       row_number() OVER (
                           PARTITION BY review_type, account, transaction_date, amount, direction
                           ORDER BY created_at ASC
                       ) AS rn
                FROM review_queue
                WHERE resolved_at IS NULL
            ) ranked
            WHERE rn > 1
        )
    """)
    op.execute("""
        CREATE UNIQUE INDEX uq_review_queue_unresolved_item
        ON review_queue (review_type, account, transaction_date, amount, direction)
        WHERE resolved_at IS NULL
    """)


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS uq_review_queue_unresolved_item")
    op.execute("""
        CREATE UNIQUE INDEX uq_review_queue_unresolved_item
        ON review_queue (review_type, description, amount, transaction_date, direction, account)
        WHERE resolved_at IS NULL
    """)
