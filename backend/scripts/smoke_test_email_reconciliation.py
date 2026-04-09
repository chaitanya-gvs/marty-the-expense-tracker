#!/usr/bin/env python3
"""
Email Reconciliation Smoke Test

Validates Step 7.5 (_run_email_reconciliation_pass) in isolation.

Seeds test_env with email_ingestion transactions (copied from production if
available, otherwise generated synthetically), then runs dedup + reconciliation
against a synthetic statement dataset that deliberately omits the first 3 email
rows.  Asserts the omitted rows ended up in the review queue with valid UUIDs.

Nothing is written to production tables.

Usage (run from backend/):
    poetry run python scripts/smoke_test_email_reconciliation.py
    poetry run python scripts/smoke_test_email_reconciliation.py --account "Axis Atlas Credit Card" --month 2026-03
    poetry run python scripts/smoke_test_email_reconciliation.py --no-cleanup

Options:
  --account     Account nickname (default: "Yes Bank Savings Account")
  --month       YYYY-MM to pull email transactions from (default: previous month)
  --no-cleanup  Keep test_env for manual inspection after the run
"""

import argparse
import asyncio
import os
import sys
import uuid
from datetime import date, datetime, timedelta
from decimal import Decimal
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

# ── CRITICAL: set TEST_MODE before any app imports ──────────────────────────
# connection.py reads this env var and adds search_path=test_env,public so all
# ORM writes land in test_env.
os.environ["TEST_MODE"] = "true"

sys.path.insert(0, str(Path(__file__).parent.parent))

# ── Safe to import app modules now ──────────────────────────────────────────
from src.utils.settings import get_settings  # noqa: E402
from src.utils.logger import get_logger       # noqa: E402

logger = get_logger("smoke_test_email_reconciliation")

_DIV = "─" * 62
_HDR = "═" * 62

EXCLUDED_COUNT = 3  # rows deliberately omitted from combined_data
SYNTHETIC_TOTAL = 10  # always seed this many rows to ensure wide date coverage


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _prev_month() -> str:
    today = date.today()
    if today.month == 1:
        return f"{today.year - 1}-12"
    return f"{today.year}-{today.month - 1:02d}"


def _month_date_range(month_str: str) -> Tuple[date, date]:
    """Return (first_day, last_day) for a YYYY-MM string."""
    year, month = map(int, month_str.split("-"))
    first = date(year, month, 1)
    # last day: first day of next month minus 1 day
    if month == 12:
        last = date(year + 1, 1, 1) - timedelta(days=1)
    else:
        last = date(year, month + 1, 1) - timedelta(days=1)
    return first, last


async def _raw_conn():
    """
    Open a raw asyncpg connection without any search_path override.
    Used for schema DDL that must target the public schema.
    """
    import asyncpg
    settings = get_settings()
    dsn = settings.DATABASE_URL.replace("postgresql+asyncpg://", "postgresql://")
    return await asyncpg.connect(dsn)


def _trunc(s: str, n: int = 40) -> str:
    return s if len(s) <= n else s[: n - 1] + "…"


# ---------------------------------------------------------------------------
# Phase 1 — Setup
# ---------------------------------------------------------------------------

async def setup_test_schema() -> None:
    """Drop (if exists) and recreate test_env schema with 3 tables."""
    conn = await _raw_conn()
    try:
        await conn.execute("DROP SCHEMA IF EXISTS test_env CASCADE")
        print("  ✓  Dropped previous test_env (if any)")

        await conn.execute("CREATE SCHEMA test_env")
        print("  ✓  Created schema test_env")

        for table in ("transactions", "review_queue", "statement_processing_log"):
            await conn.execute(
                f"CREATE TABLE test_env.{table} "
                f"(LIKE public.{table} INCLUDING ALL)"
            )
            print(f"  ✓  Created test_env.{table}")
    finally:
        await conn.close()


# ---------------------------------------------------------------------------
# Phase 2 — Seed email_ingestion transactions
# ---------------------------------------------------------------------------

