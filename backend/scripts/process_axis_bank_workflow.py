#!/usr/bin/env python3
"""
Simple Axis Bank Credit Card Statement Processing Workflow

This script orchestrates the essential workflow for processing Axis Bank credit card statements:
1. Extract emails from Gmail
2. Download PDF attachments to locked_statements directory
3. Unlock PDFs using configured passwords
4. Save unlocked PDFs to unlocked_statements directory
5. Extract tables using agentic-doc
6. Save final table as Excel file

Usage:
    poetry run python scripts/process_axis_bank_workflow.py --recent
    poetry run python scripts/process_axis_bank_workflow.py --days 7 --limit 5
"""

import sys
import os
import argparse
from pathlib import Path
from typing import Dict, List, Any, Optional
from datetime import datetime, timedelta

# Add the backend directory to Python path
backend_path = Path(__file__).parent.parent
sys.path.insert(0, str(backend_path))

# Load environment variables from secrets/.env
from dotenv import load_dotenv
secrets_env_path = backend_path / "configs" / "secrets" / ".env"
if secrets_env_path.exists():
    load_dotenv(secrets_env_path)
    print(f"✅ Loaded environment variables from {secrets_env_path}")
    # Verify key environment variable is loaded
    vision_key = os.getenv('VISION_AGENT_API_KEY')
    if vision_key:
        print(f"✅ VISION_AGENT_API_KEY loaded: {vision_key[:10]}...")
    else:
        print("❌ VISION_AGENT_API_KEY not loaded")
else:
    print(f"❌ Environment file not found: {secrets_env_path}")

from src.services.statement_processor import (
    get_attachment_handler,
    get_agentic_doc_processor,
    get_transaction_extractor
)
from src.services.email_ingestion.client import EmailClient
from src.utils.logger import get_logger

logger = get_logger(__name__)


