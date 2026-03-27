"""
Smoke test for the LandingAI ADE extraction pipeline.

Downloads an unlocked PDF from GCS and runs it through DocumentExtractor
to verify the landingai-ade migration is working correctly.

Usage (from backend/):
    # List available PDFs and pick the most recent
    poetry run python scripts/smoke_extraction.py

    # Use a specific GCS path
    poetry run python scripts/smoke_extraction.py --gcs-path "2025-09/unlocked_statements/yes_bank_savings_20250904_unlocked.pdf"

    # Override account nickname (if auto-detection fails)
    poetry run python scripts/smoke_extraction.py --account "Yes Bank Savings Account"

    # Skip GCS, use a local PDF
    poetry run python scripts/smoke_extraction.py --local-pdf data/statements/unlocked_statements/yes_bank_savings_account_20250904_unlocked.pdf --account "Yes Bank Savings Account"
"""

import argparse
import re
import sys
from io import StringIO
from pathlib import Path

# Ensure backend root is on the path regardless of working directory
backend_root = Path(__file__).parent.parent
sys.path.insert(0, str(backend_root))

import pandas as pd
from dotenv import load_dotenv

load_dotenv(backend_root / "configs/secrets/.env")
load_dotenv(backend_root / "configs/.env")

from src.services.cloud_storage.gcs_service import GoogleCloudStorageService
from src.services.statement_processor.document_extractor import DocumentExtractor
from src.services.statement_processor.schemas import BANK_STATEMENT_MODELS

def _nickname_from_gcs_path(gcs_path: str) -> str:
    """
    Derive a human-readable account nickname from a GCS blob path.

    Example:
        "2025-09/unlocked_statements/yes_bank_savings_20250904_unlocked.pdf"
        → "Yes Bank Savings"

    The result is passed to DocumentExtractor which strips trailing
    " credit card" / " account" before looking up the schema registry.
    """
    filename = Path(gcs_path).stem          # strip .pdf
    if filename.endswith("_unlocked"):
        filename = filename[:-9]            # strip _unlocked

    # Strip trailing date: _YYYYMMDD or _YYYY-MM-DD or _YYYYMM
    filename = re.sub(r'_\d{6,8}$', '', filename)

    # Convert underscores → spaces, title-case
    return filename.replace("_", " ").title()


def _list_unlocked_pdfs(gcs: GoogleCloudStorageService, month_prefix: str = "") -> list[dict]:
    """Return all unlocked PDF blobs, newest first.

    Bucket layout: {YYYY-MM}/unlocked_statements/{filename}_unlocked.pdf
    List under an optional month prefix, then filter by path segment.
    """
    prefix = f"{month_prefix}/" if month_prefix else ""
    blobs = gcs.list_files(prefix=prefix, max_results=1000)
    pdfs = [
        b for b in blobs
        if "/unlocked_statements/" in b["name"] and b["name"].lower().endswith(".pdf")
    ]
    pdfs.sort(key=lambda b: b.get("updated") or b.get("created"), reverse=True)
    return pdfs