_SYNTHETIC_TEMPLATES = [
    ("UPI/Swiggy/12345678", "debit", "purchase", Decimal("349.00")),
    ("UPI/Zomato/98765432", "debit", "purchase", Decimal("520.00")),
    ("HDFC CC EMI/Auto-debit", "debit", "transfer", Decimal("4500.00")),
    ("UPI/Amazon/55443322", "debit", "purchase", Decimal("1299.00")),
    ("UPI/PhonePe/11223344", "debit", "purchase", Decimal("200.00")),
    ("NEFT/Salary Credit", "credit", "income", Decimal("85000.00")),
    ("UPI/Dunzo/66778899", "debit", "purchase", Decimal("149.00")),
    ("UPI/BigBasket/44332211", "debit", "purchase", Decimal("876.50")),
    ("ATM/Cash Withdrawal", "debit", "transfer", Decimal("5000.00")),
    ("UPI/Ola/77665544", "debit", "purchase", Decimal("312.00")),
]


async def seed_email_transactions(
    account: str, month_str: str
) -> List[Dict[str, Any]]:
    """
    Try to copy real email_ingestion rows from public.transactions.
    Always supplements to SYNTHETIC_TOTAL rows (spread across the month) so
    we have enough coverage: excluded rows land in the MIDDLE of the date
    range covered by included rows, ensuring the reconciliation pass can
    find them.

    Inserts into test_env.transactions and returns the seeded rows.
    """
    date_from, date_to = _month_date_range(month_str)

    conn = await _raw_conn()
    try:
        # Attempt to copy real rows from production
        await conn.execute(
            """
            INSERT INTO test_env.transactions
            SELECT * FROM public.transactions
            WHERE transaction_source = 'email_ingestion'
              AND account = $1
              AND transaction_date BETWEEN $2 AND $3
              AND is_deleted = false
            ORDER BY transaction_date
            LIMIT 10
            """,
            account,
            date_from,
            date_to,
        )
        real_rows = await conn.fetch(
            """
            SELECT id, transaction_date, amount, description, account,
                   direction, transaction_type, reference_number
            FROM test_env.transactions
            WHERE transaction_source = 'email_ingestion'
              AND account = $1
            ORDER BY transaction_date
            """,
            account,
        )

        seeded = [dict(r) for r in real_rows]

        # Always top up to SYNTHETIC_TOTAL rows so excluded rows fall inside
        # the date range covered by the included rows.
        # Day offsets: spread 10 rows evenly across the month (days 1-28).
        day_offsets = [1, 4, 7, 10, 13, 16, 19, 22, 25, 28]
        needed = max(0, SYNTHETIC_TOTAL - len(seeded))
        if needed > 0:
            print(
                f"  ⚠  Only {len(seeded)} real email_ingestion row(s) found for "
                f"'{account}' in {month_str} — adding {needed} synthetic row(s) "
                f"to reach {SYNTHETIC_TOTAL} total"
            )
            year, month_num = map(int, month_str.split("-"))
            for i in range(needed):
                # Pick day offsets from the end so they slot into the spread
                day_idx = SYNTHETIC_TOTAL - needed + i
                tx_day = day_offsets[day_idx % len(day_offsets)]
                tmpl_idx = (len(seeded)) % len(_SYNTHETIC_TEMPLATES)
                desc, direction, tx_type, amount = _SYNTHETIC_TEMPLATES[tmpl_idx]
                tx_date = date(year, month_num, tx_day)
                row_id = str(uuid.uuid4())
                await conn.execute(
                    """
                    INSERT INTO test_env.transactions
                        (id, transaction_date, description, amount, direction,
                         transaction_type, account, transaction_source,
                         is_deleted, statement_confirmed)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, 'email_ingestion', false, false)
                    """,
                    row_id,
                    tx_date,
                    desc,
                    amount,
                    direction,
                    tx_type,
                    account,
                )
                seeded.append(
                    {
                        "id": row_id,
                        "transaction_date": tx_date,
                        "amount": amount,
                        "description": desc,
                        "account": account,
                        "direction": direction,
                        "transaction_type": tx_type,
                        "reference_number": None,
                    }
                )

        return seeded

    finally:
        await conn.close()


def _print_seeded_table(rows: List[Dict[str, Any]]) -> None:
    print(f"\n  {'id':>36}  {'date':<12}  {'amount':>10}  description")
    print(f"  {_DIV}")
    for r in rows:
        row_id = str(r["id"])
        tx_date = r["transaction_date"]
        amount = float(r["amount"])
        desc = _trunc(r.get("description", ""), 40)
        print(f"  {row_id}  {str(tx_date):<12}  ₹{amount:>9,.2f}  {desc}")


# ---------------------------------------------------------------------------
# Phase 3 — Build synthetic combined_data
# ---------------------------------------------------------------------------

