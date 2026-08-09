"""
Download the latest Cashback SBI credit card statement from Gmail,
extract transactions from the PDF, and compare against what's in the DB.
"""

import asyncio
import os
import sys
import tempfile
from pathlib import Path

# Run from backend/
sys.path.insert(0, str(Path(__file__).parent.parent))
os.environ.setdefault("ENV_FILE", "configs/.env")
os.environ.setdefault("SECRETS_FILE", "configs/secrets/.env")

from src.utils.settings import get_settings  # noqa: E402 - must come after path setup
get_settings()  # initialise settings / load .env files

# noqa: E402 - all module imports must come after path and settings setup
from src.services.email_ingestion.client import EmailClient  # noqa: E402
from src.services.statement_processor.pdf_unlocker import PDFUnlocker  # noqa: E402
from src.services.statement_processor.document_extractor import DocumentExtractor  # noqa: E402
from src.utils.password_manager import get_password_manager  # noqa: E402
from src.utils.logger import get_logger  # noqa: E402

logger = get_logger(__name__)

SENDER = "Statements@sbicard.com"
NICKNAME = "Cashback SBI Credit Card"
# Search window: April–June 2026 to catch the latest statement
SEARCH_START = "2026/04/01"
SEARCH_END = "2026/06/01"


def download_statement() -> Path | None:
    """Search Gmail and download the latest Cashback SBI statement PDF."""
    client = EmailClient(account_id="primary")
    query = f"from:{SENDER} statement"
    print(f"\n[1] Searching Gmail: {query!r} ({SEARCH_START} → {SEARCH_END})")

    emails = client.search_emails_by_date_range(SEARCH_START, SEARCH_END, query)
    if not emails:
        # Try secondary account
        print("   Not found in primary — trying secondary account…")
        client2 = EmailClient(account_id="secondary")
        emails = client2.search_emails_by_date_range(SEARCH_START, SEARCH_END, query)
        if not emails:
            print("   No statement emails found in either account.")
            return None
        client = client2

    print(f"   Found {len(emails)} email(s). Using most recent.")
    email_id = emails[0]["id"]
    details = client.get_email_content(email_id)
    subject = details.get("subject", "")
    date = details.get("date", "")
    print(f"   Subject : {subject}")
    print(f"   Date    : {date}")

    pdfs = [a for a in details.get("attachments", []) if a.get("filename", "").lower().endswith(".pdf")]
    if not pdfs:
        print("   No PDF attachments found in this email.")
        return None

    attachment = pdfs[0]
    print(f"   Attachment: {attachment['filename']} ({attachment.get('size', '?')} bytes)")

    data = client.download_attachment(email_id, attachment["attachment_id"])
    if not data:
        print("   Failed to download attachment.")
        return None

    tmp_dir = Path(tempfile.mkdtemp(prefix="cashback_sbi_"))
    locked_path = tmp_dir / f"locked_{attachment['filename']}"
    locked_path.write_bytes(data)
    print(f"   Saved locked PDF → {locked_path}")
    return locked_path


def unlock_pdf(locked_path: Path, password: str) -> Path | None:
    """Unlock the PDF using the account password."""
    import shutil
    print("\n[2] Unlocking PDF with password…")
    unlocker = PDFUnlocker()
    result = unlocker.unlock_pdf_with_password(locked_path, password, account_nickname=NICKNAME)
    if result.get("success"):
        unlocked_path = Path(result["unlocked_path"])
        print(f"   Unlocked PDF → {unlocked_path}")
        return unlocked_path
    print(f"   Unlock failed ({result.get('error')}), trying as unprotected PDF…")
    fallback_path = locked_path.parent / locked_path.name.removeprefix("locked_")
    shutil.copy(locked_path, fallback_path)
    print(f"   Using as-is → {fallback_path}")
    return fallback_path


