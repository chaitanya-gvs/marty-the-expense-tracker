"""
Bank Statement Extraction Schemas

This module contains Pydantic models for extracting structured data from different bank statements.
"""

from dataclasses import dataclass, field
from pydantic import BaseModel, Field
from typing import Dict, List, Type


@dataclass
class PageFilterConfig:
    """
    Per-account configuration for PDF page pre-filtering.

    Detection signals are evaluated in priority order; the first that fires keeps the page:

    1. column_headers / min_column_header_matches
       Exact column names from the transaction table header row. This is the highest-
       confidence signal — if enough column names are found in the page text, the page
       is definitely a transaction page. Set min_column_header_matches to the smallest
       number of columns whose co-occurrence is unambiguous (usually 2).

    2. required_keywords
       Bank-specific strings such as exact table section headings. Any single match keeps
       the page. Used for continuation pages that repeat the section heading but not all
       column names.

    3. min_table_cols / min_table_rows  (table density)
       PyMuPDF find_tables() structural detection. A table with at least min_table_cols
       columns and min_table_rows data rows is considered a transaction table. Catches
       continuation pages that have the table structure but no header row.

    4. supporting_keywords / min_supporting_matches
       Generic transaction terms (date, debit, credit, balance…) as a last-resort
       fallback for pages where text extraction yields few recognisable keywords.
    """
    column_headers: List[str] = field(default_factory=list)
    min_column_header_matches: int = 2
    required_keywords: List[str] = field(default_factory=list)
    supporting_keywords: List[str] = field(default_factory=list)
    min_supporting_matches: int = 4
    min_table_cols: int = 4
    min_table_rows: int = 2


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
        "CRITICAL — the source PDF has 4 columns: 'DATE & TIME', 'TRANSACTION DESCRIPTION', 'AMOUNT', 'PI'. "
        "Each cell in the 'DATE & TIME' column contains BOTH the date and time as a single value in the format "
        "'DD/MM/YYYY| HH:MM' (e.g. '06/05/2026| 11:27'). The '|' character is NOT a column separator — "
        "it is part of the cell content. Split this single value: "
        "  - the part before '|' is the 'Date' (e.g. '06/05/2026') "
        "  - the part after '|' is the 'Time' (e.g. '11:27') "
        "The PDF's 'TRANSACTION DESCRIPTION' column → 'Transaction Description'. "
        "The PDF's 'AMOUNT' column → 'Amount (INR)': use '+ X.XX' for credits (payments/cashback), 'X.XX' for debits. "
        "The PDF's 'PI' column is a category bullet — ignore it entirely. "
        "Skip rows that have no monetary amount in the AMOUNT column."
    ))


