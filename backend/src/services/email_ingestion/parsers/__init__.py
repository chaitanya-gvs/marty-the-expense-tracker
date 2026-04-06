from __future__ import annotations

from typing import Dict, Optional
from src.services.email_ingestion.parsers.base import BaseAlertParser


class BankParserRegistry:
    """Maps alert_sender email addresses to their parser instances.
    Populated lazily on first use so import order doesn't matter.
    """

    def __init__(self):
        self._registry: Dict[str, BaseAlertParser] = {}
        self._built = False

    def _build(self):
        if self._built:
            return
        from src.services.email_ingestion.parsers.sbi_card import SBICardParser
        from src.services.email_ingestion.parsers.hdfc import HDFCParser
        from src.services.email_ingestion.parsers.icici import ICICIParser
        from src.services.email_ingestion.parsers.axis_credit import AxisCreditParser
        from src.services.email_ingestion.parsers.axis_savings import AxisSavingsParser
        from src.services.email_ingestion.parsers.yes_bank import YesBankParser
        # Keys must match exactly the alert_sender values stored in the accounts table
        self._registry = {
            "alerts@sbicard.com": SBICardParser(),
            "alerts@hdfcbank.net": HDFCParser(),
            "alerts@icicibank.com": ICICIParser(),
            "alerts@axisbank.com": AxisCreditParser(),
            "alerts@axisbank.in": AxisSavingsParser(),
            "alerts@yesbank.in": YesBankParser(),
        }
        self._built = True

    def get_parser(self, alert_sender: str) -> Optional[BaseAlertParser]:
        self._build()
        return self._registry.get(alert_sender.lower().strip())

    def all_senders(self):
        self._build()
        return list(self._registry.keys())


# Singleton used by the ingestion service
parser_registry = BankParserRegistry()
