#!/usr/bin/env python3
"""
Statement Processing Workflow with Resume Capability

This script demonstrates how to run the statement processing workflow with the ability
to resume from the standardization step if document extraction has already been completed
and CSVs are available in cloud storage.

Usage:
    # Run complete workflow (including document extraction)
    python scripts/run_workflow_with_resume.py --full
    
    # Resume workflow from standardization (skip document extraction)
    python scripts/run_workflow_with_resume.py --resume
    
    # Check if resume is possible
    python scripts/run_workflow_with_resume.py --check-resume
    
    # Auto-detect and run appropriate workflow
    python scripts/run_workflow_with_resume.py --auto
    
    # Enable secondary account checking (override environment setting)
    python scripts/run_workflow_with_resume.py --full --enable-secondary
    
    # Resume with secondary account enabled
    python scripts/run_workflow_with_resume.py --resume --enable-secondary
"""

import asyncio
import sys
import argparse
from pathlib import Path

# Add backend directory to Python path
backend_path = Path(__file__).parent.parent
sys.path.insert(0, str(backend_path))

from src.services.orchestrator.statement_workflow import (
    run_statement_workflow,
    run_resume_workflow,
    can_resume_workflow
)
from src.utils.logger import get_logger

logger = get_logger(__name__)


async def run_full_workflow(enable_secondary_account: bool = None):
    """Run the complete statement processing workflow"""
    logger.info("🚀 Running complete statement processing workflow")
    if enable_secondary_account is not None:
        logger.info(f"Secondary account override: {enable_secondary_account}")
    else:
        logger.info("Using secondary account setting from environment variable")
    try:
        result = await run_statement_workflow(enable_secondary_account=enable_secondary_account)
        
        logger.info("✅ Workflow completed successfully!")
        logger.info(f"📊 Results Summary:")
        logger.info(f"  - Statements downloaded: {result.get('total_statements_downloaded', 0)}")
        logger.info(f"  - Statements uploaded: {result.get('total_statements_uploaded', 0)}")
        logger.info(f"  - Statements processed: {result.get('total_statements_processed', 0)}")
        logger.info(f"  - Statements skipped (already extracted): {result.get('total_statements_skipped', 0)}")
        logger.info(f"  - Splitwise transactions: {result.get('splitwise_transaction_count', 0)}")
        logger.info(f"  - Total combined transactions: {result.get('combined_transaction_count', 0)}")
        logger.info(f"  - Database inserted: {result.get('database_inserted_count', 0)}")
        logger.info(f"  - Database skipped (duplicates): {result.get('database_skipped_count', 0)}")
        
        if result.get('errors'):
            logger.warning(f"⚠️ {len(result['errors'])} errors occurred:")
            for error in result['errors']:
                logger.warning(f"  - {error}")
        
        return result
        
    except Exception as e:
        logger.error(f"❌ Workflow failed: {e}")
        raise


async def run_resume_workflow_only(enable_secondary_account: bool = None):
    """Run workflow resuming from standardization step"""
    logger.info("🔄 Running resume workflow (skipping document extraction)")
    if enable_secondary_account is not None:
        logger.info(f"Secondary account override: {enable_secondary_account}")
    else:
        logger.info("Using secondary account setting from environment variable")
    try:
        result = await run_resume_workflow(enable_secondary_account=enable_secondary_account)
        
        logger.info("✅ Resume workflow completed successfully!")
        logger.info(f"📊 Results Summary:")
        logger.info(f"  - Splitwise transactions: {result.get('splitwise_transaction_count', 0)}")
        logger.info(f"  - Total combined transactions: {result.get('combined_transaction_count', 0)}")
        logger.info(f"  - Database inserted: {result.get('database_inserted_count', 0)}")
        logger.info(f"  - Database skipped (duplicates): {result.get('database_skipped_count', 0)}")
        
        if result.get('errors'):
            logger.warning(f"⚠️ {len(result['errors'])} errors occurred:")
            for error in result['errors']:
                logger.warning(f"  - {error}")
        
        return result
        
    except Exception as e:
        logger.error(f"❌ Resume workflow failed: {e}")
        raise


async def check_resume_possibility(enable_secondary_account: bool = None):
    """Check if workflow can be resumed"""
    logger.info("🔍 Checking if workflow can be resumed...")
    if enable_secondary_account is not None:
        logger.info(f"Secondary account override: {enable_secondary_account}")
    else:
        logger.info("Using secondary account setting from environment variable")
    try:
        can_resume = await can_resume_workflow(enable_secondary_account=enable_secondary_account)
        
        if can_resume:
            logger.info("✅ Resume is possible - CSV files found in cloud storage")
            logger.info("💡 You can run: python scripts/run_workflow_with_resume.py --resume")
        else:
            logger.info("❌ Resume is not possible - no CSV files found in cloud storage")
            logger.info("💡 You need to run: python scripts/run_workflow_with_resume.py --full")
        
        return can_resume
        
    except Exception as e:
        logger.error(f"❌ Error checking resume possibility: {e}")
        return False


async def run_auto_workflow(enable_secondary_account: bool = None):
    """Automatically detect and run appropriate workflow"""
    logger.info("🤖 Auto-detecting workflow mode...")
    if enable_secondary_account is not None:
        logger.info(f"Secondary account override: {enable_secondary_account}")
    else:
        logger.info("Using secondary account setting from environment variable")
    
    try:
        can_resume = await check_resume_possibility(enable_secondary_account=enable_secondary_account)
        
        if can_resume:
            logger.info("🔄 Resuming workflow from standardization step")
            return await run_resume_workflow_only(enable_secondary_account=enable_secondary_account)
        else:
            logger.info("🚀 Running complete workflow")
            return await run_full_workflow(enable_secondary_account=enable_secondary_account)
            
    except Exception as e:
        logger.error(f"❌ Auto workflow failed: {e}")
        raise


async def main():
    """Main function"""
    parser = argparse.ArgumentParser(description="Statement Processing Workflow with Resume Capability")
    parser.add_argument("--full", action="store_true", help="Run complete workflow (including document extraction)")
    parser.add_argument("--resume", action="store_true", help="Resume workflow from standardization step")
    parser.add_argument("--check-resume", action="store_true", help="Check if resume is possible")
    parser.add_argument("--auto", action="store_true", help="Auto-detect and run appropriate workflow")
    parser.add_argument("--enable-secondary", action="store_true", help="Enable secondary account checking (override environment setting)")
    
    args = parser.parse_args()
    
    # Determine secondary account setting
    if args.enable_secondary:
        enable_secondary_account = True  # Override environment setting
    else:
        enable_secondary_account = None  # Use environment setting
    
    if args.full:
        await run_full_workflow(enable_secondary_account=enable_secondary_account)
    elif args.resume:
        await run_resume_workflow_only(enable_secondary_account=enable_secondary_account)
    elif args.check_resume:
        await check_resume_possibility(enable_secondary_account=enable_secondary_account)
    elif args.auto:
        await run_auto_workflow(enable_secondary_account=enable_secondary_account)
    else:
        # Default to auto mode
        logger.info("No mode specified, running in auto mode...")
        await run_auto_workflow(enable_secondary_account=enable_secondary_account)


if __name__ == "__main__":
    asyncio.run(main())
