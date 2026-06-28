#!/usr/bin/env python3
"""
Validate extraction schema changes against reference CSVs stored in GCS.

Compares new extraction output (using updated schemas + standardizers) against
the existing CSVs from the last successful ingestion run. Reports per-account
row counts and any skipped rows.

Usage (from backend/):
    poetry run python scripts/validate_extraction.py [--month 2026-05]

Exit 0: all accounts pass (new row count >= reference row count)
Exit 1: regression detected in at least one account
"""
import argparse
import sys
import tempfile
from datetime import datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import pandas as pd

from src.services.cloud_storage.gcs_service import GoogleCloudStorageService
from src.services.statement_processor.document_extractor import DocumentExtractor

# Maps schema key → account nickname (reverse of nickname_to_schema_key)
_KEY_TO_NICKNAME = {
    "amazon_pay_icici": "Amazon Pay ICICI Credit Card",
    "axis_atlas": "Axis Atlas Credit Card",
    "cashback_sbi": "Cashback SBI Credit Card",
    "swiggy_hdfc": "Swiggy HDFC Credit Card",
    "sbi_savings": "SBI Savings Account",
    "yes_bank_savings": "Yes Bank Savings Account",
    "axis_bank_savings": "Axis Bank Savings Account",
}


def _previous_month(ref: datetime = None) -> str:
    ref = ref or datetime.now()
    first = ref.replace(day=1)
    prev = first - timedelta(days=1)
    return prev.strftime("%Y-%m")


def _schema_key_from_csv_stem(stem: str) -> str:
    """e.g. 'amazon_pay_icici_20260503' → 'amazon_pay_icici'"""
    parts = stem.split("_")
    if parts and parts[-1].isdigit() and len(parts[-1]) == 8:
        parts = parts[:-1]
    return "_".join(parts)


def validate(month: str) -> bool:
    """Run validation. Returns True if no regressions."""
    print(f"\nValidating extraction for {month}")
    print("=" * 60)

    gcs = GoogleCloudStorageService()
    extractor = DocumentExtractor()

    if not extractor.api_key:
        print("ERROR: VISION_AGENT_API_KEY not set — cannot run extraction")
        return False

    from src.services.orchestrator.transaction_standardizer import TransactionStandardizer
    standardizer = TransactionStandardizer()

    ref_csvs = [
        f for f in gcs.list_files(f"{month}/extracted_data/")
        if f.get("name", "").endswith(".csv") and "splitwise" not in f.get("name", "")
    ]
    unlocked_pdfs = [
        f for f in gcs.list_files(f"{month}/unlocked_statements/")
        if f.get("name", "").endswith("_unlocked.pdf")
    ]

    if not ref_csvs:
        print(f"No reference CSVs found in GCS for {month}. Nothing to validate.")
        return True

    print(f"Reference CSVs: {len(ref_csvs)}   Unlocked PDFs: {len(unlocked_pdfs)}\n")

    regressions = []

    for ref_info in ref_csvs:
        ref_stem = Path(ref_info["name"]).stem  # e.g. "amazon_pay_icici_20260503"
        schema_key = _schema_key_from_csv_stem(ref_stem)
        nickname = _KEY_TO_NICKNAME.get(schema_key)

        if not nickname:
            print(f"  {ref_stem}: SKIP (no nickname mapping for key '{schema_key}')")
            continue

        # Find matching unlocked PDF (stem without date suffix matches)
        pdf_match = next(
            (p for p in unlocked_pdfs if schema_key in p["name"]),
            None,
        )
        if not pdf_match:
            print(f"  {ref_stem}: SKIP (no unlocked PDF found)")
            continue

        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)

            # Download reference CSV
            ref_csv = tmp_path / "ref.csv"
            dl = gcs.download_file(ref_info["name"], str(ref_csv))
            if not dl.get("success"):
                print(f"  {ref_stem}: SKIP (CSV download failed: {dl.get('error')})")
                continue
            old_df = pd.read_csv(ref_csv)
            old_count = len(old_df)

            # Download unlocked PDF
            pdf_name = Path(pdf_match["name"]).name
            pdf_path = tmp_path / pdf_name
            dl = gcs.download_file(pdf_match["name"], str(pdf_path))
            if not dl.get("success"):
                print(f"  {ref_stem}: SKIP (PDF download failed: {dl.get('error')})")
                continue

            # Extract with updated schema
            try:
                result = extractor.extract_from_pdf(
                    str(pdf_path), account_nickname=nickname, save_results=False
                )
            except Exception as e:
                print(f"  {ref_stem}: ERROR during extraction — {e}")
                regressions.append(ref_stem)
                continue

            if not result.get("success"):
                print(f"  {ref_stem}: EXTRACTION FAILED — {result.get('error')}")
                regressions.append(ref_stem)
                continue

            # Parse extracted table
            raw_df = extractor._parse_table_to_dataframe(result["table_data"])
            if raw_df.empty:
                print(f"  {ref_stem}: REGRESSION — extraction returned empty table (old={old_count})")
                regressions.append(ref_stem)
                continue

            # Standardize
            method_name = f"process_{schema_key}"
            if not hasattr(standardizer, method_name):
                print(f"  {ref_stem}: SKIP (no standardizer method '{method_name}')")
                continue

            new_df = getattr(standardizer, method_name)(raw_df, f"{ref_stem}.csv")
            valid_rows = new_df[new_df["_skip_reason"].isna()] if "_skip_reason" in new_df.columns else new_df
            skipped_rows = new_df[new_df["_skip_reason"].notna()] if "_skip_reason" in new_df.columns else pd.DataFrame()

            new_count = len(valid_rows)
            skip_count = len(skipped_rows)
            status = "✓" if new_count >= old_count else "✗ REGRESSION"

            print(f"  {ref_stem}: OLD={old_count}  NEW={new_count} {status}  skipped={skip_count}")

            if not skipped_rows.empty:
                for _, sr in skipped_rows.iterrows():
                    print(f"    SKIPPED reason={sr['_skip_reason']} partial_date={sr.get('_partial_date_raw')} raw={sr.get('raw_data', {})}")

            if new_count < old_count:
                regressions.append(ref_stem)

    print()
    if regressions:
        print(f"REGRESSIONS detected in {len(regressions)} account(s): {regressions}")
        return False
    else:
        print("All accounts pass ✓")
        return True


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--month", help="Month to validate (YYYY-MM), default = previous month")
    args = parser.parse_args()
    month = args.month or _previous_month()
    passed = validate(month)
    sys.exit(0 if passed else 1)


if __name__ == "__main__":
    main()
