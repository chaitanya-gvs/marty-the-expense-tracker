"""add transaction_time to review_queue, fold it + normalized description into the dedup index

Revision ID: o0p1q2r3s4t5
Revises: n9o0p1q2r3s4
Create Date: 2026-08-08

Adding time-of-day and a whitespace-normalized description to the idempotency
key. Two real production rows were found conflated under the account/date/
amount/direction-only key (different UPI reference numbers, same day/amount).
transaction_time alone doesn't fix this: ~83%% of statement-sourced rows have
no time data, and Postgres composite unique indexes exempt a row from
uniqueness entirely when ANY indexed column is null (not just that column) —
verified empirically. COALESCE(transaction_time, '00:00:00') turns that null
into a real sentinel value instead of an escape hatch; the normalized
description (whitespace stripped) is what actually distinguishes the two real
disputed pairs, since their difference is in the embedded UPI reference
number text, not whitespace.
"""
from alembic import op

revision = "o0p1q2r3s4t5"
down_revision = "n9o0p1q2r3s4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE review_queue ADD COLUMN transaction_time TIME NULL")
    op.execute("DROP INDEX IF EXISTS uq_review_queue_unresolved_item")
    op.execute("""
        CREATE UNIQUE INDEX uq_review_queue_unresolved_item
        ON review_queue (
            review_type, account, transaction_date, amount, direction,
            COALESCE(transaction_time, '00:00:00'::time),
            regexp_replace(description, '\\s+', '', 'g')
        )
        WHERE resolved_at IS NULL
    """)


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS uq_review_queue_unresolved_item")
    op.execute("""
        CREATE UNIQUE INDEX uq_review_queue_unresolved_item
        ON review_queue (review_type, account, transaction_date, amount, direction)
        WHERE resolved_at IS NULL
    """)
    op.execute("ALTER TABLE review_queue DROP COLUMN transaction_time")
