#!/usr/bin/env python3
"""
Dedup Smoke Test

Validates _run_dedup_pass + _run_email_reconciliation_pass against ALL known
edge cases using fully synthetic seeded data in test_env.

All 12 cases are deterministic and self-contained — no dependency on production
email_ingestion data.

Usage (run from backend/):
    poetry run python scripts/smoke_test_dedup.py
    poetry run python scripts/smoke_test_dedup.py --no-cleanup
"""

import argparse
import asyncio
import os
import sys
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

# ── CRITICAL: set TEST_MODE before any app imports ───────────────────────────
os.environ["TEST_MODE"] = "true"

sys.path.insert(0, str(Path(__file__).parent.parent))

# ── Safe to import app modules now ───────────────────────────────────────────
from src.utils.settings import get_settings  # noqa: E402
from src.utils.logger import get_logger       # noqa: E402

logger = get_logger("smoke_test_dedup")

_DIV = "─" * 90
_HDR = "═" * 90

ACCOUNT = "Axis Atlas Credit Card"


# ---------------------------------------------------------------------------
# Raw connection helper (no search_path override — for DDL)
# ---------------------------------------------------------------------------

async def _raw_conn():
    import asyncpg
    settings = get_settings()
    dsn = settings.DATABASE_URL.replace("postgresql+asyncpg://", "postgresql://")
    return await asyncpg.connect(dsn)


# ---------------------------------------------------------------------------
# Phase 1 — Setup test_env schema
# ---------------------------------------------------------------------------

async def setup_test_schema() -> None:
    conn = await _raw_conn()
    try:
        await conn.execute("DROP SCHEMA IF EXISTS test_env CASCADE")
        print("  [ok] Dropped previous test_env (if any)")
        await conn.execute("CREATE SCHEMA test_env")
        print("  [ok] Created schema test_env")
        for table in ("transactions", "review_queue", "statement_processing_log"):
            await conn.execute(
                f"CREATE TABLE test_env.{table} "
                f"(LIKE public.{table} INCLUDING ALL)"
            )
            print(f"  [ok] Created test_env.{table}")
    finally:
        await conn.close()


# ---------------------------------------------------------------------------
# Phase 2 — Seed synthetic transactions
# ---------------------------------------------------------------------------

async def seed_transactions() -> Dict[str, str]:
    """
    Insert all 12 test cases into test_env.transactions.
    Returns a dict mapping case_key -> UUID string for rows that need IDs in assertions.
    """
    conn = await _raw_conn()
    ids: Dict[str, str] = {}

    async def insert(
        *,
        case_key: str,
        amount: float,
        tx_date: date,
        reference_number: Optional[str] = None,
        is_split: bool = False,
        is_shared: bool = False,
        split_share_amount: Optional[float] = None,
        is_grouped_expense: bool = False,
        transaction_group_id: Optional[str] = None,
        transaction_source: str = "email_ingestion",
        description: str = "Synthetic tx",
    ) -> str:
        row = await conn.fetchrow(
            """
            INSERT INTO test_env.transactions
                (id, transaction_date, description, amount, direction, transaction_type,
                 account, transaction_source, is_deleted, statement_confirmed,
                 reference_number, is_split, is_shared, split_share_amount,
                 is_grouped_expense, transaction_group_id)
            VALUES
                (gen_random_uuid(), $1, $2, $3, 'debit', 'purchase',
                 $4, $5, false, false,
                 $6, $7, $8, $9,
                 $10, $11::uuid)
            RETURNING id::text
            """,
            tx_date,
            description,
            Decimal(str(amount)),
            ACCOUNT,
            transaction_source,
            reference_number,
            is_split,
            is_shared,
            Decimal(str(split_share_amount)) if split_share_amount is not None else None,
            is_grouped_expense,
            transaction_group_id,
        )
        tx_id = row["id"]
        ids[case_key] = tx_id
        return tx_id

    try:
        # Case 1 — Tier 1 match (reference number)
        await insert(case_key="c1", amount=500, tx_date=date(2026, 3, 5),
                     reference_number="REF001", description="Case 1 Tier1 ref match")

        # Case 2 — Tier 2 match (exact date)
        await insert(case_key="c2", amount=1200, tx_date=date(2026, 3, 8),
                     description="Case 2 Tier2 exact date")

        # Case 3 — Tier 2 match (within ±3 days)
        await insert(case_key="c3", amount=750, tx_date=date(2026, 3, 10),
                     description="Case 3 Tier2 date window")

        # Case 4a — Ambiguous email tx A
        await insert(case_key="c4a", amount=300, tx_date=date(2026, 3, 14),
                     description="Case 4a Ambiguous A")
        # Case 4b — Ambiguous email tx B
        await insert(case_key="c4b", amount=300, tx_date=date(2026, 3, 15),
                     description="Case 4b Ambiguous B")

        # Case 5 — Shared transaction (is_shared=true, gross amount matches)
        await insert(case_key="c5", amount=900, tx_date=date(2026, 3, 17),
                     is_shared=True, split_share_amount=450,
                     description="Case 5 Shared tx")

        # Case 6 — Split transaction (is_split=true, Tier 1 match)
        await insert(case_key="c6", amount=2400, tx_date=date(2026, 3, 19),
                     reference_number="REF006", is_split=True,
                     description="Case 6 Split tx")

        # Case 7 — Grouped expense, real row (is_grouped_expense=false)
        group_uuid = await conn.fetchval("SELECT gen_random_uuid()::text")
        await insert(case_key="c7", amount=1500, tx_date=date(2026, 3, 21),
                     is_grouped_expense=False, transaction_group_id=group_uuid,
                     description="Case 7 Grouped real row")

        # Case 8 — Grouped expense, synthetic ₹0 placeholder (is_grouped_expense=true)
        await insert(case_key="c8", amount=0, tx_date=date(2026, 3, 21),
                     is_grouped_expense=True, transaction_group_id=group_uuid,
                     description="Case 8 Grouped placeholder")

        # Case 9 — Statement tx with no email match (no email tx seeded)
        # (no email tx — statement-only in combined_data)

        # Case 10 — Email tx with no statement match
        await insert(case_key="c10", amount=800, tx_date=date(2026, 3, 25),
                     description="Case 10 Email no stmt match")

        # Case 11 — Tier 2 outside ±3 day window (5 days apart — no match)
        await insert(case_key="c11", amount=400, tx_date=date(2026, 3, 1),
                     description="Case 11 Email outside window")

        # Case 12 — Grouped expense real non-zero, but transaction_source='manual_entry'
        await insert(case_key="c12", amount=5000, tx_date=date(2026, 3, 27),
                     is_grouped_expense=True, transaction_source="manual_entry",
                     description="Case 12 Manual entry grouped")

    finally:
        await conn.close()

    return ids


