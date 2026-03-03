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
    """Pydantic model for extracting transaction tables from Axis Bank statements"""
    table: str = Field(description="The transaction table in markdown/html format called Transaction Details")


class SwiggyHDFCCreditCard(BaseModel):
    """Pydantic model for extracting transaction tables from HDFC Bank statements"""
    table: str = Field(description="The transaction table in markdown/html format called Domestic Transactions")


class AmazonPayICICICreditCard(BaseModel):
    """Pydantic model for extracting transaction tables from ICICI Bank statements"""
    table: str = Field(description="The transaction table in markdown/html format called Transaction Details")


class CashbackSBICreditCard(BaseModel):
    """Pydantic model for extracting transaction tables from State Bank of India statements"""
    table: str = Field(description="The transaction table in markdown/html format called Transaction Details")


class SBISavingsAccount(BaseModel):
    """Pydantic model for extracting transaction tables from SBI Savings Account statements"""
    table: str = Field(description="The transaction table in markdown/html format titled 'TRANSACTION OVERVIEW' with columns: Date, Transaction Reference, Ref.No./Chq.No., Credit, Debit, and Balance. Include all transaction rows.")

class YesBankSavingsAccount(BaseModel):
    """Pydantic model for extracting transaction tables from Yes Bank statements"""
    table: str = Field(description="The transaction table in markdown/html format called Statement Of Transactions")

class AxisBankSavingsAccount(BaseModel):
    """Pydantic model for extracting transaction tables from Axis Bank statements"""
    table: str = Field(description="The transaction table in markdown/html format for a table with the heading 'Statement for Account No. 92501XXXXX12081...' and containing account statement with columns: Date, Transaction Details, Chq No., Withdrawal, Deposits, Balance")

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
