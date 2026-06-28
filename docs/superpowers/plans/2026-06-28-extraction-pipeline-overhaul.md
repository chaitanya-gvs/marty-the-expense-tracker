# Extraction Pipeline Overhaul — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the June 2026 ingestion failures (Amazon Pay ICICI 0 rows, 243-row bulk insert crash, false `db_inserted` status), redesign extraction schemas for all accounts, add per-row validation with full SSE/log/summary reporting.

**Architecture:** Changes flow extraction-first → standardizer-second → infrastructure-last, gated by a manual validation script after Task 5. The `_skip_reason` column is the key mechanism: standardizers emit it, `bulk_insert_transactions` filters on it, `statement_workflow` reports it via SSE. No new DB tables or columns.

**Tech Stack:** Python 3.12, FastAPI, SQLAlchemy 2.0 async, PostgreSQL, LandingAI ADE ≥ 1.12.0, PyMuPDF (fitz), pandas, pydantic v2, pytest

## Global Constraints

- All work on branch `feat/extraction-pipeline-overhaul` — no direct pushes to main
- Run all backend commands from `backend/` directory
- `landingai-ade` bumped to `>=1.12.0`
- `PAGE_FILTER_STRATEGY` default = `"compare"` (runs both strategies, uses PyMuPDF result)
- Three universal skip guards: `null_date`, `null_description`, `zero_amount` — applied in every `process_*` method
- `_skip_reason` rows are never inserted into DB; reported via log WARNING + SSE + job summary only
- No new DB columns or tables
- Spec: `docs/superpowers/specs/2026-06-28-extraction-pipeline-overhaul-design.md`

---

## File Structure

| File | Action |
|------|--------|
| `backend/pyproject.toml` | Modify — bump `landingai-ade` |
| `backend/src/services/statement_processor/schemas.py` | Modify — rewrite all 7 extraction schemas |
| `backend/src/services/statement_processor/pdf_page_filter.py` | Modify — refactor into `_filter_with_pymupdf`, add `_filter_with_classify`, `_filter_with_compare`, `_write_filtered_pdf` |
| `backend/src/services/statement_processor/document_extractor.py` | Modify — pass `self.client` to page filter |
| `backend/src/services/orchestrator/transaction_standardizer.py` | Modify — add `_make_skip_row`, rewrite all 7 `process_*` methods |
| `backend/src/services/orchestrator/data_standardizer_helper.py` | Modify — remove premature `db_inserted` mark, separate valid/flagged rows before dedup, return `(data, valid_csv_keys)` |
| `backend/src/services/database_manager/operations/transaction_operations.py` | Modify — split on `_skip_reason` at top of `bulk_insert_transactions`, log warnings, return `validation_skipped_rows` |
| `backend/src/services/orchestrator/statement_workflow.py` | Modify — unpack helper tuple, emit SSE per skipped row, post-insert `db_inserted` marking, update `workflow_complete` |
| `backend/scripts/validate_extraction.py` | Create — manual validation gate |
| `backend/tests/test_pdf_page_filter.py` | Create — unit tests for page filter strategies |
| `backend/tests/test_transaction_standardizer.py` | Create — unit tests for `_skip_reason` guards and per-account fixes |

---

## Task 1: Feature Branch + SDK Bump

**Files:**
- Modify: `backend/pyproject.toml:32`

**Interfaces:**
- Produces: `feat/extraction-pipeline-overhaul` branch with `landingai-ade >=1.12.0`

- [ ] **Step 1: Create feature branch**

```bash
git checkout -b feat/extraction-pipeline-overhaul
```

- [ ] **Step 2: Bump SDK version in `pyproject.toml`**

Change line 32 from:
```toml
landingai-ade = ">=1.9.0"
```
to:
```toml
landingai-ade = ">=1.12.0"
```

- [ ] **Step 3: Install and verify**

```bash
cd backend
poetry install
poetry run python -c "import landingai_ade; print(landingai_ade.__version__)"
```

Expected: version ≥ 1.12.0 printed with no import error.

- [ ] **Step 4: Commit**

```bash
git add backend/pyproject.toml backend/poetry.lock
git commit -m "chore: bump landingai-ade to >=1.12.0"
```

---

## Task 2: Extraction Schema Redesign

**Files:**
- Modify: `backend/src/services/statement_processor/schemas.py`

**Interfaces:**
- Produces: All 7 `BaseModel` classes with exact ASCII-safe column specs; `PAGE_FILTER_CONFIGS` unchanged; `BANK_STATEMENT_MODELS` dict unchanged

- [ ] **Step 1: Replace all 7 schema class bodies**

Replace the entire block of schema classes (everything before `BANK_STATEMENT_MODELS`) with the following. Leave `PageFilterConfig`, `PAGE_FILTER_CONFIGS`, and `BANK_STATEMENT_MODELS` unchanged.

```python
class AxisAtlasCreditCard(BaseModel):
    table: str = Field(description=(
        "Extract the Transaction Details table as markdown with EXACTLY these 3 columns in this order: "
        "'DATE', 'TRANSACTION DETAILS', 'AMOUNT (Rs.)'. "
        "'DATE' = transaction date in DD/MM/YYYY format. "
        "'TRANSACTION DETAILS' = full transaction description. "
        "'AMOUNT (Rs.)' = amount followed by Cr or Dr (e.g. '1000.00 Cr', '500.00 Dr'). "
        "Do NOT include the Merchant Category column. "
        "Skip summary rows, opening/closing balance rows, and rows without a valid date."
    ))


class SwiggyHDFCCreditCard(BaseModel):
    table: str = Field(description=(
        "Extract the Domestic Transactions table as markdown with EXACTLY these 4 columns in this order: "
        "'Date', 'Time', 'Transaction Description', 'Amount (INR)'. "
        "'Date' = date in DD/MM/YYYY format. "
        "'Time' = time in HH:MM format (use 00:00 if not available). "
        "'Transaction Description' = full transaction description. "
        "'Amount (INR)' = amount with sign prefix: '+ 1000.00' for credits, '- 500.00' for debits. "
        "Do NOT combine date and time into one column."
    ))


class AmazonPayICICICreditCard(BaseModel):
    table: str = Field(description=(
        "Extract the Transaction Details table as markdown with EXACTLY these 4 columns in this order: "
        "'Date', 'SerNo', 'Transaction Details', 'Amount (INR)'. "
        "'Date' = transaction date in DD/MM/YYYY format. "
        "'SerNo' = serial/reference number. "
        "'Transaction Details' = full transaction description. "
        "'Amount (INR)' = amount followed by Cr or Dr (e.g. '1000.00 Cr', '500.00 Dr'). "
        "Do NOT include Reward Points or Intl. Amount columns. "
        "Skip summary rows, opening/closing balance rows, and rows without a valid date."
    ))


class CashbackSBICreditCard(BaseModel):
    table: str = Field(description=(
        "Extract the transaction table as markdown with EXACTLY these 3 columns in this order: "
        "'Date', 'Transaction Details', 'Amount (INR)'. "
        "'Date' = transaction date in DD Mon YY format (e.g. '01 May 26'). "
        "'Transaction Details' = full transaction description. "
        "'Amount (INR)' = amount followed by Cr or Dr (e.g. '1548.00 Cr', '299.00 Dr'). "
        "Include ONLY rows that have a valid date and a non-zero amount. "
        "Do NOT include section headers, summary rows, or rows where Date contains text instead of a date."
    ))


class SBISavingsAccount(BaseModel):
    table: str = Field(description=(
        "Extract the account statement transaction table as markdown with EXACTLY these 3 columns in this order: "
        "'Date', 'Description', 'Amount'. "
        "'Date' = transaction date. "
        "'Description' = full transaction narration including UPI/NEFT/IMPS reference codes. "
        "'Amount' = transaction amount as a positive number. "
        "Do NOT include Ref No., Chq. No., Debit, Credit, Withdrawal, Deposit, or Balance columns. "
        "Skip opening balance, closing balance, summary, and total rows. Include all transaction rows."
    ))


class YesBankSavingsAccount(BaseModel):
    table: str = Field(description=(
        "Extract the account statement transaction table as markdown with EXACTLY these 4 columns in this order: "
        "'Date', 'Description', 'Withdrawals', 'Deposits'. "
        "'Date' = transaction date. "
        "'Description' = full transaction narration. "
        "'Withdrawals' = amount debited (money going out); use 0.00 if not a debit. "
        "'Deposits' = amount credited (money coming in); use 0.00 if not a credit. "
        "Do NOT include Value Date, Cheque No, Reference No, Running Balance, or Balance columns. "
        "Skip opening balance, closing balance, summary rows, and rows where both Withdrawals and Deposits are 0. "
        "Include all transaction rows."
    ))


class AxisBankSavingsAccount(BaseModel):
    table: str = Field(description=(
        "Extract the account statement transaction table as markdown with EXACTLY these 5 columns in this order: "
        "'Date', 'Transaction Details', 'Chq No', 'Withdrawal', 'Deposits'. "
        "'Date' = transaction date in DD/MM/YYYY format. "
        "'Transaction Details' = full transaction description. "
        "'Chq No' = cheque number or reference (empty string if not applicable). "
        "'Withdrawal' = amount debited as a positive number (empty if not a debit). "
        "'Deposits' = amount credited as a positive number (empty if not a credit). "
        "Skip opening balance, closing balance, and summary rows. Include all transaction rows."
    ))
```