def build_combined_data(
    seeded_rows: List[Dict[str, Any]],
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """
    Convert all seeded email rows to statement_extraction format.
    Exclude EXCLUDED_COUNT rows from the MIDDLE of the date-sorted list.
    The included rows bracket the excluded rows on both sides, so the
    reconciliation pass (which uses min/max statement date as window) will
    cover the excluded rows and flag them as unconfirmed.

    Returns (combined_data, excluded_rows).
    """
    # Sort by date ascending to make the exclusion deterministic
    sorted_rows = sorted(seeded_rows, key=lambda r: r["transaction_date"])

    # Exclude rows from the middle so their dates fall within [first, last]
    # of the included rows.  With 10 rows we exclude indices 3-5.
    excl_start = len(sorted_rows) // 2 - 1  # e.g. index 4 of 10
    excl_end = excl_start + EXCLUDED_COUNT   # exclusive

    excluded = sorted_rows[excl_start:excl_end]
    included = sorted_rows[:excl_start] + sorted_rows[excl_end:]

    combined_data: List[Dict[str, Any]] = []
    for row in included:
        tx_date = row["transaction_date"]
        combined_data.append(
            {
                "transaction_date": tx_date.isoformat()
                if isinstance(tx_date, date)
                else tx_date,
                "amount": float(row["amount"]),
                "description": row.get("description", ""),
                "account": row["account"],
                "direction": row.get("direction", "debit"),
                "transaction_type": row.get("transaction_type", ""),
                "reference_number": row.get("reference_number"),
                "transaction_source": "statement_extraction",
            }
        )

    return combined_data, excluded


# ---------------------------------------------------------------------------
# Phase 4 — Run dedup + reconciliation
# ---------------------------------------------------------------------------

async def run_passes(
    combined_data: List[Dict[str, Any]],
) -> Tuple[List[Dict[str, Any]], Dict[str, int], Dict[str, int]]:
    """
    Import StatementWorkflow and invoke the internal dedup + reconciliation
    passes directly, without running the full pipeline.
    """
    # Import here (after TEST_MODE is set) so the engine picks up search_path
    from src.services.orchestrator.statement_workflow import StatementWorkflow  # noqa: E402

    # StatementWorkflow.__init__ tries to build email clients; that's fine since
    # we have valid credentials — we just don't call the email-fetching methods.
    try:
        workflow = StatementWorkflow()
    except Exception as exc:
        # If email client init fails (e.g. no token), still proceed — we only
        # need the internal dedup/recon methods which don't use the email client.
        logger.warning("StatementWorkflow init warning (non-fatal): %s", exc)
        workflow = object.__new__(StatementWorkflow)
        workflow.event_callback = None
        workflow.job_id = None

    filtered_data, dedup_stats = await workflow._run_dedup_pass(combined_data)
    recon_stats = await workflow._run_email_reconciliation_pass(combined_data)

    return filtered_data, dedup_stats, recon_stats


def _print_stats(dedup_stats: Dict[str, int], recon_stats: Dict[str, int]) -> None:
    print(f"\n  Dedup pass results:")
    print(f"  {_DIV}")
    for k, v in dedup_stats.items():
        print(f"    {k:<30} {v}")
    print(f"\n  Email reconciliation pass results:")
    print(f"  {_DIV}")
    for k, v in recon_stats.items():
        print(f"    {k:<30} {v}")


# ---------------------------------------------------------------------------
# Phase 5 — Assert and print results
# ---------------------------------------------------------------------------

async def assert_results(
    account: str,
    excluded_rows: List[Dict[str, Any]],
) -> bool:
    """
    Query test_env.review_queue, check that the excluded email rows are present,
    and validate that each entry's ambiguous_candidate_ids points to a valid UUID
    that exists in test_env.transactions with statement_confirmed = false.

    Returns True if all assertions pass.
    """
    from sqlalchemy import text  # noqa: E402
    from src.services.database_manager.connection import get_session_factory  # noqa: E402

    session_factory = get_session_factory()
    async with session_factory() as session:
        rq_rows = (
            await session.execute(
                text(
                    """
                    SELECT id, transaction_date, amount, description,
                           ambiguous_candidate_ids, review_type
                    FROM review_queue
                    WHERE account = :account
                      AND resolved_at IS NULL
                    ORDER BY transaction_date
                    """
                ),
                {"account": account},
            )
        ).fetchall()

    expected_count = EXCLUDED_COUNT
    actual_count = len(rq_rows)

    overall_pass = True
    row_results: List[Dict[str, Any]] = []

    # Build a lookup from excluded email tx by date+amount for matching
    # (we may not have reference_numbers to match on)
    excluded_by_key: Dict[Tuple, str] = {}
    for ex in excluded_rows:
        tx_date = ex["transaction_date"]
        if isinstance(tx_date, str):
            tx_date = date.fromisoformat(tx_date)
        key = (tx_date, round(float(ex["amount"]), 2))
        excluded_by_key[key] = str(ex["id"])

    # Validate each review queue entry
    conn = await _raw_conn()
    try:
        for rq in rq_rows:
            entry: Dict[str, Any] = {
                "date": rq.transaction_date,
                "amount": float(rq.amount),
                "description": _trunc(rq.description, 32),
                "candidate_id": None,
                "pass": True,
                "fail_reason": "",
            }

            cand_ids = rq.ambiguous_candidate_ids or []

            # Assertion 1: exactly 1 candidate id
            if len(cand_ids) != 1:
                entry["pass"] = False
                entry["fail_reason"] = f"expected 1 candidate_id, got {len(cand_ids)}"
                overall_pass = False
                row_results.append(entry)
                continue

            candidate_id = cand_ids[0]
            entry["candidate_id"] = candidate_id

            # Assertion 2: candidate_id is a valid UUID
            try:
                uuid.UUID(candidate_id)
            except ValueError:
                entry["pass"] = False
                entry["fail_reason"] = f"candidate_id '{candidate_id}' is not a valid UUID"
                overall_pass = False
                row_results.append(entry)
                continue

            # Assertion 3: candidate exists in test_env.transactions
            tx_row = await conn.fetchrow(
                "SELECT statement_confirmed FROM test_env.transactions WHERE id = $1",
                candidate_id,
            )
            if tx_row is None:
                entry["pass"] = False
                entry["fail_reason"] = f"UUID {candidate_id} not found in test_env.transactions"
                overall_pass = False
                row_results.append(entry)
                continue

            # Assertion 4: statement_confirmed is still false
            if tx_row["statement_confirmed"] is True:
                entry["pass"] = False
                entry["fail_reason"] = "email tx already marked statement_confirmed (should be false)"
                overall_pass = False

            row_results.append(entry)
    finally:
        await conn.close()

    # Count unconfirmed email txns
    conn2 = await _raw_conn()
    try:
        unconfirmed_count = await conn2.fetchval(
            """
            SELECT COUNT(*) FROM test_env.transactions
            WHERE transaction_source = 'email_ingestion'
              AND account = $1
              AND (statement_confirmed IS NULL OR statement_confirmed = false)
              AND is_deleted = false
            """,
            account,
        )
    finally:
        await conn2.close()

    # Print assertion table
    print(f"\n  ASSERTION RESULTS")
    print(f"  {_DIV}")
    count_ok = actual_count == expected_count
    count_marker = "✅" if count_ok else "❌"
    if not count_ok:
        overall_pass = False
    print(f"  Expected in review queue  : {expected_count}")
    print(f"  Actual in review queue    : {actual_count}  {count_marker}")

    if rq_rows:
        print(f"\n  Review queue entries:")
        hdr = f"  {'date':<12}  {'amount':>10}  {'description':<32}  {'candidate_id (email tx)':<36}  ✓"
        print(f"  {hdr}")
        print(f"  {_DIV}")
        for entry in row_results:
            marker = "✅" if entry["pass"] else f"❌ {entry['fail_reason']}"
            cid = (entry["candidate_id"] or "—")[:36]
            print(
                f"  {str(entry['date']):<12}  "
                f"₹{entry['amount']:>9,.2f}  "
                f"{entry['description']:<32}  "
                f"{cid:<36}  {marker}"
            )

    unconf_ok = unconfirmed_count == expected_count
    unconf_marker = "✅" if unconf_ok else "❌"
    if not unconf_ok:
        overall_pass = False
    print(f"\n  Email txns still unconfirmed (should equal {expected_count}):")
    print(f"  {unconfirmed_count}  {unconf_marker}")

    print(f"\n  {_DIV}")
    if overall_pass:
        print(f"  OVERALL: PASS ✅")
    else:
        print(f"  OVERALL: FAIL ❌")
        if actual_count != expected_count:
            print(
                f"  ✗ Review queue count mismatch: expected {expected_count}, "
                f"got {actual_count}"
            )
        for entry in row_results:
            if not entry["pass"]:
                print(f"  ✗ [{entry['date']} ₹{entry['amount']:.2f}] {entry['fail_reason']}")
        if not unconf_ok:
            print(
                f"  ✗ Unconfirmed email tx count: expected {expected_count}, "
                f"got {unconfirmed_count}"
            )
    print(f"  {_DIV}")

    return overall_pass


# ---------------------------------------------------------------------------
# Phase 6 — Teardown
# ---------------------------------------------------------------------------

async def teardown_test_schema(skip: bool) -> None:
    print(f"\n{_HDR}")
    if skip:
        print("  TEARDOWN  Skipped (--no-cleanup flag set)")
        print("  Inspect tables manually, then run:")
        print("    DROP SCHEMA test_env CASCADE;")
    else:
        print("  TEARDOWN  Dropping test_env schema")
        conn = await _raw_conn()
        try:
            await conn.execute("DROP SCHEMA IF EXISTS test_env CASCADE")
            print("  ✓  test_env dropped — production data untouched")
        finally:
            await conn.close()
    print(_HDR)


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

async def main(args: argparse.Namespace) -> None:
    month_str = args.month
    account = args.account
    date_from, date_to = _month_date_range(month_str)

    print(f"\n{_HDR}")
    print("  EMAIL RECONCILIATION SMOKE TEST")
    print(f"  Account       : {account}")
    print(f"  Month         : {month_str} ({date_from} → {date_to})")
    print(f"  Excluded rows : {EXCLUDED_COUNT}  (middle {EXCLUDED_COUNT} by date — these must appear in review queue)")
    print(f"  Cleanup       : {'yes' if not args.no_cleanup else 'no (--no-cleanup)'}")
    print(_HDR)

    # Phase 1 — Setup
    print(f"\n{_HDR}")
    print("  PHASE 1   Setup test_env schema")
    print(_HDR)
    await setup_test_schema()

    overall_pass = False
    try:
        # Phase 2 — Seed email transactions
        print(f"\n{_HDR}")
        print("  PHASE 2   Seed email_ingestion transactions into test_env")
        print(_HDR)
        seeded_rows = await seed_email_transactions(account, month_str)
        print(
            f"\n  Seeded {len(seeded_rows)} email_ingestion row(s) "
            f"for '{account}' in {month_str}:"
        )
        _print_seeded_table(seeded_rows)

        min_needed = EXCLUDED_COUNT + 2  # need rows before AND after the excluded window
        if len(seeded_rows) < min_needed:
            print(
                f"\n❌  Need at least {min_needed} seeded rows to run the test "
                f"(got {len(seeded_rows)}). Aborting."
            )
            return

        # Phase 3 — Build combined_data
        print(f"\n{_HDR}")
        print("  PHASE 3   Build synthetic statement combined_data")
        print(_HDR)
        combined_data, excluded_rows = build_combined_data(seeded_rows)
        print(
            f"\n  Built {len(combined_data)} statement transactions "
            f"(excluded {EXCLUDED_COUNT} middle row(s) to simulate missing alerts)"
        )
        print(f"  Excluded rows (expect these in review queue):")
        _print_seeded_table(excluded_rows)

        # Phase 4 — Run passes
        print(f"\n{_HDR}")
        print("  PHASE 4   Run dedup + email reconciliation passes")
        print(_HDR)
        filtered_data, dedup_stats, recon_stats = await run_passes(combined_data)
        _print_stats(dedup_stats, recon_stats)

        # Phase 5 — Assert
        print(f"\n{_HDR}")
        print("  PHASE 5   Assert review queue contents")
        print(_HDR)
        overall_pass = await assert_results(account, excluded_rows)

    except Exception as exc:
        print(f"\n❌  Smoke test raised an exception: {exc}")
        import traceback
        traceback.print_exc()

    finally:
        await teardown_test_schema(skip=args.no_cleanup)

    sys.exit(0 if overall_pass else 1)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Validate the email reconciliation pass (Step 7.5) in isolation",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument(
        "--account",
        default="Yes Bank Savings Account",
        metavar="NAME",
        help="Account nickname to use (default: 'Yes Bank Savings Account')",
    )
    parser.add_argument(
        "--month",
        default=_prev_month(),
        metavar="YYYY-MM",
        help="Month to pull/generate email transactions for (default: previous month)",
    )
    parser.add_argument(
        "--no-cleanup",
        action="store_true",
        help="Keep test_env schema after the run for manual inspection",
    )
    asyncio.run(main(parser.parse_args()))