# ---------------------------------------------------------------------------
# Phase 3 — Build combined_data (statement_extraction rows)
# ---------------------------------------------------------------------------

def build_combined_data(ids: Dict[str, str]) -> List[Dict[str, Any]]:
    """
    Build a synthetic list of statement_extraction transactions matching the
    email_ingestion rows (where a match is expected), plus unique statement-only rows.
    """
    combined: List[Dict[str, Any]] = []

    def stmt(
        amount: float,
        tx_date: str,
        reference_number: Optional[str] = None,
        description: str = "Stmt tx",
    ) -> Dict[str, Any]:
        return {
            "transaction_date": tx_date,
            "amount": amount,
            "description": description,
            "account": ACCOUNT,
            "direction": "debit",
            "transaction_type": "purchase",
            "reference_number": reference_number,
            "transaction_source": "statement_extraction",
        }

    # Case 1 — matches email tx c1 by REF001
    combined.append(stmt(500, "2026-03-05", reference_number="REF001", description="Case 1 stmt"))

    # Case 2 — matches email tx c2 by amount+date
    combined.append(stmt(1200, "2026-03-08", description="Case 2 stmt"))

    # Case 3 — matches email tx c3 (2 days apart, within ±3)
    combined.append(stmt(750, "2026-03-12", description="Case 3 stmt"))

    # Case 4 — one statement tx, but TWO email candidates → ambiguous
    combined.append(stmt(300, "2026-03-14", description="Case 4 stmt"))

    # Case 5 — matches email tx c5 on gross amount 900
    combined.append(stmt(900, "2026-03-17", description="Case 5 stmt"))

    # Case 6 — matches email tx c6 by REF006
    combined.append(stmt(2400, "2026-03-19", reference_number="REF006", description="Case 6 stmt"))

    # Case 7 — matches email tx c7 by amount+date
    combined.append(stmt(1500, "2026-03-21", description="Case 7 stmt"))

    # Case 8 — NO statement tx (placeholder ₹0 should be filtered out by the fix)

    # Case 9 — statement tx with no email match (REF009)
    combined.append(stmt(650, "2026-03-23", reference_number="REF009", description="Case 9 stmt"))

    # Case 10 — NO statement tx (email tx c10 should be flagged by reconciliation pass)

    # Case 11 — statement tx 5 days after email tx (outside ±3 window → no match)
    combined.append(stmt(400, "2026-03-06", description="Case 11 stmt"))

    # Case 12 — NO statement tx (manual_entry, not email_ingestion)

    return combined


