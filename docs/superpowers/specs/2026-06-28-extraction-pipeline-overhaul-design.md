# Extraction Pipeline Overhaul — Design Spec

**Date**: 2026-06-28
**Branch**: `feat/extraction-pipeline-overhaul`
**Status**: Approved

## Background

The June 2026 ingestion run surfaced three failures that motivated this work:

1. **Amazon Pay ICICI produced 0 transactions** — LandingAI OCR rendered `₹` as `•` in the column name (`Amount (in₹)` → `Amount (in•)`). The standardizer only checked for exact Unicode matches, so it found no amount column and skipped all rows.
2. **Bulk insert failed for all 243 transactions** — Cashback SBI's extraction captured a section header (`Date = "TRANSACTIONS FOR CHAITANYA GVS"`) as a real transaction row. The standardizer called `parse_date`, got `None`, but still appended the row. The null `transaction_date` violated the NOT NULL constraint and aborted the entire batch.
3. **`statement_processing_log` showed false success** — All 5 other accounts were marked `db_inserted` during standardization, before the DB insert ran. A re-run would skip them as already done even though nothing was inserted.

Secondary issues observed: Swiggy HDFC's column-shift workaround fired on all 62 rows (symptom of a bad extraction schema), and the current PyMuPDF page filter is working but has no comparison baseline against LandingAI's native classification.

---

## Scope

All changes go on feature branch `feat/extraction-pipeline-overhaul`. No direct pushes to main.

---

## Section 1: SDK Upgrade & Page Filtering

### SDK Upgrade

`landingai-ade` bumped from `>=1.9.0` to `>=1.12.0` in `pyproject.toml`.

### Page Filter Strategy

`PDFPageFilter` gains a `strategy` parameter with three values, controlled by the env var `PAGE_FILTER_STRATEGY`:

| Strategy | Description |
|----------|-------------|
| `"pymupdf"` | Current behavior — PyMuPDF keyword/table detection, pre-filters PDF before parse. **Remains the default.** |
| `"classify"` | Uses `client.classify(document=pdf, categories=["transaction_page", "non_transaction_page"])`, filters to transaction pages, then parses only those. Two API calls (classify + parse). |
| `"compare"` | Runs **both** strategies and logs which pages each kept, page counts, and table chunk counts — but uses PyMuPDF's result for the actual extraction. No cost penalty in production; classify only fires for comparison logging. |

The comparison mode is the initial deployment state. After a few real ingestion runs the logs will show cost and quality for each strategy. When classify is confirmed better (or equal cost), flip `PAGE_FILTER_STRATEGY=classify`. If it costs more, stay on `"pymupdf"`.

**Fallback**: In `"classify"` mode, if `client.classify()` fails or returns zero transaction pages, the pipeline falls back to PyMuPDF automatically and logs a warning.

---

## Section 2: Extraction Schema Redesign

### Principles

- Every schema specifies **exact column names** (no vague "the transaction table")
- Column names use **ASCII-safe names only** — no `₹`, no Unicode symbols that OCR can corrupt
- The LLM is explicitly told to **exclude non-transaction rows** (headers, summaries, balance rows) at source
- Amount columns always use a `Cr`/`Dr` suffix or `+`/`-` prefix — no ambiguous bare numbers

### Per-Account Schema Changes

**Amazon Pay ICICI** — drops unused `Reward Points` column, renames amount column to ASCII:

```python
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
```

**Cashback SBI** — explicitly instructs LLM to exclude header/section rows:

```python
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
```

**Swiggy HDFC** — splits date and time into separate columns (eliminates the column-shift workaround that was firing on every row):

```python
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
```

**Axis Atlas** — adds format specs and explicit exclusion of balance rows:

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
```

**SBI Savings** — adds explicit exclusions:

```python
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
```

**Yes Bank Savings** — adds explicit exclusions:

```python
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
```

**Axis Bank Savings** — adds format specs and exclusions (no change to columns, which are already correct):

```python
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

### Page Filter Configs

`PAGE_FILTER_CONFIGS` in `schemas.py` are unchanged — they are only used by the PyMuPDF strategy. The `classify` strategy does not use them.

---

## Section 3: Standardizer Fixes

### Universal Safety Net

Every `process_*` method gets a `_skip_reason` column added to its output DataFrame. Valid rows have `_skip_reason=None`. Rows that would previously have been silently skipped or silently inserted with bad data are now marked with a reason string:

| Reason | Condition |
|--------|-----------|
| `"null_date"` | `parse_date()` returned `None` |
| `"null_description"` | description is empty, `"nan"`, or `"None"` |
| `"zero_amount"` | parsed amount is 0 or negative |

All three guards are applied universally to **every** `process_*` method — not just the three accounts with specific fixes.

Rows with a non-null `_skip_reason` are **not inserted into the DB** but are **fully reported** in logs, SSE events, and the job summary. No new DB columns or tables are needed. The expectation is that flagged rows will be rare once extraction schemas are fixed, and any legitimate transaction that gets flagged can be manually inserted using the report data.

Each flagged row in the report includes:
- `source_file` — which CSV it came from
- `reason` — the skip reason string
- `raw_data` — the full raw row dict as extracted
- `partial_date` — the raw unparsed date string (even when `parse_date()` failed), so a `null_date` row can be manually reconstructed

### Per-Account Changes

**Amazon Pay ICICI** (`process_amazon_pay_icici`):
- Remove the entire `header_row` detection loop (legacy code for when LLM embedded headers as data rows)
- Remove the `else` branch with Unicode fallback checks for amount column name
- Amount column is now reliably `"Amount (INR)"` — read it directly
- Add `_skip_reason` guard after `parse_date`

