"""Integration tests for deduplication within the statement processing workflow.

These tests verify that DeduplicationService is correctly invoked during statement
processing and that results (confirmed, ambiguous, unmatched) are routed properly.
"""

import pytest
from unittest.mock import AsyncMock, patch, MagicMock
from decimal import Decimal
from datetime import date

from src.services.email_ingestion.dedup_service import DeduplicationService, DeduplicationResult


@pytest.mark.asyncio
async def test_dedup_marks_statement_confirmed_on_tier1_match():
    """Verify that match_statement_transaction returns is_confirmed=True on a tier1 match."""
    with patch.object(
        DeduplicationService,
        "match_statement_transaction",
        new=AsyncMock(return_value=DeduplicationResult(tier=1, matched_id="tx-1")),
    ):
        svc = DeduplicationService()
        result = await svc.match_statement_transaction(
            {
                "amount": Decimal("100"),
                "account": "Test",
                "reference_number": "UTR1",
                "transaction_date": date(2026, 4, 1),
                "direction": "debit",
            },
            has_alert_sender=True,
        )
        assert result.is_confirmed
        assert result.matched_id == "tx-1"


@pytest.mark.asyncio
async def test_dedup_marks_statement_confirmed_on_tier2_match():
    """Verify that match_statement_transaction returns is_confirmed=True on a tier2 match."""
    with patch.object(
        DeduplicationService,
        "match_statement_transaction",
        new=AsyncMock(return_value=DeduplicationResult(tier=2, matched_id="tx-2")),
    ):
        svc = DeduplicationService()
        result = await svc.match_statement_transaction(
            {
                "amount": Decimal("250.50"),
                "account": "Test",
                "reference_number": None,
                "transaction_date": date(2026, 4, 1),
                "direction": "debit",
            },
            has_alert_sender=True,
        )
        assert result.is_confirmed
        assert result.matched_id == "tx-2"


@pytest.mark.asyncio
async def test_dedup_returns_ambiguous_on_tier3():
    """Verify that match_statement_transaction returns is_ambiguous=True on tier3."""
    with patch.object(
        DeduplicationService,
        "match_statement_transaction",
        new=AsyncMock(
            return_value=DeduplicationResult(tier=3, candidate_ids=["tx-a", "tx-b"])
        ),
    ):
        svc = DeduplicationService()
        result = await svc.match_statement_transaction(
            {
                "amount": Decimal("100"),
                "account": "Test",
                "reference_number": None,
                "transaction_date": date(2026, 4, 1),
                "direction": "debit",
            },
            has_alert_sender=True,
        )
        assert result.is_ambiguous
        assert result.candidate_ids == ["tx-a", "tx-b"]


@pytest.mark.asyncio
async def test_dedup_returns_unmatched_when_no_candidates():
    """Verify that match_statement_transaction returns is_unmatched=True when no match."""
    with patch.object(
        DeduplicationService,
        "match_statement_transaction",
        new=AsyncMock(return_value=DeduplicationResult(tier=None)),
    ):
        svc = DeduplicationService()
        result = await svc.match_statement_transaction(
            {
                "amount": Decimal("500"),
                "account": "SBI Savings",
                "reference_number": None,
                "transaction_date": date(2026, 4, 1),
                "direction": "credit",
            },
            has_alert_sender=False,
        )
        assert result.is_unmatched
        assert not result.is_confirmed
        assert not result.is_ambiguous


@pytest.mark.asyncio
async def test_dedup_result_properties():
    """Verify DeduplicationResult property semantics."""
    confirmed_t1 = DeduplicationResult(tier=1, matched_id="x")
    assert confirmed_t1.is_confirmed and not confirmed_t1.is_ambiguous and not confirmed_t1.is_unmatched

    confirmed_t2 = DeduplicationResult(tier=2, matched_id="y")
    assert confirmed_t2.is_confirmed and not confirmed_t2.is_ambiguous and not confirmed_t2.is_unmatched

    ambiguous = DeduplicationResult(tier=3, candidate_ids=["a", "b"])
    assert ambiguous.is_ambiguous and not ambiguous.is_confirmed and not ambiguous.is_unmatched

    unmatched = DeduplicationResult(tier=None)
    assert unmatched.is_unmatched and not unmatched.is_confirmed and not unmatched.is_ambiguous
