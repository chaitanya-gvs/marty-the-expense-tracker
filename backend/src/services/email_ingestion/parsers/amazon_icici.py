from __future__ import annotations
import re
from typing import Any, Dict, Optional
from src.services.email_ingestion.parsers.base import BaseAlertParser


class AmazonICICIParser(BaseAlertParser):
    def parse_regular(self, email_content: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        subject = email_content.get("subject", "") or ""
        body = email_content.get("body", "") or ""
        combined = f"{subject}\n{body}"
        lower = combined.lower()

        amount = self._extract_amount(combined)
        # ICICI uses "has been used" for debit and "payment...received" for credit
        if any(k in lower for k in ["debited", "spent", "has been used", "is used"]):
            direction = "debit"
        elif any(k in lower for k in ["credited", "payment received", "has been received", "received on your"]):
            direction = "credit"
        else:
            direction = None

        date_val, time_val = self._extract_datetime(combined)
        description = self._extract_merchant_at(combined)
        ref = self._extract_reference(combined)
        last4 = self._extract_last4(combined)
        return self._build_result(email_content, amount, direction,
                                  description or subject, date_val, time_val, ref, last4)

    def _extract_merchant_at(self, text: str) -> Optional[str]:
        m = re.search(r"\bat\s+([A-Za-z0-9 &.\-]{3,})", text, re.IGNORECASE)
        if not m:
            return None
        merchant = m.group(1).strip()
        return re.split(r"\bon\b|\bvia\b|\busing\b", merchant, flags=re.IGNORECASE)[0].strip()
