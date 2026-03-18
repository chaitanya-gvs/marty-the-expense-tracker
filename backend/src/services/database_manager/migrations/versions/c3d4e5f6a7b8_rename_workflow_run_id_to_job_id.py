"""Rename workflow_run_id to job_id in statement_processing_log

Revision ID: c3d4e5f6a7b8
Revises: b2c3d4e5f6a7
Create Date: 2026-03-15

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'c3d4e5f6a7b8'
down_revision: Union[str, Sequence[str], None] = 'b2c3d4e5f6a7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column(
        'statement_processing_log',
        'workflow_run_id',
        new_column_name='job_id',
    )


def downgrade() -> None:
    op.alter_column(
        'statement_processing_log',
        'job_id',
        new_column_name='workflow_run_id',
    )
