"""
Smoke test for the LandingAI document extraction pipeline.

Tests two things:
  1. (Offline) _parse_table_to_dataframe — no API key needed.
     Covers a typical Axis Atlas-style markdown table, a table with a
     separator row, and a ragged table where rows have different widths.

  2. (Live, optional) Full extract_from_pdf against a real PDF on the instance.
     Only runs when PDF_PATH env var is set and VISION_AGENT_API_KEY is present.

Usage:
    # Offline only (fast, no API calls):
    poetry run python scripts/smoke_test_extraction.py

    # Include live API extraction:
    PDF_PATH=/path/to/statement.pdf poetry run python scripts/smoke_test_extraction.py
"""

import os
import sys
from pathlib import Path

# Make sure project root is on the path
sys.path.insert(0, str(Path(__file__).parent.parent))

import pandas as pd

PASS = "\033[92mPASS\033[0m"
FAIL = "\033[91mFAIL\033[0m"

_results: list[tuple[str, bool, str]] = []


def check(name: str, condition: bool, detail: str = "") -> None:
    status = PASS if condition else FAIL
    print(f"  [{status}] {name}" + (f" — {detail}" if detail else ""))
    _results.append((name, condition, detail))


# ---------------------------------------------------------------------------
# 1. Import the extractor (no API call yet)
# ---------------------------------------------------------------------------
print("\n=== Import ===")
try:
    from src.services.statement_processor.document_extractor import DocumentExtractor
    extractor = DocumentExtractor.__new__(DocumentExtractor)  # skip __init__ (no API key needed)
    check("DocumentExtractor importable", True)
except Exception as e:
    check("DocumentExtractor importable", False, str(e))
    sys.exit(1)


# ---------------------------------------------------------------------------
# 2. _parse_table_to_dataframe — offline unit checks
# ---------------------------------------------------------------------------
print("\n=== _parse_table_to_dataframe (offline) ===")

# 2a. Typical Axis Atlas credit card table
AXIS_ATLAS = """\
| Date | Transaction Details | Reward Points | Amount (₹) |
|------|---------------------|---------------|------------|
| 01 Mar 2026 | AMAZON PAY | 50 | 500.00 |
| 05 Mar 2026 | UBER AUTO | 10 | 98.00 |
| 10 Mar 2026 | SWIGGY ORDER | 25 | 245.50 |
"""

df = extractor._parse_table_to_dataframe(AXIS_ATLAS)
check("Axis Atlas: non-empty", not df.empty)
check("Axis Atlas: 3 data rows", len(df) == 3, f"got {len(df)}")
check("Axis Atlas: 4 columns", len(df.columns) == 4, f"got {list(df.columns)}")
check("Axis Atlas: Date column present", "Date" in df.columns)
check("Axis Atlas: Amount column present", any("Amount" in c for c in df.columns))

# 2b. Table with no surrounding pipes (some LandingAI variants omit leading |)
NO_OUTER_PIPES = """\
Date | Description | Debit | Credit
---- | ----------- | ----- | ------
02 Mar 2026 | NEFT TRF | 1000.00 |
08 Mar 2026 | SALARY | | 50000.00
"""

df2 = extractor._parse_table_to_dataframe(NO_OUTER_PIPES)
check("No-outer-pipes: non-empty", not df2.empty)
check("No-outer-pipes: 2 data rows", len(df2) == 2, f"got {len(df2)}")

# 2c. Ragged rows (columns count mismatch — should be padded)
RAGGED = """\
| Date | Details | Amount |
|------|---------|--------|
| 01 Jan | Opening Balance |
| 15 Jan | ATM Withdrawal | 2000.00 |
"""

df3 = extractor._parse_table_to_dataframe(RAGGED)
check("Ragged: non-empty", not df3.empty)
check("Ragged: 2 data rows", len(df3) == 2, f"got {len(df3)}")
check("Ragged: 3 columns", len(df3.columns) == 3, f"got {list(df3.columns)}")

# 2d. Empty / garbage input should return empty DataFrame without raising
df4 = extractor._parse_table_to_dataframe("no table here at all")
check("Garbage input: returns empty DF", df4.empty)

df5 = extractor._parse_table_to_dataframe("")
check("Empty string: returns empty DF", df5.empty)

# 2e. Single-column degenerate table (only header row) → empty
ONLY_HEADER = "| Date |\n|------|\n"
df6 = extractor._parse_table_to_dataframe(ONLY_HEADER)
check("Header-only table: returns empty DF", df6.empty)


# ---------------------------------------------------------------------------
# 3. Live API test (optional — requires PDF_PATH env var + API key)
# ---------------------------------------------------------------------------
pdf_path = os.environ.get("PDF_PATH")
if pdf_path:
    print(f"\n=== Live extraction: {pdf_path} ===")
    try:
        # Full __init__ needed here to set up the API client
        live_extractor = DocumentExtractor()
        if not getattr(live_extractor, 'api_key', None):
            check("API key present", False, "VISION_AGENT_API_KEY not set")
        else:
            check("API key present", True)
            account_nickname = os.environ.get("ACCOUNT_NICKNAME", "Axis Atlas Credit Card")
            result = live_extractor.extract_from_pdf(
                pdf_path=pdf_path,
                account_nickname=account_nickname,
                save_results=False,
            )
            check("Extraction success flag", result.get("success") is True, result.get("error", ""))
            if result.get("success"):
                table_data = result.get("table_data", "")
                check("table_data non-empty", bool(table_data), f"{len(table_data)} chars")
                if table_data:
                    df_live = live_extractor._parse_table_to_dataframe(table_data)
                    check("Live DataFrame non-empty", not df_live.empty, f"{len(df_live)} rows")
                    check("Live DataFrame has columns", len(df_live.columns) > 0, str(list(df_live.columns)))
                    if not df_live.empty:
                        print(f"\n  Preview (first 3 rows):\n{df_live.head(3).to_string(index=False)}\n")
    except Exception as e:
        check("Live extraction (no exception)", False, str(e))
else:
    print("\n=== Live extraction: SKIPPED (set PDF_PATH env var to enable) ===")


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
    print("  All checks passed.")
