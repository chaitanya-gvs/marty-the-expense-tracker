from __future__ import annotations
import re
from typing import Any, Dict, Optional
from src.services.email_ingestion.parsers.base import BaseAlertParser


class AxisSavingsParser(BaseAlertParser):
    """Axis Bank savings account — sender domain differs from credit card."""

    def parse_regular(self, email_content: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        subject = email_content.get("subject", "") or ""
        body = email_content.get("body", "") or ""
        combined = f"{subject}\n{body}"
        lower = combined.lower()
        amount = self._extract_amount(combined)
        direction = "debit" if any(k in lower for k in ["debited", "withdrawn", "sent"]) else \
                    "credit" if any(k in lower for k in ["credited", "received"]) else None
        date_val, time_val = self._extract_datetime(combined)
        description = self._extract_to_from(combined) or subject
        ref = self._extract_reference(combined)
        last4 = self._extract_last4(combined)
        return self._build_result(email_content, amount, direction,
                                  description, date_val, time_val, ref, last4)

    def _extract_to_from(self, text: str) -> Optional[str]:
        m = re.search(r"\bto\s+([A-Za-z0-9 &.\-]{3,})", text, re.IGNORECASE)
        if m:
            return re.split(r"\bon\b|\bvia\b", m.group(1), flags=re.IGNORECASE)[0].strip()
        m = re.search(r"\bfrom\s+([A-Za-z0-9 &.\-]{3,})", text, re.IGNORECASE)
        return m.group(1).strip() if m else None
