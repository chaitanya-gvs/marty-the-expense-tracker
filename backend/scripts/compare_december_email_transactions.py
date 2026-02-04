#!/usr/bin/env python3
"""
Compare December 2025 email-derived transactions with DB transactions.

Defaults to 2025-12-01 through 2025-12-31.
"""
import argparse
import asyncio
import sys
from collections import Counter
from datetime import datetime
from typing import Any, Dict, List, Optional

from pathlib import Path

backend_path = Path(__file__).parent.parent
sys.path.insert(0, str(backend_path))

from src.services.email_ingestion.client import EmailClient
from src.services.email_ingestion.alert_parser import EmailAlertParser
from src.services.email_ingestion.alert_service import EmailAlertIngestionService
from src.services.database_manager.operations import AccountOperations, TransactionOperations


def _fmt(value: Any) -> str:
    if value is None:
        return ""
    return str(value)


def _print_table(rows: List[Dict[str, Any]], headers: List[str]) -> None:
    if not rows:
        print("(none)")
        return
    widths = {h: len(h) for h in headers}
    for row in rows:
        for h in headers:
            widths[h] = max(widths[h], len(_fmt(row.get(h, ""))))

    def fmt_row(row: Dict[str, Any]) -> str:
        return " | ".join(_fmt(row.get(h, "")).ljust(widths[h]) for h in headers)

    sep = "-+-".join("-" * widths[h] for h in headers)
    print(fmt_row({h: h for h in headers}))
    print(sep)
    for row in rows:
        print(fmt_row(row))


def _build_dedupe_key(row: Dict[str, Any]) -> Optional[str]:
    date_value = row.get("transaction_date") or row.get("date")
    direction = row.get("direction") or row.get("transaction_type")
    amount = row.get("amount")
    account = row.get("account")
    description = row.get("description")
    reference_number = row.get("reference_number")
    if not date_value or direction is None or amount is None or not account:
        return None
    return TransactionOperations._create_dedupe_key(
        str(date_value),
        str(direction),
        amount,
        account,
        description,
        reference_number,
    )


def _build_loose_key(row: Dict[str, Any]) -> Optional[str]:
    date_value = row.get("transaction_date") or row.get("date")
    direction = row.get("direction") or row.get("transaction_type")
    amount = row.get("amount")
    account = row.get("account")
    if not date_value or direction is None or amount is None or not account:
        return None
    rounded_amount = round(float(amount or 0), 2)
    return f"{date_value}|{direction}|{rounded_amount}|{account}"


def _parse_date(date_str: str) -> datetime:
    return datetime.strptime(date_str, "%Y-%m-%d")


def _as_gmail_date(date_str: str) -> str:
    return _parse_date(date_str).strftime("%Y/%m/%d")


def _paginate_messages(client: EmailClient, query: str, max_results: Optional[int]) -> List[Dict[str, Any]]:
    if not client._refresh_credentials():
        raise Exception("Failed to authenticate with Gmail")

    messages: List[Dict[str, Any]] = []
    page_token = None
    fetched = 0

    while True:
        resp = (
            client.service.users()
            .messages()
            .list(userId="me", q=query, maxResults=500, pageToken=page_token)
            .execute()
        )
        batch = resp.get("messages", [])
        if not batch:
            break
        messages.extend(batch)
        fetched += len(batch)
        if max_results and fetched >= max_results:
            messages = messages[:max_results]
            break
        page_token = resp.get("nextPageToken")
        if not page_token:
            break

    return messages


async def _fetch_db_transactions(start_date: str, end_date: str) -> List[Dict[str, Any]]:
    start = _parse_date(start_date).date()
    end = _parse_date(end_date).date()

    all_rows: List[Dict[str, Any]] = []
    limit = 1000
    offset = 0
    while True:
        batch = await TransactionOperations.get_transactions_by_date_range(
            start_date=start,
            end_date=end,
            limit=limit,
            offset=offset,
            order_by="ASC",
        )
        if not batch:
            break
        all_rows.extend(batch)
        if len(batch) < limit:
            break
        offset += limit
    return all_rows