- [ ] **Step 2: Verify the module loads cleanly**

```bash
cd backend
poetry run python -c "from src.services.statement_processor.schemas import BANK_STATEMENT_MODELS; print(list(BANK_STATEMENT_MODELS.keys()))"
```

Expected: `['axis_atlas', 'swiggy_hdfc', 'amazon_pay_icici', 'cashback_sbi', 'yes_bank_savings', 'axis_bank_savings', 'sbi_savings']` with no error.

- [ ] **Step 3: Commit**

```bash
git add backend/src/services/statement_processor/schemas.py
git commit -m "feat(schemas): redesign all 7 extraction schemas with exact ASCII-safe column specs"
```

---

## Task 3: PDF Page Filter — Classify + Compare Strategies

**Files:**
- Modify: `backend/src/services/statement_processor/pdf_page_filter.py`
- Create: `backend/tests/test_pdf_page_filter.py`

**Interfaces:**
- Produces: `PDFPageFilter.filter_transaction_pages(pdf_path, schema_key, ade_client=None)` — same signature as before, plus optional `ade_client`; reads `PAGE_FILTER_STRATEGY` env var internally
- `_filter_with_pymupdf(pdf_path, schema_key)` → `Tuple[Path, List[int]]` (extracted from current `filter_transaction_pages`)
- `_write_filtered_pdf(source_path, kept_indices)` → `Path`

- [ ] **Step 1: Write failing tests**

Create `backend/tests/test_pdf_page_filter.py`:

```python
"""Unit tests for PDFPageFilter strategy routing."""
import os
import fitz
import pytest
from pathlib import Path
from unittest.mock import MagicMock, patch

from src.services.statement_processor.pdf_page_filter import PDFPageFilter


class _MockPage:
    def __init__(self, page_num: int, category: str):
        self.page_num = page_num
        self.category = category


class _MockClassifyResponse:
    def __init__(self, pages):
        self.pages = pages


@pytest.fixture
def two_page_pdf(tmp_path):
    """Minimal 2-page PDF for testing."""
    p = tmp_path / "test.pdf"
    doc = fitz.open()
    doc.new_page()
    doc.new_page()
    doc.save(str(p))
    doc.close()
    return p


def _classify_client(kept_indices):
    """Return a mock ADE client whose classify() says the given pages are transaction pages."""
    client = MagicMock()
    all_pages = [
        _MockPage(i, "transaction_page" if i in kept_indices else "non_transaction_page")
        for i in range(2)
    ]
    client.classify.return_value = _MockClassifyResponse(all_pages)
    return client


def test_classify_strategy_uses_ade_client(two_page_pdf):
    client = _classify_client([0])
    with patch.dict(os.environ, {"PAGE_FILTER_STRATEGY": "classify"}):
        result_path, kept = PDFPageFilter().filter_transaction_pages(
            two_page_pdf, "axis_atlas", ade_client=client
        )
    client.classify.assert_called_once()
    assert kept == [0]
    assert result_path != two_page_pdf  # filtered PDF written


def test_classify_strategy_falls_back_when_zero_pages_returned(two_page_pdf):
    client = _classify_client([])  # all non-transaction
    with patch.dict(os.environ, {"PAGE_FILTER_STRATEGY": "classify"}):
        result_path, kept = PDFPageFilter().filter_transaction_pages(
            two_page_pdf, "axis_atlas", ade_client=client
        )
    # Fallback to pymupdf — no config for this test pdf, returns full pdf
    assert result_path == two_page_pdf


def test_classify_strategy_falls_back_on_exception(two_page_pdf):
    client = MagicMock()
    client.classify.side_effect = RuntimeError("API error")
    with patch.dict(os.environ, {"PAGE_FILTER_STRATEGY": "classify"}):
        result_path, kept = PDFPageFilter().filter_transaction_pages(
            two_page_pdf, "axis_atlas", ade_client=client
        )
    assert result_path == two_page_pdf  # fallback to pymupdf → full pdf (no config)


def test_compare_strategy_calls_classify_but_uses_pymupdf_result(two_page_pdf):
    client = _classify_client([0])
    with patch.dict(os.environ, {"PAGE_FILTER_STRATEGY": "compare"}):
        result_path, kept = PDFPageFilter().filter_transaction_pages(
            two_page_pdf, "axis_atlas", ade_client=client
        )
    # classify was called for comparison logging
    client.classify.assert_called_once()
    # but pymupdf result is used (no config → full pdf)
    assert result_path == two_page_pdf


def test_pymupdf_strategy_never_calls_ade(two_page_pdf):
    client = MagicMock()
    with patch.dict(os.environ, {"PAGE_FILTER_STRATEGY": "pymupdf"}):
        PDFPageFilter().filter_transaction_pages(two_page_pdf, "axis_atlas", ade_client=client)
    client.classify.assert_not_called()


def test_default_strategy_is_compare_when_no_env(two_page_pdf):
    """Default strategy is 'compare' — classify IS called even with no explicit env var."""
    client = _classify_client([0])
    env = {k: v for k, v in os.environ.items() if k != "PAGE_FILTER_STRATEGY"}
    with patch.dict(os.environ, env, clear=True):
        PDFPageFilter().filter_transaction_pages(two_page_pdf, "axis_atlas", ade_client=client)
    client.classify.assert_called_once()


def test_no_ade_client_falls_through_to_pymupdf_even_in_classify_mode(two_page_pdf):
    """If no client is provided but strategy=classify, falls back to pymupdf silently."""
    with patch.dict(os.environ, {"PAGE_FILTER_STRATEGY": "classify"}):
        result_path, kept = PDFPageFilter().filter_transaction_pages(
            two_page_pdf, "axis_atlas", ade_client=None
        )
    assert result_path == two_page_pdf
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd backend
poetry run pytest tests/test_pdf_page_filter.py -v 2>&1 | head -30
```