# ---------------------------------------------------------------------------
# Phase 4 — Run dedup + reconciliation passes
# ---------------------------------------------------------------------------

async def run_passes(
    combined_data: List[Dict[str, Any]],
) -> Tuple[List[Dict[str, Any]], Dict[str, int], Dict[str, int]]:
    from src.services.orchestrator.statement_workflow import StatementWorkflow  # noqa: E402

    try:
        workflow = StatementWorkflow()
    except Exception as exc:
        logger.warning("StatementWorkflow init warning (non-fatal): %s", exc)
        workflow = object.__new__(StatementWorkflow)
        workflow.event_callback = None
        workflow.job_id = None

    filtered_data, dedup_stats = await workflow._run_dedup_pass(combined_data)
    recon_stats = await workflow._run_email_reconciliation_pass(combined_data)

    return filtered_data, dedup_stats, recon_stats


# ---------------------------------------------------------------------------
# Phase 5 — Assertions
# ---------------------------------------------------------------------------

async def run_assertions(ids: Dict[str, str], dedup_stats: Dict[str, int], recon_stats: Dict[str, int]) -> bool:
    from sqlalchemy import text
    from src.services.database_manager.connection import get_session_factory

    conn = await _raw_conn()
    session_factory = get_session_factory()

    results: List[Dict[str, Any]] = []

    try:
        # Fetch all review_queue rows for this account
        rq_rows = await conn.fetch(
            """
            SELECT id::text, review_type, transaction_date, amount::float,
                   reference_number, ambiguous_candidate_ids
            FROM test_env.review_queue
            WHERE account = $1
              AND resolved_at IS NULL
            ORDER BY transaction_date, created_at
            """,
            ACCOUNT,
        )

        # Fetch confirmed email txns
        confirmed_txns = await conn.fetch(
            """
            SELECT id::text FROM test_env.transactions
            WHERE statement_confirmed = true
              AND transaction_source = 'email_ingestion'
            """,
        )
        confirmed_ids = {r["id"] for r in confirmed_txns}

        def check(desc: str, passed: bool, expected: str, actual: str) -> bool:
            results.append({
                "desc": desc,
                "expected": expected,
                "actual": actual,
                "pass": passed,
            })
            return passed

        overall = True

        # ── Cases 1, 2, 3, 5, 6, 7 — confirmed matches ───────────────────
        confirmed_count = dedup_stats.get("confirmed", 0)

        ok = check(
            "Cases 1,2,3,5,6,7: dedup_confirmed=6",
            confirmed_count == 6,
            "dedup_confirmed=6",
            f"dedup_confirmed={confirmed_count}",
        )
        if not ok:
            overall = False

        # Individual confirmation — check IDs are in confirmed set
        for key, label in [("c1", "Case1"), ("c2", "Case2"), ("c3", "Case3"),
                            ("c5", "Case5"), ("c6", "Case6"), ("c7", "Case7")]:
            tx_id = ids[key]
            ok = check(
                f"  {label}: email tx statement_confirmed=true",
                tx_id in confirmed_ids,
                "statement_confirmed=true",
                "true" if tx_id in confirmed_ids else "false",
            )
            if not ok:
                overall = False

        # ── Case 4 — ambiguous, 2 candidate_ids ──────────────────────────
        # The dedup pass creates ONE ambiguous entry with exactly 2 candidate_ids
        # (the statement tx dated 2026-03-14 matched both c4a and c4b within ±3 days).
        # The reconciliation pass may also add entries for c4a/c4b individually (still
        # unconfirmed), but we only assert on the dedup-generated entry with 2 candidates.
        case4_dedup_rq = [
            r for r in rq_rows
            if r["review_type"] == "ambiguous"
            and abs(r["amount"] - 300.0) < 0.01
            and r["ambiguous_candidate_ids"] is not None
            and len(r["ambiguous_candidate_ids"]) == 2
        ]
        case4_ok = len(case4_dedup_rq) == 1
        c4_cand_ids = case4_dedup_rq[0]["ambiguous_candidate_ids"] if case4_dedup_rq else []
        ok = check(
            "Case 4: dedup created 1 ambiguous entry with 2 candidate_ids",
            case4_ok,
            "1 dedup entry, 2 candidates",
            f"{len(case4_dedup_rq)} dedup entry, {len(c4_cand_ids)} candidates" if case4_dedup_rq else "0 dedup entries",
        )
        if not ok:
            overall = False

        # Verify both candidate IDs are c4a and c4b
        if case4_ok:
            expected_c4_ids = {ids["c4a"], ids["c4b"]}
            actual_c4_ids = set(c4_cand_ids)
            c4_ids_match = expected_c4_ids == actual_c4_ids
            ok = check(
                "  Case 4: candidates are c4a and c4b",
                c4_ids_match,
                "{c4a, c4b}",
                "match" if c4_ids_match else "mismatch",
            )
            if not ok:
                overall = False

        # ── Case 8 — ₹0 placeholder NOT in review_queue ──────────────────
        c8_id = ids["c8"]
        # Check not as queued item directly
        c8_as_queued = [
            r for r in rq_rows
            if r["review_type"] == "ambiguous"
            and abs(r["amount"] - 0.0) < 0.01
            and str(r["transaction_date"]) == "2026-03-21"
        ]
        # Check not as a candidate_id in any row
        all_candidate_ids = set()
        for r in rq_rows:
            if r["ambiguous_candidate_ids"]:
                all_candidate_ids.update(r["ambiguous_candidate_ids"])
        c8_as_candidate = c8_id in all_candidate_ids

        c8_absent = len(c8_as_queued) == 0 and not c8_as_candidate
        ok = check(
            "Case 8: ₹0 placeholder NOT in review_queue",
            c8_absent,
            "not in review_queue",
            "absent" if c8_absent else f"present (queued={len(c8_as_queued)}, as_candidate={c8_as_candidate})",
        )
        if not ok:
            overall = False

        # ── Case 9 — statement_only entry with REF009 ────────────────────
        case9_rq = [
            r for r in rq_rows
            if r["review_type"] == "statement_only"
            and r["reference_number"] == "REF009"
        ]
        ok = check(
            "Case 9: 1 statement_only rq entry with REF009",
            len(case9_rq) == 1,
            "1 statement_only(REF009)",
            f"{len(case9_rq)} statement_only(REF009)",
        )
        if not ok:
            overall = False

        # ── Case 10 — reconciliation pass flags email tx (ambiguous, 1 candidate) ──
        c10_id = ids["c10"]
        case10_rq = [
            r for r in rq_rows
            if r["review_type"] == "ambiguous"
            and r["ambiguous_candidate_ids"] is not None
            and c10_id in r["ambiguous_candidate_ids"]
        ]
        ok = check(
            "Case 10: reconciliation queues email tx c10",
            len(case10_rq) == 1,
            f"1 ambiguous([c10_id])",
            f"{len(case10_rq)} matching entries",
        )
        if not ok:
            overall = False

        if case10_rq:
            c10_cands = case10_rq[0]["ambiguous_candidate_ids"]
            ok = check(
                "  Case 10: candidate_ids=[c10_id] (exactly 1)",
                len(c10_cands) == 1 and c10_cands[0] == c10_id,
                "1 candidate = c10_id",
                f"{len(c10_cands)} candidates",
            )
            if not ok:
                overall = False

        # ── Case 11 — both email AND statement end up in review_queue ─────
        # Statement side: statement_only for amount=400, date=2026-03-06
        c11_stmt_rq = [
            r for r in rq_rows
            if r["review_type"] == "statement_only"
            and abs(r["amount"] - 400.0) < 0.01
            and str(r["transaction_date"]) == "2026-03-06"
        ]
        # Email side: ambiguous/reconciliation for email tx c11 (amount=400, date=2026-03-01)
        c11_id = ids["c11"]
        c11_email_rq = [
            r for r in rq_rows
            if r["review_type"] == "ambiguous"
            and r["ambiguous_candidate_ids"] is not None
            and c11_id in r["ambiguous_candidate_ids"]
        ]
        ok = check(
            "Case 11: statement_only for ₹400/2026-03-06",
            len(c11_stmt_rq) == 1,
            "1 statement_only",
            f"{len(c11_stmt_rq)} statement_only",
        )
        if not ok:
            overall = False

        ok = check(
            "Case 11: ambiguous for email tx c11 (no match, reconciliation)",
            len(c11_email_rq) == 1,
            "1 ambiguous(c11)",
            f"{len(c11_email_rq)} ambiguous(c11)",
        )
        if not ok:
            overall = False

        # ── Case 12 — manual_entry NOT in review_queue ───────────────────
        c12_id = ids["c12"]
        c12_as_candidate = c12_id in all_candidate_ids
        c12_amount_rq = [
            r for r in rq_rows
            if abs(r["amount"] - 5000.0) < 0.01
        ]
        c12_absent = not c12_as_candidate and len(c12_amount_rq) == 0
        ok = check(
            "Case 12: manual_entry ₹5000 NOT in review_queue",
            c12_absent,
            "not in review_queue",
            "absent" if c12_absent else f"present (candidate={c12_as_candidate}, rows={len(c12_amount_rq)})",
        )
        if not ok:
            overall = False

    finally:
        await conn.close()

    return results, overall


