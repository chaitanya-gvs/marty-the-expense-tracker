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

        # For payment-received emails use a static description — the body has no
        # merchant; _extract_merchant_at would grab footer promo text otherwise.
        if direction == "credit" and any(k in lower for k in ["payment received", "has been received", "received on your"]):
            description = "Credit Card Payment"
        else:
            # "Info: AMAZON PAY IN GROCERY" is the most reliable source.
            # Fall back to "at <merchant>" only after stripping email/URL tokens
            # so we don't grab "customer.care" from the footer link.
            description = self._extract_info_field(combined) or \
                          self._extract_merchant_at(combined)

        ref = self._extract_reference(combined)
        last4 = self._extract_last4(combined)
        return self._build_result(email_content, amount, direction,
                                  description or subject, date_val, time_val, ref, last4)

    def _extract_info_field(self, text: str) -> Optional[str]:
        """Extract merchant from 'Info: <merchant>.' pattern in ICICI transaction alerts."""
        m = re.search(r"\bInfo[:\s]+([A-Za-z0-9 &/.,\-]{3,}?)\.?\s*$",
                      text, re.IGNORECASE | re.MULTILINE)
        if m:
            return m.group(1).strip()
        return None

    def _extract_merchant_at(self, text: str) -> Optional[str]:
        # Strip lines containing email addresses or URLs before matching so
        # footer links like "customer.care@icicibank.com" don't pollute the result.
        clean = re.sub(r"[^\n]*(?:@|\bhttp|\bwww\.)[^\n]*", "", text)
        m = re.search(r"\bat\s+([A-Za-z0-9 &.\-]{3,})", clean, re.IGNORECASE)
        if not m:
            return None
        merchant = m.group(1).strip()
        return re.split(r"\bon\b|\bvia\b|\busing\b", merchant, flags=re.IGNORECASE)[0].strip()
