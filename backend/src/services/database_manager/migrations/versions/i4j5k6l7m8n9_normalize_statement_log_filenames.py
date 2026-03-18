"""normalize_statement_log_filenames

Revision ID: i4j5k6l7m8n9
Revises: h3i4j5k6l7m8
Create Date: 2026-03-18

Normalize statement_processing_log.normalized_filename from old naming
(sbi_savings_20260312, yes_bank_savings_20260301) to new {account}_{date}
convention (sbi_20260312, yes_bank_20260301) so skip logic matches GCS filenames.
"""
import re
import sys
from pathlib import Path

from alembic import op
from sqlalchemy import text

# Add backend to path for filename_utils
_backend = Path(__file__).resolve().parents[5]
if str(_backend) not in sys.path:
    sys.path.insert(0, str(_backend))

from src.services.statement_processor.filename_utils import nickname_to_filename_prefix

revision: str = "i4j5k6l7m8n9"
down_revision: str = "h3i4j5k6l7m8"
branch_labels = None
depends_on = None

PATTERN = re.compile(r"^(.+)_(\d{8})$")


def upgrade() -> None:
    conn = op.get_bind()
    result = conn.execute(
        text("SELECT id, normalized_filename FROM statement_processing_log")
    )
    rows = result.fetchall()

    for row in rows:
        row_id, normalized_filename = row[0], row[1]
        match = PATTERN.match(normalized_filename)
        if not match:
            continue
        prefix, date_part = match.groups()
        new_prefix = nickname_to_filename_prefix(prefix)
        if prefix == new_prefix:
            continue
        new_key = f"{new_prefix}_{date_part}"

        # Check if target key already exists (unique constraint)
        exists = conn.execute(
            text(
                "SELECT 1 FROM statement_processing_log "
                "WHERE normalized_filename = :key AND id != :id"
            ),
            {"key": new_key, "id": row_id},
        ).fetchone()
        if exists:
            # Keep the canonical row; delete the duplicate (old naming)
            conn.execute(
                text("DELETE FROM statement_processing_log WHERE id = :id"),
                {"id": row_id},
            )
        else:
            conn.execute(
                text(
                    "UPDATE statement_processing_log "
                    "SET normalized_filename = :new_key WHERE id = :id"
                ),
                {"new_key": new_key, "id": row_id},
            )


def downgrade() -> None:
    # No restore - old naming cannot be reconstructed
    pass