Expected: all 7 tests FAIL or ERROR (method doesn't exist yet).

- [ ] **Step 3: Refactor `pdf_page_filter.py`**

Replace the entire body of `PDFPageFilter` with the following (keep the module docstring, imports, and `PageAnalysis` dataclass unchanged):

```python
class PDFPageFilter:
    """
    Filters PDF pages to include only those containing transaction data.

    Strategy is controlled by the PAGE_FILTER_STRATEGY environment variable:
      "pymupdf"  — keyword/table detection via PyMuPDF (default fallback)
      "classify" — LandingAI ADE classify() API; falls back to pymupdf on failure
      "compare"  — runs both, logs the comparison, uses pymupdf result (default)

    Main entry points:
      analyze_pages()            — dry-run, returns PageAnalysis per page
      filter_transaction_pages() — returns (filtered_pdf_path, kept_page_indices)
    """

    # ------------------------------------------------------------------ #
    # Internal helpers                                                     #
    # ------------------------------------------------------------------ #

    def _detect_transaction_table(
        self, page: fitz.Page, config: PageFilterConfig
    ) -> Tuple[bool, int, int]:
        """PyMuPDF structural table detection. Returns (has_table, max_cols, max_rows)."""
        try:
            table_finder = page.find_tables()
            max_cols, max_rows = 0, 0
            for table in table_finder.tables:
                cols = len(table.header.names)
                rows = max(0, len(table.rows) - 1)
                if cols > max_cols:
                    max_cols = cols
                if rows > max_rows:
                    max_rows = rows
            qualifies = max_cols >= config.min_table_cols and max_rows >= config.min_table_rows
            return qualifies, max_cols, max_rows
        except Exception:
            logger.debug("find_tables() failed — skipping table detection", exc_info=True)
            return False, 0, 0

    def _score_page(self, page: fitz.Page, config: PageFilterConfig) -> PageAnalysis:
        """Score a single page using column headers and required keywords."""
        text = page.get_text().lower()
        matched_col_headers = [h for h in config.column_headers if h in text]
        col_header_hit = len(matched_col_headers) >= config.min_column_header_matches
        matched_required = [kw for kw in config.required_keywords if kw in text]
        has_table, max_cols, max_rows = self._detect_transaction_table(page, config)
        matched_supporting = [kw for kw in config.supporting_keywords if kw in text]
        kept = col_header_hit or bool(matched_required)
        return PageAnalysis(
            page_num=0,
            kept=kept,
            matched_column_headers=matched_col_headers,
            matched_required=matched_required,
            has_transaction_table=has_table,
            max_table_cols=max_cols,
            max_table_rows=max_rows,
            matched_supporting=matched_supporting,
        )

    def _write_filtered_pdf(self, source_path: Path, kept_indices: List[int]) -> Path:
        """Write a new PDF containing only the pages at kept_indices."""
        filtered_path = source_path.with_name(f"{source_path.stem}_filtered.pdf")
        src = fitz.open(str(source_path))
        dst = fitz.open()
        try:
            for idx in kept_indices:
                dst.insert_pdf(src, from_page=idx, to_page=idx)
            dst.save(str(filtered_path))
        finally:
            src.close()
            dst.close()
        return filtered_path

    # ------------------------------------------------------------------ #
    # Public dry-run                                                       #
    # ------------------------------------------------------------------ #

    def analyze_pages(self, pdf_path: Path, schema_key: str) -> List[PageAnalysis]:
        """Dry-run: score every page and return analysis without writing any file."""
        config = PAGE_FILTER_CONFIGS.get(schema_key)
        if config is None:
            logger.warning(f"No PageFilterConfig for '{schema_key}' — skipping analysis")
            return []
        try:
            doc = fitz.open(str(pdf_path))
        except Exception:
            logger.error(f"Could not open PDF: {pdf_path}", exc_info=True)
            return []
        analyses: List[PageAnalysis] = []
        try:
            for i in range(len(doc)):
                page = doc.load_page(i)
                analysis = self._score_page(page, config)
                analysis.page_num = i
                analyses.append(analysis)
        finally:
            doc.close()
        kept_count = sum(1 for a in analyses if a.kept)
        logger.info(f"PyMuPDF page analysis '{schema_key}' ({pdf_path.name}): {kept_count}/{len(analyses)} kept")
        return analyses

    # ------------------------------------------------------------------ #
    # Strategy implementations                                            #
    # ------------------------------------------------------------------ #

    def _filter_with_pymupdf(self, pdf_path: Path, schema_key: str) -> Tuple[Path, List[int]]:
        """PyMuPDF keyword/table strategy — the original implementation."""
        config = PAGE_FILTER_CONFIGS.get(schema_key)
        if config is None:
            logger.warning(f"No PageFilterConfig for '{schema_key}' — using full PDF")
            return pdf_path, []
        try:
            analyses = self.analyze_pages(pdf_path, schema_key)
            kept = [a.page_num for a in analyses if a.kept]
            if not kept:
                logger.warning(f"PyMuPDF matched 0 pages for '{schema_key}' — using full PDF")
                return pdf_path, []
            filtered_path = self._write_filtered_pdf(pdf_path, kept)
            logger.info(f"PyMuPDF: kept {len(kept)}/{len(analyses)} pages for '{schema_key}'")
            return filtered_path, kept
        except Exception:
            logger.error(f"PyMuPDF filter error for '{schema_key}' — using full PDF", exc_info=True)
            return pdf_path, []

    def _filter_with_classify(
        self, pdf_path: Path, schema_key: str, ade_client
    ) -> Tuple[Path, List[int]]:
        """LandingAI classify() strategy. Falls back to pymupdf on any failure."""
        try:
            response = ade_client.classify(
                document=pdf_path,
                categories=["transaction_page", "non_transaction_page"],
            )
            # SDK response may use .pages or .classifications depending on version
            pages = getattr(response, "pages", None) or getattr(response, "classifications", None) or []
            kept = [p.page_num for p in pages if getattr(p, "category", "") == "transaction_page"]
            if not kept:
                logger.warning(
                    f"classify() returned 0 transaction pages for '{schema_key}' — falling back to pymupdf"
                )
                return self._filter_with_pymupdf(pdf_path, schema_key)
            filtered_path = self._write_filtered_pdf(pdf_path, kept)
            logger.info(f"classify(): kept {len(kept)} pages for '{schema_key}'")
            return filtered_path, kept
        except Exception:
            logger.warning(
                f"classify() failed for '{schema_key}' — falling back to pymupdf", exc_info=True
            )
            return self._filter_with_pymupdf(pdf_path, schema_key)

    def _filter_with_compare(
        self, pdf_path: Path, schema_key: str, ade_client
    ) -> Tuple[Path, List[int]]:
        """Runs both strategies, logs comparison, uses pymupdf result."""
        pymupdf_path, pymupdf_kept = self._filter_with_pymupdf(pdf_path, schema_key)
        try:
            response = ade_client.classify(
                document=pdf_path,
                categories=["transaction_page", "non_transaction_page"],
            )
            pages = getattr(response, "pages", None) or getattr(response, "classifications", None) or []
            classify_kept = [p.page_num for p in pages if getattr(p, "category", "") == "transaction_page"]
            logger.info(
                f"PAGE_FILTER compare '{schema_key}' ({pdf_path.name}): "
                f"pymupdf={pymupdf_kept} ({len(pymupdf_kept)} pages), "
                f"classify={classify_kept} ({len(classify_kept)} pages). "
                f"Using pymupdf result."
            )
        except Exception:
            logger.warning(
                f"classify() failed in compare mode for '{schema_key}' — only pymupdf result available",
                exc_info=True,
            )
        return pymupdf_path, pymupdf_kept

    # ------------------------------------------------------------------ #
    # Main entry point                                                     #
    # ------------------------------------------------------------------ #

    def filter_transaction_pages(
        self, pdf_path: Path, schema_key: str, ade_client=None
    ) -> Tuple[Path, List[int]]:
        """
        Return (filtered_pdf_path, kept_page_indices).

        Fallback: returns (pdf_path, []) unchanged when 0 pages match or any error.
        Strategy is selected via PAGE_FILTER_STRATEGY env var (default: "compare").
        """
        import os
        strategy = os.getenv("PAGE_FILTER_STRATEGY", "compare").lower()

        if strategy == "classify" and ade_client is not None:
            return self._filter_with_classify(pdf_path, schema_key, ade_client)
        elif strategy == "compare" and ade_client is not None:
            return self._filter_with_compare(pdf_path, schema_key, ade_client)
        else:
            # "pymupdf" strategy, or classify/compare requested but no client provided
            return self._filter_with_pymupdf(pdf_path, schema_key)
```

- [ ] **Step 4: Run tests**

```bash
cd backend
poetry run pytest tests/test_pdf_page_filter.py -v
```

Expected: all 7 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/statement_processor/pdf_page_filter.py backend/tests/test_pdf_page_filter.py
git commit -m "feat(page-filter): add classify and compare strategies, refactor into focused methods"
```

---

## Task 4: Wire PAGE_FILTER_STRATEGY in DocumentExtractor

**Files:**
- Modify: `backend/src/services/statement_processor/document_extractor.py:283`

**Interfaces:**
- Consumes: `PDFPageFilter.filter_transaction_pages(pdf_path, schema_key, ade_client=None)` from Task 3
- No interface changes — one-line change, same callers

- [ ] **Step 1: Pass `self.client` to page filter in `_extract_with_agentic_doc`**

In `document_extractor.py`, find the call at line 283:
```python
parse_path, kept_pages = page_filter.filter_transaction_pages(pdf_path, schema_key)
```

Change it to:
```python
parse_path, kept_pages = page_filter.filter_transaction_pages(
    pdf_path, schema_key, ade_client=self.client
)
```

- [ ] **Step 2: Verify the module loads and the extractor initialises**

```bash
cd backend
poetry run python -c "from src.services.statement_processor.document_extractor import DocumentExtractor; print('OK')"
```

Expected: `OK` with no error.

- [ ] **Step 3: Commit**

```bash
git add backend/src/services/statement_processor/document_extractor.py
git commit -m "feat(extractor): pass ADE client to page filter for classify/compare strategy support"
```

---

## Task 5: Standardizer Fixes + Universal `_skip_reason` Guards

**Files:**
- Modify: `backend/src/services/orchestrator/transaction_standardizer.py`
- Create: `backend/tests/test_transaction_standardizer.py`

**Interfaces:**
- Every `process_*` method now produces rows with two extra keys: `_skip_reason` (`None` or `"null_date"` / `"null_description"` / `"zero_amount"`) and `_partial_date_raw` (`None` or the raw unparsed date string)
- `_make_skip_row(reason, date_str, description, account, source_file, raw_data, reference_number=None)` → `dict`

- [ ] **Step 1: Write failing tests**

Create `backend/tests/test_transaction_standardizer.py`:

```python
"""Unit tests for TransactionStandardizer _skip_reason guards and per-account fixes."""
import pandas as pd
import pytest
from src.services.orchestrator.transaction_standardizer import TransactionStandardizer


@pytest.fixture
def std():
    return TransactionStandardizer()


# ------------------------------------------------------------------ #
# _make_skip_row helper                                               #
# ------------------------------------------------------------------ #

def test_make_skip_row_null_date_includes_partial_date(std):
    row = std._make_skip_row("null_date", "GARBAGE TEXT", "Some purchase", "My Bank", "file.csv", {})
    assert row["_skip_reason"] == "null_date"
    assert row["_partial_date_raw"] == "GARBAGE TEXT"
    assert row["transaction_date"] is None


def test_make_skip_row_zero_amount_has_no_partial_date(std):
    row = std._make_skip_row("zero_amount", "01/05/2026", "Purchase", "My Bank", "file.csv", {})
    assert row["_skip_reason"] == "zero_amount"
    assert row["_partial_date_raw"] is None


# ------------------------------------------------------------------ #
# Amazon Pay ICICI                                                    #
# ------------------------------------------------------------------ #

def test_amazon_pay_icici_null_date_flagged(std):
    df = pd.DataFrame([{
        "Date": "TRANSACTIONS FOR CHAITANYA GVS",
        "Transaction Details": "Amazon purchase",
        "Amount (INR)": "100.00 Dr",
        "SerNo": "001",
    }])
    result = std.process_amazon_pay_icici(df, "amazon_pay_icici_20260503.csv")
    assert len(result) == 1
    row = result.iloc[0]
    assert row["_skip_reason"] == "null_date"
    assert row["_partial_date_raw"] == "TRANSACTIONS FOR CHAITANYA GVS"


def test_amazon_pay_icici_valid_row(std):
    df = pd.DataFrame([{
        "Date": "03/05/2026",
        "Transaction Details": "Swiggy order",
        "Amount (INR)": "350.00 Dr",
        "SerNo": "A001",
    }])
    result = std.process_amazon_pay_icici(df, "amazon_pay_icici_20260503.csv")
    row = result.iloc[0]
    assert row["_skip_reason"] is None
    assert row["transaction_date"] == "2026-05-03"
    assert row["amount"] == 350.0
    assert row["transaction_type"] == "debit"


def test_amazon_pay_icici_reads_amount_inr_column_directly(std):
    """Regression: old code failed when OCR rendered ₹ as bullet; new schema uses ASCII 'Amount (INR)'."""
    df = pd.DataFrame([{
        "Date": "03/05/2026",
        "Transaction Details": "Amazon Pay",
        "Amount (INR)": "1000.00 Cr",
        "SerNo": "B002",
    }])
    result = std.process_amazon_pay_icici(df, "amazon_pay_icici_20260503.csv")
    row = result.iloc[0]
    assert row["_skip_reason"] is None
    assert row["transaction_type"] == "credit"


def test_amazon_pay_icici_zero_amount_flagged(std):
    df = pd.DataFrame([{
        "Date": "03/05/2026",
        "Transaction Details": "Reward redemption",
        "Amount (INR)": "0.00 Dr",
        "SerNo": "002",
    }])
    result = std.process_amazon_pay_icici(df, "amazon_pay_icici_20260503.csv")
    assert result.iloc[0]["_skip_reason"] == "zero_amount"


# ------------------------------------------------------------------ #
# Cashback SBI                                                        #
# ------------------------------------------------------------------ #

def test_cashback_sbi_null_date_flagged(std):
    """Regression: this row caused the June 2026 bulk insert crash."""
    df = pd.DataFrame([{
        "Date": "TRANSACTIONS FOR CHAITANYA GVS",
        "Transaction Details": "Some text",
        "Amount (INR)": "100.00 Dr",
    }])
    result = std.process_cashback_sbi(df, "cashback_sbi_20260502.csv")
    row = result.iloc[0]
    assert row["_skip_reason"] == "null_date"
    assert row["transaction_date"] is None  # not appended with None date


def test_cashback_sbi_valid_row(std):
    df = pd.DataFrame([{
        "Date": "01 May 26",
        "Transaction Details": "Amazon purchase",
        "Amount (INR)": "1299.00 Dr",
    }])
    result = std.process_cashback_sbi(df, "cashback_sbi_20260502.csv")
    row = result.iloc[0]
    assert row["_skip_reason"] is None
    assert row["transaction_date"] == "2026-05-01"


# ------------------------------------------------------------------ #
# Swiggy HDFC                                                         #
# ------------------------------------------------------------------ #

def test_swiggy_hdfc_reads_separate_date_time_columns(std):
    """New schema: Date and Time are separate columns."""
    df = pd.DataFrame([{
        "Date": "15/05/2026",
        "Time": "14:30",
        "Transaction Description": "Swiggy food order",
        "Amount (INR)": "- 350.00",
    }])
    result = std.process_swiggy_hdfc(df, "swiggy_hdfc_20260506.csv")
    row = result.iloc[0]
    assert row["_skip_reason"] is None
    assert row["transaction_date"] == "2026-05-15"
    assert row["transaction_time"] == "14:30:00"
    assert row["amount"] == 350.0


def test_swiggy_hdfc_null_date_flagged(std):
    df = pd.DataFrame([{
        "Date": "",
        "Time": "14:30",
        "Transaction Description": "Mystery charge",
        "Amount (INR)": "- 100.00",
    }])
    result = std.process_swiggy_hdfc(df, "swiggy_hdfc_20260506.csv")
    assert result.iloc[0]["_skip_reason"] == "null_date"


# ------------------------------------------------------------------ #
# Universal: all process_* methods include _skip_reason column        #
# ------------------------------------------------------------------ #

@pytest.mark.parametrize("method_name,df", [
    ("process_axis_atlas", pd.DataFrame([{
        "DATE": "01/05/2026", "TRANSACTION DETAILS": "Test", "AMOUNT (Rs.)": "100 Dr"
    }])),
    ("process_yes_bank_savings", pd.DataFrame([{
        "Date": "01-May-2026", "Description": "Test transfer",
        "Withdrawals": "500.00", "Deposits": "0.00"
    }])),
    ("process_sbi_savings", pd.DataFrame([{
        "Date": "01-05-26", "Description": "UPI/CR/Test payment", "Amount": "500"
    }])),
    ("process_axis_bank_savings", pd.DataFrame([{
        "Date": "01/05/2026", "Transaction Details": "NEFT credit",
        "Chq No": "", "Withdrawal": "", "Deposits": "1000"
    }])),
])
def test_process_method_includes_skip_reason_column(std, method_name, df):
    method = getattr(std, method_name)
    result = method(df, "test.csv")
    if not result.empty:
        assert "_skip_reason" in result.columns, f"{method_name} must include _skip_reason column"
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd backend
poetry run pytest tests/test_transaction_standardizer.py -v 2>&1 | head -40
```

Expected: failures on `_make_skip_row` not found, `_skip_reason` column missing.

- [ ] **Step 3: Add `_make_skip_row` helper to `TransactionStandardizer`**

In `transaction_standardizer.py`, add this method after `extract_time()` (around line 159):

```python
def _make_skip_row(
    self,
    reason: str,
    date_str: str,
    description: str,
    account: str,
    source_file: str,
    raw_data: dict,
    reference_number: Optional[str] = None,
) -> dict:
    """Build a flagged row dict. Flagged rows are reported but not inserted into the DB."""
    return {
        "transaction_date": None,
        "transaction_time": None,
        "description": description,
        "amount": 0.0,
        "transaction_type": None,
        "account": account,
        "category": None,
        "reference_number": reference_number,
        "source_file": source_file,
        "raw_data": raw_data,
        "_skip_reason": reason,
        "_partial_date_raw": date_str if reason == "null_date" else None,
    }
```

- [ ] **Step 4: Rewrite `process_amazon_pay_icici`**

Replace the entire method (lines 214–280) with:

```python
def process_amazon_pay_icici(self, df: pd.DataFrame, filename: str, account_name: str = None) -> pd.DataFrame:
    """Process Amazon Pay ICICI Credit Card data. Schema produces: Date, SerNo, Transaction Details, Amount (INR)."""
    logger.info(f"Processing Amazon Pay ICICI data: {filename}")
    account = account_name or "Amazon Pay ICICI Credit Card"
    standardized_data = []

    for _, row in df.iterrows():
        date_str = str(row.get("Date", "")).strip()
        description = str(row.get("Transaction Details", "")).strip()
        amount_str = str(row.get("Amount (INR)", "")).strip()
        raw = row.to_dict()

        parsed_date = self.parse_date(date_str) if date_str and date_str.lower() not in ("nan", "") else None
        if not parsed_date:
            standardized_data.append(self._make_skip_row("null_date", date_str, description, account, filename, raw, str(row.get("SerNo", "")).strip()))
            continue

        if not description or description.lower() in ("nan", "none"):
            standardized_data.append(self._make_skip_row("null_description", date_str, description, account, filename, raw, str(row.get("SerNo", "")).strip()))
            continue

        amount, transaction_type = self.clean_amount(amount_str, is_credit_card=True)
        if amount <= 0:
            standardized_data.append(self._make_skip_row("zero_amount", date_str, description, account, filename, raw, str(row.get("SerNo", "")).strip()))
            continue

        standardized_data.append({
            "transaction_date": parsed_date,
            "transaction_time": None,
            "description": description,
            "amount": amount,
            "transaction_type": transaction_type,
            "account": account,
            "category": None,
            "reference_number": str(row.get("SerNo", "")).strip(),
            "source_file": filename,
            "raw_data": raw,
            "_skip_reason": None,
            "_partial_date_raw": None,
        })

    return pd.DataFrame(standardized_data)
```

- [ ] **Step 5: Rewrite `process_axis_atlas`**

Replace the entire method (lines 282–306) with:

```python
def process_axis_atlas(self, df: pd.DataFrame, filename: str, account_name: str = None) -> pd.DataFrame:
    """Process Axis Atlas Credit Card data. Schema produces: DATE, TRANSACTION DETAILS, AMOUNT (Rs.)."""
    logger.info(f"Processing Axis Atlas data: {filename}")
    account = account_name or "Axis Atlas Credit Card"
    standardized_data = []

    for _, row in df.iterrows():
        date_str = str(row.get("DATE", "")).strip()
        description = str(row.get("TRANSACTION DETAILS", "")).strip()
        amount_str = str(row.get("AMOUNT (Rs.)", "")).strip()
        raw = row.to_dict()

        parsed_date = self.parse_date(date_str) if date_str and date_str.lower() not in ("nan", "") else None
        if not parsed_date:
            standardized_data.append(self._make_skip_row("null_date", date_str, description, account, filename, raw))
            continue

        if not description or description.lower() in ("nan", "none"):
            standardized_data.append(self._make_skip_row("null_description", date_str, description, account, filename, raw))
            continue

        amount, transaction_type = self.clean_amount(amount_str, is_credit_card=True)
        if amount <= 0:
            standardized_data.append(self._make_skip_row("zero_amount", date_str, description, account, filename, raw))
            continue

        standardized_data.append({
            "transaction_date": parsed_date,
            "transaction_time": None,
            "description": description,
            "amount": amount,
            "transaction_type": transaction_type,
            "account": account,
            "category": None,
            "reference_number": None,
            "source_file": filename,
            "raw_data": raw,
            "_skip_reason": None,
            "_partial_date_raw": None,
        })

    return pd.DataFrame(standardized_data)
```

- [ ] **Step 6: Rewrite `process_swiggy_hdfc`**

Replace the entire method (lines 308–358) with:

```python
def process_swiggy_hdfc(self, df: pd.DataFrame, filename: str, account_name: str = None) -> pd.DataFrame:
    """Process Swiggy HDFC Credit Card data. Schema produces: Date, Time, Transaction Description, Amount (INR)."""
    logger.info(f"Processing Swiggy HDFC data: {filename}")
    account = account_name or "Swiggy HDFC Credit Card"
    standardized_data = []

    for _, row in df.iterrows():
        date_str = str(row.get("Date", "")).strip()
        time_str = str(row.get("Time", "")).strip()
        description = str(row.get("Transaction Description", "")).strip()
        amount_str = str(row.get("Amount (INR)", "")).strip()
        raw = row.to_dict()

        # Combine into format expected by parse_date / extract_time
        if time_str and time_str.lower() not in ("nan", ""):
            full_datetime = f"{date_str}| {time_str}"
        else:
            full_datetime = date_str

        parsed_date = self.parse_date(full_datetime) if date_str and date_str.lower() not in ("nan", "") else None
        if not parsed_date:
            standardized_data.append(self._make_skip_row("null_date", date_str, description, account, filename, raw))
            continue

        if not description or description.lower() in ("nan", "none"):
            standardized_data.append(self._make_skip_row("null_description", date_str, description, account, filename, raw))
            continue

        amount, transaction_type = self.clean_amount(amount_str, is_credit_card=True)
        if amount <= 0:
            standardized_data.append(self._make_skip_row("zero_amount", date_str, description, account, filename, raw))
            continue

        standardized_data.append({
            "transaction_date": parsed_date,
            "transaction_time": self.extract_time(full_datetime),
            "description": description,
            "amount": amount,
            "transaction_type": transaction_type,
            "account": account,
            "category": None,
            "reference_number": None,
            "source_file": filename,
            "raw_data": raw,
            "_skip_reason": None,
            "_partial_date_raw": None,
        })

    return pd.DataFrame(standardized_data)
```

- [ ] **Step 7: Rewrite `process_cashback_sbi`**

Replace the entire method (lines 360–437) with:

```python
def process_cashback_sbi(self, df: pd.DataFrame, filename: str, account_name: str = None) -> pd.DataFrame:
    """Process Cashback SBI Credit Card data. Schema produces: Date, Transaction Details, Amount (INR)."""
    logger.info(f"Processing Cashback SBI data: {filename}")
    account = account_name or "Cashback SBI Credit Card"

    # Dynamic column detection — safety net for minor column name variations
    description_col = next((c for c in df.columns if str(c).startswith("Transaction Details")), None)
    if not description_col:
        logger.warning(f"No 'Transaction Details' column in {filename} — skipping")
        return pd.DataFrame()

    amount_col = next((c for c in df.columns if str(c).startswith("Amount")), None)
    if not amount_col:
        logger.warning(f"No 'Amount' column in {filename} — skipping")
        return pd.DataFrame()

    standardized_data = []
    for _, row in df.iterrows():
        date_str = str(row.get("Date", "")).strip()
        description = str(row.get(description_col, "")).strip()
        amount_str = str(row.get(amount_col, "")).strip()
        raw = row.to_dict()

        parsed_date = self.parse_date(date_str) if date_str and date_str.lower() not in ("nan", "") else None
        if not parsed_date:
            standardized_data.append(self._make_skip_row("null_date", date_str, description, account, filename, raw))
            continue

        if not description or description.lower() in ("nan", "none"):
            standardized_data.append(self._make_skip_row("null_description", date_str, description, account, filename, raw))
            continue

        amount, transaction_type = self.clean_amount(amount_str, is_credit_card=True)
        if amount <= 0:
            standardized_data.append(self._make_skip_row("zero_amount", date_str, description, account, filename, raw))
            continue

        standardized_data.append({
            "transaction_date": parsed_date,
            "transaction_time": None,
            "description": description,
            "amount": amount,
            "transaction_type": transaction_type,
            "account": account,
            "category": None,
            "reference_number": None,
            "source_file": filename,
            "raw_data": raw,
            "_skip_reason": None,
            "_partial_date_raw": None,
        })

    return pd.DataFrame(standardized_data)
```

- [ ] **Step 8: Rewrite `process_yes_bank_savings`**

Replace the entire method (lines 439–496) with:

```python
def process_yes_bank_savings(self, df: pd.DataFrame, filename: str, account_name: str = None) -> pd.DataFrame:
    """Process Yes Bank Savings Account data. Schema produces: Date, Description, Withdrawals, Deposits."""
    logger.info(f"Processing Yes Bank Savings data: {filename}")
    account = account_name or "Yes Bank Savings Account"

    def _parse_amt(val) -> float:
        if val is None or (isinstance(val, float) and pd.isna(val)):
            return 0.0
        try:
            return float(str(val).strip().replace(",", ""))
        except (ValueError, AttributeError):
            return 0.0

    standardized_data = []
    for _, row in df.iterrows():
        date_val = row.get("Date") or row.get("Transaction Date")
        date_str = str(date_val).strip() if date_val is not None else ""
        description = str(row.get("Description", "")).strip()
        raw = row.to_dict()

        parsed_date = self.parse_date(date_str) if date_str and date_str.lower() not in ("nan", "") else None
        if not parsed_date:
            standardized_data.append(self._make_skip_row("null_date", date_str, description, account, filename, raw))
            continue

        if not description or description.lower() in ("nan", "none"):
            standardized_data.append(self._make_skip_row("null_description", date_str, description, account, filename, raw))
            continue

        withdrawal = _parse_amt(row.get("Withdrawals", 0))
        deposit = _parse_amt(row.get("Deposits", 0))

        if withdrawal > 0:
            amount, transaction_type = withdrawal, "debit"
        elif deposit > 0:
            amount, transaction_type = deposit, "credit"
        else:
            standardized_data.append(self._make_skip_row("zero_amount", date_str, description, account, filename, raw))
            continue

        standardized_data.append({
            "transaction_date": parsed_date,
            "transaction_time": None,
            "description": description,
            "amount": amount,
            "transaction_type": transaction_type,
            "account": account,
            "category": None,
            "reference_number": None,
            "source_file": filename,
            "raw_data": raw,
            "_skip_reason": None,
            "_partial_date_raw": None,
        })

    return pd.DataFrame(standardized_data)
```

- [ ] **Step 9: Rewrite `process_sbi_savings`**

Replace the entire method (lines 498–554) with:

```python
def process_sbi_savings(self, df: pd.DataFrame, filename: str, account_name: str = None) -> pd.DataFrame:
    """Process SBI Savings Account data. Schema produces: Date, Description, Amount."""
    logger.info(f"Processing SBI Savings data: {filename}")
    account = account_name or "SBI Savings Account"

    def _parse_amount(val) -> float:
        if val is None or (isinstance(val, float) and pd.isna(val)):
            return 0.0
        s = str(val).strip().replace(",", "").strip()
        if not s or s.lower() in ("nan", "none", "-", ""):
            return 0.0
        try:
            return float(s)
        except (ValueError, AttributeError):
            return 0.0

    standardized_data = []
    for _, row in df.iterrows():
        date_str = str(row.get("Date", "")).strip()
        description = str(row.get("Description") or "").strip()
        raw = row.to_dict()

        parsed_date = self.parse_date(date_str) if date_str and date_str.lower() not in ("nan", "") else None
        if not parsed_date:
            standardized_data.append(self._make_skip_row("null_date", date_str, description, account, filename, raw))
            continue

        if not description or description.lower() in ("nan", "none"):
            standardized_data.append(self._make_skip_row("null_description", date_str, description, account, filename, raw))
            continue

        amount = _parse_amount(row.get("Amount"))
        if amount <= 0:
            standardized_data.append(self._make_skip_row("zero_amount", date_str, description, account, filename, raw))
            continue

        desc_upper = description.upper()
        if "/CR/" in desc_upper or (
            ("CREDIT" in desc_upper or "INTEREST" in desc_upper) and "/DR/" not in desc_upper
        ):
            transaction_type = "credit"
        elif "/DR/" in desc_upper or ("DEBIT" in desc_upper and "/CR/" not in desc_upper):
            transaction_type = "debit"
        else:
            # Direction cannot be inferred from SBI description format — skip silently
            logger.warning(f"SBI Savings: unknown direction for '{description}' in {filename}")
            continue

        standardized_data.append({
            "transaction_date": parsed_date,
            "transaction_time": None,
            "description": description,
            "amount": amount,
            "transaction_type": transaction_type,
            "account": account,
            "category": None,
            "reference_number": None,
            "source_file": filename,
            "raw_data": raw,
            "_skip_reason": None,
            "_partial_date_raw": None,
        })

    return pd.DataFrame(standardized_data)
```

- [ ] **Step 10: Rewrite `process_axis_bank_savings`**

Replace the entire method (lines 557–610) with:

```python
def process_axis_bank_savings(self, df: pd.DataFrame, filename: str, account_name: str = None) -> pd.DataFrame:
    """Process Axis Bank Savings Account data. Schema produces: Date, Transaction Details, Chq No, Withdrawal, Deposits."""
    logger.info(f"Processing Axis Bank Savings data: {filename}")
    account = account_name or "Axis Bank Savings Account"
    standardized_data = []

    for _, row in df.iterrows():
        date_str = str(row.get("Date", "")).strip()
        description = str(row.get("Transaction Details", "")).strip()
        raw = row.to_dict()

        parsed_date = self.parse_date(date_str) if date_str and date_str.lower() not in ("nan", "") else None
        if not parsed_date:
            standardized_data.append(self._make_skip_row("null_date", date_str, description, account, filename, raw))
            continue

        if not description or description.lower() in ("nan", "none"):
            standardized_data.append(self._make_skip_row("null_description", date_str, description, account, filename, raw))
            continue

        withdrawal_raw = row.get("Withdrawal", "")
        deposit_raw = row.get("Deposits", "")

        def _safe_float(val) -> float:
            if val is None or (isinstance(val, float) and pd.isna(val)):
                return 0.0
            s = str(val).strip().replace(",", "")
            if not s or s.lower() in ("nan", ""):
                return 0.0
            try:
                return float(s)
            except (ValueError, TypeError):
                return 0.0

        withdrawal = _safe_float(withdrawal_raw)
        deposit = _safe_float(deposit_raw)

        if withdrawal > 0:
            amount, transaction_type = withdrawal, "debit"
        elif deposit > 0:
            amount, transaction_type = deposit, "credit"
        else:
            standardized_data.append(self._make_skip_row("zero_amount", date_str, description, account, filename, raw))
            continue

        chq_no = str(row.get("Chq No", "")).strip()
        reference_number = chq_no if chq_no and chq_no.lower() not in ("nan", "") else None

        standardized_data.append({
            "transaction_date": parsed_date,
            "transaction_time": None,
            "description": description,
            "amount": amount,
            "transaction_type": transaction_type,
            "account": account,
            "category": None,
            "reference_number": reference_number,
            "source_file": filename,
            "raw_data": raw,
            "_skip_reason": None,
            "_partial_date_raw": None,
        })

    return pd.DataFrame(standardized_data)
```

- [ ] **Step 11: Run all tests**

```bash
cd backend
poetry run pytest tests/test_transaction_standardizer.py -v
```

Expected: all tests PASS.

- [ ] **Step 12: Run existing tests to check for regressions**

```bash
cd backend
poetry run pytest tests/ -v --ignore=tests/test_api_integration.py -x
```

Expected: no new failures.

- [ ] **Step 13: Commit**

```bash
git add backend/src/services/orchestrator/transaction_standardizer.py backend/tests/test_transaction_standardizer.py
git commit -m "feat(standardizer): add _make_skip_row helper, rewrite all 7 process_* methods with universal _skip_reason guards"
```

---

## Task 6: Validation Script (Manual Gate)

**Files:**
- Create: `backend/scripts/validate_extraction.py`

**Interfaces:**
- Consumes: `DocumentExtractor`, `TransactionStandardizer`, `GoogleCloudStorageService` (all existing)
- Run manually; exit 0 = no regressions, exit 1 = regression found
- Must be run and pass before Tasks 7–9 are implemented

- [ ] **Step 1: Create the validation script**

Create `backend/scripts/validate_extraction.py`:

```python
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
import asyncio
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


async def validate(month: str) -> bool:
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
            gcs.download_file(ref_info["name"], str(ref_csv))
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
    passed = asyncio.run(validate(month))
    sys.exit(0 if passed else 1)


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Run the validation script against the previous month's data**

```bash
cd backend
poetry run python scripts/validate_extraction.py
```

Read the output carefully:
- `✓` rows: new extraction equals or exceeds old row count — acceptable
- `✗ REGRESSION` rows: new extraction produces fewer rows than reference — investigate before continuing
- `SKIPPED` lines under a row: examine the `reason` and `raw_data`; if it's a genuine non-transaction (section header, balance row) the skip is correct and the regression may be acceptable

Only proceed to Task 7 when either: (a) no regressions, or (b) any regressions are confirmed to be garbage rows now correctly skipped.

- [ ] **Step 3: Commit the validation script**

```bash
git add backend/scripts/validate_extraction.py
git commit -m "feat(scripts): add validate_extraction.py for manual schema/standardizer validation gate"
```

---

## Task 7: Fix Premature `db_inserted` + Return `(data, valid_csv_keys)` from Helper

**Files:**
- Modify: `backend/src/services/orchestrator/data_standardizer_helper.py`
- Modify: `backend/src/services/orchestrator/statement_workflow.py` (signature change only — `_standardize_and_combine_all_data`)

**Interfaces:**
- Produces: `DataStandardizerHelper.process()` returns `Tuple[List[Dict], Set[str]]` — `(combined_data, valid_csv_keys)` where `combined_data` includes both valid and flagged rows, and `valid_csv_keys` is the set of csv stems that had at least one valid (non-flagged) row
- `_standardize_and_combine_all_data()` in `statement_workflow.py` updated to unpack the tuple; all two call sites updated

- [ ] **Step 1: Update `DataStandardizerHelper.process()` return type and logic**

In `data_standardizer_helper.py`:

a) Add `Set` to the `typing` import:
```python
from typing import Any, Callable, Dict, List, Set, Tuple
```

