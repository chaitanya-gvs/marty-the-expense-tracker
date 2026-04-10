from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional

from src.services.database_manager.operations.account_operations import AccountOperations
from src.services.database_manager.operations.transaction_operations import TransactionOperations
from src.services.email_ingestion.client import EmailClient
from src.services.email_ingestion.dedup_service import DeduplicationService
from src.services.email_ingestion.parsers import parser_registry
from src.utils.logger import get_logger
from src.utils.settings import get_settings

logger = get_logger(__name__)


class AlertIngestionService:
    """Orchestrates one email ingestion run across all alert-enabled accounts."""

    def __init__(self, event_callback=None):
        self.settings = get_settings()
        self.dedup = DeduplicationService()
        self._event_callback = event_callback

    def _emit(self, event_type: str, message: str, level: str = "info", data: dict = None, account: str = None) -> None:
        """Fire an SSE event if a callback was registered (no-op otherwise)."""
        if self._event_callback is None:
            return
        self._event_callback({
            "event": event_type,
            "step": "email_ingestion",
            "message": message,
            "account": account,
            "level": level,
            "timestamp": datetime.utcnow().isoformat() + "Z",
            "data": data or {},
        })

    async def run(
        self,
        since_date: Optional[datetime] = None,
        until_date: Optional[datetime] = None,
        account_ids: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        """
        Run ingestion for all alert-enabled accounts.
        If since_date is provided, use it as watermark (backfill mode).
        Otherwise, use each account's alert_last_processed_at.
        Emits per-account SSE events if event_callback was provided.
        """
        accounts = await AccountOperations.get_all_accounts()
        alert_accounts = [
            a for a in accounts
            if a.get("alert_sender") and a.get("is_active")
            and (not account_ids or str(a["id"]) in account_ids)
        ]

        if not alert_accounts:
            logger.info("No alert-enabled accounts found")
            return {"processed": 0, "inserted": 0, "skipped": 0, "errors": 0, "accounts": []}

        totals = {"processed": 0, "inserted": 0, "skipped": 0, "errors": 0, "accounts": []}

        for account in alert_accounts:
            nickname = account.get("nickname", account["alert_sender"])
            self._emit(
                "email_ingestion_account_started",
                f"Fetching alert emails for {nickname}",
                account=nickname,
                data={"account": nickname},
            )
            try:
                result = await self._run_for_account(account, since_date, until_date)
            except Exception as exc:
                logger.exception("Error processing account %s", nickname)
                totals["errors"] += 1
                totals["accounts"].append({"account": nickname, "processed": 0, "inserted": 0, "skipped": 0, "errors": 1})
                self._emit(
                    "email_ingestion_account_complete",
                    f"{nickname}: failed — {exc}",
                    level="error",
                    account=nickname,
                    data={"account": nickname, "processed": 0, "inserted": 0, "skipped": 0, "errors": 1},
                )
                continue
            totals["processed"] += result["processed"]
            totals["inserted"] += result["inserted"]
            totals["skipped"] += result["skipped"]
            totals["errors"] += result["errors"]
            totals["accounts"].append({"account": nickname, **result})
            level = "success" if result["errors"] == 0 else "warning"
            self._emit(
                "email_ingestion_account_complete",
                (
                    f"{nickname}: {result['inserted']} inserted, "
                    f"{result['skipped']} skipped, {result['errors']} error(s)"
                ),
                level=level,
                account=nickname,
                data={"account": nickname, **result},
            )

        return totals

    async def _run_for_account(
        self, account: Dict[str, Any], since_date: Optional[datetime], until_date: Optional[datetime] = None,
    ) -> Dict[str, Any]:
        alert_sender = account["alert_sender"]
        nickname = account.get("nickname", alert_sender)

        # Prefer the nickname-specific parser so that accounts sharing the same
        # alert_sender (e.g. Axis Atlas CC and Axis Bank Savings both use
        # alerts@axis.bank.in) don't accidentally parse each other's emails.
        specific = parser_registry.get_parser_for_account(nickname)
        parsers = [specific] if specific else parser_registry.get_parsers(alert_sender)

        if not parsers:
            logger.warning(
                "No parser found for sender %s (account: %s)", alert_sender, nickname
            )
            return {"processed": 0, "inserted": 0, "skipped": 0, "errors": 1}

        # Determine watermark
        watermark: Optional[datetime] = since_date
        if not watermark:
            lp = account.get("alert_last_processed_at")
            watermark = lp if isinstance(lp, datetime) else None

        try:
            email_client = EmailClient(account_id="primary")
            days_back = 7 if not watermark else None
            messages = email_client.list_recent_alert_emails(
                max_results=200,
                days_back=days_back,
                alert_senders=[alert_sender],
                since=watermark,
                until=until_date,
            )
        except Exception:
            logger.error("Failed to fetch emails for %s", nickname, exc_info=True)
            return {"processed": 0, "inserted": 0, "skipped": 0, "errors": 1}

        processed = inserted = skipped = errors = 0
        transactions_to_insert: List[Dict[str, Any]] = []

        # Bulk message ID check
        message_ids = [m["id"] for m in messages if m.get("id")]
        existing_ids = await TransactionOperations.get_transactions_by_email_message_ids(
            message_ids
        )

        for message in messages:
            msg_id = message.get("id")
            if not msg_id:
                skipped += 1
                continue
            if msg_id in existing_ids:
                skipped += 1
                continue

            processed += 1
            try:
                content = email_client.get_email_content(msg_id)
                parsed = None
                for p in parsers:
                    parsed = p.parse(content)
                    if parsed:
                        break
                if not parsed:
                    skipped += 1
                    continue

                # Email-to-email fuzzy dedup
                tx_date_raw = parsed.get("transaction_date")
                tx_date = (
                    datetime.strptime(tx_date_raw, "%Y-%m-%d").date()
                    if tx_date_raw
                    else datetime.now().date()
                )

                already = await self.dedup.is_email_already_ingested(
                    email_message_id=msg_id,
                    reference_number=parsed.get("reference_number"),
                    amount=parsed["amount"],
                    account=account.get("nickname", ""),
                    tx_date=tx_date,
                )
                if already:
                    skipped += 1
                    continue

                tx = self._build_transaction(parsed, account)
                transactions_to_insert.append(tx)
            except Exception:
                errors += 1
                logger.error(
                    "Error processing email %s for %s", msg_id, nickname, exc_info=True
                )

        # Bulk insert
        if transactions_to_insert:
            try:
                result = await TransactionOperations.bulk_insert_transactions(
                    transactions_to_insert,
                    check_duplicates=False,
                    upsert_splitwise=False,
                )
                inserted = result.get("inserted_count", len(transactions_to_insert))
                errors += result.get("error_count", 0)
            except Exception:
                errors += len(transactions_to_insert)
                logger.error("Bulk insert failed for %s", nickname, exc_info=True)

        # Update watermark (skip in backfill mode)
        if not since_date:
            await AccountOperations.update_alert_last_processed_at(str(account["id"]))

        return {
            "processed": processed,
            "inserted": inserted,
            "skipped": skipped,
            "errors": errors,
        }

    def _build_transaction(
        self, parsed: Dict[str, Any], account: Dict[str, Any]
    ) -> Dict[str, Any]:
        # auto_categorize hook — no-op until auto-categorization is implemented
        category_id = None

        return {
            "transaction_date": parsed["transaction_date"],
            "transaction_time": parsed.get("transaction_time"),
            "amount": parsed["amount"],
            "direction": parsed["direction"],
            "transaction_type": parsed["direction"],  # debit/credit mirrors direction for email
            "description": parsed["description"],
            "account": account.get("nickname", parsed.get("email_sender", "")),
            "email_message_id": parsed["email_message_id"],
            "reference_number": parsed.get("reference_number"),
            "transaction_source": "email_ingestion",
            "category_id": category_id,
            "raw_data": parsed.get("raw_data", {}),
            "related_mails": [parsed["email_message_id"]],
            "statement_confirmed": False,
        }
