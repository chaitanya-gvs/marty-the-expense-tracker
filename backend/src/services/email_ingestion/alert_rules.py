from __future__ import annotations

import re
from typing import List


DEFAULT_ALERT_KEYWORDS: List[str] = [
    "UPI",
    "debited",
    "credited",
    "spent",
    "withdrawn",
    "payment",
    "card",
    "IMPS",
    "NEFT",
    "transaction",
]

AMOUNT_REGEXES = [
    re.compile(r"(?:rs\.?|inr|₹)\s*([0-9,]+(?:\.\d{1,2})?)", re.IGNORECASE),
    re.compile(r"([0-9,]+(?:\.\d{1,2})?)\s*(?:rs\.?|inr)", re.IGNORECASE),
]

DIRECTION_KEYWORDS = {
    "debit": [
        "debited",
        "spent",
        "withdrawn",
        "paid",
        "sent",
        "purchase",
        "used",
        "charged",
    ],
    "credit": [
        "credited",
        "received",
        "refund",
        "reversed",
        "cashback",
    ],
}

REFERENCE_REGEXES = [
    re.compile(r"(?:rrn|utr|txn(?:\s*id)?|txnid|reference(?:\s*no)?|ref(?:\.?)?)[:\s#-]*([A-Za-z0-9/-]+)", re.IGNORECASE),
]

ACCOUNT_REGEXES = [
    re.compile(r"(?:a/c|acct|account|card|card\s*ending|ending)\s*[*xX-]*\s*([0-9]{3,4})", re.IGNORECASE),
    re.compile(r"[*xX]{2,}\s*([0-9]{3,4})", re.IGNORECASE),
]

MERCHANT_REGEXES = [
    re.compile(r"\bto\s+([A-Za-z0-9 &.\-]{3,})", re.IGNORECASE),
    re.compile(r"\bat\s+([A-Za-z0-9 &.\-]{3,})", re.IGNORECASE),
]
