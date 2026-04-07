import pytest
from src.services.email_ingestion.parsers.base import BaseAlertParser
from src.services.email_ingestion.parsers import BankParserRegistry


def test_base_parser_is_abstract():
    with pytest.raises(TypeError):
        BaseAlertParser()


def test_registry_returns_empty_list_for_unknown_sender():
    registry = BankParserRegistry()
    assert registry.get_parsers("unknown@random.com") == []


def test_registry_returns_parsers_for_known_senders():
    registry = BankParserRegistry()
    # SBI Card — single parser
    assert len(registry.get_parsers("onlinesbicard@sbicard.com")) == 1
    # Axis — two parsers (Atlas CC + Savings share the same sender domain)
    assert len(registry.get_parsers("alerts@axis.bank.in")) == 2
    # HDFC, ICICI, Yes Bank — single parsers each
    assert len(registry.get_parsers("alerts@hdfcbank.bank.in")) == 1
    assert len(registry.get_parsers("credit_cards@icicibank.com")) == 1
    assert len(registry.get_parsers("alerts@yes.bank.in")) == 1


def test_registry_returns_parser_by_account_nickname():
    registry = BankParserRegistry()
    assert registry.get_parser_for_account("cashback sbi credit card") is not None
    assert registry.get_parser_for_account("swiggy hdfc credit card") is not None
    assert registry.get_parser_for_account("nonexistent account") is None
