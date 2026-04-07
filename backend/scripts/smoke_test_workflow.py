#!/usr/bin/env python3
"""
Workflow Smoke Test Script

Creates a temporary `test_env` schema in PostgreSQL, runs the full workflow
pipeline (email ingestion → statement standardisation → dedup → DB insert)
against it, prints a results summary, then drops the schema.

Nothing is written to production tables.

Usage (run from backend/):
    poetry run python scripts/smoke_test_workflow.py
    poetry run python scripts/smoke_test_workflow.py --month 2026-03
    poetry run python scripts/smoke_test_workflow.py --no-cleanup     # keep schema for manual inspection
    poetry run python scripts/smoke_test_workflow.py --no-splitwise   # skip Splitwise sync

Tables created in test_env:
    transactions                — starts empty; receives email + statement inserts
    review_queue                — starts empty; receives ambiguous dedup items
    statement_processing_log    — seeded from production for --month (status preserved)

After the run you can inspect test_env manually:
    SELECT * FROM test_env.transactions;
    SELECT * FROM test_env.review_queue;
    SELECT normalized_filename, status FROM test_env.statement_processing_log;

To clean up manually if --no-cleanup was used:
    DROP SCHEMA test_env CASCADE;
"""

import argparse
import asyncio
import os
import sys
from datetime import date, datetime
from pathlib import Path
from typing import Optional

# ── CRITICAL: set TEST_MODE before any app imports ─────────────────────────
# connection.py reads this env var when creating the engine and adds
# search_path=test_env,public so all ORM writes land in test_env.
os.environ["TEST_MODE"] = "true"

sys.path.insert(0, str(Path(__file__).parent.parent))

# ── Safe to import app modules now ─────────────────────────────────────────
from src.utils.settings import get_settings  # noqa: E402
from src.utils.logger import get_logger       # noqa: E402

logger = get_logger("smoke_test")

_DIV = "─" * 62
_HDR = "═" * 62


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _prev_month() -> str:
    today = date.today()
    if today.month == 1:
        return f"{today.year - 1}-12"
    return f"{today.year}-{today.month - 1:02d}"


async def _raw_conn():
    """
    Open a raw asyncpg connection without any search_path override.
    Used for schema DDL that must target the public schema.
    """
    import asyncpg
    settings = get_settings()
    dsn = settings.DATABASE_URL.replace("postgresql+asyncpg://", "postgresql://")
    return await asyncpg.connect(dsn)


# ---------------------------------------------------------------------------
# Phase 1 — Setup
# ---------------------------------------------------------------------------

async def setup_test_schema(statement_month: str) -> int:
    """
    Drop (if exists) and recreate test_env schema with 3 tables.
    Seeds statement_processing_log from production for statement_month.
    Returns the number of seeded log rows.
    """
    print(f"\n{_HDR}")
    print(f"  SETUP   test_env schema  (month: {statement_month})")
    print(_HDR)

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

        # Seed the statement log from production (status preserved as-is so the
        # workflow skips already-complete statements and only re-processes those
        # you have manually reset, e.g. swiggy_hdfc / axis_atlas → pdf_stored).
        await conn.execute(
            """
            INSERT INTO test_env.statement_processing_log
            SELECT * FROM public.statement_processing_log
            WHERE statement_month = $1
            """,
            statement_month,
        )
        seeded = await conn.fetchval(
            "SELECT COUNT(*) FROM test_env.statement_processing_log"
        )
        print(f"  ✓  Seeded {seeded} statement log row(s) for {statement_month}")

        # Show their statuses so user knows what will be re-processed
        rows = await conn.fetch(
            """
            SELECT status, COUNT(*) AS n
            FROM   test_env.statement_processing_log
            GROUP  BY status
            ORDER  BY status
            """
        )
        for r in rows:
            marker = "  ↺ will re-extract" if r["status"] in ("pdf_stored", "pdf_unlocked", "downloaded") else "  ✓ will skip"
            print(f"       {r['status']:<20} {r['n']:>3} row(s){marker}")

        return seeded
    finally:
        await conn.close()


# ---------------------------------------------------------------------------
# Phase 2 — Workflow run
# ---------------------------------------------------------------------------

async def run_workflow(include_splitwise: bool, email_since: Optional[datetime], email_until: Optional[datetime]) -> dict:
    """
    Import and run StatementWorkflow in-process against test_env tables.
    All DB writes go to test_env due to search_path set by TEST_MODE.
    """
    from datetime import datetime as _dt  # noqa: F401 — imported for type use above

    print(f"\n{_HDR}")
    print("  WORKFLOW  Running pipeline (writes to test_env)")
    if email_since or email_until:
        print(f"  Email window: {email_since.date() if email_since else 'watermark'} → {email_until.date() if email_until else 'today'}")
    print(_HDR)

    from src.services.orchestrator.statement_workflow import StatementWorkflow  # noqa: E402

    events: list[dict] = []

    def callback(event: dict) -> None:
        events.append(event)
        level = event.get("level", "info")
        step  = event.get("step", "")
        msg   = event.get("message", "")
        icon  = {"success": "✅", "warning": "⚠️ ", "error": "❌"}.get(level, "ℹ️ ")
        print(f"  {icon} [{step}] {msg}")

    workflow = StatementWorkflow(event_callback=callback)
    result = await workflow.run_complete_workflow(
        include_email_ingestion=True,
        include_statement=True,
        include_splitwise=include_splitwise,
        email_since_date=email_since,
        email_until_date=email_until,
        job_id="smoke-test",
    )
    result["_events"] = events
    return result


# ---------------------------------------------------------------------------
# Phase 3 — Results
# ---------------------------------------------------------------------------