def _print_table_preview(table_html: str, max_rows: int = 10) -> None:
    """Parse extracted HTML/markdown table and pretty-print the first N rows."""
    try:
        tables = pd.read_html(StringIO(table_html))
        if not tables:
            print("  (no table rows parsed)")
            return
        df = pd.concat(tables, ignore_index=True).dropna(how="all")
        print(f"\n  Preview (first {min(max_rows, len(df))} of {len(df)} rows):")
        print(df.head(max_rows).to_string(index=False))
    except Exception:
        # Markdown table or unparseable — just print raw
        lines = [l for l in table_html.splitlines() if l.strip()]
        print(f"\n  Raw table preview ({min(max_rows, len(lines))} lines):")
        for line in lines[:max_rows]:
            print(f"    {line}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Smoke-test the landingai-ade extraction pipeline")
    parser.add_argument("--gcs-path", help="Specific GCS blob path to test")
    parser.add_argument("--account", help="Account nickname override (e.g. 'Yes Bank Savings Account')")
    parser.add_argument("--local-pdf", help="Use a local PDF instead of downloading from GCS")
    parser.add_argument("--month", help="Limit search to a specific month prefix (e.g. '2025-09')")
    parser.add_argument("--list", action="store_true", help="List available unlocked PDFs and exit")
    args = parser.parse_args()

    print("=" * 70)
    print("  LandingAI ADE Extraction Smoke Test")
    print("=" * 70)

    # ------------------------------------------------------------------
    # 1. Validate extractor is ready
    # ------------------------------------------------------------------
    extractor = DocumentExtractor()
    if not extractor.api_key:
        print("\nFAIL: VISION_AGENT_API_KEY is not set.")
        return 1
    print(f"\n[OK] VISION_AGENT_API_KEY present")
    print(f"[OK] Available schemas: {', '.join(BANK_STATEMENT_MODELS.keys())}")

    # ------------------------------------------------------------------
    # 2. Determine PDF source
    # ------------------------------------------------------------------
    temp_cleanup = None

    if args.local_pdf:
        pdf_path = Path(args.local_pdf)
        if not pdf_path.exists():
            print(f"\nFAIL: Local PDF not found: {pdf_path}")
            return 1
        account_nickname = args.account or _nickname_from_gcs_path(pdf_path.name)
        print(f"\n[PDF]  {pdf_path}")

    else:
        gcs = GoogleCloudStorageService()

        if args.list or (not args.gcs_path):
            pdfs = _list_unlocked_pdfs(gcs, month_prefix=args.month or "")
            if not pdfs:
                print("\nFAIL: No unlocked PDFs found in bucket.")
                return 1

            print(f"\nAvailable unlocked PDFs ({len(pdfs)} total):")
            for i, b in enumerate(pdfs[:20]):
                updated = (b.get("updated") or b.get("created") or "").strftime("%Y-%m-%d") if hasattr(b.get("updated") or b.get("created"), "strftime") else str(b.get("updated") or b.get("created") or "")
                size_kb = (b["size"] or 0) // 1024
                print(f"  [{i:2d}] {b['name']}  ({size_kb} KB, {updated})")

            if args.list:
                return 0

            # Auto-pick most recent
            chosen = pdfs[0]
            print(f"\n[AUTO] Selected most recent: {chosen['name']}")
            gcs_path = chosen["name"]
        else:
            gcs_path = args.gcs_path

        account_nickname = args.account or _nickname_from_gcs_path(gcs_path)

        # Download to temp file
        print(f"\n[GCS]  Downloading: {gcs_path}")
        result = gcs.download_to_temp_file(gcs_path)
        if not result.get("success"):
            print(f"\nFAIL: GCS download failed — {result.get('error')}")
            return 1

        pdf_path = Path(result["temp_path"])
        temp_cleanup = result.get("cleanup")
        size_kb = result["size"] // 1024
        print(f"[OK]   Downloaded ({size_kb} KB) → {pdf_path}")

    # ------------------------------------------------------------------
    # 3. Run extraction
    # ------------------------------------------------------------------
    print(f"\n[ACCT] Account nickname : '{account_nickname}'")

    # Validate schema mapping before spending API credits
    schema = extractor._map_nickname_to_schema(account_nickname)
    if schema is None:
        print(f"\nFAIL: No schema found for nickname '{account_nickname}'.")
        print(f"      Available keys: {', '.join(BANK_STATEMENT_MODELS.keys())}")
        print(f"      Try --account 'Yes Bank Savings Account' (or whichever bank this PDF is for)")
        if temp_cleanup:
            temp_cleanup()
        return 1

    print(f"[OK]   Schema matched  : {schema.__name__}")
    print(f"\n[...] Starting extraction (this may take 30-90s) ...")

    try:
        result = extractor.extract_from_pdf(
            pdf_path=str(pdf_path),
            account_nickname=account_nickname,
            save_results=False,  # smoke test — don't write files or upload to GCS
        )
    finally:
        if temp_cleanup:
            temp_cleanup()

    # ------------------------------------------------------------------
    # 4. Report results
    # ------------------------------------------------------------------
    print("\n" + "=" * 70)
    if result.get("success"):
        table_data = result.get("table_data", "")
        kept_pages = result.get("kept_pages")
        print(f"  PASS — Extraction succeeded")
        print(f"  Schema        : {result.get('extraction_schema')}")
        print(f"  Table chars   : {len(table_data)}")
        if kept_pages is not None:
            print(f"  Pages kept    : {kept_pages}")
        if result.get("page_filter_fallback"):
            print(f"  Page filter   : fallback (all pages used)")
        _print_table_preview(table_data)
    else:
        print(f"  FAIL — Extraction failed")
        print(f"  Error: {result.get('error')}")
        return 1

    print("=" * 70)
    return 0


if __name__ == "__main__":
    sys.exit(main())
