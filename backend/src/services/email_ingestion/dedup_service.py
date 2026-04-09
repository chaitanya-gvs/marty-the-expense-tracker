from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, timedelta
from decimal import Decimal
from typing import Any, Dict, List, Optional

from src.services.database_manager.operations.transaction_operations import TransactionOperations
from src.utils.logger import get_logger

logger = get_logger(__name__)

DATE_WINDOW_DAYS = 2


@dataclass
class DeduplicationResult:
    tier: Optional[int]           # 1, 2, 3, or None
    matched_id: Optional[str] = None
    candidate_ids: List[str] = field(default_factory=list)

    @property
    def is_confirmed(self) -> bool:
        return self.tier in (1, 2)

    @property
    def is_ambiguous(self) -> bool:
        return self.tier == 3

    @property
    def is_unmatched(self) -> bool:
        return self.tier is None


class DeduplicationService:
    """Tiered deduplication: reference number -> amount+date window -> ambiguous."""

    def _match_tier1(
        self, stmt_tx: Dict[str, Any], candidates: List[Dict[str, Any]]
    ) -> DeduplicationResult:
        ref = (stmt_tx.get("reference_number") or "").strip()
        if not ref:
            return DeduplicationResult(tier=None)
        for c in candidates:
            c_ref = (c.get("reference_number") or "").strip()
            if c_ref and c_ref == ref:
                return DeduplicationResult(tier=1, matched_id=str(c["id"]))
        return DeduplicationResult(tier=None)

    def _match_tier2(
        self, stmt_tx: Dict[str, Any], candidates: List[Dict[str, Any]], stmt_date: date
    ) -> DeduplicationResult:
        stmt_amount = Decimal(str(stmt_tx["amount"]))
        date_min = stmt_date - timedelta(days=DATE_WINDOW_DAYS)
        date_max = stmt_date + timedelta(days=DATE_WINDOW_DAYS)

        matches = [
            c for c in candidates
            if Decimal(str(c["amount"])) == stmt_amount
            and date_min <= c["transaction_date"] <= date_max
        ]
        if len(matches) == 1:
            return DeduplicationResult(tier=2, matched_id=str(matches[0]["id"]))
        if len(matches) > 1:
            return DeduplicationResult(tier=3, candidate_ids=[str(m["id"]) for m in matches])
        return DeduplicationResult(tier=None)

    async def match_statement_transaction(
        self, stmt_tx: Dict[str, Any], has_alert_sender: bool
    ) -> DeduplicationResult:
        """Full tiered match for one statement transaction against email_ingestion candidates."""
        account = stmt_tx["account"]
        raw_date = stmt_tx["transaction_date"]
        stmt_date: date = date.fromisoformat(raw_date) if isinstance(raw_date, str) else raw_date
        date_from = stmt_date - timedelta(days=DATE_WINDOW_DAYS)
        date_to = stmt_date + timedelta(days=DATE_WINDOW_DAYS)

        candidates = await TransactionOperations.get_email_transactions_for_dedup(
            account=account, date_from=date_from, date_to=date_to
        )

        tier1 = self._match_tier1(stmt_tx, candidates)
        if tier1.is_confirmed:
            await TransactionOperations.mark_statement_confirmed(tier1.matched_id)
            return tier1

        tier2 = self._match_tier2(stmt_tx, candidates, stmt_date)
        if tier2.is_confirmed:
            await TransactionOperations.mark_statement_confirmed(tier2.matched_id)
            return tier2
        if tier2.is_ambiguous:
            return tier2

        # No match
        return DeduplicationResult(tier=None)  # caller decides insert vs review queue

    async def is_email_already_ingested(
        self, email_message_id: str, reference_number: Optional[str],
        amount: float, account: str, tx_date: date
    ) -> bool:
        """Two-step email-to-email dedup: exact ID then fuzzy."""
        # Step 1: exact Gmail message ID
        existing = await TransactionOperations.get_transactions_by_email_message_ids([email_message_id])
        if email_message_id in existing:
            return True
        # Step 2: fuzzy (different email ID, same transaction data)
        if reference_number:
            date_from = tx_date - timedelta(days=DATE_WINDOW_DAYS)
            date_to = tx_date + timedelta(days=DATE_WINDOW_DAYS)
            candidates = await TransactionOperations.get_email_transactions_for_dedup(
                account=account, date_from=date_from, date_to=date_to
            )
            for c in candidates:
                if (c.get("reference_number") or "").strip() == reference_number.strip():
                    logger.info("Skipping duplicate email (different ID, same ref %s)", reference_number)
                    return True
        return False
