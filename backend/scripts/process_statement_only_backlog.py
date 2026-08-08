"""
One-time backlog processor for the retired 'statement_only' review-queue type.

For each unresolved statement_only row: if a matching non-deleted transaction
already exists (account/amount/date/direction), just resolve the row —
someone already covered it manually. Otherwise insert it as a real
statement_extraction transaction, then resolve the row.

Run from backend/ with: poetry run python scripts/process_statement_only_backlog.py
"""
import asyncio
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
os.environ.setdefault("ENV_FILE", "configs/.env")
os.environ.setdefault("SECRETS_FILE", "configs/secrets/.env")

from src.utils.settings import get_settings  # noqa: E402
get_settings()

from src.services.database_manager.operations.review_queue_operations import ReviewQueueOperations  # noqa: E402
from src.services.database_manager.operations.transaction_operations import TransactionOperations  # noqa: E402


async def main() -> None:
    items = await ReviewQueueOperations.get_unresolved("statement_only")
    if not items:
        print("No unresolved statement_only items — nothing to do.")
        return

    inserted = 0
    skipped_duplicate = 0

    for item in items:
        already_exists = await TransactionOperations.exists_matching(
            account=item["account"],
            amount=item["amount"],
            transaction_date=item["transaction_date"],
            direction=item["direction"],
        )
        if already_exists:
            skipped_duplicate += 1
            print(f"  SKIP (already exists) — {item['account']} {item['transaction_date']} "
                  f"₹{item['amount']} {item['description'][:60]}")
        else:
            tx = dict(item.get("raw_data") or {})
            await TransactionOperations.bulk_insert_transactions(
                [tx],
                transaction_source="statement_extraction",
            )
            inserted += 1
            print(f"  INSERT — {item['account']} {item['transaction_date']} "
                  f"₹{item['amount']} {item['description'][:60]}")
        await ReviewQueueOperations.resolve(str(item["id"]), "confirmed")

    print(f"\nDone. {inserted} inserted, {skipped_duplicate} skipped as already-covered, "
          f"{len(items)} total resolved.")


if __name__ == "__main__":
    asyncio.run(main())
