"""
Smoke test for the statement extraction + standardization pipeline.

Mirrors every stage of the actual statement workflow in explicit steps:
  Step 1: PDFPageFilter     — strip non-transaction pages
  Step 2: LandingAI parse() — filtered PDF → markdown + typed chunks
  Step 3: Chunk filter      — keep only chunkTable/table chunks
  Step 4: LandingAI extract() — table markdown → structured table_data string
  Step 5: Markdown parser   — table_data → DataFrame
  Step 6: Save temp CSV     — local only, no GCS upload
  Step 7: Standardizer      — CSV → normalised transaction dicts

Skipped (no side-effects on a test run):
  - PDF unlocking  (pass an already-unlocked PDF)
  - GCS upload
  - Database insert

Usage (run from backend/ on the instance):
    PDF_PATH=/tmp/axis_atlas_20260301.pdf \\
    ACCOUNT_NICKNAME="Axis Atlas Credit Card" \\
    poetry run python scripts/smoke_test_extraction.py
"""

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
# Step 0: imports + environment check
# ---------------------------------------------------------------------------
print("\n=== Step 0: Environment ===")

try:
    from landingai_ade import LandingAIADE
    from landingai_ade.lib import pydantic_to_json_schema
    from src.services.statement_processor.document_extractor import DocumentExtractor
    from src.services.statement_processor.pdf_page_filter import PDFPageFilter
    from src.services.orchestrator.transaction_standardizer import TransactionStandardizer
    from src.utils.filename_utils import nickname_to_filename_prefix
    check("Imports OK", True)
except Exception as e:
    check("Imports OK", False, str(e))
    sys.exit(1)

if not check("PDF exists", pdf_path.exists(), str(pdf_path)):
    sys.exit(1)

api_key = os.environ.get("VISION_AGENT_API_KEY", "")
if not check("VISION_AGENT_API_KEY set", bool(api_key)):
    sys.exit(1)

# Build a partial extractor (schema helpers only — no full __init__ side-effects needed)
extractor = DocumentExtractor.__new__(DocumentExtractor)
extractor.api_key = api_key
extractor.client = LandingAIADE(apikey=api_key)

schema = extractor._get_schema_from_filename(pdf_path.name, account_nickname)
if not check("Schema resolved", schema is not None, f"nickname='{account_nickname}'"):
    sys.exit(1)
info(f"Schema: {schema.__name__}")


# ---------------------------------------------------------------------------
# Step 1: PDFPageFilter — strip non-transaction pages
# ---------------------------------------------------------------------------
print("\n=== Step 1: Page filter ===")

schema_key = extractor._get_schema_key(account_nickname)
page_filter = PDFPageFilter()

try:
    parse_path, kept_pages = page_filter.filter_transaction_pages(pdf_path, schema_key)
    check("Page filter completed", True)
except Exception as e:
    check("Page filter completed", False, str(e))
    sys.exit(1)

if parse_path != pdf_path:
    info(f"Filtered PDF written to: {parse_path}")
    info(f"Pages kept: {[p + 1 for p in kept_pages]}")
else:
    info("No filtering applied (all pages kept or no filter defined for this schema)")


# ---------------------------------------------------------------------------
# Step 2: LandingAI parse() — filtered PDF → markdown + chunks
# ---------------------------------------------------------------------------
print("\n=== Step 2: LandingAI parse ===")

try:
    parse_response = extractor.client.parse(document=parse_path, model="dpt-2-latest")
    check("parse() returned response", parse_response is not None)
    check("parse() has markdown", bool(getattr(parse_response, "markdown", None)),
          f"{len(parse_response.markdown)} chars")
except Exception as e:
    check("parse() completed", False, str(e))
    sys.exit(1)
finally:
    # Clean up filtered PDF if a temp file was created
    if parse_path != pdf_path and parse_path.exists():
        parse_path.unlink()
        info(f"Cleaned up filtered PDF: {parse_path.name}")

chunks = getattr(parse_response, "chunks", None) or []
info(f"Total chunks returned: {len(chunks)}")
chunk_type_counts: dict[str, int] = {}
for c in chunks:
    t = getattr(c, "type", "unknown")
    chunk_type_counts[t] = chunk_type_counts.get(t, 0) + 1