class AmazonPayICICICreditCard(BaseModel):
    table: str = Field(description=(
        "Extract the Transaction Details table as markdown with EXACTLY these 4 columns in this order: "
        "'Date', 'SerNo', 'Transaction Details', 'Amount (INR)'. "
        "'Date' = transaction date in DD/MM/YYYY format. "
        "'SerNo' = serial/reference number. "
        "'Transaction Details' = full transaction description. "
        "'Amount (INR)' = amount followed by Cr or Dr (e.g. '1000.00 Cr', '500.00 Dr'). "
        "CRITICAL — the source PDF has TWO amount columns: 'Intl.# amount' and 'Amount (in₹)'. "
        "For each transaction row, exactly ONE of these two columns will have a value: "
        "  - If 'Intl.# amount' has a value (e.g. '12,814.53 CR'), use it as 'Amount (INR)' and keep the 'CR' suffix. "
        "  - If 'Amount (in₹)' has a value (e.g. '2,374.00'), use it as 'Amount (INR)' and append ' Dr' (it is a debit/purchase). "
        "Do NOT include Reward Points, Intl.# amount, or Amount (in₹) as separate columns. "
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

# Registry of all available bank statement models
BANK_STATEMENT_MODELS: Dict[str, Type[BaseModel]] = {
    "axis_atlas": AxisAtlasCreditCard,
    "swiggy_hdfc": SwiggyHDFCCreditCard,
    "amazon_pay_icici": AmazonPayICICICreditCard,
    "cashback_sbi": CashbackSBICreditCard,
    "yes_bank_savings": YesBankSavingsAccount,
    "axis_bank_savings": AxisBankSavingsAccount,
    # SBI savings account mapping (nickname 'SBI Savings Account' -> key 'sbi_savings')
    "sbi_savings": SBISavingsAccount,
}

_COMMON_TRANSACTION_KEYWORDS = ["date", "debit", "credit", "balance", "amount"]

# Per-account page filter configs — kept alongside the extraction schemas so both
# are updated together when a new account is added.
#
# column_headers must be lowercase and match what PyMuPDF extracts from the PDF text.
# "amount (in" is used instead of "amount (in ₹)" to avoid Unicode encoding uncertainty.
# "marchant category" is preserved as-is (typo present in the actual Axis Atlas PDF).
PAGE_FILTER_CONFIGS: Dict[str, PageFilterConfig] = {
    # Columns: Date | SerNo. | Transaction Details | Reward Points | Intl. Amount | Amount (in ₹)
    "amazon_pay_icici": PageFilterConfig(
        column_headers=["serno.", "reward points", "intl. amount", "amount (in"],
        min_column_header_matches=2,
        required_keywords=["transaction details"],
        supporting_keywords=_COMMON_TRANSACTION_KEYWORDS + ["reward points", "cashback"],
    ),
    # Columns: Date | Transaction Details | Marchant Category | Amount (Rs.)
    "axis_atlas": PageFilterConfig(
        column_headers=["marchant category", "merchant category", "amount (rs.)"],
        min_column_header_matches=1,  # "marchant/merchant category" alone is unambiguous
        required_keywords=["transaction details"],
        supporting_keywords=_COMMON_TRANSACTION_KEYWORDS + ["reward points"],
    ),
    # Columns: Date | Transaction Details | Amount (Rs.)
    "cashback_sbi": PageFilterConfig(
        column_headers=["transaction details", "amount (rs.)"],
        min_column_header_matches=2,
        required_keywords=["transaction details"],
        supporting_keywords=_COMMON_TRANSACTION_KEYWORDS,
    ),
    # Columns: Date | Transaction Reference | Ref. No | Credit | Debit | Balance
    "sbi_savings": PageFilterConfig(
        column_headers=["transaction reference", "ref. no"],
        min_column_header_matches=1,  # "transaction reference" alone is unambiguous
        required_keywords=["transaction overview"],
        supporting_keywords=["date", "credit", "debit", "balance", "ref.no"],
    ),
    # Columns: Date & Time | Transaction Description | Amount
    "swiggy_hdfc": PageFilterConfig(
        column_headers=["date & time", "transaction description"],
        min_column_header_matches=1,  # either alone is distinctive
        required_keywords=["domestic transactions"],
        supporting_keywords=_COMMON_TRANSACTION_KEYWORDS,
    ),
    # Columns: Transaction Date | Value Date | Description | Cheque No/Reference No | Deposits | Withdrawals | Running Balance
    "yes_bank_savings": PageFilterConfig(
        column_headers=["value date", "running balance", "cheque no"],
        min_column_header_matches=2,
        required_keywords=["statement of transactions"],
        supporting_keywords=["date", "withdrawal", "deposit", "balance", "narration"],
    ),
    # Columns: Date | Transaction Details | Chq No | Withdrawal | Deposits | Balance
    "axis_bank_savings": PageFilterConfig(
        column_headers=["chq no", "withdrawal", "deposits"],
        min_column_header_matches=2,
        required_keywords=["statement for account no"],
        supporting_keywords=["date", "withdrawal", "deposits", "balance"],
    ),
}
