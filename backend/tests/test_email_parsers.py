import pytest
from src.services.email_ingestion.parsers.base import BaseAlertParser
from src.services.email_ingestion.parsers import BankParserRegistry


def test_base_parser_is_abstract():
    with pytest.raises(TypeError):
        BaseAlertParser()


def test_registry_returns_none_for_unknown_sender():
    registry = BankParserRegistry()
    assert registry.get_parser("unknown@random.com") is None


def test_registry_returns_parser_for_known_sender():
    registry = BankParserRegistry()
    parser = registry.get_parser("alerts@sbicard.com")
    assert parser is not None