b) Change the `process()` signature:
```python
async def process(self, override: bool = False, job_id: str | None = None) -> Tuple[List[Dict[str, Any]], Set[str]]:
```

c) Before the `for cloud_file_info in csv_files_only:` loop, add:
```python
all_valid_data: List[Dict[str, Any]] = []
all_flagged_data: List[Dict[str, Any]] = []
valid_csv_keys: Set[str] = set()
```

d) Replace the block starting at `all_standardized_data: List[Dict[str, Any]] = []` and the `if not standardized_df.empty:` block (lines 106–230) with the following. The key changes are:
- Separate valid/flagged rows per CSV
- Track `valid_csv_keys`
- Remove the `update_status("db_inserted")` block (lines 197–213)
- Change the final dedup/sort to run only on valid rows

Replace lines 106–266 (from `all_standardized_data: List[Dict, Any]` to `return []` in the outer else) with:

```python
            all_valid_data: List[Dict[str, Any]] = []
            all_flagged_data: List[Dict[str, Any]] = []
            valid_csv_keys: Set[str] = set()

            # Process each CSV file
            for cloud_file_info in csv_files_only:
                try:
                    cloud_file = cloud_file_info.get("name", "")
                    if not cloud_file.endswith(".csv"):
                        continue

                    csv_stem = Path(cloud_file).stem
                    csv_key = csv_stem
                    if db_inserted_keys and csv_key in db_inserted_keys:
                        logger.info(f"Skipping {csv_key} — already db_inserted", extra=self.log_extra())
                        self.emit(
                            "standardization_file_skipped", "standardization",
                            f"Skipping {Path(cloud_file).name} — already inserted",
                            data={"cloud_file": cloud_file, "reason": "already_db_inserted"},
                        )
                        continue

                    if "splitwise" in cloud_file.lower():
                        if Path(cloud_file).name != "splitwise.csv":
                            logger.info(f"Skipping legacy Splitwise file {Path(cloud_file).name}", extra=self.log_extra())
                            self.emit(
                                "standardization_file_skipped", "standardization",
                                f"Skipping {Path(cloud_file).name} — legacy Splitwise file",
                                data={"cloud_file": cloud_file, "reason": "legacy_splitwise"},
                            )
                            continue

                    logger.info(f"Processing cloud CSV: {cloud_file}", extra=self.log_extra())
                    self.emit(
                        "standardization_file_started", "standardization",
                        f"Standardizing {Path(cloud_file).name}",
                        data={"cloud_file": cloud_file},
                    )

                    temp_csv_path = self.temp_dir / Path(cloud_file).name
                    download_result = self.cloud_storage.download_file(cloud_file, str(temp_csv_path))

                    if not download_result.get("success"):
                        logger.error(f"Failed to download {cloud_file}: {download_result.get('error')}", exc_info=True, extra=self.log_extra())
                        self.emit(
                            "standardization_file_failed", "standardization",
                            f"Failed to download {Path(cloud_file).name} from GCS",
                            level="error",
                            data={"cloud_file": cloud_file, "error": download_result.get("error")},
                        )
                        continue

                    df = pd.read_csv(temp_csv_path)

                    if "splitwise" in cloud_file.lower():
                        standardized_df = self.transaction_standardizer.standardize_splitwise_data(df)
                    else:
                        search_pattern = _extract_search_pattern_from_csv_filename(Path(cloud_file).name)
                        standardized_df = await self.transaction_standardizer.process_with_dynamic_method(
                            df, search_pattern, Path(cloud_file).name
                        )

                    if not standardized_df.empty:
                        rows = standardized_df.to_dict("records")
                        valid_rows = [r for r in rows if not r.get("_skip_reason")]
                        flagged_rows = [r for r in rows if r.get("_skip_reason")]

                        all_valid_data.extend(valid_rows)
                        all_flagged_data.extend(flagged_rows)

                        if valid_rows and "splitwise" not in cloud_file.lower():
                            valid_csv_keys.add(csv_key)

                        logger.info(
                            f"Standardized {len(valid_rows)} valid + {len(flagged_rows)} flagged rows from {cloud_file}",
                            extra=self.log_extra(),
                        )
                        self.emit(
                            "standardization_file_complete", "standardization",
                            f"Standardized {len(valid_rows)} transaction(s) from {Path(cloud_file).name}"
                            + (f" ({len(flagged_rows)} flagged)" if flagged_rows else ""),
                            level="success",
                            data={"cloud_file": cloud_file, "row_count": len(valid_rows), "flagged_count": len(flagged_rows)},
                        )
                    else:
                        self.emit(
                            "standardization_file_complete", "standardization",
                            f"No transactions extracted from {Path(cloud_file).name}",
                            level="warning",
                            data={"cloud_file": cloud_file, "row_count": 0},
                        )

                except Exception as e:
                    logger.error(f"Error processing cloud CSV {cloud_file}", exc_info=True, extra=self.log_extra())
                    self.emit(
                        "standardization_file_failed", "standardization",
                        f"Error standardizing {Path(cloud_file).name}: {e}",
                        level="error",
                        data={"cloud_file": cloud_file, "error": str(e)},
                    )
                    continue

            if all_valid_data or all_flagged_data:
                deduplicated = await self.remove_duplicate_transactions(all_valid_data)
                logger.info(
                    f"Removed {len(all_valid_data) - len(deduplicated)} duplicate transactions",
                    extra=self.log_extra(),
                )
                sorted_valid = await self.sort_transactions_by_date(deduplicated)
                combined = sorted_valid + all_flagged_data  # flagged rows appended unsorted

                self.emit(
                    "standardization_complete", "standardization",
                    f"Standardization complete: {len(sorted_valid)} unique valid + {len(all_flagged_data)} flagged",
                    level="success",
                    data={
                        "total_before_dedup": len(all_valid_data),
                        "total_after_dedup": len(sorted_valid),
                        "duplicates_removed": len(all_valid_data) - len(deduplicated),
                        "flagged_count": len(all_flagged_data),
                    },
                )
                return combined, valid_csv_keys
            else:
                logger.warning("No standardized transaction data generated", extra=self.log_extra())
                self.emit(
                    "standardization_complete", "standardization",
                    "No transaction data generated from any CSV source",
                    level="warning",
                    data={"total_after_dedup": 0},
                )
                return [], set()
```

