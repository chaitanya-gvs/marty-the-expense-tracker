"""remove_splitwise_from_statement_log

Revision ID: g2h3i4j5k6l7
Revises: c3d4e5f6a7b8
Create Date: 2026-03-18

Remove any Splitwise rows from statement_processing_log.
Splitwise is intentionally excluded from the log per design.
"""
from typing import Sequence, Union

from alembic import op
from sqlalchemy import text


revision: str = "g2h3i4j5k6l7"
down_revision: Union[str, Sequence[str], None] = "c3d4e5f6a7b8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    conn.execute(
        text("""
            DELETE FROM statement_processing_log
            WHERE account_nickname = 'Splitwise'
               OR normalized_filename LIKE 'splitwise%'
        """)
    )


def downgrade() -> None:
    # No restore - this is a one-time cleanup
    pass
