"""fix billing_cycle_start dates for axis_atlas, cashback_sbi, amazon_pay_icici

Revision ID: l7m8n9o0p1q2
Revises: k6l7m8n9o0p1
Create Date: 2026-06-29

axis_atlas:      2 (billing period ends on the 1st; May 2 → June 1)
cashback_sbi:    2 (same period structure as axis_atlas)
amazon_pay_icici: 3 (PDF states "May 3 – June 2"; was incorrectly set to 1)
"""
from alembic import op


def upgrade() -> None:
    op.execute("""
        UPDATE accounts SET billing_cycle_start = 2
        WHERE account_key = 'axis_atlas' AND billing_cycle_start = 1
    """)
    op.execute("""
        UPDATE accounts SET billing_cycle_start = 2
        WHERE account_key = 'cashback_sbi' AND billing_cycle_start = 1
    """)
    op.execute("""
        UPDATE accounts SET billing_cycle_start = 3
        WHERE account_key = 'amazon_pay_icici' AND billing_cycle_start = 1
    """)


def downgrade() -> None:
    op.execute("""
        UPDATE accounts SET billing_cycle_start = 1
        WHERE account_key IN ('axis_atlas', 'cashback_sbi', 'amazon_pay_icici')
        AND billing_cycle_start IN (2, 3)
    """)
