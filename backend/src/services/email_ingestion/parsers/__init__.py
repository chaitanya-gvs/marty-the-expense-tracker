from __future__ import annotations

from typing import Dict, List, Optional
from src.services.email_ingestion.parsers.base import BaseAlertParser


class BankParserRegistry:
    """Maps alert_sender email addresses to their parser instances.
    Populated lazily on first use so import order doesn't matter.

    Most senders map to a single parser. Senders shared by multiple accounts
    (e.g. alerts@axis.bank.in for both Axis Atlas CC and Axis Bank Savings)
    map to a list — callers should try each and use the first non-None result.
    Use get_parsers() which always returns a list.
    """

    def __init__(self):
        self._registry: Dict[str, List[BaseAlertParser]] = {}
        self._nickname_registry: Dict[str, BaseAlertParser] = {}
        self._built = False

    def _build(self):
        if self._built:
            return
        from src.services.email_ingestion.parsers.cashback_sbi import CashbackSBIParser
        from src.services.email_ingestion.parsers.swiggy_hdfc import SwiggyHDFCParser
        from src.services.email_ingestion.parsers.amazon_icici import AmazonICICIParser
        from src.services.email_ingestion.parsers.axis_atlas import AxisAtlasParser
        from src.services.email_ingestion.parsers.axis_savings import AxisSavingsParser
        from src.services.email_ingestion.parsers.yes_bank_savings import YesBankSavingsParser

        axis_atlas = AxisAtlasParser()
        axis_savings = AxisSavingsParser()

        # Keys must match exactly the alert_sender values stored in the accounts table.
        # alerts@axis.bank.in is shared by Axis Atlas CC and Axis Bank Savings;
        # each parser self-identifies via subject pattern and returns None if it
        # doesn't recognise the email.
        self._registry = {
            "onlinesbicard@sbicard.com": [CashbackSBIParser()],
            "emandates@sbicard.com": [CashbackSBIParser()],
            "alerts@hdfcbank.bank.in": [SwiggyHDFCParser()],
            "credit_cards@icicibank.com": [AmazonICICIParser()],
            "alerts@axis.bank.in": [axis_atlas, axis_savings],
            "alerts@yes.bank.in": [YesBankSavingsParser()],
        }
        # Nickname-keyed lookup for callers that know which account they're
        # processing (e.g. validate script, ingestion service per-account loop).
        self._nickname_registry = {
            "axis atlas credit card": axis_atlas,
            "axis bank savings account": axis_savings,
            "cashback sbi credit card": self._registry["onlinesbicard@sbicard.com"][0],
            "swiggy hdfc credit card": self._registry["alerts@hdfcbank.bank.in"][0],
            "amazon pay icici credit card": self._registry["credit_cards@icicibank.com"][0],
            "yes bank savings account": self._registry["alerts@yes.bank.in"][0],
        }
        self._built = True

    def get_parsers(self, alert_sender: str) -> List[BaseAlertParser]:
        """Return all parsers for this sender (always a list, may be empty)."""
        self._build()
        return self._registry.get(alert_sender.lower().strip(), [])

    def get_parser_for_account(self, nickname: str) -> Optional[BaseAlertParser]:
        """Return the single parser for a known account nickname, or None."""
        self._build()
        return self._nickname_registry.get(nickname.lower().strip())

    def all_senders(self):
        self._build()
        return list(self._registry.keys())


# Singleton used by the ingestion service
parser_registry = BankParserRegistry()
