#!/usr/bin/env python3
"""
Daily Email Alert Ingestion Script

Runs rule-based parsing for UPI/credit/debit alerts and stores transactions.
"""
import argparse
import asyncio
import sys
from pathlib import Path

backend_path = Path(__file__).parent.parent
sys.path.insert(0, str(backend_path))

from src.services.email_ingestion.alert_service import EmailAlertIngestionService
from src.utils.logger import get_logger

logger = get_logger(__name__)


async def run_ingestion(max_results: int, days_back: int) -> None:
    service = EmailAlertIngestionService(account_id="primary")
    result = await service.ingest_recent_alerts(max_results=max_results, days_back=days_back)
    logger.info(f"Primary account ingestion result: {result}")

    # Try secondary account if configured
    try:
        secondary_service = EmailAlertIngestionService(account_id="secondary")
        result = await secondary_service.ingest_recent_alerts(max_results=max_results, days_back=days_back)
        logger.info(f"Secondary account ingestion result: {result}")
    except Exception as e:
        logger.warning(f"Secondary account ingestion skipped: {e}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run daily email alert ingestion")
    parser.add_argument("--max-results", type=int, default=100, help="Max emails to fetch per account")
    parser.add_argument("--days-back", type=int, default=2, help="How many days back to search")
    return parser.parse_args()


if __name__ == "__main__":
    args = parse_args()
    asyncio.run(run_ingestion(args.max_results, args.days_back))
