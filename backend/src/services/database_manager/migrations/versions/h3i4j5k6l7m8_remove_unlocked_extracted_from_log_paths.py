"""remove_unlocked_extracted_from_log_paths

Revision ID: h3i4j5k6l7m8
Revises: g2h3i4j5k6l7
Create Date: 2026-03-18

Update statement_processing_log to use new naming (no _unlocked, _extracted):
- unlocked_cloud_path: _unlocked.pdf -> .pdf
- csv_cloud_path: _extracted.csv -> .csv
- normalized_filename: strip _unlocked and _extracted where present
"""
from typing import Sequence, Union

from alembic import op
from sqlalchemy import text


revision: str = "h3i4j5k6l7m8"
down_revision: Union[str, Sequence[str], None] = "g2h3i4j5k6l7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()

    # Update unlocked_cloud_path: remove _unlocked.pdf suffix
    conn.execute(
        text("""
            UPDATE statement_processing_log
            SET unlocked_cloud_path = REPLACE(unlocked_cloud_path, '_unlocked.pdf', '.pdf')
            WHERE unlocked_cloud_path LIKE '%_unlocked.pdf'
        """)
    )

    # Update csv_cloud_path: remove _extracted from filenames (e.g. sbi_20260312_extracted.csv -> sbi_20260312.csv)
    conn.execute(
        text("""
            UPDATE statement_processing_log
            SET csv_cloud_path = REPLACE(csv_cloud_path, '_extracted.csv', '.csv')
            WHERE csv_cloud_path LIKE '%_extracted.csv'
        """)
    )

    # Update normalized_filename: strip _unlocked and _extracted (for any legacy rows)
    # Only update rows that actually contain these strings
    conn.execute(
        text("""
            UPDATE statement_processing_log
            SET normalized_filename = REPLACE(REPLACE(normalized_filename, '_unlocked', ''), '_extracted', '')
            WHERE normalized_filename LIKE '%_unlocked%' OR normalized_filename LIKE '%_extracted%'
        """)
    )


def downgrade() -> None:
    # No restore - paths would need to be reverted manually if needed
    pass
