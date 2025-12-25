#!/usr/bin/env python3
"""
Statement Processing Workflow Runner

This script runs the complete end-to-end statement processing workflow.
It orchestrates fetching emails, downloading statements, uploading to cloud storage,
extracting data, and standardizing transactions.

This version processes transactions from the last transaction date in the DB to today,
including Splitwise transactions.
"""

import asyncio
import sys
from datetime import datetime, date, timedelta
from pathlib import Path

# Add the backend directory to Python path
backend_path = Path(__file__).parent.parent
sys.path.insert(0, str(backend_path))

from src.services.orchestrator import run_statement_workflow
from src.services.database_manager.operations import TransactionOperations
from src.utils.logger import get_logger

logger = get_logger(__name__)


async def main():
    """Main function to run the statement processing workflow"""
    try:
        logger.info("🚀 Starting Statement Processing Workflow")
        logger.info("=" * 60)
        
        # Get the last transaction date from the database
        logger.info("📅 Fetching last transaction date from database...")
        last_transaction_date = await TransactionOperations.get_last_transaction_date()
        
        if last_transaction_date:
            # Use a few days before the last transaction date as start date
            # This catches statements that were sent late (e.g., Nov 6 email for Oct transactions)
            # The workflow has duplicate checking, so it will skip already processed transactions
            # Go back 7 days to catch any late statements
            start_date = last_transaction_date - timedelta(days=7)
            logger.info(f"📅 Last transaction date in DB: {last_transaction_date}")
            logger.info(f"📅 Starting from: {start_date} (7 days before last transaction to catch late statements)")
        else:
            # If no transactions exist, start from 30 days ago
            start_date = date.today() - timedelta(days=30)
            logger.warning(f"⚠️ No transactions found in DB. Starting from: {start_date}")
        
        # End date is today
        end_date = date.today()
        logger.info(f"📅 Processing until: {end_date}")
        
        # Format dates for email search (Gmail API format: YYYY/MM/DD)
        email_start_date = start_date.strftime("%Y/%m/%d")
        email_end_date = end_date.strftime("%Y/%m/%d")
        
        # Format dates for Splitwise (datetime objects)
        splitwise_start_date = datetime.combine(start_date, datetime.min.time())
        splitwise_end_date = datetime.combine(end_date, datetime.max.time())
        
        logger.info(f"📧 Email date range: {email_start_date} to {email_end_date}")
        logger.info(f"💰 Splitwise date range: {splitwise_start_date.date()} to {splitwise_end_date.date()}")
        logger.info("=" * 60)
        
        # Run the complete workflow with custom date ranges
        results = await run_statement_workflow(
            custom_start_date=email_start_date,
            custom_end_date=email_end_date,
            custom_splitwise_start_date=splitwise_start_date,
            custom_splitwise_end_date=splitwise_end_date
        )
        
        # Display results
        logger.info("=" * 60)
        logger.info("📊 WORKFLOW RESULTS")
        logger.info("=" * 60)
        logger.info(f"Total Statement Senders: {results['total_senders']}")
        logger.info(f"Total Statements Downloaded: {results['total_statements_downloaded']}")
        logger.info(f"Total Statements Uploaded: {results['total_statements_uploaded']}")
        logger.info(f"Total Statements Processed: {results['total_statements_processed']}")
        logger.info(f"Splitwise Processed: {results.get('splitwise_processed', False)}")
        logger.info(f"Splitwise Transaction Count: {results.get('splitwise_transaction_count', 0)}")
        logger.info(f"Combined Transaction Count: {results.get('combined_transaction_count', 0)}")
        logger.info(f"Database Inserted: {results.get('database_inserted_count', 0)}")
        logger.info(f"Database Updated: {results.get('database_updated_count', 0)}")
        logger.info(f"Database Skipped: {results.get('database_skipped_count', 0)}")
        logger.info(f"Total Errors: {len(results['errors'])}")
        logger.info(f"Temp Directory Used: {results.get('temp_directory', 'N/A')}")
        logger.info(f"Local CSV Path: {results.get('local_csv_path', 'N/A')}")
        
        if results['errors']:
            logger.warning("⚠️ ERRORS ENCOUNTERED:")
            for error in results['errors']:
                logger.warning(f"  - {error}")
        
        if results['processed_statements']:
            logger.info("✅ SUCCESSFULLY PROCESSED STATEMENTS:")
            for statement in results['processed_statements']:
                logger.info(f"  - {statement['filename']} from {statement['sender_email']}")
        
        logger.info("=" * 60)
        logger.info("🏁 Statement Processing Workflow Completed")
        
        return results
        
    except Exception as e:
        logger.error(f"❌ Critical error in workflow: {e}")
        raise


if __name__ == "__main__":
    # Run the async main function
    asyncio.run(main())
