"""
Utilities for generating consistent {account}_{date} filenames for PDFs and CSVs.
Strips suffixes like _savings, _account, _credit_card to produce short forms (sbi, yes_bank, etc.).
"""


def nickname_to_filename_prefix(nickname: str) -> str:
    """
    Convert account nickname to short filename prefix.
    Examples: "SBI Savings Account" -> "sbi", "Yes Bank Savings" -> "yes_bank"
    """
    prefix = nickname.lower().replace(" ", "_")
    for suffix in ("_credit_card", "_account", "_savings"):
        if prefix.endswith(suffix):
            prefix = prefix[: -len(suffix)]
    return prefix.rstrip("_")
