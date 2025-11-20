#!/usr/bin/env python3
"""
Manually process Yes Bank statements for a specific date range
"""
import asyncio
import sys
from pathlib import Path
from datetime import datetime

# Add the backend directory to Python path
backend_path = Path(__file__).parent.parent
sys.path.insert(0, str(backend_path))

from src.services.email_ingestion.client import EmailClient
from src.services.cloud_storage.gcs_service import GoogleCloudStorageService
from src.services.orchestrator.transaction_standardizer import TransactionStandardizer
from src.services.database_manager.operations import TransactionOperations, AccountOperations
from src.services.statement_processor.document_extractor import DocumentExtractor
from src.services.statement_processor.pdf_unlocker import PDFUnlocker
from src.utils.password_manager import BankPasswordManager
from src.utils.logger import get_logger
import tempfile
import shutil

logger = get_logger(__name__)


async def main():
    """Process Yes Bank statements for Oct 31 to Nov 5"""
    try:
        # Initialize services
        email_client = EmailClient(account_id="primary")
        cloud_storage = GoogleCloudStorageService()
        standardizer = TransactionStandardizer()
        document_extractor = DocumentExtractor()
        pdf_unlocker = PDFUnlocker()
        password_manager = BankPasswordManager()
        
        # Date range
        start_date = "2025/10/31"
        end_date = "2025/11/05"
        sender_email = "casastmt@yes.bank.in"
        
        logger.info(f"Processing Yes Bank statements from {sender_email}")
        logger.info(f"Date range: {start_date} to {end_date}")
        
        # Create temp directory
        temp_dir = Path(tempfile.mkdtemp(prefix="yes_bank_processing_"))
        logger.info(f"Created temp directory: {temp_dir}")
        
        try:
            # Search for emails from Yes Bank
            logger.info(f"🔍 Searching for statements from {sender_email}")
            query = f"from:{sender_email} statement"
            emails = email_client.search_emails_by_date_range(start_date, end_date, query)
            
            if not emails:
                logger.info(f"No emails found from {sender_email} in date range")
                return
            
            logger.info(f"📧 Found {len(emails)} emails from {sender_email}")
            
            all_standardized_transactions = []
            
            # Process each email
            for email_data in emails:
                try:
                    email_id = email_data.get("id")
                    email_details = email_client.get_email_content(email_id)
                    
                    if not email_details:
                        continue
                    
                    subject = email_details.get("subject", "")
                    email_date = email_details.get("date", "")
                    attachments = email_details.get("attachments", [])
                    
                    # Filter for PDF attachments
                    pdf_attachments = [
                        att for att in attachments 
                        if att.get("filename", "").lower().endswith(".pdf")
                    ]
                    
                    if not pdf_attachments:
                        continue
                    
                    # Process each PDF
                    for attachment in pdf_attachments:
                        try:
                            attachment_id = attachment.get("attachment_id")
                            original_filename = attachment.get("filename", "statement.pdf")
                            
                            # Download attachment
                            attachment_data = email_client.download_attachment(email_id, attachment_id)
                            if not attachment_data:
                                continue
                            
                            # Generate normalized filename
                            account_nickname = await AccountOperations.get_account_nickname_by_sender(sender_email)
                            if not account_nickname:
                                account_nickname = "Yes Bank Savings Account"
                            
                            # Parse email date for filename
                            from datetime import datetime
                            try:
                                email_datetime = datetime.strptime(email_date, "%a, %d %b %Y %H:%M:%S %z")
                            except:
                                email_datetime = datetime.now()
                            
                            date_str = email_datetime.strftime("%Y%m%d")
                            nickname_clean = account_nickname.lower().replace(" ", "_")
                            normalized_filename = f"{nickname_clean}_{date_str}_locked.pdf"
                            
                            # Save to temp directory
                            temp_file_path = temp_dir / normalized_filename
                            with open(temp_file_path, "wb") as f:
                                f.write(attachment_data)
                            
                            logger.info(f"✅ Downloaded: {normalized_filename}")
                            
                            # Unlock PDF
                            password = await password_manager.get_password_for_sender_async(sender_email)
                            if password:
                                unlock_result = pdf_unlocker.unlock_pdf_with_password(temp_file_path, password)
                                if unlock_result.get("success"):
                                    unlocked_path = unlock_result.get("unlocked_path")
                                    logger.info(f"🔓 Successfully unlocked PDF")
                                else:
                                    unlocked_path = temp_file_path
                                    logger.warning(f"Could not unlock PDF, using original")
                            else:
                                unlocked_path = temp_file_path
                                logger.warning(f"No password found, using original PDF")
                            
                            # Extract data
                            extraction_result = document_extractor.extract_from_pdf(
                                pdf_path=str(unlocked_path),
                                account_nickname=account_nickname,
                                save_results=True,
                                email_date=email_date
                            )
                            
                            if not extraction_result.get("success"):
                                logger.error(f"Failed to extract data from {normalized_filename}")
                                continue
                            
                            # Get CSV path
                            csv_path = extraction_result.get("saved_path") or extraction_result.get("csv_file")
                            if not csv_path:
                                logger.warning(f"No CSV path in extraction result")
                                continue
                            
                            csv_path = Path(csv_path)
                            if not csv_path.exists():
                                logger.warning(f"CSV file does not exist: {csv_path}")
                                continue
                            
                            # Read and standardize
                            import pandas as pd
                            df = pd.read_csv(csv_path)
                            
                            search_pattern = "yes_bank_savings"
                            standardized_df = await standardizer.process_with_dynamic_method(
                                df, search_pattern, csv_path.name
                            )
                            
                            if not standardized_df.empty:
                                transactions = standardized_df.to_dict('records')
                                all_standardized_transactions.extend(transactions)
                                logger.info(f"Standardized {len(transactions)} transactions from {normalized_filename}")
                            
                        except Exception as e:
                            logger.error(f"Error processing attachment {original_filename}: {e}")
                            import traceback
                            traceback.print_exc()
                            continue
                
                except Exception as e:
                    logger.error(f"Error processing email {email_data.get('id')}: {e}")
                    continue
            
            # Insert all transactions
            if all_standardized_transactions:
                logger.info(f"Inserting {len(all_standardized_transactions)} transactions into database...")
                result = await TransactionOperations.bulk_insert_transactions(
                    all_standardized_transactions,
                    check_duplicates=True
                )
                
                if result.get("success"):
                    logger.info(f"✅ Successfully inserted {result.get('inserted_count', 0)} transactions")
                    logger.info(f"⏭️  Skipped {result.get('skipped_count', 0)} duplicates")
                    logger.info(f"❌ Errors: {result.get('error_count', 0)}")
                else:
                    logger.error(f"Failed to insert transactions: {result.get('errors', [])}")
            else:
                logger.warning("No transactions to insert")
        
        finally:
            # Cleanup temp directory
            try:
                shutil.rmtree(temp_dir)
                logger.info(f"🧹 Cleaned up temp directory: {temp_dir}")
            except Exception as e:
                logger.warning(f"Failed to cleanup temp directory: {e}")
        
    except Exception as e:
        logger.error(f"Error: {e}")
        import traceback
        traceback.print_exc()


if __name__ == "__main__":
    asyncio.run(main())

