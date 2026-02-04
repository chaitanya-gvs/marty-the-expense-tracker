from __future__ import annotations

from typing import Dict, Any, List, Optional
from datetime import datetime

from src.services.email_ingestion.client import EmailClient
from src.services.email_ingestion.alert_parser import EmailAlertParser
from src.services.email_ingestion.alert_rules import DEFAULT_ALERT_KEYWORDS
from src.services.database_manager.operations import AccountOperations, TransactionOperations
from src.utils.logger import get_logger

logger = get_logger(__name__)


class EmailAlertIngestionService:
    def __init__(self, account_id: str = "primary"):
        self.account_id = account_id
        self.email_client = EmailClient(account_id=account_id)
        self.parser = EmailAlertParser()

    async def ingest_recent_alerts(
        self,
        max_results: int = 100,
        days_back: int = 2,
    ) -> Dict[str, Any]:
        """Fetch recent alert emails, parse, and insert transactions."""
        try:
            accounts = await AccountOperations.get_all_accounts()
            alert_senders = self._collect_alert_senders(accounts)
            alert_keywords = self._collect_alert_keywords(accounts)

            if not alert_senders:
                logger.info("No alert senders configured; skipping ingestion")
                return {"processed": 0, "parsed": 0, "inserted": 0, "skipped": 0, "errors": 0}

            messages = self.email_client.list_recent_alert_emails(
                max_results=max_results,
                days_back=days_back,
                alert_senders=alert_senders,
                keywords=None,
            )

            if not messages:
                return {"processed": 0, "parsed": 0, "inserted": 0, "skipped": 0, "errors": 0}

            message_ids = [message.get("id") for message in messages if message.get("id")]
            existing_message_ids = await TransactionOperations.get_existing_email_message_ids(message_ids)

            transactions: List[Dict[str, Any]] = []
            processed = 0
            parsed = 0
            skipped = 0
            errors = 0

            for message in messages:
                message_id = message.get("id")
                if not message_id or message_id in existing_message_ids:
                    skipped += 1
                    continue

                processed += 1
                try:
                    email_content = self.email_client.get_email_content(message_id)
                    parsed_alert = self.parser.parse(email_content)
                    if not parsed_alert:
                        skipped += 1
                        continue

                    parsed += 1
                    account_name = self._match_account(accounts, parsed_alert, email_content)
                    if account_name == "unknown":
                        skipped += 1
                        continue

                    transaction = self._build_transaction(parsed_alert, account_name)
                    transactions.append(transaction)
                except Exception as e:
                    errors += 1
                    logger.error(f"Error processing alert email {message_id}: {e}", exc_info=True)

            inserted = 0
            if transactions:
                db_result = await TransactionOperations.bulk_insert_transactions(
                    transactions,
                    check_duplicates=True,
                    upsert_splitwise=False,
                )
                inserted = db_result.get("inserted_count", 0)

            return {
                "processed": processed,
                "parsed": parsed,
                "inserted": inserted,
                "skipped": skipped,
                "errors": errors,
            }
        except Exception as e:
            logger.error("Error ingesting alert emails", exc_info=True)
            raise

    def _collect_alert_senders(self, accounts: List[dict]) -> List[str]:
        senders: List[str] = []
        for account in accounts:
            account_senders = account.get("alert_senders") or []
            if isinstance(account_senders, str):
                account_senders = [s.strip() for s in account_senders.split(",") if s.strip()]
            senders.extend(account_senders)
        return list({sender for sender in senders if sender})

    def _collect_alert_keywords(self, accounts: List[dict]) -> List[str]:
        keywords: List[str] = []
        for account in accounts:
            account_keywords = account.get("alert_keywords") or []
            if isinstance(account_keywords, str):
                account_keywords = [k.strip() for k in account_keywords.split(",") if k.strip()]
            keywords.extend(account_keywords)
        return list({keyword for keyword in keywords if keyword})

    def _match_account(
        self,
        accounts: List[dict],
        parsed_alert: Dict[str, Any],
        email_content: Dict[str, Any],
    ) -> str:
        sender = (email_content.get("sender") or "").lower()
        account_last4 = parsed_alert.get("account_last4")

        # Enforce last-4 requirement: if not present, do not insert
        if not account_last4:
            logger.info("Skipping email alert without last-4 digits present in subject/body")
            return "unknown"

        # Primary mapping: last-4 match against account_number + sender allowlist
        for account in accounts:
            account_number = str(account.get("account_number", ""))
            account_senders = account.get("alert_senders") or []
            if isinstance(account_senders, str):
                account_senders = [s.strip() for s in account_senders.split(",") if s.strip()]
            sender_allowed = any(alert_sender.lower() in sender for alert_sender in account_senders) if account_senders else True

            if account_number.endswith(str(account_last4)) and sender_allowed:
                return self._format_account_name(account)

        logger.warning("Unable to map alert to account; defaulting to unknown")
        return "unknown"

    def _format_account_name(self, account: dict) -> str:
        return account.get("nickname") or account.get("bank_name") or account.get("account_number") or "unknown"

    def _build_transaction(self, parsed_alert: Dict[str, Any], account_name: str) -> Dict[str, Any]:
        transaction_date = parsed_alert.get("transaction_date") or datetime.now().date().isoformat()
        direction = parsed_alert.get("transaction_type")
        amount = parsed_alert.get("amount")
        description = parsed_alert.get("description")
        reference_number = parsed_alert.get("reference_number")

        dedupe_key = TransactionOperations._create_dedupe_key(
            transaction_date,
            direction,
            amount,
            account_name,
            description,
            reference_number,
        )

        return {
            "transaction_date": transaction_date,
            "transaction_time": parsed_alert.get("transaction_time"),
            "amount": amount,
            "transaction_type": direction,
            "account": account_name,
            "description": description,
            "reference_number": reference_number,
            "source_file": "email_alert",
            "source_type": "email",
            "email_message_id": parsed_alert.get("email_message_id"),
            "dedupe_key": dedupe_key,
            "raw_data": parsed_alert.get("raw_data", {}),
        }