async def main() -> None:
    parser = argparse.ArgumentParser(description="Compare email alerts vs DB transactions")
    parser.add_argument("--start-date", default="2025-12-01", help="Start date (YYYY-MM-DD)")
    parser.add_argument("--end-date", default="2025-12-31", help="End date (YYYY-MM-DD)")
    parser.add_argument("--max-emails", type=int, default=None, help="Max emails to fetch per Gmail account")
    parser.add_argument("--limit", type=int, default=200, help="Max rows to print per section")
    parser.add_argument(
        "--match-mode",
        choices=["strict", "loose"],
        default="strict",
        help="Matching mode: strict uses full dedupe key, loose uses date+direction+amount+account",
    )
    parser.add_argument(
        "--exclude-account",
        action="append",
        default=[],
        help="Account name to exclude from missing-in-email results (repeatable)",
    )
    parser.add_argument(
        "--export-xlsx",
        default=None,
        help="Path to export results as Excel (.xlsx)",
    )
    args = parser.parse_args()

    start_gmail = _as_gmail_date(args.start_date)
    end_gmail = _as_gmail_date(args.end_date)

    accounts = await AccountOperations.get_all_accounts()
    ingestion = EmailAlertIngestionService(account_id="primary")
    alert_senders = ingestion._collect_alert_senders(accounts)

    sender_terms = " OR ".join(alert_senders)
    sender_query = f"from:({sender_terms})" if sender_terms else ""
    date_query = f"after:{start_gmail} before:{end_gmail}"
    query = f"{date_query} AND {sender_query}".strip()

    alert_parser = EmailAlertParser()
    email_rows: List[Dict[str, Any]] = []

    for account_id in ["primary", "secondary"]:
        try:
            client = EmailClient(account_id=account_id)
        except Exception:
            continue

        messages = _paginate_messages(client, query=query, max_results=args.max_emails)
        for message in messages:
            message_id = message.get("id")
            if not message_id:
                continue
            try:
                email = client.get_email_content(message_id)
            except Exception:
                continue

            parsed = alert_parser.parse(email)
            if not parsed:
                continue

            account_name = ingestion._match_account(accounts, parsed, email)
            if account_name == "unknown":
                continue

            parsed["account"] = account_name
            parsed["dedupe_key"] = _build_dedupe_key(
                {
                    "transaction_date": parsed.get("transaction_date"),
                    "transaction_type": parsed.get("transaction_type"),
                    "amount": parsed.get("amount"),
                    "account": account_name,
                    "description": parsed.get("description"),
                    "reference_number": parsed.get("reference_number"),
                }
            )
            parsed["sender"] = email.get("sender")
            parsed["gmail_account"] = account_id
            email_rows.append(parsed)

    db_rows = await _fetch_db_transactions(args.start_date, args.end_date)

    if args.match_mode == "loose":
        email_dedupe = {(_build_loose_key(row)) for row in email_rows if _build_loose_key(row)}
    else:
        email_dedupe = {row.get("dedupe_key") for row in email_rows if row.get("dedupe_key")}
    db_dedupe = set()
    db_missing_dedupe = 0
    for row in db_rows:
        if args.match_mode == "loose":
            key = _build_loose_key(row)
        else:
            key = row.get("dedupe_key") or _build_dedupe_key(row)
        if not key:
            db_missing_dedupe += 1
            continue
        db_dedupe.add(key)

    if args.match_mode == "loose":
        missing_in_db = [
            row for row in email_rows
            if _build_loose_key(row) and _build_loose_key(row) not in db_dedupe
        ]
        missing_in_email = [
            row for row in db_rows
            if _build_loose_key(row) not in email_dedupe
        ]
    else:
        missing_in_db = [
            row for row in email_rows
            if row.get("dedupe_key") and row.get("dedupe_key") not in db_dedupe
        ]
    missing_in_email = [
        row for row in db_rows
        if (row.get("dedupe_key") or _build_dedupe_key(row)) not in email_dedupe
    ]

    if args.exclude_account:
        excluded = {name.strip().lower() for name in args.exclude_account if name.strip()}
        if excluded:
            missing_in_email = [
                row for row in missing_in_email
                if (row.get("account") or "").lower() not in excluded
            ]

    print("=== Summary ===")
    print(f"Date range: {args.start_date} to {args.end_date}")
    print(f"Match mode: {args.match_mode}")
    print(f"Email parsed: {len(email_rows)}")
    print(f"DB transactions: {len(db_rows)}")
    print(f"DB rows missing dedupe_key: {db_missing_dedupe}")
    print(f"Missing in DB (email -> DB): {len(missing_in_db)}")
    print(f"Missing in email (DB -> email): {len(missing_in_email)}")

    missing_in_email_by_source = Counter(row.get("source_type") or "unknown" for row in missing_in_email)
    if missing_in_email_by_source:
        print("Missing in email by source_type:")
        for source_type, count in missing_in_email_by_source.items():
            print(f"  {source_type}: {count}")

    print("\n=== Missing in DB (email-derived not found in DB) ===")
    missing_in_db_rows = [
        {
            "date": row.get("transaction_date"),
            "time": row.get("transaction_time"),
            "account": row.get("account"),
            "amount": row.get("amount"),
            "direction": row.get("transaction_type"),
            "description": row.get("description"),
            "sender": row.get("sender"),
        }
        for row in missing_in_db[: args.limit]
    ]
    _print_table(
        missing_in_db_rows,
        ["date", "time", "account", "amount", "direction", "description", "sender"],
    )

    print("\n=== Missing in email (DB rows not found in email alerts) ===")
    missing_in_email_rows = [
        {
            "date": row.get("transaction_date"),
            "time": row.get("transaction_time"),
            "account": row.get("account"),
            "amount": row.get("amount"),
            "direction": row.get("transaction_type") or row.get("direction"),
            "description": row.get("description"),
            "source": row.get("source_type"),
        }
        for row in missing_in_email[: args.limit]
    ]
    _print_table(
        missing_in_email_rows,
        ["date", "time", "account", "amount", "direction", "description", "source"],
    )

    if args.export_xlsx:
        try:
            import pandas as pd
        except Exception as exc:
            print(f"Unable to export Excel (pandas missing): {exc}")
            return

        export_missing_db = [
            {
                "date": row.get("transaction_date"),
                "time": row.get("transaction_time"),
                "account": row.get("account"),
                "amount": row.get("amount"),
                "direction": row.get("transaction_type"),
                "description": row.get("description"),
                "sender": row.get("sender"),
            }
            for row in missing_in_db
        ]
        export_missing_email = [
            {
                "date": row.get("transaction_date"),
                "time": row.get("transaction_time"),
                "account": row.get("account"),
                "amount": row.get("amount"),
                "direction": row.get("transaction_type") or row.get("direction"),
                "description": row.get("description"),
                "source": row.get("source_type"),
            }
            for row in missing_in_email
        ]

        with pd.ExcelWriter(args.export_xlsx) as writer:
            pd.DataFrame(export_missing_db).to_excel(writer, sheet_name="missing_in_db", index=False)
            pd.DataFrame(export_missing_email).to_excel(writer, sheet_name="missing_in_email", index=False)

        print(f"\nExported Excel: {args.export_xlsx}")


if __name__ == "__main__":
    asyncio.run(main())