**Cashback SBI** (`process_cashback_sbi`):
- Add `_skip_reason="null_date"` when `parse_date()` returns `None` instead of appending the row (this is the fix for the bulk insert failure)
- Dynamic column detection for `description_col` and `amount_col` stays — still useful as a safety net against minor column name variations

**Swiggy HDFC** (`process_swiggy_hdfc`):
- Remove the entire column-shift detection block (`is_column_shifted`, reading from AMOUNT/PI fallback columns)
- Read `row["Date"]` and `row["Time"]` from their respective columns directly
- Construct `full_datetime = f"{date_str}| {time_str}"` for existing `parse_date`/`extract_time` parsers
- Add `_skip_reason` guard after `parse_date`

**All other accounts** (SBI Savings, Yes Bank Savings, Axis Bank Savings): Add all three `_skip_reason` guards (`null_date`, `null_description`, `zero_amount`) — no other logic changes.

### Validation Script

`backend/scripts/validate_extraction.py` runs **after** schema and standardizer changes are implemented, **before** the infrastructure changes are deployed.

It:
1. Lists existing unlocked PDFs and their reference CSVs from GCS (previous successful runs)
2. Reruns extraction with new schemas and standardizers against those PDFs
3. Compares per account: row count (new ≥ old), column names match schema spec, null date count = 0
4. Prints a per-account report:
   ```
   amazon_pay_icici_20260503: OLD=4 rows, NEW=4 rows ✓  0 skipped
   cashback_sbi_20260502:     OLD=6 rows, NEW=7 rows ✓  1 skipped (null_date)
   swiggy_hdfc_20260506:      OLD=62 rows, NEW=62 rows ✓  0 column shifts
   ```
5. Exits non-zero if any account shows a regression (fewer rows than old CSV with no valid skip reason)

This is a **manual gate** — run it, verify the report, then proceed to Section 4 work.

---

## Section 4: Infrastructure Fixes

### Fix 1 — `db_inserted` Timing (`data_standardizer_helper.py`)

**Before**: `StatementLogOperations.update_status(csv_key, "db_inserted")` is called inside the CSV processing loop right after standardization, before the DB insert has run.

**After**: The helper removes all `update_status("db_inserted")` calls. Instead it returns to the caller (in `statement_workflow.py`):
- The combined list of valid + flagged transactions (with `_skip_reason`)
- A list of `csv_keys` that contributed rows (for post-insert status update)

In `statement_workflow.py`, after `TransactionOperations.bulk_insert()` returns successfully, it calls `update_status(csv_key, "db_inserted")` for each key whose rows were inserted. If the insert fails or a CSV contributed zero inserted rows, its status remains at `csv_stored` — accurate, retryable.

### Fix 2 — Per-Row Validation (`transaction_operations.py`)

Before the bulk insert, the input list is split on `_skip_reason`:

```python
valid_rows = [r for r in transactions if not r.get("_skip_reason")]
flagged_rows = [r for r in transactions if r.get("_skip_reason")]
```

For each flagged row, log a WARNING immediately:
```
WARNING: Skipped row — reason=null_date source=cashback_sbi_20260602.csv raw={"Date": "TRANSACTIONS FOR CHAITANYA GVS", ...}
```

Only `valid_rows` are passed to the existing bulk insert SQL — no change to the insert logic itself.

Return value:
```python
{
    "inserted": 240,
    "skipped": [
        {
            "source_file": "cashback_sbi_20260602.csv",
            "reason": "null_date",
            "raw_data": {...},
            "partial_date": "TRANSACTIONS FOR CHAITANYA GVS"  # raw string that failed parse_date
        }
    ]
}
```

### Fix 3 — SSE + Job Summary Reporting (`statement_workflow.py`)

After the insert call returns:
- For each entry in `result["skipped"]`: emit a `validation_row_skipped` SSE event with `{source_file, reason, raw_data}`
- The final `workflow_complete` SSE event gains a `skipped_rows` field with the full list

No frontend changes needed — existing warning-level event styling already handles these.

---

## File Impact Summary

| File | Change |
|------|--------|
| `pyproject.toml` | Bump `landingai-ade` to `>=1.12.0` |
| `statement_processor/schemas.py` | Rewrite all 6 extraction schemas; `PAGE_FILTER_CONFIGS` unchanged |
| `statement_processor/pdf_page_filter.py` | Add `classify` strategy + `compare` mode; PyMuPDF stays as default |
| `statement_processor/document_extractor.py` | Read `PAGE_FILTER_STRATEGY` env var, wire classify strategy |
| `orchestrator/transaction_standardizer.py` | Fix per-account methods, add `_skip_reason`, remove defensive guessing |
| `orchestrator/data_standardizer_helper.py` | Remove premature `db_inserted` marks, return csv_keys + flagged rows |
| `database_manager/operations/transaction_operations.py` | Pre-insert split on `_skip_reason`, log + return skipped rows |
| `orchestrator/statement_workflow.py` | Move `db_inserted` mark post-insert, emit SSE + summary for skipped rows |
| `scripts/validate_extraction.py` | New validation script |

---

## Implementation Order

1. Create feature branch `feat/extraction-pipeline-overhaul`
2. Bump SDK + update `pyproject.toml`
3. Rewrite all extraction schemas (`schemas.py`)
4. Add `classify` + `compare` strategies to `PDFPageFilter`
5. Wire `PAGE_FILTER_STRATEGY` in `document_extractor.py`
6. Fix per-account standardizers + add universal `_skip_reason` guard
7. Write `scripts/validate_extraction.py` and run it — verify no regressions
8. Fix `db_inserted` timing in `data_standardizer_helper.py`
9. Add per-row validation in `transaction_operations.py`
10. Wire SSE + job summary reporting in `statement_workflow.py`
11. Deploy to Docker, run a full ingestion, verify all accounts insert cleanly
