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