def extract_transactions(pdf_path: Path) -> list[dict]:
    """Run DocumentExtractor on the unlocked PDF, return list of row dicts."""
    print("\n[3] Extracting transactions from PDF…")
    extractor = DocumentExtractor()
    result = extractor.extract_from_pdf(str(pdf_path), account_nickname=NICKNAME, save_results=False)
    if not result.get("success"):
        print(f"   Extraction failed: {result.get('error')}")
        return []

    table_data = result.get("table_data", "")
    if not table_data:
        print("   No table_data in result.")
        return []

    df = extractor._parse_table_to_dataframe(table_data)
    if df.empty:
        print("   DataFrame is empty after parsing.")
        return []

    print(f"   Raw columns: {list(df.columns)}")
    print(f"   Extracted {len(df)} row(s) from PDF.")
    return df.to_dict(orient="records")


async def get_db_transactions() -> list[dict]:
    """Fetch all Cashback SBI transactions from the DB."""
    from src.services.database_manager.connection import get_session_factory
    from sqlalchemy import text
    session_factory = get_session_factory()
    async with session_factory() as session:
        result = await session.execute(
            text("""
                SELECT transaction_date, description, amount, direction, source_file
                FROM transactions
                WHERE account = 'Cashback SBI Credit Card'
                  AND is_deleted = false
                ORDER BY transaction_date, created_at
            """)
        )
        rows = [dict(r._mapping) for r in result.fetchall()]
    return rows


def _pdf_row_fields(r: dict) -> tuple[str, str, str]:
    """Extract (date, description, amount) from a raw PDF row regardless of column names."""
    # Try standardized keys first, then fall back to raw PDF column names
    date = r.get("transaction_date") or r.get("Date") or "?"
    desc = r.get("description") or r.get("Transaction Details") or r.get("details") or "?"
    amt  = r.get("amount") or r.get("Amount (₹)") or r.get("Amount") or "?"
    return str(date), str(desc), str(amt)


def compare(pdf_rows: list[dict], db_rows: list[dict]):
    """Print a side-by-side comparison."""
    print("\n" + "=" * 70)
    print("PDF TRANSACTIONS (raw — as extracted by LandingAI)")
    print("=" * 70)
    if not pdf_rows:
        print("  (none extracted)")
    for r in sorted(pdf_rows, key=lambda x: str(x.get("Date", x.get("transaction_date", "")))):
        date, desc, amt = _pdf_row_fields(r)
        print(f"  {date}  ₹{amt:>12}  {desc}")

    print("\n" + "=" * 70)
    print("DB TRANSACTIONS (Cashback SBI Credit Card — all time)")
    print("=" * 70)
    for r in sorted(db_rows, key=lambda x: str(x.get("transaction_date", ""))):
        date = r.get("transaction_date", "?")
        desc = r.get("description", "?")
        amt  = r.get("amount", "?")
        direction = r.get("direction", "?")
        src  = r.get("source_file") or "-"
        print(f"  {date}  {direction:6}  ₹{str(amt):>10}  {desc}  [{src}]")

    # Find what's in PDF but not in DB (match by amount string)
    db_amounts = {str(r.get("amount", "")) for r in db_rows}
    missing = [r for r in pdf_rows if str(_pdf_row_fields(r)[2]).replace(",", "") not in db_amounts]

    print("\n" + "=" * 70)
    print(f"IN PDF BUT POSSIBLY MISSING FROM DB ({len(missing)} row(s))")
    print("=" * 70)
    if not missing:
        print("  All PDF transaction amounts are present in DB.")
    for r in missing:
        date, desc, amt = _pdf_row_fields(r)
        print(f"  {date}  ₹{amt:>12}  {desc}")


async def main():
    locked_pdf = download_statement()
    if not locked_pdf:
        sys.exit(1)

    password = await get_password_manager().get_password_for_sender_async(SENDER)
    if not password:
        print(f"   No password on file for sender {SENDER!r} — check the accounts table.")
        sys.exit(1)

    unlocked_pdf = unlock_pdf(locked_pdf, password)
    if not unlocked_pdf:
        sys.exit(1)

    pdf_rows = extract_transactions(unlocked_pdf)
    db_rows = await get_db_transactions()
    compare(pdf_rows, db_rows)


if __name__ == "__main__":
    asyncio.run(main())
