"""normalize_splitwise_account_case

Revision ID: j5k6l7m8n9o0
Revises: i4j5k6l7m8n9
Create Date: 2026-03-19

Normalize transactions.account from 'splitwise' (lowercase) to 'Splitwise'
(title case) so all Splitwise rows use consistent casing.
"""
from typing import Sequence, Union

from alembic import op
from sqlalchemy import text

revision: str = "j5k6l7m8n9o0"
down_revision: Union[str, Sequence[str], None] = "i4j5k6l7m8n9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    conn.execute(
        text("""
            UPDATE transactions
            SET account = 'Splitwise'
            WHERE LOWER(account) = 'splitwise'
        """)
    )


def downgrade() -> None:
    # Imperfect revert: cannot know exactly which rows were lowercase
    pass
