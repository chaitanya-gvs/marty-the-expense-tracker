"""
Utilities for generating consistent {account}_{date} filenames for PDFs and CSVs.

The canonical identifier for an account is its schema key — derived by stripping
exactly one trailing suffix (' Credit Card' or ' Account') from the nickname and
lowercasing. This key is stable, unique per account, and matches the keys used in
BANK_STATEMENT_MODELS, PAGE_FILTER_CONFIGS, and TransactionStandardizer methods.
"""


def nickname_to_schema_key(nickname: str) -> str:
    """
    Convert an account nickname to its canonical schema key.

    Strips exactly one trailing suffix (' Credit Card' or ' Account'), lowercases,
    and replaces spaces with underscores. The result is used as the prefix in GCS
    filenames, statement_processing_log.normalized_filename, and standardizer routing.

    Examples:
      "SBI Savings Account"          -> "sbi_savings"
      "Cashback SBI Credit Card"     -> "cashback_sbi"
      "Yes Bank Savings Account"     -> "yes_bank_savings"
      "Amazon Pay ICICI Credit Card" -> "amazon_pay_icici"
      "Axis Atlas Credit Card"       -> "axis_atlas"
      "Axis Bank Savings Account"    -> "axis_bank_savings"
    """
    if not nickname:
        return ""
    key = nickname.lower()
    if key.endswith(" credit card"):
        key = key[:-12]
    elif key.endswith(" account"):
        key = key[:-8]
    return key.replace(" ", "_").rstrip("_")


def nickname_to_filename_prefix(nickname: str) -> str:
    """Deprecated alias for nickname_to_schema_key(). Use that instead."""
    return nickname_to_schema_key(nickname)
