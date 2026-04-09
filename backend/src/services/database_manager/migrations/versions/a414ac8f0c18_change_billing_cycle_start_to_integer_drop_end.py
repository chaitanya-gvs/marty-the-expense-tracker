"""change billing_cycle_start to integer drop billing_cycle_end

Revision ID: a414ac8f0c18
Revises: k6l7m8n9o0p1
Create Date: 2026-04-08

"""
from alembic import op
import sqlalchemy as sa

revision = 'a414ac8f0c18'
down_revision = '98ef2f3deecc'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. Add temp integer column
    op.add_column('accounts', sa.Column('billing_cycle_start_int', sa.Integer(), nullable=True))

    # 2. Copy existing data: extract day-of-month from the Date column (handles NULLs gracefully)
    op.execute(
        "UPDATE accounts SET billing_cycle_start_int = EXTRACT(DAY FROM billing_cycle_start)::INTEGER"
        " WHERE billing_cycle_start IS NOT NULL"
    )

    # 3. Drop old Date column
    op.drop_column('accounts', 'billing_cycle_start')

    # 4. Rename temp column to billing_cycle_start
    op.alter_column('accounts', 'billing_cycle_start_int', new_column_name='billing_cycle_start')

    # 5. Drop billing_cycle_end
    op.drop_column('accounts', 'billing_cycle_end')


def downgrade() -> None:
    # Re-add billing_cycle_end as nullable Date
    op.add_column('accounts', sa.Column('billing_cycle_end', sa.Date(), nullable=True))

    # Re-add billing_cycle_start as nullable Date (data cannot be recovered precisely)
    op.add_column('accounts', sa.Column('billing_cycle_start_new', sa.Date(), nullable=True))

    # Drop the integer column
    op.drop_column('accounts', 'billing_cycle_start')

    # Rename the new Date column back
    op.alter_column('accounts', 'billing_cycle_start_new', new_column_name='billing_cycle_start')
