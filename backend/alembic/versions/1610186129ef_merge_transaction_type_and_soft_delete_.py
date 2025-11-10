"""merge transaction_type and soft_delete migrations

Revision ID: 1610186129ef
Revises: f1a2b3c4d5e6, f1e2d3c4b5a6
Create Date: 2025-11-10 13:36:15.291279

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '1610186129ef'
down_revision: Union[str, Sequence[str], None] = ('f1a2b3c4d5e6', 'f1e2d3c4b5a6')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    pass


def downgrade() -> None:
    """Downgrade schema."""
    pass