class AxisBankWorkflowProcessor:
    """Simple workflow processor for Axis Bank credit card statements"""
    
    def __init__(self):
        self.attachment_handler = get_attachment_handler()
        self.agentic_processor = get_agentic_doc_processor()
        self.transaction_extractor = get_transaction_extractor()
        self.email_client = EmailClient()
    
    def process_recent_axis_bank_statements(self, days_back: int = 7, max_results: int = 10) -> Dict[str, Any]:
        """
        Process recent Axis Bank credit card statements
        
        Args:
            days_back: Number of days to look back
            max_results: Maximum number of emails to process
        
        Returns:
            Dictionary containing processing results
        """
        try:
            logger.info(f"🚀 Starting Axis Bank statement processing workflow")
            logger.info(f"📅 Looking back {days_back} days, max {max_results} emails")
            
            # Step 1: Fetch recent Axis Bank emails
            logger.info("📧 Step 1: Fetching recent Axis Bank emails...")
            emails = self._fetch_axis_bank_emails(days_back, max_results)
            
            if not emails:
                logger.info("No Axis Bank emails found")
                return {
                    "success": True,
                    "emails_processed": 0,
                    "statements_processed": 0,
                    "message": "No Axis Bank emails found in the specified period"
                }
            
            logger.info(f"✅ Found {len(emails)} Axis Bank emails")
            
            # Step 2: Process each email
            total_statements = 0
            successful_statements = 0
            failed_statements = 0
            processing_results = []
            
            for i, email in enumerate(emails, 1):
                logger.info(f"\n📧 Processing email {i}/{len(emails)}: {email.get('subject', 'No subject')}")
                
                try:
                    # Process email attachments
                    email_result = self.attachment_handler.process_axis_bank_email(email)
                    
                    if email_result and email_result.get("successful_attachments"):
                        # Process each successful attachment
                        for attachment_result in email_result["successful_attachments"]:
                            unlocked_pdf_path = attachment_result["unlocked_path"]
                            
                            # Step 3: Extract data using agentic-doc
                            logger.info(f"🔍 Step 3: Extracting data from {Path(unlocked_pdf_path).name}...")
                            extraction_result = self.agentic_processor.extract_from_pdf(unlocked_pdf_path)
                            
                            if not extraction_result.get("success"):
                                logger.error(f"Agentic-doc extraction failed: {extraction_result.get('error')}")
                                failed_statements += 1
                                continue
                            
                            # Step 4: Extract transaction table
                            logger.info("📊 Step 4: Extracting transaction tables...")
                            table_df = self.transaction_extractor.extract_transaction_table(extraction_result)
                            
                            if table_df is None or table_df.empty:
                                logger.warning("No transaction table found")
                                failed_statements += 1
                                continue
                            
                            # Step 5: Save transaction table
                            logger.info("💾 Step 5: Saving transaction table...")
                            output_path = f"data/extracted_tables/axis_bank_{Path(unlocked_pdf_path).stem}_transactions"
                            excel_file = self.transaction_extractor.save_transaction_table(table_df, output_path, 'excel')
                            
                            if excel_file:
                                logger.info(f"✅ Successfully processed statement: {excel_file}")
                                successful_statements += 1
                                processing_results.append({
                                    "filename": Path(unlocked_pdf_path).name,
                                    "rows": len(table_df),
                                    "excel_file": excel_file
                                })
                            else:
                                logger.error("Failed to save transaction table")
                                failed_statements += 1
                                
                    else:
                        logger.info(f"No successful attachments in email: {email.get('subject', 'No subject')}")
                        
                except Exception as e:
                    logger.error(f"Error processing email {i}: {e}")
                    failed_statements += 1
            
            # Step 6: Processing Summary
            logger.info("\n📋 Step 6: Processing Summary")
            logger.info(f"📧 Emails processed: {len(emails)}")
            logger.info(f"📄 Total statements: {total_statements}")
            logger.info(f"✅ Successful: {successful_statements}")
            logger.info(f"❌ Failed: {failed_statements}")
            
            # Cleanup old files
            logger.info("🧹 Cleaning up old files...")
            self.attachment_handler.cleanup_old_files()
            
            # Final summary
            logger.info("\n🎉 Workflow completed successfully!")
            logger.info(f"📧 Emails processed: {len(emails)}")
            logger.info(f"📄 Statements processed: {total_statements}")
            logger.info(f"✅ Successful: {successful_statements}")
            logger.info(f"❌ Failed: {failed_statements}")
            
            if processing_results:
                logger.info("\n📋 Processing Results:")
                for result in processing_results:
                    logger.info(f"  ✅ {result['filename']}: {result['rows']} rows → {result['excel_file']}")
            
            logger.info(f"\n💾 Files saved to:")
            logger.info(f"  - Locked statements: data/statements/locked_statements/")
            logger.info(f"  - Unlocked statements: data/statements/unlocked_statements/")
            logger.info(f"  - Transaction tables: data/extracted_tables/")
            
            return {
                "success": True,
                "emails_processed": len(emails),
                "statements_processed": total_statements,
                "successful": successful_statements,
                "failed": failed_statements,
                "results": processing_results
            }
            
        except Exception as e:
            logger.error(f"Error in workflow: {e}")
            return {
                "success": False,
                "error": str(e)
            }
    
    def _fetch_axis_bank_emails(self, days_back: int, max_results: int) -> List[Dict[str, Any]]:
        """Fetch recent Axis Bank emails"""
        try:
            # Calculate date range
            end_date = datetime.now()
            start_date = end_date - timedelta(days=days_back)
            
            # Search for Axis Bank emails
            query = "from:cc.statements@axisbank.com"
            emails = self.email_client.search_emails_by_date_range(
                start_date=start_date.strftime("%Y/%m/%d"),
                end_date=end_date.strftime("%Y/%m/%d"),
                query=query
            )
            
            # Limit results
            emails = emails[:max_results]
            
            return emails
            
        except Exception as e:
            logger.error(f"Error fetching emails: {e}")
            return []
    
    def process_specific_email(self, message_id: str) -> Dict[str, Any]:
        """Process a specific email by message ID"""
        try:
            # Fetch the specific email
            email = self.email_client.get_email(message_id)
            if not email:
                return {"success": False, "error": "Email not found"}
            
            # Process it
            return self.process_recent_axis_bank_statements(days_back=1, max_results=1)
            
        except Exception as e:
            logger.error(f"Error processing specific email: {e}")
            return {"success": False, "error": str(e)}


def main():
    """Main entry point"""
    parser = argparse.ArgumentParser(description="Process Axis Bank credit card statements")
    parser.add_argument("--days", type=int, default=3, help="Number of days to look back")
    parser.add_argument("--limit", type=int, default=5, help="Maximum number of emails to process")
    parser.add_argument("--recent", action="store_true", help="Process recent emails (3 days, 5 emails)")
    parser.add_argument("--message-id", type=str, help="Process specific email by message ID")
    parser.add_argument("--cleanup", action="store_true", help="Clean up old files only")
    
    args = parser.parse_args()
    
    # Set defaults for recent flag
    if args.recent:
        args.days = 3
        args.limit = 5
    
    processor = AxisBankWorkflowProcessor()
    
    if args.cleanup:
        # Just cleanup old files
        processor.attachment_handler.cleanup_old_files()
        logger.info("🧹 Cleanup completed")
        return
    
    if args.message_id:
        # Process specific email
        result = processor.process_specific_email(args.message_id)
    else:
        # Process recent emails
        result = processor.process_recent_axis_bank_statements(args.days, args.limit)
    
    if not result.get("success"):
        logger.error(f"Workflow failed: {result.get('error')}")
        sys.exit(1)


if __name__ == "__main__":
    main()