e) In the outer `except Exception` handler at the bottom of `process()`, update the two `return []` calls to `return [], set()`.

- [ ] **Step 2: Update `_standardize_and_combine_all_data` in `statement_workflow.py`**

Change the method at line 1604:
```python
async def _standardize_and_combine_all_data(self) -> Tuple[List[Dict[str, Any]], Set[str]]:
    """Delegate to DataStandardizerHelper."""
    return await self._data_standardizer_helper.process(
        override=getattr(self, "override", False),
        job_id=self.job_id,
    )
```

Also add `Set` to the `typing` import at the top of `statement_workflow.py` if not already present.

- [ ] **Step 3: Update call sites in `statement_workflow.py`**

There are two call sites. Find them with:
```bash
grep -n "_standardize_and_combine_all_data\|combined_data = await" backend/src/services/orchestrator/statement_workflow.py | head -10
```

For each call site, change:
```python
combined_data = await self._standardize_and_combine_all_data()
```
to:
```python
combined_data, valid_csv_keys = await self._standardize_and_combine_all_data()
```

(The `valid_csv_keys` variable is used in Task 9 to mark `db_inserted`. For now it's just unpacked and unused — that's fine.)

- [ ] **Step 4: Verify the module loads and tests pass**

```bash
cd backend
poetry run python -c "from src.services.orchestrator.data_standardizer_helper import DataStandardizerHelper; print('OK')"
poetry run pytest tests/ -v --ignore=tests/test_api_integration.py -x
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/orchestrator/data_standardizer_helper.py backend/src/services/orchestrator/statement_workflow.py
git commit -m "fix(standardizer-helper): remove premature db_inserted mark, return (data, valid_csv_keys) tuple"
```

