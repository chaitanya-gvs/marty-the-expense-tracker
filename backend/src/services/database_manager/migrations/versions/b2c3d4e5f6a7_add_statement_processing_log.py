"""Add statement_processing_log table

Revision ID: b2c3d4e5f6a7
Revises: a1b2c3d4e5f6
Create Date: 2026-03-15

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b2c3d4e5f6a7'
down_revision: Union[str, Sequence[str], None] = 'a1b2c3d4e5f6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'statement_processing_log',
        sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
        sa.Column('normalized_filename', sa.Text(), nullable=False),
        sa.Column('account_id', sa.UUID(), nullable=True),
        sa.Column('account_nickname', sa.Text(), nullable=True),
        sa.Column('sender_email', sa.Text(), nullable=True),
        sa.Column('email_date', sa.Text(), nullable=True),
        sa.Column('statement_month', sa.Text(), nullable=True),
        sa.Column('status', sa.Text(), server_default='downloaded', nullable=False),
        sa.Column('unlocked_cloud_path', sa.Text(), nullable=True),
        sa.Column('csv_cloud_path', sa.Text(), nullable=True),
        sa.Column('transaction_count', sa.Integer(), nullable=True),
        sa.Column('db_inserted_count', sa.Integer(), nullable=True),
        sa.Column('last_error', sa.Text(), nullable=True),
        sa.Column('workflow_run_id', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['account_id'], ['accounts.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('normalized_filename', name='uq_statement_processing_log_filename'),
        sa.CheckConstraint(
            "status IN ('downloaded', 'pdf_unlocked', 'pdf_stored', 'csv_extracted', 'csv_stored', 'db_inserted')",
            name='chk_statement_status'
        ),
    )
    op.create_index('idx_spl_status', 'statement_processing_log', ['status'])
    op.create_index('idx_spl_statement_month', 'statement_processing_log', ['statement_month'])
    op.create_index('idx_spl_account_id', 'statement_processing_log', ['account_id'])


def downgrade() -> None:
    op.drop_index('idx_spl_account_id', table_name='statement_processing_log')
    op.drop_index('idx_spl_statement_month', table_name='statement_processing_log')
    op.drop_index('idx_spl_status', table_name='statement_processing_log')
    op.drop_table('statement_processing_log')