# ---------------------------------------------------------------------------
# Phase 6 — Print results table
# ---------------------------------------------------------------------------

def print_results(results: List[Dict[str, Any]], dedup_stats: Dict[str, int], recon_stats: Dict[str, int]) -> None:
    print(f"\n  {'Case / Description':<58}  {'Expected':<28}  {'Actual':<28}  Status")
    print(f"  {_DIV}")
    passed = 0
    failed = 0
    for r in results:
        status = "PASS" if r["pass"] else "FAIL"
        if r["pass"]:
            passed += 1
        else:
            failed += 1
        print(
            f"  {r['desc']:<58}  {r['expected']:<28}  {r['actual']:<28}  {status}"
        )
    print(f"\n  Dedup stats  : {dedup_stats}")
    print(f"  Recon stats  : {recon_stats}")
    print(f"\n  Passed: {passed}  |  Failed: {failed}")


# ---------------------------------------------------------------------------
# Phase 7 — Teardown
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
            print("  [ok] test_env dropped — production data untouched")
        finally:
            await conn.close()
    print(_HDR)


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

async def main(args: argparse.Namespace) -> None:
    print(f"\n{_HDR}")
    print("  DEDUP SMOKE TEST — ALL EDGE CASES")
    print(f"  Account   : {ACCOUNT}")
    print(f"  Date      : March 2026")
    print(f"  Cleanup   : {'yes' if not args.no_cleanup else 'no (--no-cleanup)'}")
    print(_HDR)

    # Verify account has alert_sender (needed for Cases 9, 11)
    conn = await _raw_conn()
    try:
        acct_row = await conn.fetchrow(
            "SELECT alert_sender, billing_cycle_start FROM public.accounts WHERE nickname = $1",
            ACCOUNT,
        )
    finally:
        await conn.close()

    if acct_row is None:
        print(f"\n  WARNING: Account '{ACCOUNT}' not found in public.accounts — case 9/11 may fail")
    elif not acct_row["alert_sender"]:
        print(f"\n  WARNING: Account '{ACCOUNT}' has no alert_sender — statement_only cases (9, 11) will not be queued")
    else:
        print(f"\n  Account verified: alert_sender='{acct_row['alert_sender']}', billing_cycle_start={acct_row['billing_cycle_start']}")

    # Phase 1 — Setup
    print(f"\n{_HDR}")
    print("  PHASE 1   Setup test_env schema")
    print(_HDR)
    await setup_test_schema()

    overall_pass = False
    try:
        # Phase 2 — Seed
        print(f"\n{_HDR}")
        print("  PHASE 2   Seed synthetic transactions")
        print(_HDR)
        ids = await seed_transactions()
        print(f"  Seeded {len(ids)} email_ingestion rows (+ 1 manual_entry for case 12)")
        for key, tx_id in ids.items():
            print(f"    {key}: {tx_id}")

        # Phase 3 — Build combined_data
        print(f"\n{_HDR}")
        print("  PHASE 3   Build combined_data (statement_extraction rows)")
        print(_HDR)
        combined_data = build_combined_data(ids)
        print(f"  Built {len(combined_data)} statement_extraction transactions")

        # Phase 4 — Run passes
        print(f"\n{_HDR}")
        print("  PHASE 4   Run dedup + email reconciliation passes")
        print(_HDR)
        filtered_data, dedup_stats, recon_stats = await run_passes(combined_data)
        print(f"  Dedup stats  : {dedup_stats}")
        print(f"  Recon stats  : {recon_stats}")

        # Phase 5 — Assertions
        print(f"\n{_HDR}")
        print("  PHASE 5   Assertions")
        print(_HDR)
        results, overall_pass = await run_assertions(ids, dedup_stats, recon_stats)

        print_results(results, dedup_stats, recon_stats)

        print(f"\n{_HDR}")
        if overall_pass:
            print("  OVERALL: PASS")
        else:
            print("  OVERALL: FAIL")
        print(_HDR)

    except Exception as exc:
        print(f"\n  ERROR: Smoke test raised an exception: {exc}")
        import traceback
        traceback.print_exc()

    finally:
        await teardown_test_schema(skip=args.no_cleanup)

    sys.exit(0 if overall_pass else 1)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Smoke test for dedup pipeline — all edge cases",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument(
        "--no-cleanup",
        action="store_true",
        help="Keep test_env schema after the run for manual inspection",
    )
    asyncio.run(main(parser.parse_args()))
