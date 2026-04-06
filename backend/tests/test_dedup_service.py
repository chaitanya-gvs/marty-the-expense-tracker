import pytest
from datetime import date
from decimal import Decimal
from unittest.mock import AsyncMock, patch
from src.services.email_ingestion.dedup_service import DeduplicationService, DeduplicationResult


def make_stmt_tx(amount=100.0, account="Test Account", ref="UTR123",
                 tx_date=date(2026, 4, 1), direction="debit"):
    return {"amount": Decimal(str(amount)), "account": account,
            "reference_number": ref, "transaction_date": tx_date, "direction": direction}


def make_email_tx(tx_id="abc-123", amount=100.0, account="Test Account",
                  ref="UTR123", tx_date=date(2026, 4, 1), direction="debit"):
    return {"id": tx_id, "amount": Decimal(str(amount)), "account": account,
            "reference_number": ref, "transaction_date": tx_date, "direction": direction}


@pytest.mark.asyncio
async def test_tier1_match_by_reference_number():
    svc = DeduplicationService()
    stmt = make_stmt_tx(ref="UTR999")
    candidates = [make_email_tx(ref="UTR999")]
    result = svc._match_tier1(stmt, candidates)
    assert result.tier == 1
    assert result.matched_id == "abc-123"


@pytest.mark.asyncio
async def test_tier2_single_match_by_amount_and_date():
    svc = DeduplicationService()
    stmt = make_stmt_tx(ref=None)  # no reference
    candidates = [make_email_tx(ref=None, tx_date=date(2026, 4, 2))]  # 1 day drift
    result = svc._match_tier2(stmt, candidates)
    assert result.tier == 2
    assert result.matched_id == "abc-123"


@pytest.mark.asyncio
async def test_tier3_ambiguous_when_multiple_amount_matches():
    svc = DeduplicationService()
    stmt = make_stmt_tx(ref=None)
    candidates = [
        make_email_tx(tx_id="id-1", ref=None),
        make_email_tx(tx_id="id-2", ref=None),
    ]
    result = svc._match_tier2(stmt, candidates)
    assert result.tier == 3
    assert len(result.candidate_ids) == 2


def test_no_match_returns_tier_none():
    svc = DeduplicationService()
    stmt = make_stmt_tx(amount=999.0, ref=None)
    candidates = [make_email_tx(amount=100.0, ref=None)]
    result = svc._match_tier2(stmt, candidates)
    assert result.tier is None
