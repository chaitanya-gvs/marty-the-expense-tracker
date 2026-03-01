#!/usr/bin/env python3
"""
Page Filter Diagnostic Script

Downloads every unlocked statement PDF from GCS and runs the PDFPageFilter
in dry-run mode (no Landing AI calls, no filtered PDFs written). Prints a
per-page breakdown showing which pages would be kept or dropped, and why.

Usage (from backend/):
    poetry run python scripts/test_page_filter.py
    poetry run python scripts/test_page_filter.py --prefix 2025-09   # one month only
    poetry run python scripts/test_page_filter.py --schema axis_atlas  # one account only
"""

import argparse
import sys
import tempfile
from pathlib import Path

# Add backend directory to Python path
backend_path = Path(__file__).parent.parent
sys.path.insert(0, str(backend_path))

from src.schemas.extraction import BANK_STATEMENT_MODELS, PAGE_FILTER_CONFIGS
from src.services.cloud_storage.gcs_service import GoogleCloudStorageService
from src.services.statement_processor.pdf_page_filter import PDFPageFilter
from src.utils.logger import get_logger

logger = get_logger(__name__)

# ── helpers ──────────────────────────────────────────────────────────────────

def _schema_key_from_filename(filename: str) -> str | None:
    """
    Derive the schema registry key from an unlocked-statement filename.
    Filenames follow: {account_key}_{credit_card|account}_{YYYYMMDD}_unlocked.pdf
    e.g. axis_atlas_credit_card_20250802_unlocked.pdf  →  axis_atlas
         yes_bank_savings_account_20250904_unlocked.pdf  →  yes_bank_savings
         sbi_savings_account_20251023_unlocked.pdf  →  sbi_savings
    """
    stem = Path(filename).stem  # strip .pdf
    if stem.endswith("_unlocked"):
        stem = stem[:-9]
    # Remove trailing _YYYYMMDD date segment
    parts = stem.rsplit("_", 1)
    if len(parts) == 2 and parts[1].isdigit() and len(parts[1]) == 8:
        stem = parts[0]
    # Remove _credit_card or _account suffix (matches DocumentExtractor._get_schema_key logic)
    if stem.endswith("_credit_card"):
        stem = stem[:-12]
    elif stem.endswith("_account"):
        stem = stem[:-8]
    return stem if stem in BANK_STATEMENT_MODELS else None


def _print_file_report(gcs_path: str, schema_key: str, analyses: list) -> dict:
    """Print per-page analysis for one PDF and return summary stats."""
    filename = Path(gcs_path).name
    total = len(analyses)
    kept = [a for a in analyses if a.kept]
    config = PAGE_FILTER_CONFIGS[schema_key]

    print(f"\n{'='*75}")
    print(f"  {filename}")
    print(f"  schema: {schema_key}  |  {len(kept)}/{total} pages would be sent to Landing AI")
    print(f"{'='*75}")

    for a in analyses:
        status = "KEPT   " if a.kept else "DROPPED"
        decisive = []
        info = []
        # Decisive signals (drove the keep/drop decision)
        if a.matched_column_headers:
            decisive.append(f"col_headers={a.matched_column_headers}")
        if a.matched_required:
            decisive.append(f"required={a.matched_required}")
        # Informational signals (not used for decision)
        if a.has_transaction_table:
            info.append(f"table({a.max_table_cols}col x {a.max_table_rows}row)")
        elif a.max_table_cols:
            info.append(f"table-weak({a.max_table_cols}col x {a.max_table_rows}row)")
        if a.matched_supporting:
            info.append(f"supporting={a.matched_supporting}")
        parts = []
        if decisive:
            parts.append("  ".join(decisive))
        if info:
            parts.append(f"[info: {'  '.join(info)}]")
        detail = "  ".join(parts) if parts else "no signals"
        print(f"  Page {a.display_num:>3}  {status}  {detail}")

    return {
        "gcs_path": gcs_path,
        "schema_key": schema_key,
        "total_pages": total,
        "kept_pages": len(kept),
        "dropped_pages": total - len(kept),
    }


def _print_summary(summaries: list[dict]) -> None:
    print(f"\n{'='*70}")
    print("FINAL SUMMARY")
    print(f"{'='*70}")
    print(f"  {'File':<50} {'Schema':<22} {'Kept':>5} {'Total':>6}")
    print(f"  {'-'*50} {'-'*22} {'-'*5} {'-'*6}")
    total_kept = total_pages = 0
    for s in summaries:
        fname = Path(s["gcs_path"]).name
        print(
            f"  {fname:<50} {s['schema_key']:<22} "
            f"{s['kept_pages']:>5} {s['total_pages']:>6}"
        )
        total_kept += s["kept_pages"]
        total_pages += s["total_pages"]

    if total_pages:
        pct = 100 * total_kept / total_pages
        print(f"\n  TOTAL: {total_kept}/{total_pages} pages kept ({pct:.0f}%)")
        print(f"  Estimated page reduction: {total_pages - total_kept} pages "
              f"({100 - pct:.0f}% savings)")


# ── main ─────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(description="Dry-run page filter against GCS statements")
    parser.add_argument(
        "--prefix",
        default="",
        help="Optional month prefix to narrow down files, e.g. '2025-09'",
    )
    parser.add_argument(
        "--schema",
        default="",
        help="Only test files matching this schema key, e.g. 'axis_atlas'",
    )
    args = parser.parse_args()

    gcs = GoogleCloudStorageService()
    page_filter = PDFPageFilter()

    # The bucket layout is: {YYYY-MM}/unlocked_statements/{filename}_unlocked.pdf
    # List under the month prefix if provided, otherwise list everything.
    gcs_prefix = f"{args.prefix}/" if args.prefix else ""
    logger.info(f"Listing GCS files under prefix: '{gcs_prefix or '(all)'}'")
    all_files = gcs.list_files(prefix=gcs_prefix, max_results=1000)
    pdf_files = [
        f for f in all_files
        if "/unlocked_statements/" in f["name"] and f["name"].endswith(".pdf")
    ]

    if not pdf_files:
        print(f"No PDF files found under '{gcs_prefix}'")
        return

    summaries = []
    skipped = []

    for file_info in pdf_files:
        gcs_path = file_info["name"]
        filename = Path(gcs_path).name
        schema_key = _schema_key_from_filename(filename)

        if schema_key is None:
            skipped.append(gcs_path)
            logger.debug(f"Skipping unrecognized file: {filename}")
            continue

        if args.schema and schema_key != args.schema:
            continue

        if schema_key not in PAGE_FILTER_CONFIGS:
            skipped.append(gcs_path)
            logger.warning(f"No PageFilterConfig for schema '{schema_key}', skipping: {filename}")
            continue

        # Download to a temporary file and run dry-run analysis
        logger.info(f"Downloading: {gcs_path}")
        dl = gcs.download_to_temp_file(gcs_path)
        if not dl.get("success"):
            logger.error(f"Failed to download {gcs_path}: {dl.get('error')}")
            skipped.append(gcs_path)
            continue

        temp_path = Path(dl["temp_path"])
        try:
            analyses = page_filter.analyze_pages(temp_path, schema_key)
            if not analyses:
                logger.warning(f"No page analyses returned for {filename} — skipping")
                skipped.append(gcs_path)
                continue
            summary = _print_file_report(gcs_path, schema_key, analyses)
            summaries.append(summary)
        finally:
            dl["cleanup"]()

    _print_summary(summaries)

    if skipped:
        print(f"\nSkipped {len(skipped)} file(s) (unrecognized schema or download error):")
        for s in skipped:
            print(f"  {s}")


if __name__ == "__main__":
    main()