async def print_results(result: dict) -> None:
    """Query test_env tables and print a human-readable summary."""
    print(f"\n{_HDR}")
    print("  RESULTS   What landed in test_env")
    print(_HDR)

    from sqlalchemy import text                                           # noqa: E402
    from src.services.database_manager.connection import get_session_factory  # noqa: E402

    async with get_session_factory()() as session:
        # Transactions breakdown by account + source + type
        tx_rows = (await session.execute(text("""
            SELECT account,
                   transaction_source,
                   transaction_type,
                   COUNT(*)    AS cnt,
                   SUM(amount) AS total
            FROM   transactions
            GROUP  BY account, transaction_source, transaction_type
            ORDER  BY account, transaction_source
        """))).fetchall()

        # Review queue breakdown
        rq_rows = (await session.execute(text("""
            SELECT review_type, account, COUNT(*) AS cnt
            FROM   review_queue
            GROUP  BY review_type, account
            ORDER  BY review_type, account
        """))).fetchall()

    total_tx = sum(r.cnt for r in tx_rows)
    total_rq = sum(r.cnt for r in rq_rows)

    print(f"\n  transactions  ({total_tx} total rows)")
    print(f"  {'account':<32} {'source':<22} {'type':<8} {'rows':>5}  {'total':>12}")
    print(f"  {_DIV}")
    if tx_rows:
        for r in tx_rows:
            print(
                f"  {str(r.account):<32} {str(r.transaction_source):<22} "
                f"{str(r.transaction_type):<8} {r.cnt:>5}  ₹{float(r.total):>11,.2f}"
            )
    else:
        print("  (none)")

    print(f"\n  review_queue  ({total_rq} total items)")
    if rq_rows:
        for r in rq_rows:
            print(f"  {str(r.review_type):<22} {str(r.account):<32} {r.cnt:>4} item(s)")
    else:
        print("  (none — all statement transactions matched email alerts or passed through)")

    # Workflow summary numbers
    email_ing = result.get("email_ingestion") or {}
    print(f"\n  pipeline summary")
    print(f"  {_DIV}")
    print(f"  email ingestion   inserted={email_ing.get('inserted', 'n/a')}  "
          f"skipped={email_ing.get('skipped', 'n/a')}  "
          f"errors={email_ing.get('errors', 'n/a')}")
    print(f"  statements DL'd   {result.get('total_statements_downloaded', 0)}")
    print(f"  statements proc'd {result.get('total_statements_processed', 0)}")
    print(f"  dedup confirmed   {result.get('dedup_confirmed', 0)}")
    print(f"  dedup → review    {result.get('dedup_review_queued', 0)}")
    print(f"  db inserted       {result.get('database_inserted_count', 0)}")
    print(f"  db skipped        {result.get('database_skipped_count', 0)}")

    errors = result.get("errors", [])
    if errors:
        print(f"\n  ⚠️  {len(errors)} non-fatal error(s):")
        for e in errors:
            print(f"    ✗ {e}")


# ---------------------------------------------------------------------------
# Phase 4 — Teardown
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
    from datetime import datetime as _dt

    # Resolve email date window — default to full target month
    year, month = map(int, args.month.split("-"))
    email_since = _dt.strptime(args.email_since, "%Y-%m-%d") if args.email_since else _dt(year, month, 1)
    # Gmail `before:` is exclusive, so 1st of next month = last day of target month inclusive
    next_month = month % 12 + 1
    next_year  = year + (1 if month == 12 else 0)
    email_until = _dt.strptime(args.email_until, "%Y-%m-%d") if args.email_until else _dt(next_year, next_month, 1)

    print(f"\n{_HDR}")
    print("  WORKFLOW SMOKE TEST")
    print(f"  Target month  : {args.month}")
    print(f"  Email window  : {email_since.date()} → {email_until.date()} (exclusive)")
    print(f"  Splitwise     : {'yes' if not args.no_splitwise else 'skipped (--no-splitwise)'}")
    print(f"  Cleanup       : {'yes' if not args.no_cleanup else 'no (--no-cleanup)'}")
    print(_HDR)

    try:
        await setup_test_schema(args.month)
        result = await run_workflow(
            include_splitwise=not args.no_splitwise,
            email_since=email_since,
            email_until=email_until,
        )
        await print_results(result)
    except Exception as exc:
        print(f"\n❌  Smoke test failed: {exc}")
        import traceback
        traceback.print_exc()
    finally:
        await teardown_test_schema(skip=args.no_cleanup)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Run the full workflow against an isolated test_env schema",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument(
        "--month",
        default=_prev_month(),
        metavar="YYYY-MM",
        help="Statement month to seed into test_env (default: previous calendar month)",
    )
    parser.add_argument(
        "--no-cleanup",
        action="store_true",
        help="Keep test_env schema after the run for manual inspection",
    )
    parser.add_argument(
        "--no-splitwise",
        action="store_true",
        help="Skip the Splitwise sync step",
    )
    parser.add_argument(
        "--email-since",
        default=None,
        metavar="YYYY-MM-DD",
        help=(
            "Fetch alert emails since this date (default: 1st of --month). "
            "Overrides the alert_last_processed_at watermarks on the accounts table."
        ),
    )
    parser.add_argument(
        "--email-until",
        default=None,
        metavar="YYYY-MM-DD",
        help=(
            "Fetch alert emails up to but not including this date "
            "(default: 1st of the month after --month, i.e. end of target month). "
            "Gmail before: is exclusive so 2026-04-01 includes all of March."
        ),
    )
    asyncio.run(main(parser.parse_args()))
