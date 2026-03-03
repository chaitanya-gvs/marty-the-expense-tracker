"""add_user_description_to_transactions

Revision ID: 4b025858c243
Revises: 1610186129ef
Create Date: 2025-11-18 02:36:37.455190

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '4b025858c243'
down_revision: Union[str, Sequence[str], None] = '1610186129ef'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "transactions",
        sa.Column(
            "user_description",
            sa.Text(),
            nullable=True,
        ),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("transactions", "user_description")