---

## Task 8: Per-Row Validation in `bulk_insert_transactions`

**Files:**
- Modify: `backend/src/services/database_manager/operations/transaction_operations.py`

**Interfaces:**
- `bulk_insert_transactions()` return dict now includes `"validation_skipped_rows": List[Dict]` where each dict has: `source_file`, `reason`, `raw_data`, `partial_date`
- All other return keys unchanged (`inserted_count`, `skipped_count`, `errors`, etc.)

- [ ] **Step 1: Add validation split at the top of `bulk_insert_transactions`**

In `transaction_operations.py`, find `bulk_insert_transactions` (line 793). After the `if not transactions: return {...}` guard (line 810–819), add the following block:

```python
        # Separate validation-flagged rows (bad extraction output) from valid rows.
        # Flagged rows are never inserted; they are returned for SSE reporting.
        _valid_transactions = [t for t in transactions if not t.get("_skip_reason")]
        validation_skipped_rows = [
            {
                "source_file": t.get("source_file", ""),
                "reason": t["_skip_reason"],
                "raw_data": t.get("raw_data", {}),
                "partial_date": t.get("_partial_date_raw"),
            }
            for t in transactions
            if t.get("_skip_reason")
        ]
        if validation_skipped_rows:
            for skipped in validation_skipped_rows:
                logger.warning(
                    "Skipped row — reason=%s source=%s raw=%s",
                    skipped["reason"],
                    skipped["source_file"],
                    skipped["raw_data"],
                )
        transactions = _valid_transactions
```

