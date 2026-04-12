from __future__ import annotations

import html as html_lib
import re
from abc import ABC, abstractmethod
from datetime import datetime
from email.utils import parsedate_to_datetime
from typing import Any, Dict, Optional


AMOUNT_REGEXES = [
    re.compile(r"(?:rs\.?|inr|₹)\s*([0-9,]+(?:\.\d{1,2})?)", re.IGNORECASE),
    re.compile(r"([0-9,]+(?:\.\d{1,2})?)\s*(?:rs\.?|inr)", re.IGNORECASE),
]

DIRECTION_KEYWORDS = {
    "debit": ["debited", "spent", "withdrawn", "paid", "sent", "purchase", "used", "charged"],
    "credit": ["credited", "received", "refund", "reversed", "cashback"],
}

REFERENCE_REGEXES = [
    re.compile(r"(?:rrn|utr|txn(?:\s*id)?|txnid|reference(?:\s*no)?|ref(?:\.?)?)[:\s#-]*([A-Za-z0-9/-]+)", re.IGNORECASE),
]

# Subject keyword patterns that identify non-transaction emails.
# Matched case-insensitively against the email subject.
_NON_TRANSACTION_SUBJECTS: list[tuple[str, ...]] = [
    ("we value your feedback",),
    ("transaction declined",),
    ("upcoming autopay",),
    ("autopay txn. reminder",),
    ("autopay activated",),
    ("autopay is activated",),
    ("autopay for",),                    # e.g. "AutoPay for Wispr: ACTIVATED"
    ("autopay registered",),
    ("confirmation required",),
    ("one time password",),
    (" otp ",),                          # OTP in subject
    ("statement for the period",),
    ("credit card statement",),
    ("e-statement",),
]


class BaseAlertParser(ABC):
    """Abstract base for all bank alert email parsers."""

    EMANDATE_KEYWORDS = ["e-mandate", "emandate", "nach", "auto debit", "standing instruction"]

    def is_emandate(self, text: str) -> bool:
        lower = text.lower()
        return any(kw in lower for kw in self.EMANDATE_KEYWORDS)

    @staticmethod
    def is_non_transaction_subject(subject: str) -> bool:
        """Return True if the subject indicates a non-transaction email that should be skipped."""
        lower = f" {subject.lower()} "  # pad so word-boundary OTP check works
        return any(all(kw in lower for kw in patterns) for patterns in _NON_TRANSACTION_SUBJECTS)

    def parse_emandate(self, email_content: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Override in subclasses that need e-mandate handling."""
        return self.parse_regular(email_content)

    @abstractmethod
    def parse_regular(self, email_content: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Parse a regular (non-mandate) transaction email.
        Return None if required fields (amount/direction) can't be extracted.
        """

    def parse(self, email_content: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        subject = email_content.get("subject", "") or ""
        body = email_content.get("body", "") or ""
        combined = f"{subject}\n{body}"
        if self.is_emandate(combined):
            return self.parse_emandate(email_content)
        return self.parse_regular(email_content)

    # ── Shared extraction helpers ──────────────────────────────────────────

    def _extract_amount(self, text: str) -> Optional[float]:
        for regex in AMOUNT_REGEXES:
            m = regex.search(text)
            if m:
                try:
                    return float(m.group(1).replace(",", ""))
                except ValueError:
                    continue
        return None

    def _detect_direction(self, text_lower: str) -> Optional[str]:
        for direction, keywords in DIRECTION_KEYWORDS.items():
            if any(kw in text_lower for kw in keywords):
                return direction
        return None

    def _extract_reference(self, text: str) -> Optional[str]:
        for regex in REFERENCE_REGEXES:
            m = regex.search(text)
            if m:
                return m.group(1).strip()
        return None

    def _extract_last4(self, text: str) -> Optional[str]:
        for pattern in [
            re.compile(r"(?:xx|[*x]{2,})\s*([0-9]{4})", re.IGNORECASE),
            re.compile(r"(?:a/c|acct|account|ending|card)\D*([0-9]{4})", re.IGNORECASE),
        ]:
            m = pattern.search(text)
            if m:
                return m.group(1)
        return None

    def _extract_datetime(self, text: str):
        """Returns (date_str, time_str) or (None, None)."""
        month_map = {"JAN":"01","FEB":"02","MAR":"03","APR":"04","MAY":"05","JUN":"06",
                     "JUL":"07","AUG":"08","SEP":"09","OCT":"10","NOV":"11","DEC":"12"}
        m = re.search(r"(\d{2})-([A-Z]{3})-(\d{4})\s+(\d{2}:\d{2}:\d{2})", text)
        if m:
            day, mon, year, t = m.groups()
            mo = month_map.get(mon.upper())
            if mo:
                return f"{year}-{mo}-{day}", t
        # DD-MM-YYYY, HH:MM:SS TZ  (e.g. "06-04-2026, 03:57:49 IST")
        m = re.search(r"(\d{2})-(\d{2})-(\d{4}),?\s+(\d{2}:\d{2}:\d{2})", text)
        if m:
            day, mo, year, t = m.groups()
            return f"{year}-{mo}-{day}", t
        m = re.search(r"(\d{2})/(\d{2})/(\d{2,4})", text)
        if m:
            day, mo, year = m.groups()
            year = f"20{year}" if len(year) == 2 else year
            return f"{year}-{mo}-{day}", None
        return None, None

    def _parse_email_date(self, date_str: Optional[str]) -> Optional[datetime]:
        if not date_str:
            return None
        try:
            return parsedate_to_datetime(date_str)
        except (TypeError, ValueError):
            return None

    def _clean_text(self, text: str) -> str:
        text = html_lib.unescape(text or "")
        text = re.sub(r"<[^>]+>", " ", text)
        text = text.replace("\u00a0", " ")
        return re.sub(r"\s+", " ", text).strip()

    def _build_result(
        self,
        email_content: Dict[str, Any],
        amount: Optional[float],
        direction: Optional[str],
        description: str,
        transaction_date: Optional[str],
        transaction_time: Optional[str],
        reference_number: Optional[str],
        account_identifier: Optional[str],
    ) -> Optional[Dict[str, Any]]:
        """Assemble the standard output dict. Returns None if required fields are missing."""
        if amount is None or direction is None:
            return None
        parsed_date = self._parse_email_date(email_content.get("date"))
        if not transaction_date and parsed_date:
            transaction_date = parsed_date.date().isoformat()
        if not transaction_time and parsed_date:
            transaction_time = parsed_date.time().strftime("%H:%M:%S")
        return {
            "transaction_date": transaction_date,
            "transaction_time": transaction_time,
            "amount": amount,
            "direction": direction,
            "description": self._clean_text(description) or email_content.get("subject", "Alert"),
            "reference_number": reference_number,
            "account_identifier": account_identifier,
            "email_message_id": email_content.get("id"),
            "email_sender": email_content.get("sender"),
            "raw_data": {
                "source": "email_alert",
                "sender": email_content.get("sender"),
                "subject": email_content.get("subject"),
                "reference_number": reference_number,
            },
        }
