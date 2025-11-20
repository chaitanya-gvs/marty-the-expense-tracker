"""
Bank Statement Extraction Schemas

This module contains Pydantic models for extracting structured data from different bank statements.
"""

from pydantic import BaseModel, Field
from typing import Dict, Type


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