- [ ] **Step 2: Replace the top of `bulk_insert_transactions` with the following**

The key additions: (a) split on `_skip_reason` before any DB work, (b) early exit if all rows were flagged (avoids opening a session), (c) `validation_skipped_rows` in every return dict.

Replace the existing opening block of `bulk_insert_transactions` (the `if not transactions:` guard and the `session_factory = ...` setup, down to just before `result = {...}`) with:

```python
        validation_skipped_rows: list = []

        if not transactions:
            return {
                "success": True,
                "inserted_count": 0,
                "updated_count": 0,
                "skipped_count": 0,
                "error_count": 0,
                "errors": [],
                "splitwise_upsert_updates": [],
                "validation_skipped_rows": [],
            }

        # Separate validation-flagged rows from valid rows before any DB work.
        _valid = [t for t in transactions if not t.get("_skip_reason")]
        validation_skipped_rows = [
            {
                "source_file": t.get("source_file", ""),
                "reason": t["_skip_reason"],
                "raw_data": t.get("raw_data", {}),
                "partial_date": t.get("_partial_date_raw"),
            }
            for t in transactions if t.get("_skip_reason")
        ]
        if validation_skipped_rows:
            for skipped in validation_skipped_rows:
                logger.warning(
                    "Skipped row — reason=%s source=%s raw=%s",
                    skipped["reason"], skipped["source_file"], skipped["raw_data"],
                )
        transactions = _valid

        # If all rows were flagged, skip the DB session entirely
        if not transactions:
            return {
                "success": True,
                "inserted_count": 0,
                "updated_count": 0,
                "skipped_count": 0,
                "error_count": 0,
                "errors": [],
                "splitwise_upsert_updates": [],
                "validation_skipped_rows": validation_skipped_rows,
            }
```

