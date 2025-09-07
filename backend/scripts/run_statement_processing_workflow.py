#!/usr/bin/env python3
"""
Statement Processing Workflow Runner

This script runs the complete end-to-end statement processing workflow.
It orchestrates fetching emails, downloading statements, uploading to cloud storage,
extracting data, and standardizing transactions.
"""

import asyncio
import sys
from pathlib import Path

# Add the backend directory to Python path
backend_path = Path(__file__).parent.parent
sys.path.insert(0, str(backend_path))

from src.services.statement_processor import run_statement_workflow
from src.utils.logger import get_logger

logger = get_logger(__name__)


async def main():
    """Main function to run the statement processing workflow"""
    try:
        logger.info("🚀 Starting Statement Processing Workflow")
        logger.info("=" * 60)
        
        # Run the complete workflow
        results = await run_statement_workflow()
        
        # Display results
        logger.info("=" * 60)
        logger.info("📊 WORKFLOW RESULTS")
        logger.info("=" * 60)
        logger.info(f"Total Statement Senders: {results['total_senders']}")
        logger.info(f"Total Statements Downloaded: {results['total_statements_downloaded']}")
        logger.info(f"Total Statements Uploaded: {results['total_statements_uploaded']}")
        logger.info(f"Total Statements Processed: {results['total_statements_processed']}")
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
