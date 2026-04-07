"""
Pre-launch validation: parse historical alert emails and check how well
they match against existing statement-extracted transactions in the DB.

Usage:
    poetry run python scripts/validate_email_dedup.py --from 2025-11-01 --to 2026-03-31
    poetry run python scripts/validate_email_dedup.py --from 2025-11-01 --to 2026-03-31 --account "Yes Bank Savings"
"""
from __future__ import annotations

import argparse
import asyncio
import sys
from datetime import datetime, date, timedelta
from decimal import Decimal
from pathlib import Path

# Ensure backend src is on path when run as script
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.services.email_ingestion.client import EmailClient
from src.services.email_ingestion.parsers import parser_registry
from src.services.email_ingestion.parsers.base import BaseAlertParser
from src.services.database_manager.operations.account_operations import AccountOperations
from src.services.database_manager.operations.transaction_operations import TransactionOperations
from src.services.email_ingestion.dedup_service import DeduplicationService, DATE_WINDOW_DAYS

# Alias for clarity: validation checks parsed emails against statement ground truth
get_candidates = TransactionOperations.get_statement_transactions_for_dedup


def _should_skip(subject: str, body: str, account_nickname: str) -> bool:
    """Return True if this email should be silently skipped for this account.

    Three cases:
    1. Generic non-transaction subjects (surveys, declined, reminders, OTPs…)
    2. Axis disambiguation via subject (quick, no body fetch needed)
    3. Axis disambiguation via body — both accounts share alerts@axis.bank.in,
       so CC emails land in the savings fetch and vice versa. The email body
       always contains either "Credit Card No." (CC) or "Account Number:" (savings),
       which lets us filter definitively without counting it as a parse failure.
    """
    if BaseAlertParser.is_non_transaction_subject(subject):
        return True
    nick_lower = account_nickname.lower()
    combined_lower = f"{subject}\n{body}".lower()
    if "axis bank savings account" in nick_lower and "credit card no." in combined_lower:
        return True
    if "axis atlas credit card" in nick_lower and "account number:" in combined_lower:
        return True
    return False


async def validate(date_from: date, date_to: date, account_filter: str | None):
    accounts = await AccountOperations.get_all_accounts()
    alert_accounts = [
        a for a in accounts
        if a.get("alert_sender") and a.get("is_active")
        and (not account_filter or account_filter.lower() in (a.get("nickname") or "").lower())
    ]

    if not alert_accounts:
        print("No alert-enabled accounts found.")
        return

    dedup = DeduplicationService()
    overall = {"fetched": 0, "skipped": 0, "parse_fail": 0, "parsed": 0,
               "tier1": 0, "tier2": 0, "tier3": 0, "unmatched": 0}
    per_account: dict = {}
    unmatched_rows: list = []
    parse_failures: list = []

    for account in alert_accounts:
        nickname = account.get("nickname", account["alert_sender"])
        senders = [s.strip() for s in account["alert_sender"].split(",") if s.strip()]
        account_parser = parser_registry.get_parser_for_account(nickname)
        if not account_parser:
            print(f"  [WARN] No parser for account '{nickname}', skipping.")
            continue

        email_client = EmailClient(account_id="primary")
        since = datetime.combine(date_from, datetime.min.time())
        # Gmail `before:` is exclusive — add 1 day to include date_to itself
        until = datetime.combine(date_to + timedelta(days=1), datetime.min.time())
        messages = email_client.list_recent_alert_emails(
            max_results=500,
            days_back=None,
            alert_senders=senders,
            since=since,
            until=until,
        )

        stats: dict = {"fetched": len(messages), "skipped": 0, "parse_fail": 0,
                       "parsed": 0, "tier1": 0, "tier2": 0, "tier3": 0, "unmatched": 0}

        for msg in messages:
            overall["fetched"] += 1
            try:
                content = email_client.get_email_content(msg["id"])
                subject = content.get("subject", "") or ""
                body = content.get("body", "") or ""

                if _should_skip(subject, body, nickname):
                    stats["skipped"] += 1
                    overall["skipped"] += 1
                    continue

                parsed = account_parser.parse(content)
                if not parsed:
                    stats["parse_fail"] += 1
                    overall["parse_fail"] += 1
                    parse_failures.append(
                        f"  [{nickname}] \"{subject}\" — {content.get('date', '?')}"
                    )
                    continue

                stats["parsed"] += 1
                overall["parsed"] += 1

                tx_date = datetime.strptime(parsed["transaction_date"], "%Y-%m-%d").date()
                d_from = tx_date - timedelta(days=DATE_WINDOW_DAYS)
                d_to = tx_date + timedelta(days=DATE_WINDOW_DAYS)
                candidates = await get_candidates(
                    account=nickname, date_from=d_from, date_to=d_to
                )
                t1 = dedup._match_tier1(
                    {"reference_number": parsed.get("reference_number"),
                     "amount": Decimal(str(parsed["amount"])),
                     "transaction_date": tx_date},
                    candidates
                )
                if t1.is_confirmed:
                    stats["tier1"] += 1
                    overall["tier1"] += 1
                    continue
                t2 = dedup._match_tier2(
                    {"reference_number": parsed.get("reference_number"),
                     "amount": Decimal(str(parsed["amount"])),
                     "transaction_date": tx_date},
                    candidates
                )
                if t2.is_confirmed:
                    stats["tier2"] += 1
                    overall["tier2"] += 1
                elif t2.is_ambiguous:
                    stats["tier3"] += 1
                    overall["tier3"] += 1
                else:
                    stats["unmatched"] += 1
                    overall["unmatched"] += 1
                    direction = parsed.get("direction", "?")
                    unmatched_rows.append(
                        f"  {tx_date}  {parsed['amount']:>10.2f}  {direction:<6}  "
                        f"{nickname:<24}  {parsed['description'][:38]}"
                    )
            except Exception as exc:
                stats["parse_fail"] += 1
                overall["parse_fail"] += 1
                parse_failures.append(f"  [{nickname}] {msg.get('id', '?')} — {exc}")

        per_account[nickname] = stats

    _print_report(date_from, date_to, overall, per_account, unmatched_rows, parse_failures)


