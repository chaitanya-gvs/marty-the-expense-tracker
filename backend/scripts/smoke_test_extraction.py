"""
Smoke test for the statement extraction + standardization pipeline.

Mirrors the exact workflow that runs during statement processing:
  1. LandingAI parse()  — PDF → markdown + typed chunks
  2. Chunk filter       — keep only chunkTable/table chunks
  3. LandingAI extract() — table markdown → structured table_data string
  4. Markdown parser    — table_data → DataFrame
  5. Save temp CSV      — local only, no GCS upload
  6. Standardizer       — CSV → normalised transaction dicts

Skipped (no side-effects on a test run):
  - PDF unlocking  (pass an already-unlocked PDF)
  - GCS upload
  - Database insert

Usage (run from backend/ on the instance):
    PDF_PATH=/tmp/axis_atlas_20260301.pdf \\
    ACCOUNT_NICKNAME="Axis Atlas Credit Card" \\
    poetry run python scripts/smoke_test_extraction.py
"""

import asyncio
import os
import sys
import tempfile
from pathlib import Path

# Project root on path
sys.path.insert(0, str(Path(__file__).parent.parent))

PASS = "\033[92mPASS\033[0m"
FAIL = "\033[91mFAIL\033[0m"
INFO = "\033[94mINFO\033[0m"

_results: list[tuple[str, bool, str]] = []


def check(name: str, condition: bool, detail: str = "") -> bool:
    status = PASS if condition else FAIL
    print(f"  [{status}] {name}" + (f"  ({detail})" if detail else ""))
    _results.append((name, condition, detail))
    return condition


def info(msg: str) -> None:
    print(f"  [{INFO}] {msg}")


# ---------------------------------------------------------------------------
# Resolve inputs
# ---------------------------------------------------------------------------
pdf_path_str = os.environ.get("PDF_PATH", "")
account_nickname = os.environ.get("ACCOUNT_NICKNAME", "")

if not pdf_path_str or not account_nickname:
    print(
        "\nUsage:\n"
        "  PDF_PATH=/path/to/unlocked.pdf \\\n"
        "  ACCOUNT_NICKNAME='Axis Atlas Credit Card' \\\n"
        "  poetry run python scripts/smoke_test_extraction.py\n"
    )
    sys.exit(1)

pdf_path = Path(pdf_path_str)


# ---------------------------------------------------------------------------
# Step 0: imports + API key check
# ---------------------------------------------------------------------------
print("\n=== Step 0: Environment ===")
try:
    from src.services.statement_processor.document_extractor import DocumentExtractor
    from src.services.orchestrator.transaction_standardizer import TransactionStandardizer
    check("Imports OK", True)
except Exception as e:
    check("Imports OK", False, str(e))
    sys.exit(1)

if not check("PDF exists", pdf_path.exists(), str(pdf_path)):
    sys.exit(1)

api_key = os.environ.get("VISION_AGENT_API_KEY") or ""
if not check("VISION_AGENT_API_KEY set", bool(api_key)):
    print("  Set VISION_AGENT_API_KEY in your environment and retry.")
    sys.exit(1)


# ---------------------------------------------------------------------------
# Step 1 + 2 + 3: parse → chunk filter → extract
# ---------------------------------------------------------------------------
print("\n=== Step 1-3: LandingAI parse → chunk filter → extract ===")

extractor = DocumentExtractor()

try:
    extraction = extractor._extract_with_agentic_doc(pdf_path, account_nickname)
except Exception as e:
    check("_extract_with_agentic_doc", False, str(e))
    sys.exit(1)

if not check("Extraction success", extraction.get("success") is True, extraction.get("error", "")):
    sys.exit(1)

table_data: str = extraction.get("table_data", "")
check("table_data non-empty", bool(table_data), f"{len(table_data)} chars")

schema_used = extraction.get("extraction_schema", "?")
kept_pages = extraction.get("kept_pages")
info(f"Schema: {schema_used}")
info(f"Page filter kept: {[p for p in kept_pages] if kept_pages else 'all (fallback)'}")
info(f"table_data preview: {table_data[:300].replace(chr(10), ' ')} ...")


# ---------------------------------------------------------------------------
# Step 4: markdown → DataFrame
# ---------------------------------------------------------------------------
print("\n=== Step 4: Markdown table → DataFrame ===")

df = extractor._parse_table_to_dataframe(table_data)

if not check("DataFrame non-empty", not df.empty, f"{len(df)} rows"):
    print(f"\n  Raw table_data:\n{table_data}\n")
    sys.exit(1)

check("Has columns", len(df.columns) > 0, str(list(df.columns)))
info(f"Columns: {list(df.columns)}")
info(f"Row count: {len(df)}")
print(f"\n  DataFrame preview (first 5 rows):\n")
print(df.head(5).to_string(index=False))
print()


# ---------------------------------------------------------------------------
# Step 5: save temp CSV (local only — no GCS)
# ---------------------------------------------------------------------------
print("\n=== Step 5: Save temp CSV ===")

from src.utils.filename_utils import nickname_to_filename_prefix

tmp_dir = Path(tempfile.mkdtemp())
prefix = nickname_to_filename_prefix(account_nickname)
csv_name = f"{prefix}_smoke.csv"
csv_path = tmp_dir / csv_name
df.to_csv(csv_path, index=False, encoding="utf-8")

check("CSV written", csv_path.exists(), str(csv_path))
info(f"CSV path: {csv_path}")


# ---------------------------------------------------------------------------
# Step 6: standardize (no DB needed — uses filename routing)
# ---------------------------------------------------------------------------
print("\n=== Step 6: Standardize transactions ===")

standardizer = TransactionStandardizer()
std_df = standardizer.process_csv_file(csv_path)

if not check("Standardized DataFrame non-empty", not std_df.empty, f"{len(std_df)} rows"):
    print("  process_csv_file returned empty — check account nickname routing in process_csv_file()")
    sys.exit(1)

check("Has 'amount' column", "amount" in std_df.columns, str(list(std_df.columns)))
check("Has 'direction' column", "direction" in std_df.columns)
check("Has 'date' column", "date" in std_df.columns)
check("No 'unknown' direction", not (std_df.get("direction") == "unknown").any(),
      f"{(std_df['direction'] == 'unknown').sum()} unknown rows" if "direction" in std_df.columns else "")

info(f"Columns: {list(std_df.columns)}")
print(f"\n  Standardized preview (first 5 rows):\n")
print(std_df.head(5).to_string(index=False))
print()


# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
print("\n=== Summary ===")
passed = sum(1 for _, ok, _ in _results if ok)
total = len(_results)
print(f"  {passed}/{total} checks passed")
if passed < total:
    print("  Failed checks:")
    for name, ok, detail in _results:
        if not ok:
            print(f"    - {name}" + (f": {detail}" if detail else ""))
    sys.exit(1)
else:
    print("  All checks passed — pipeline looks healthy.")
