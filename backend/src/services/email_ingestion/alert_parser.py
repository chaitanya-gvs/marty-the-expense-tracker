from __future__ import annotations

import re
import html as html_lib
from datetime import datetime
from email.utils import parsedate_to_datetime
from typing import Dict, Any, Optional

from src.services.email_ingestion.alert_rules import (
    AMOUNT_REGEXES,
    DIRECTION_KEYWORDS,
    REFERENCE_REGEXES,
    ACCOUNT_REGEXES,
    MERCHANT_REGEXES,
)


class EmailAlertParser:
    """Rule-based parser for UPI/credit/debit alert emails."""

    def parse(self, email_content: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        subject = email_content.get("subject", "") or ""
        sender = email_content.get("sender", "") or ""
        body = email_content.get("body", "") or ""
        message_id = email_content.get("id")

        if self._is_statement_email(subject, body):
            return None

        combined_text = f"{subject}\n{body}"
        combined_text = self._normalize_text(combined_text)
        combined_lower = combined_text.lower()

        parsed_fields = self._parse_by_sender(sender, subject, body)
        amount = parsed_fields.get("amount") if parsed_fields else self._extract_amount(combined_text)
        direction = parsed_fields.get("direction") if parsed_fields else self._detect_direction(combined_lower)

        if amount is None or direction is None:
            return None

        reference_number = self._extract_reference(combined_text)
        account_identifier = self._extract_account_identifier(combined_text)
        account_last4 = self._extract_last4(combined_text)
        merchant = self._extract_merchant(combined_text)

        parsed_date = self._extract_email_date(email_content.get("date"))
        transaction_date = parsed_fields.get("date") if parsed_fields else None
        transaction_time = parsed_fields.get("time") if parsed_fields else None
        if not transaction_date and parsed_date:
            transaction_date = parsed_date.date().isoformat()
        if not transaction_time and parsed_date:
            transaction_time = parsed_date.time().strftime("%H:%M:%S")

        description = parsed_fields.get("description") if parsed_fields else None
        if not description:
            description = merchant or subject or "UPI Transaction Alert"
        description = self._post_process_description(description)

        return {
            "transaction_date": transaction_date,
            "transaction_time": transaction_time,
            "amount": amount,
            "transaction_type": direction,
            "description": description.strip(),
            "reference_number": reference_number or "",
            "account_identifier": account_identifier,
            "account_last4": account_last4,
            "email_message_id": message_id,
            "email_sender": sender,
            "email_subject": subject,
            "raw_data": {
                "source": "email_alert",
                "sender": sender,
                "subject": subject,
                "reference_number": reference_number,
                "account_identifier": account_identifier,
                "account_last4": account_last4,
            },
        }

    def _is_statement_email(self, subject: str, body: str) -> bool:
        combined = f"{subject} {body}".lower()
        statement_terms = [
            "statement",
            "e-statement",
            "statement for the period",
            "credit card statement",
        ]
        return any(term in combined for term in statement_terms)

    def _normalize_text(self, text: str) -> str:
        normalized = text.replace("\u00a0", " ")
        normalized = normalized.replace("\r\n", "\n").replace("\r", "\n")
        return normalized

    def _post_process_description(self, description: str) -> str:
        cleaned = html_lib.unescape(description or "")
        cleaned = re.sub(r"<[^>]+>", " ", cleaned)
        cleaned = cleaned.replace("\u00a0", " ")
        cleaned = re.sub(r"[ \t]+", " ", cleaned)
        cleaned = re.sub(r"\s*\n\s*", " ", cleaned)
        cleaned = cleaned.strip(" \t\r\n-:;")
        return cleaned or description

    def _parse_by_sender(self, sender: str, subject: str, body: str) -> Dict[str, Any]:
        sender_lower = sender.lower()
        combined = f"{subject}\n{body}"
        combined_lower = combined.lower()

        if "yes.bank.in" in sender_lower:
            return self._parse_yes_bank(combined)
        if "sbicard.com" in sender_lower:
            return self._parse_sbi_card(combined)
        if "hdfcbank.net" in sender_lower:
            return self._parse_hdfc(combined)
        if "axis.bank.in" in sender_lower or "axisbank.com" in sender_lower:
            return self._parse_axis(combined)
        if "icicibank.com" in sender_lower:
            return self._parse_icici(combined)

        return {
            "amount": self._extract_amount(combined),
            "direction": self._detect_direction(combined_lower),
            "description": None,
            "date": None,
            "time": None,
        }

    def _parse_yes_bank(self, text: str) -> Dict[str, Any]:
        amount = self._extract_amount(text)
        direction = "credit" if "credited" in text.lower() else "debit" if "debited" in text.lower() else None
        date_value, time_value = self._extract_datetime(text)
        description = self._extract_after_phrase(text, "on account of")
        return {
            "amount": amount,
            "direction": direction,
            "description": description,
            "date": date_value,
            "time": time_value,
        }

    def _parse_sbi_card(self, text: str) -> Dict[str, Any]:
        amount = self._extract_amount(text)
        lowered = text.lower()
        direction = "debit" if ("spent" in lowered or "debited" in lowered) else "credit" if "credited" in lowered else None
        date_value, time_value = self._extract_datetime(text)
        if "e-mandate" in lowered:
            description = self._extract_sbi_emandate_merchant(text)
        else:
            description = self._extract_sbi_regular_merchant(text)
        return {
            "amount": amount,
            "direction": direction,
            "description": description,
            "date": date_value,
            "time": time_value,
        }

    def _parse_hdfc(self, text: str) -> Dict[str, Any]:
        amount = self._extract_amount(text)
        lowered = text.lower()
        direction = "debit" if "debited" in lowered else "credit" if "credited" in lowered else None
        description = self._extract_between(text, "towards", " on ")
        return {
            "amount": amount,
            "direction": direction,
            "description": description,
            "date": None,
            "time": None,
        }

    def _parse_axis(self, text: str) -> Dict[str, Any]:
        amount = self._extract_amount(text)
        lowered = text.lower()
        direction = "debit" if ("spent" in lowered or "debited" in lowered) else "credit" if "credited" in lowered else None
        date_value, time_value = self._extract_datetime(text)
        description = self._extract_field_label(text, "Merchant Name") or self._extract_merchant_from_at(text)
        return {
            "amount": amount,
            "direction": direction,
            "description": description,
            "date": date_value,
            "time": time_value,
        }

    def _parse_icici(self, text: str) -> Dict[str, Any]:
        amount = self._extract_amount(text)
        lowered = text.lower()
        direction = "debit" if "debited" in lowered or "spent" in lowered else "credit" if "credited" in lowered else None
        date_value, time_value = self._extract_datetime(text)
        description = self._extract_merchant_from_at(text)
        return {
            "amount": amount,
            "direction": direction,
            "description": description,
            "date": date_value,
            "time": time_value,
        }

    def _extract_datetime(self, text: str) -> tuple[Optional[str], Optional[str]]:
        month_map = {
            "JAN": "01",
            "FEB": "02",
            "MAR": "03",
            "APR": "04",
            "MAY": "05",
            "JUN": "06",
            "JUL": "07",
            "AUG": "08",
            "SEP": "09",
            "OCT": "10",
            "NOV": "11",
            "DEC": "12",
        }

        # Pattern: 02-FEB-2026 16:31:39
        match = re.search(r"(\d{2})-([A-Z]{3})-(\d{4})\s+(\d{2}:\d{2}:\d{2})", text)
        if match:
            day, mon, year, time_value = match.groups()
            month = month_map.get(mon.upper())
            if month:
                return f"{year}-{month}-{day}", time_value

        # Pattern: 01/09/25 or 01/09/2026
        match = re.search(r"(\d{2})/(\d{2})/(\d{2,4})", text)
        if match:
            day, month, year = match.groups()
            if len(year) == 2:
                year = f"20{year}"
            return f"{year}-{month}-{day}", None

        # Pattern: 30-08-2025 15:45:57
        match = re.search(r"(\d{2})-(\d{2})-(\d{4})\s+(\d{2}:\d{2}:\d{2})", text)
        if match:
            day, month, year, time_value = match.groups()
            return f"{year}-{month}-{day}", time_value

        return None, None

    def _extract_after_phrase(self, text: str, phrase: str) -> Optional[str]:
        lowered = text.lower()
        if phrase not in lowered:
            return None
        idx = lowered.find(phrase)
        if idx == -1:
            return None
        return text[idx + len(phrase):].strip().splitlines()[0]

    def _extract_merchant_from_at(self, text: str) -> Optional[str]:
        match = re.search(r"\bat\s+([A-Za-z0-9 &.\-]{3,})", text, re.IGNORECASE)
        if not match:
            return None
        merchant = match.group(1).strip()
        merchant = re.split(r"\bon\b|\bvia\b|\busing\b", merchant, flags=re.IGNORECASE)[0].strip()
        return merchant or None

    def _extract_sbi_emandate_merchant(self, text: str) -> Optional[str]:
        match = re.search(
            r"transaction\s+of\s+rs\.?\s*[\d,]+(?:\.\d{1,2})?\s+at\s+([A-Za-z0-9 &./_-]+?)\s+against\s+e-?mandate",
            text,
            re.IGNORECASE,
        )
        if match:
            return match.group(1).strip()
        return self._extract_merchant_from_at(text)

    def _extract_sbi_regular_merchant(self, text: str) -> Optional[str]:
        match = re.search(
            r"spent\s+on\s+your\s+sbi\s+credit\s+card.*?\s+at\s+([A-Za-z0-9 &./_-]+)",
            text,
            re.IGNORECASE,
        )
        if match:
            merchant = match.group(1).strip()
            merchant = re.split(r"\bon\b|\bfrom\b|\busing\b", merchant, flags=re.IGNORECASE)[0].strip()
            return merchant or None
        return self._extract_merchant_from_at(text)

    def _extract_between(self, text: str, start_phrase: str, end_phrase: str) -> Optional[str]:
        lowered = text.lower()
        start_idx = lowered.find(start_phrase.lower())
        if start_idx == -1:
            return None
        end_idx = lowered.find(end_phrase.lower(), start_idx + len(start_phrase))
        if end_idx == -1:
            return None
        value = text[start_idx + len(start_phrase):end_idx].strip()
        return value or None

    def _extract_field_label(self, text: str, label: str) -> Optional[str]:
        normalized = self._normalize_text(text)
        normalized_lower = normalized.lower()
        label_lower = label.lower()
        idx = normalized_lower.find(label_lower)
        if idx == -1:
            return None
        tail = normalized[idx + len(label):]
        tail = re.sub(r"^\\s*:\\s*", "", tail)
        for line in re.split(r"[\r\n]+", tail):
            candidate = line.strip()
            if not candidate:
                continue
            if not re.search(r"[A-Za-z0-9]", candidate):
                continue
            candidate = re.split(
                r"\\b(Account|Date|Time|Available|Total)\\b",
                candidate,
                flags=re.IGNORECASE,
            )[0].strip()
            return candidate or None
        return None

    def _extract_amount(self, text: str) -> Optional[float]:
        for regex in AMOUNT_REGEXES:
            match = regex.search(text)
            if match:
                amount_str = match.group(1).replace(",", "")
                try:
                    return float(amount_str)
                except ValueError:
                    continue
        return None

    def _detect_direction(self, text_lower: str) -> Optional[str]:
        for direction, keywords in DIRECTION_KEYWORDS.items():
            if any(keyword in text_lower for keyword in keywords):
                return direction
        return None

    def _extract_reference(self, text: str) -> Optional[str]:
        for regex in REFERENCE_REGEXES:
            match = regex.search(text)
            if match:
                return match.group(1).strip()
        return None

    def _extract_account_identifier(self, text: str) -> Optional[str]:
        for regex in ACCOUNT_REGEXES:
            match = regex.search(text)
            if match:
                return match.group(1).strip()
        return None

    def _extract_last4(self, text: str) -> Optional[str]:
        patterns = [
            re.compile(r"(?:xx|[*x]{2,})\s*([0-9]{4})", re.IGNORECASE),
            re.compile(r"(?:a/c|acct|account|ending|card)\D*([0-9]{4})", re.IGNORECASE),
            re.compile(r"\b\d{4}\b"),
        ]
        for pattern in patterns:
            match = pattern.search(text)
            if match:
                return match.group(1) if match.lastindex else match.group(0)
        return None

    def _extract_merchant(self, text: str) -> Optional[str]:
        for regex in MERCHANT_REGEXES:
            match = regex.search(text)
            if match:
                merchant = match.group(1).strip()
                # Trim common trailing phrases
                merchant = re.split(r"\bon\b|\bvia\b|\busing\b", merchant, flags=re.IGNORECASE)[0].strip()
                if merchant:
                    return merchant
        return None

    def _extract_email_date(self, date_str: Optional[str]) -> Optional[datetime]:
        if not date_str:
            return None
        try:
            return parsedate_to_datetime(date_str)
        except (TypeError, ValueError):
            return None