Then add `"validation_skipped_rows": validation_skipped_rows` to the `result` dict initialised just after `session_factory = get_session_factory()`:
```python
            result = {
                "success": True,
                "inserted_count": 0,
                "updated_count": 0,
                "skipped_count": 0,
                "error_count": 0,
                "errors": [],
                "splitwise_upsert_updates": [],
                "validation_skipped_rows": validation_skipped_rows,
            }
```

- [ ] **Step 3: Verify with a unit test**

Add to `tests/test_transaction_standardizer.py`:

```python
import asyncio
from src.services.database_manager.operations.transaction_operations import TransactionOperations


def test_bulk_insert_filters_flagged_rows_no_db_needed():
    """All-flagged input returns immediately without opening a DB session."""
    flagged = {
        "transaction_date": None,
        "description": "TRANSACTIONS FOR CHAITANYA GVS",
        "amount": 0.0,
        "transaction_type": None,
        "account": "Cashback SBI Credit Card",
        "source_file": "cashback_sbi_20260502.csv",
        "raw_data": {"Date": "TRANSACTIONS FOR CHAITANYA GVS"},
        "_skip_reason": "null_date",
        "_partial_date_raw": "TRANSACTIONS FOR CHAITANYA GVS",
    }
    result = asyncio.run(TransactionOperations.bulk_insert_transactions([flagged]))
    assert result["inserted_count"] == 0
    assert len(result["validation_skipped_rows"]) == 1
    skipped = result["validation_skipped_rows"][0]
    assert skipped["reason"] == "null_date"
    assert skipped["partial_date"] == "TRANSACTIONS FOR CHAITANYA GVS"
    assert skipped["source_file"] == "cashback_sbi_20260502.csv"
```

Run the test:
```bash
cd backend
poetry run pytest tests/test_transaction_standardizer.py::test_bulk_insert_filters_flagged_rows_no_db_needed -v
```

Expected: PASS — the early-exit after the split means no DB session is opened.

- [ ] **Step 4: Commit**

```bash
git add backend/src/services/database_manager/operations/transaction_operations.py
git commit -m "fix(db): pre-filter _skip_reason rows before bulk insert, return validation_skipped_rows"
```

---

## Task 9: SSE Reporting + Post-Insert `db_inserted` Marking

**Files:**
- Modify: `backend/src/services/orchestrator/statement_workflow.py`

**Interfaces:**
- Consumes: `db_result["validation_skipped_rows"]` from Task 8
- Consumes: `valid_csv_keys` from Task 7
- `workflow_complete` SSE event gains `"skipped_rows"` field

- [ ] **Step 1: Emit `validation_row_skipped` SSE events after each bulk insert**

In `statement_workflow.py`, find both call sites of `bulk_insert_transactions` (grep showed they're around lines 1274 and 1870). After EACH successful `if db_result.get("success"):` block, add:

```python
                        # Emit SSE for each validation-flagged row
                        for skipped_row in db_result.get("validation_skipped_rows", []):
                            self._emit(
                                "validation_row_skipped", "db_insert",
                                f"Skipped row (reason={skipped_row['reason']}): {skipped_row['source_file']}",
                                level="warning",
                                data=skipped_row,
                            )
```

- [ ] **Step 2: Replace old per-statement `db_inserted` marking with csv_key-based marking**

In the full workflow path (around line 1289), find and **remove** the block:

```python
                        for stmt in workflow_results.get("processed_statements", []):
                            if not stmt.get("extraction_skipped") and stmt.get("standardization_success"):
                                stmt_log_key = stmt["filename"].replace("_locked.pdf", "")
                                try:
                                    await StatementLogOperations.update_status(
                                        stmt_log_key, "db_inserted", job_id=self.job_id
                                    )
                                except Exception:
                                    logger.warning(f"Failed to mark {stmt_log_key} as db_inserted", ...)
```

Replace it with:

```python
                        # Mark db_inserted only for CSV keys that had at least one valid row inserted
                        for csv_key in valid_csv_keys:
                            try:
                                await StatementLogOperations.update_status(
                                    csv_key, "db_inserted", job_id=self.job_id
                                )
                                logger.info(f"Marked {csv_key} as db_inserted", extra=self._log_extra())
                            except Exception:
                                logger.warning(
                                    f"Failed to mark {csv_key} as db_inserted",
                                    exc_info=True,
                                    extra=self._log_extra(),
                                )
```

- [ ] **Step 3: Add `skipped_rows` to the `workflow_complete` SSE event**

Find the `workflow_complete` emit in the full workflow path (around line 1340 area). The emit data dict currently has fields like `db_inserted`, `db_skipped`, etc. Add:

```python
                "skipped_rows": db_result.get("validation_skipped_rows", []),
```

Do the same for the splitwise-only `workflow_complete` event (around line 1897).

- [ ] **Step 4: Verify end-to-end with `ruff` and existing tests**

```bash
cd backend
poetry run ruff check .
poetry run pytest tests/ -v --ignore=tests/test_api_integration.py -x
```

Expected: no lint errors, no test failures.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/orchestrator/statement_workflow.py
git commit -m "fix(workflow): emit validation_row_skipped SSE, mark db_inserted post-insert from csv_keys"
```

---

## Final Verification

- [ ] **Deploy to Docker**

```bash
# From repo root
make restart-backend  # or: docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build backend
```

- [ ] **Run a full ingestion workflow and verify**

Trigger the workflow from the UI or API. Then check:

```bash
# From repo root
docker compose -f docker-compose.yml -f docker-compose.prod.yml logs --tail=200 backend | grep -E "(WARN|ERROR|db_inserted|validation_row_skipped|Marked)"
```

Expected:
- No `Could not parse date` warnings with subsequent row appended
- `Marked <account>_<date> as db_inserted` appears AFTER the insert (not during standardization)
- Any flagged rows appear as `WARNING: Skipped row — reason=...`
- SSE stream includes `validation_row_skipped` events if any rows were skipped

- [ ] **Verify DB state**

```bash
psql -h localhost -U chaitanya -d marty_the_expense_tracker -c "
SELECT normalized_filename, status, updated_at 
FROM statement_processing_log 
WHERE updated_at >= NOW() - INTERVAL '1 hour'
ORDER BY updated_at DESC;"
```

Expected: accounts show `db_inserted` only if their CSVs had valid rows inserted.

- [ ] **Create PR**

```bash
gh pr create \
  --base main \
  --title "feat: extraction pipeline overhaul — schema redesign, _skip_reason guards, classify/compare page filter, fix db_inserted timing" \
  --body "See docs/superpowers/specs/2026-06-28-extraction-pipeline-overhaul-design.md for full design."
```
