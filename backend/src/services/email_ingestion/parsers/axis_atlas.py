from __future__ import annotations
import re
from typing import Any, Dict, Optional
from src.services.email_ingestion.parsers.base import BaseAlertParser


class AxisAtlasParser(BaseAlertParser):
    """Axis Atlas credit card — sender: alerts@axis.bank.in.
    Disambiguates from Axis Savings by rejecting emails that contain 'a/c no.'
    (savings account pattern) in the subject/body.
    """

    def parse_regular(self, email_content: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        subject = email_content.get("subject", "") or ""
        body = email_content.get("body", "") or ""
        combined = f"{subject}\n{body}"
        lower = combined.lower()

        # Reject savings account emails (they say "a/c no." not "credit card no.")
        if "a/c no." in lower:
            return None

        # Try extracting amount directly from the "Transaction Amount:" label first.
        # This avoids the collapsed-whitespace problem where stripping "available/credit limit"
        # lines wipes out the entire single-line body including the transaction amount.
        tx_amount_str = self._extract_field_label(combined, "Transaction Amount")

        # Skip non-INR transactions — the statement carries the correct INR equivalent.
        # If a "Transaction Amount:" label is present but has no INR/Rs./₹, it's forex.
        _INR_RE = re.compile(r"(?:inr|rs\.?|₹)", re.IGNORECASE)
        if tx_amount_str and not _INR_RE.search(tx_amount_str):
            return None

        amount = self._extract_amount(tx_amount_str) if tx_amount_str else None

        if amount is None:
            # Fallback for older inline-subject format.
            # Skip if the subject amount is non-INR (e.g. "USD 175 spent on...").
            if subject and not _INR_RE.search(subject) and self._extract_amount(subject) is None:
                # Check if subject has any amount-like token — if so it's a forex subject email
                if re.search(r"\b[A-Z]{3}\s+[\d,]+", subject):
                    return None
            clean = re.sub(r"(?i)[^\n]*(?:available|avl\.?|credit limit|bal\.?)[^\n]*", "", combined)
            amount = self._extract_amount(clean)

        # Direction: explicit keyword wins; structured template ("Transaction Amount:" present)
        # is always a debit unless the text says credited/reversed.
        if any(k in lower for k in ["credited", "reversed", "cashback", "refund"]):
            direction: Optional[str] = "credit"
        elif any(k in lower for k in ["spent", "debited", "withdrawn", "paid", "charged"]):
            direction = "debit"
        elif tx_amount_str is not None:
            # Structured Axis template — credit card charges are debits by default
            direction = "debit"
        else:
            direction = None

        date_val, time_val = self._extract_datetime(combined)
        description = self._extract_field_label(combined, "Merchant Name") or \
                      self._extract_merchant_at(combined)
        ref = self._extract_reference(combined)
        last4 = self._extract_last4(combined)
        return self._build_result(email_content, amount, direction,
                                  description or subject, date_val, time_val, ref, last4)

    # Known field labels that delimit the end of a value in the collapsed single-line body
    _FIELD_DELIMITERS = re.compile(
        r"(?:Transaction Amount|Merchant Name|Axis Bank Credit Card No|"
        r"Date\s*&\s*Time|Available Limit|Total Credit Limit)\s*[:\*\.]",
        re.IGNORECASE,
    )

    def _extract_field_label(self, text: str, label: str) -> Optional[str]:
        idx = text.lower().find(label.lower())
        if idx == -1:
            return None
        tail = text[idx + len(label):].lstrip(" :\t")
        # If the body has real newlines, find the first non-empty line
        if "\n" in tail:
            for line in tail.splitlines():
                value = line.strip()
                if value:
                    return value
            return None
        # Collapsed single-line body — stop at the next field delimiter
        m = self._FIELD_DELIMITERS.search(tail)
        return (tail[:m.start()].strip() if m else tail.strip()) or None

    def _extract_forex_amount(self, text: str) -> Optional[float]:
        """Extract foreign currency amounts (USD, EUR, GBP, AED, QAR…) as numeric value.
        Used when no INR amount is present (e.g. small-value forex reversals).
        The value will be unmatched against INR statement data but shouldn't fail parsing.
        """
        m = re.search(r"(?:USD|EUR|GBP|AED|QAR|SGD|AUD|CAD)\s*([\d,]+(?:\.\d{1,2})?)", text, re.IGNORECASE)
        if m:
            try:
                return float(m.group(1).replace(",", ""))
            except ValueError:
                pass
        return None

    def _extract_merchant_at(self, text: str) -> Optional[str]:
        m = re.search(r"\bat\s+([A-Za-z0-9 &.\-]{3,})", text, re.IGNORECASE)
        if not m:
            return None
        merchant = m.group(1).strip()
        return re.split(r"\bon\b|\bvia\b|\busing\b", merchant, flags=re.IGNORECASE)[0].strip()
