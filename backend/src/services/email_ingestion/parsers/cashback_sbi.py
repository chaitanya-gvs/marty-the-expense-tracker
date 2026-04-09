from __future__ import annotations
import re
from typing import Any, Dict, Optional
from src.services.email_ingestion.parsers.base import BaseAlertParser


class CashbackSBIParser(BaseAlertParser):
    def parse_regular(self, email_content: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        subject = email_content.get("subject", "") or ""
        body = email_content.get("body", "") or ""
        combined = f"{subject}\n{body}"
        lower = combined.lower()
        amount = self._extract_amount(combined)
        direction = "debit" if any(k in lower for k in ["spent", "debited"]) else \
                    "credit" if "credited" in lower else None
        date_val, time_val = self._extract_datetime(combined)
        description = self._extract_sbi_merchant(combined)
        ref = self._extract_reference(combined)
        last4 = self._extract_last4(combined)
        return self._build_result(email_content, amount, direction, description or subject,
                                  date_val, time_val, ref, last4)

    def parse_emandate(self, email_content: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        subject = email_content.get("subject", "") or ""
        body = email_content.get("body", "") or ""
        combined = f"{subject}\n{body}"
        amount = self._extract_amount(combined) or self._extract_mandate_amount(combined)
        direction = "debit"
        date_val, time_val = self._extract_datetime(combined)
        description = self._extract_sbi_emandate_merchant(combined)
        ref = self._extract_reference(combined)
        last4 = self._extract_last4(combined)
        return self._build_result(email_content, amount, direction,
                                  description or "E-Mandate Debit", date_val, time_val, ref, last4)

    def _extract_sbi_merchant(self, text: str) -> Optional[str]:
        m = re.search(r"spent\s+on\s+your\s+sbi\s+credit\s+card.*?\s+at\s+([A-Za-z0-9 &./_-]+)",
                      text, re.IGNORECASE)
        if m:
            merchant = m.group(1).strip()
            return re.split(r"\bon\b|\bfrom\b|\busing\b", merchant, flags=re.IGNORECASE)[0].strip()
        m = re.search(r"\bat\s+([A-Za-z0-9 &.\-]{3,})", text, re.IGNORECASE)
        if m:
            return m.group(1).strip()
        return None

    def _extract_sbi_emandate_merchant(self, text: str) -> Optional[str]:
        # Pattern 1: "transaction of Rs.X at MERCHANT against e-mandate"
        m = re.search(
            r"transaction\s+of\s+rs\.?\s*[\d,]+(?:\.\d{1,2})?\s+at\s+([A-Za-z0-9 &./_-]+?)\s+against\s+e-?mandate",
            text, re.IGNORECASE)
        if m:
            return m.group(1).strip()
        # Pattern 2: success notification — "E-Mandate ... MERCHANT" or "mandate for MERCHANT"
        m = re.search(r"(?:e-?mandate|mandate)\s+(?:for|against|at)\s+([A-Za-z0-9 &./_-]+)",
                      text, re.IGNORECASE)
        if m:
            return re.split(r"\bon\b|\bvia\b|\bhas\b", m.group(1), flags=re.IGNORECASE)[0].strip()
        return None

    def _extract_mandate_amount(self, text: str) -> Optional[float]:
        """Broader amount extraction for e-mandate success notifications."""
        # "Mandate Amount: Rs. 200" or "amount of Rs.200" or "debited.*Rs.200"
        for pattern in [
            re.compile(r"mandate\s+amount\s*[:\-]\s*(?:rs\.?|inr|₹)\s*([\d,]+(?:\.\d{1,2})?)", re.IGNORECASE),
            re.compile(r"amount\s+of\s+(?:rs\.?|inr|₹)\s*([\d,]+(?:\.\d{1,2})?)", re.IGNORECASE),
            re.compile(r"debited\s+(?:with\s+)?(?:rs\.?|inr|₹)\s*([\d,]+(?:\.\d{1,2})?)", re.IGNORECASE),
        ]:
            m = pattern.search(text)
            if m:
                try:
                    return float(m.group(1).replace(",", ""))
                except ValueError:
                    continue
        return None
