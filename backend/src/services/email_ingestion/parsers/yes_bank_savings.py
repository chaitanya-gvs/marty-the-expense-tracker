from __future__ import annotations

from typing import Any, Dict, Optional

from src.services.email_ingestion.parsers.base import BaseAlertParser


class YesBankSavingsParser(BaseAlertParser):
    def parse_regular(self, email_content: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        subject = email_content.get("subject", "") or ""
        body = email_content.get("body", "") or ""
        combined = f"{subject}\n{body}"
        lower = combined.lower()
        amount = self._extract_amount(combined)
        direction = "credit" if "credited" in lower else \
                    "debit" if "debited" in lower else None
        date_val, time_val = self._extract_datetime(combined)
        description = self._extract_after(combined, "on account of")
        ref = self._extract_reference(combined)
        last4 = self._extract_last4(combined)
        return self._build_result(email_content, amount, direction,
                                  description or subject, date_val, time_val, ref, last4)

    def _extract_after(self, text: str, phrase: str) -> Optional[str]:
        idx = text.lower().find(phrase.lower())
        if idx == -1:
            return None
        return text[idx + len(phrase):].strip().splitlines()[0].strip() or None
