"""fix billing_cycle_start dates for axis_atlas, cashback_sbi, amazon_pay_icici

Revision ID: l7m8n9o0p1q2
Revises: k6l7m8n9o0p1
Create Date: 2026-06-29

axis_atlas:      2 (billing period ends on the 1st; May 2 → June 1)
cashback_sbi:    2 (same period structure as axis_atlas)
amazon_pay_icici: 3 (PDF states "May 3 – June 2"; was incorrectly set to 1)
"""
from alembic import op

revision = "l7m8n9o0p1q2"
down_revision = "fb1fb64e5a93"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        UPDATE accounts SET billing_cycle_start = 2
        WHERE nickname = 'Axis Atlas Credit Card' AND billing_cycle_start = 1
    """)
    op.execute("""
        UPDATE accounts SET billing_cycle_start = 2
        WHERE nickname = 'Cashback SBI Credit Card' AND billing_cycle_start = 1
    """)
    op.execute("""
        UPDATE accounts SET billing_cycle_start = 3
        WHERE nickname = 'Amazon Pay ICICI Credit Card' AND billing_cycle_start = 1
    """)


def downgrade() -> None:
    op.execute("""
        UPDATE accounts SET billing_cycle_start = 1
        WHERE nickname IN ('Axis Atlas Credit Card', 'Cashback SBI Credit Card', 'Amazon Pay ICICI Credit Card')
        AND billing_cycle_start IN (2, 3)
    """)