def _print_report(date_from, date_to, overall, per_account, unmatched_rows, parse_failures):
    def pct(n, d):
        return f"({n/d*100:.1f}%)" if d else ""

    actionable = overall["fetched"] - overall["skipped"]

    print("\n=== EMAIL DEDUP VALIDATION REPORT ===")
    print(f"Period: {date_from} → {date_to}\n")
    print("OVERALL SUMMARY")
    print(f"  Emails fetched:         {overall['fetched']:>5}")
    print(f"  Skipped (non-txn):      {overall['skipped']:>5}  {pct(overall['skipped'], overall['fetched'])}")
    print(f"  Parse failures:         {overall['parse_fail']:>5}  {pct(overall['parse_fail'], actionable)}")
    print(f"  Successfully parsed:    {overall['parsed']:>5}  {pct(overall['parsed'], actionable)}")
    print(f"  Tier 1 matched (ref):   {overall['tier1']:>5}  {pct(overall['tier1'], overall['parsed'])}")
    print(f"  Tier 2 matched (amt):   {overall['tier2']:>5}  {pct(overall['tier2'], overall['parsed'])}")
    print(f"  Tier 3 ambiguous:       {overall['tier3']:>5}  {pct(overall['tier3'], overall['parsed'])}")
    print(f"  Unmatched:              {overall['unmatched']:>5}  {pct(overall['unmatched'], overall['parsed'])}")
    print("\nBREAKDOWN BY ACCOUNT")
    for name, s in per_account.items():
        acct_actionable = s["fetched"] - s["skipped"]
        print(f"  {name:<26}  fetched={s['fetched']}  skipped={s['skipped']}  "
              f"parsed={s['parsed']}/{acct_actionable}  "
              f"matched={s['tier1']+s['tier2']}  ambiguous={s['tier3']}  "
              f"unmatched={s['unmatched']}  failures={s['parse_fail']}")
    if unmatched_rows:
        print("\nUNMATCHED TRANSACTIONS (forex, EMI, or parser gaps)")
        print(f"  {'Date':<12} {'Amount':>10}  {'Dir':<6}  {'Account':<24}  Description")
        for row in unmatched_rows:
            print(row)
    if parse_failures:
        print("\nPARSE FAILURES")
        for row in parse_failures:
            print(row)
    print()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Validate email dedup accuracy against DB transactions.")
    parser.add_argument("--from", dest="date_from", required=True, help="Start date YYYY-MM-DD")
    parser.add_argument("--to", dest="date_to", required=True, help="End date YYYY-MM-DD")
    parser.add_argument("--account", dest="account", default=None, help="Filter to one account nickname")
    args = parser.parse_args()
    asyncio.run(validate(
        date.fromisoformat(args.date_from),
        date.fromisoformat(args.date_to),
        args.account,
    ))
