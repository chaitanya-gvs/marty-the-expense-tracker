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

        # Strip lines that mention available balance / limit so the INR amount
        # extractor doesn't pick up "Available Balance: INR 663,110.70" instead
        # of the actual transaction amount.
        clean = re.sub(r"(?i)[^\n]*(?:available|avl\.?|credit limit|bal\.?)[^\n]*", "", combined)
        amount = self._extract_amount(clean) or self._extract_forex_amount(combined)
        direction = "debit" if any(k in lower for k in ["spent", "debited"]) else \
                    "credit" if any(k in lower for k in ["credited", "reversed"]) else None
        date_val, time_val = self._extract_datetime(combined)
        description = self._extract_field_label(combined, "Merchant Name") or \
                      self._extract_merchant_at(combined)
        ref = self._extract_reference(combined)
        last4 = self._extract_last4(combined)
        return self._build_result(email_content, amount, direction,
                                  description or subject, date_val, time_val, ref, last4)

    def _extract_field_label(self, text: str, label: str) -> Optional[str]:
        idx = text.lower().find(label.lower())
        if idx == -1:
            return None
        tail = text[idx + len(label):].lstrip(" :\t")
        return tail.splitlines()[0].strip() or None

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