for t, n in sorted(chunk_type_counts.items()):
    info(f"  {t}: {n}")


# ---------------------------------------------------------------------------
# Step 3: Chunk filter — keep only table chunks
# ---------------------------------------------------------------------------
print("\n=== Step 3: Chunk filter ===")

TABLE_CHUNK_TYPES = {"chunkTable", "table"}
table_chunks = [c for c in chunks if getattr(c, "type", "") in TABLE_CHUNK_TYPES]

if check("Table chunks found", len(table_chunks) > 0, f"{len(table_chunks)} chunk(s)"):
    extract_input = "\n\n".join(c.markdown for c in table_chunks)
    info(f"Table markdown: {len(extract_input)} chars (down from {len(parse_response.markdown)} full-doc chars)")
else:
    info("Falling back to full markdown")
    extract_input = parse_response.markdown


# ---------------------------------------------------------------------------
# Step 4: LandingAI extract() — table markdown → structured table_data
# ---------------------------------------------------------------------------
print("\n=== Step 4: LandingAI extract ===")

try:
    schema_json = pydantic_to_json_schema(schema)
    extract_response = extractor.client.extract(
        schema=schema_json,
        markdown=extract_input,
        model="extract-latest",
    )
    check("extract() returned response", extract_response is not None)
except Exception as e:
    check("extract() completed", False, str(e))
    sys.exit(1)

table_data: str = (getattr(extract_response, "extraction", None) or {}).get("table", "")
if not check("table_data non-empty", bool(table_data), f"{len(table_data)} chars"):
    sys.exit(1)
info(f"table_data preview: {table_data[:300].replace(chr(10), ' ')} ...")


# ---------------------------------------------------------------------------
# Step 5: Markdown table → DataFrame
# ---------------------------------------------------------------------------
print("\n=== Step 5: Markdown parser → DataFrame ===")

df = extractor._parse_table_to_dataframe(table_data)

if not check("DataFrame non-empty", not df.empty, f"{len(df)} rows"):
    print(f"\n  Raw table_data:\n{table_data}\n")
    sys.exit(1)

check("Has columns", len(df.columns) > 0, str(list(df.columns)))
info(f"Columns: {list(df.columns)}")
print(f"\n  Raw extracted table (first 5 rows):\n")
print(df.head(5).to_string(index=False))
print()


# ---------------------------------------------------------------------------
# Step 6: Save temp CSV (local only — no GCS upload)
# ---------------------------------------------------------------------------
print("\n=== Step 6: Save temp CSV ===")

tmp_dir = Path(tempfile.mkdtemp())
prefix = nickname_to_filename_prefix(account_nickname)
csv_name = f"{prefix}_smoke.csv"
csv_path = tmp_dir / csv_name
df.to_csv(csv_path, index=False, encoding="utf-8")

check("CSV written", csv_path.exists(), str(csv_path))
info(f"CSV path: {csv_path}")


# ---------------------------------------------------------------------------
# Step 7: Standardize — CSV → normalised transaction dicts
# ---------------------------------------------------------------------------
print("\n=== Step 7: Standardize ===")

standardizer = TransactionStandardizer()
std_df = standardizer.process_csv_file(csv_path)

if not check("Standardized DataFrame non-empty", not std_df.empty, f"{len(std_df)} rows"):
    print("  process_csv_file returned empty — check account nickname routing in process_csv_file()")
    sys.exit(1)

check("Has 'amount' column",    "amount"    in std_df.columns, str(list(std_df.columns)))
check("Has 'direction' column", "direction" in std_df.columns)
check("Has 'date' column",      "date"      in std_df.columns)
if "direction" in std_df.columns:
    unknown_count = (std_df["direction"] == "unknown").sum()
    check("No 'unknown' direction", unknown_count == 0, f"{unknown_count} unknown row(s)")

info(f"Columns: {list(std_df.columns)}")
print(f"\n  Standardized transactions (first 5 rows):\n")
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
