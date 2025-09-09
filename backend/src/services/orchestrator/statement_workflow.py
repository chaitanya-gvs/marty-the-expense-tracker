"""
Statement Processing Workflow

This orchestrator coordinates the complete statement processing workflow:
1. Get all statement senders from accounts table
2. Fetch emails from senders within date range (10th of current month to 10th of previous month)
3. Download statements with proper naming convention
4. Store in temp directory and upload to cloud storage (unlocked statements only)
5. Extract data from statements
6. Standardize and store in database
"""

import asyncio
import os
import shutil
import tempfile
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, List, Optional, Any

import pandas as pd

from src.services.database_manager.operations import AccountOperations
from src.services.email_ingestion.client import EmailClient
from src.services.cloud_storage.gcs_service import GoogleCloudStorageService
from src.services.statement_processor.document_extractor import DocumentExtractor
from .transaction_standardizer import TransactionStandardizer
from src.services.statement_processor.pdf_unlocker import PDFUnlocker
from src.utils.logger import get_logger
from src.utils.password_manager import BankPasswordManager

logger = get_logger(__name__)


def extract_search_pattern_from_csv_filename(csv_filename: str) -> str:
    """
    Extract search pattern from CSV filename for database lookup.
    
    Examples:
    - amazon_pay_icici_20250903_extracted.csv -> amazon_pay_icici
    - axis_atlas_20250902_extracted.csv -> axis_atlas
    - axis_bank_savings_20250906_extracted.csv -> axis_bank_savings
    """
    try:
        # Remove .csv extension and _extracted suffix
        base_name = csv_filename.replace('.csv', '').replace('_extracted', '')
        parts = base_name.split('_')
        
        # Remove only the last element (date) if it's 8 digits
        if len(parts) > 1 and parts[-1].isdigit() and len(parts[-1]) == 8:
            search_parts = parts[:-1]
        else:
            search_parts = parts
        
        # Join the remaining parts to create search pattern
        search_pattern = '_'.join(search_parts)
        return search_pattern
                
    except Exception as e:
        logger.error(f"Error extracting search pattern from {csv_filename}: {e}")
        return csv_filename.replace('.csv', '').replace('_extracted', '')


class StatementWorkflow:
    """Orchestrates the complete statement processing workflow"""
    
    def __init__(self, account_ids: List[str] = None):
        # Default to both email accounts
        if account_ids is None:
            self.account_ids = ["primary", "secondary"]  # chaitanyagvs23@gmail.com and chaitanyagvs98@gmail.com
        else:
            self.account_ids = account_ids
        
        # Initialize email clients for both accounts
        self.email_clients = {}
        for account_id in self.account_ids:
            self.email_clients[account_id] = EmailClient(account_id=account_id)
        
        self.cloud_storage = GoogleCloudStorageService()
        self.document_extractor = DocumentExtractor()
        self.transaction_standardizer = TransactionStandardizer()
        self.pdf_unlocker = PDFUnlocker()
        self.password_manager = BankPasswordManager()
        
        # Create temp directory for processing
        self.temp_dir = Path(tempfile.mkdtemp(prefix="statement_processing_"))
        logger.info(f"Created temp directory: {self.temp_dir}")
        logger.info(f"Initialized email clients for accounts: {self.account_ids}")
    
    def _calculate_date_range(self) -> tuple[str, str]:
        """
        Calculate date range for statement retrieval:
        From 10th of previous month to 10th of current month
        """
        now = datetime.now()
        
        # Current month 10th
        current_month_10th = now.replace(day=10)
        
        # Previous month 10th
        if now.month == 1:
            previous_month_10th = now.replace(year=now.year-1, month=12, day=10)
        else:
            previous_month_10th = now.replace(month=now.month-1, day=10)
        
        # Format dates for Gmail API (YYYY/MM/DD)
        start_date = previous_month_10th.strftime("%Y/%m/%d")
        end_date = current_month_10th.strftime("%Y/%m/%d")
        
        logger.info(f"Date range for statement retrieval: {start_date} to {end_date}")
        return start_date, end_date
    
    def _get_previous_month_name(self, email_date: str) -> str:
        """
        Get the previous month name from email date
        If statement was sent in September, it's for August data
        """
        try:
            # Parse email date (handle Gmail format)
            try:
                # Try Gmail format first: "Wed, 03 Sep 2025 06:48:41 +0530"
                email_datetime = datetime.strptime(email_date, "%a, %d %b %Y %H:%M:%S %z")
            except ValueError:
                try:
                    # Try Gmail format without timezone: "Wed, 03 Sep 2025 11:47:18 GMT"
                    email_datetime = datetime.strptime(email_date, "%a, %d %b %Y %H:%M:%S %Z")
                except ValueError:
                    try:
                        # Try ISO format: "2025-09-04T10:00:00Z"
                        email_datetime = datetime.strptime(email_date.split('T')[0], "%Y-%m-%d")
                    except ValueError:
                        # Fallback to current date
                        email_datetime = datetime.now()
                        logger.warning(f"Could not parse email date '{email_date}', using current date")
            
            # Get previous month
            if email_datetime.month == 1:
                prev_month = 12
                prev_year = email_datetime.year - 1
            else:
                prev_month = email_datetime.month - 1
                prev_year = email_datetime.year
            
            # Format as month name (e.g., "August_2025")
            prev_month_name = datetime(prev_year, prev_month, 1).strftime("%B_%Y")
            return prev_month_name
            
        except Exception as e:
            logger.error(f"Error parsing email date {email_date}: {e}")
            # Fallback to current month
            return datetime.now().strftime("%B_%Y")
    
    def _get_previous_month_folder(self, email_date: str) -> str:
        """
        Get the previous month folder name in YYYY-MM format from email date
        If statement was sent in September, it's for August data
        """
        try:
            # Parse email date (handle Gmail format)
            try:
                # Try Gmail format first: "Wed, 03 Sep 2025 06:48:41 +0530"
                email_datetime = datetime.strptime(email_date, "%a, %d %b %Y %H:%M:%S %z")
            except ValueError:
                try:
                    # Try Gmail format without timezone: "Wed, 03 Sep 2025 11:47:18 GMT"
                    email_datetime = datetime.strptime(email_date, "%a, %d %b %Y %H:%M:%S %Z")
                except ValueError:
                    try:
                        # Try ISO format: "2025-09-04T10:00:00Z"
                        email_datetime = datetime.strptime(email_date.split('T')[0], "%Y-%m-%d")
                    except ValueError:
                        # Fallback to current date
                        email_datetime = datetime.now()
                        logger.warning(f"Could not parse email date '{email_date}', using current date")
            
            # Get previous month
            if email_datetime.month == 1:
                prev_month = 12
                prev_year = email_datetime.year - 1
            else:
                prev_month = email_datetime.month - 1
                prev_year = email_datetime.year
            
            # Format as YYYY-MM (e.g., "2025-08")
            return f"{prev_year}-{prev_month:02d}"
            
        except Exception as e:
            logger.error(f"Error parsing email date {email_date}: {e}")
            # Fallback to current month
            return datetime.now().strftime("%Y-%m")
    
    def _generate_cloud_path(self, sender_email: str, email_date: str, filename: str) -> str:
        """Generate cloud storage path for the statement - organized by month and type"""
        previous_month = self._get_previous_month_folder(email_date)
        
        # Determine if this is a PDF or CSV based on filename
        if filename.endswith('.pdf'):
            # PDFs go to unlocked_statements folder
            cloud_path = f"{previous_month}/unlocked_statements/{filename}"
        elif filename.endswith('.csv'):
            # CSVs go to extracted_data folder
            cloud_path = f"{previous_month}/extracted_data/{filename}"
        else:
            # Fallback to unlocked_statements for unknown file types
            cloud_path = f"{previous_month}/unlocked_statements/{filename}"
        
        return cloud_path
    
    async def _download_statements_from_sender(self, sender_email: str, start_date: str, end_date: str) -> List[Dict[str, Any]]:
        """Download all statements from a specific sender within date range from all email accounts"""
        logger.info(f"🔍 Searching for statements from {sender_email}")
        
        all_downloaded_statements = []
        
        # Search in all email accounts
        for account_id, email_client in self.email_clients.items():
            try:
                logger.info(f"📧 Searching in {account_id} account for {sender_email}")
                
                # Search for emails from this sender in date range that contain "statement"
                query = f"from:{sender_email} statement"
                emails = email_client.search_emails_by_date_range(start_date, end_date, query)
                
                if not emails:
                    logger.info(f"No emails found from {sender_email} in {account_id} account")
                    continue
                
                logger.info(f"📧 Found {len(emails)} emails from {sender_email} in {account_id} account")
                
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
                        
                        # Download each PDF attachment
                        for attachment in pdf_attachments:
                            try:
                                attachment_id = attachment.get("attachment_id")
                                original_filename = attachment.get("filename", "statement.pdf")
                                
                                # Download attachment data
                                attachment_data = email_client.download_attachment(email_id, attachment_id)
                                if not attachment_data:
                                    continue
                                
                                # Generate normalized filename (no secondary suffix)
                                normalized_filename = await self._generate_normalized_filename(
                                    sender_email, email_date, original_filename
                                )
                                
                                # Save to temp directory
                                temp_file_path = self.temp_dir / normalized_filename
                                with open(temp_file_path, "wb") as f:
                                    f.write(attachment_data)
                                
                                logger.info(f"✅ Downloaded from {account_id}: {normalized_filename}")
                                
                                all_downloaded_statements.append({
                                    "sender_email": sender_email,
                                    "email_date": email_date,
                                    "email_subject": subject,
                                    "original_filename": original_filename,
                                    "normalized_filename": normalized_filename,
                                    "temp_file_path": str(temp_file_path),
                                    "file_size": temp_file_path.stat().st_size,
                                    "source_account": account_id
                                })
                                
                            except Exception as e:
                                logger.error(f"Error downloading attachment {attachment.get('filename')} from {account_id}: {e}")
                                continue
                    
                    except Exception as e:
                        logger.error(f"Error processing email {email_data.get('id')} from {account_id}: {e}")
                        continue
            
            except Exception as e:
                logger.error(f"Error searching in {account_id} account for {sender_email}: {e}")
                continue
        
        logger.info(f"📊 Total statements downloaded for {sender_email}: {len(all_downloaded_statements)}")
        return all_downloaded_statements
    
    async def _unlock_pdf_async(self, pdf_path: Path, sender_email: str) -> Dict[str, Any]:
        """Async version of PDF unlocking that uses async password lookup"""
        try:
            # Ensure pdf_path is a Path object
            pdf_path = Path(pdf_path)
            logger.info(f"🔓 Unlocking PDF: {pdf_path.name}")
            
            # Get password using async method
            password = await self.password_manager.get_password_for_sender_async(sender_email)
            if not password:
                return {
                    "success": False,
                    "error": f"No password found for sender: {sender_email}"
                }
            
            logger.info("🔑 Password found")
            
            # Use the existing PDF unlocker with the password
            unlock_result = self.pdf_unlocker.unlock_pdf_with_password(pdf_path, password)
            return unlock_result
            
        except Exception as e:
            logger.error(f"Error unlocking PDF {pdf_path}: {e}")
            return {
                "success": False,
                "error": str(e)
            }

    async def _generate_normalized_filename(self, sender_email: str, email_date: str, original_filename: str) -> str:
        """Generate normalized filename for the statement"""
        try:
            # Get account nickname
            account_nickname = await AccountOperations.get_account_nickname_by_sender(sender_email)
            
            if not account_nickname:
                # Fallback to sender email
                account_nickname = sender_email.replace("@", "_").replace(".", "_")
            
            # Process nickname: convert to lowercase and replace spaces with underscores
            processed_nickname = account_nickname.lower().replace(" ", "_")
            
            # Parse email date (handle Gmail format)
            try:
                # Try Gmail format first: "Wed, 03 Sep 2025 06:48:41 +0530"
                email_datetime = datetime.strptime(email_date, "%a, %d %b %Y %H:%M:%S %z")
            except ValueError:
                try:
                    # Try Gmail format without timezone: "Wed, 03 Sep 2025 11:47:18 GMT"
                    email_datetime = datetime.strptime(email_date, "%a, %d %b %Y %H:%M:%S %Z")
                except ValueError:
                    try:
                        # Try ISO format: "2025-09-04T10:00:00Z"
                        email_datetime = datetime.strptime(email_date.split('T')[0], "%Y-%m-%d")
                    except ValueError:
                        # Fallback to current date
                        email_datetime = datetime.now()
                        logger.warning(f"Could not parse email date '{email_date}', using current date")
            
            date_str = email_datetime.strftime("%Y%m%d")
            
            # Generate normalized filename (no secondary suffix)
            normalized_filename = f"{processed_nickname}_{date_str}_locked.pdf"
            
            return normalized_filename
            
        except Exception as e:
            logger.error(f"Error generating normalized filename: {e}")
            # Fallback filename
            return f"statement_{datetime.now().strftime('%Y%m%d_%H%M%S')}.pdf"
    
    async def _process_statement_extraction(self, statement_data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Process statement for data extraction and unlock PDF"""
        try:
            temp_file_path = statement_data["temp_file_path"]
            normalized_filename = statement_data["normalized_filename"]
            sender_email = statement_data["sender_email"]
            
            # Get account nickname from database
            account_nickname = await AccountOperations.get_account_nickname_by_sender(sender_email)
            if not account_nickname:
                logger.error(f"No account nickname found for sender: {sender_email}")
                return None
            
            # Unlock PDF if needed
            unlock_result = await self._unlock_pdf_async(temp_file_path, sender_email)
            if not unlock_result.get("success"):
                logger.warning(f"Could not unlock PDF: {normalized_filename}")
                # Use original if unlock fails
                unlocked_path = temp_file_path
            else:
                unlocked_path = unlock_result.get("unlocked_path")
                logger.info(f"🔓 Successfully unlocked PDF: {normalized_filename}")
            
            # Extract data from unlocked PDF using account nickname for schema selection
            extraction_result = self.document_extractor.extract_from_pdf(
                pdf_path=unlocked_path,
                account_nickname=account_nickname,
                save_results=True,
                email_date=statement_data.get("email_date")
            )
            
            if extraction_result.get("success"):
                logger.info(f"📊 Extracted data from: {normalized_filename}")
                return extraction_result
            else:
                logger.error(f"Failed to extract data from: {normalized_filename}")
                return None
                
        except Exception as e:
            logger.error(f"Error processing statement extraction: {e}")
            return None
    
    async def _upload_unlocked_statement_to_cloud(self, statement_data: Dict[str, Any], extraction_result: Dict[str, Any]) -> Optional[str]:
        """Upload only the unlocked statement to cloud storage"""
        try:
            temp_file_path = statement_data["temp_file_path"]
            normalized_filename = statement_data["normalized_filename"]
            sender_email = statement_data["sender_email"]
            email_date = statement_data["email_date"]
            
            # Unlock the PDF first
            unlock_result = await self._unlock_pdf_async(temp_file_path, sender_email)
            if not unlock_result.get("success"):
                logger.warning(f"Could not unlock PDF for upload: {normalized_filename}")
                return None
            
            unlocked_path = unlock_result.get("unlocked_path")
            
            # Generate cloud path for unlocked statement
            unlocked_filename = normalized_filename.replace("_locked.pdf", "_unlocked.pdf")
            cloud_path = self._generate_cloud_path(sender_email, email_date, unlocked_filename)
            
            # Upload unlocked statement to cloud storage
            upload_result = self.cloud_storage.upload_file(
                local_file_path=unlocked_path,
                cloud_path=cloud_path,
                content_type="application/pdf",
                metadata={
                    "sender_email": sender_email,
                    "email_date": email_date,
                    "original_filename": statement_data["original_filename"],
                    "upload_timestamp": datetime.now().isoformat(),
                    "extraction_schema": extraction_result.get("extraction_schema")
                }
            )
            
            if upload_result.get("success"):
                logger.info(f"☁️ Uploaded unlocked statement to cloud: {cloud_path}")
                return cloud_path
            else:
                logger.error(f"Failed to upload unlocked statement to cloud: {upload_result.get('error')}")
                return None
                
        except Exception as e:
            logger.error(f"Error uploading unlocked statement to cloud storage: {e}")
            return None
    
    
    async def _standardize_and_store_data(self, extraction_result: Dict[str, Any], statement_data: Dict[str, Any]) -> List[Dict[str, Any]]:
        """Standardize extracted data using dynamic method lookup"""
        try:
            csv_file_path = extraction_result.get("saved_path")
            if not csv_file_path:
                logger.warning("No CSV file path in extraction result")
                return []
            
            csv_file_path = Path(csv_file_path)
            if not csv_file_path.exists():
                logger.warning(f"CSV file does not exist: {csv_file_path}")
                return []
            
            # Read the extracted CSV
            df = pd.read_csv(csv_file_path)
            
            # Extract search pattern from CSV filename for database lookup
            search_pattern = extract_search_pattern_from_csv_filename(csv_file_path.name)
            
            # Get account nickname using database lookup
            account_nickname = await self.transaction_standardizer.get_account_name(search_pattern)
            
            # Convert DataFrame to list of dictionaries
            extracted_data = []
            for _, row in df.iterrows():
                row_dict = {}
                for col, value in row.items():
                    if pd.isna(value):
                        row_dict[col] = ""
                    else:
                        row_dict[col] = str(value).strip()
                
                # Add metadata
                row_dict['source_file'] = csv_file_path.name  # Use full filename for traceability
                row_dict['account'] = account_nickname  # Use database lookup result
                
                extracted_data.append(row_dict)
            
            # Use dynamic processing method lookup with search pattern
            standardized_df = await self.transaction_standardizer.process_with_dynamic_method(df, search_pattern, csv_file_path.name)
            
            # Convert DataFrame to list of dictionaries
            if not standardized_df.empty:
                standardized_data = standardized_df.to_dict('records')
                logger.info(f"Standardized {len(standardized_data)} transactions from {csv_file_path.name}")
                return standardized_data
            else:
                logger.warning(f"No standardized transactions generated from {csv_file_path.name}")
                return []
                
        except Exception as e:
            logger.error(f"Error standardizing data from {extraction_result.get('saved_path', 'unknown')}: {e}")
            return []
    
    async def process_and_combine_existing_csvs(self) -> Optional[str]:
        """Process all existing CSV files from extracted_data directory, standardize and combine them"""
        try:
            extracted_data_dir = Path("data/extracted_data")
            if not extracted_data_dir.exists():
                logger.warning("No extracted_data directory found")
                return None
            
            # Get all CSV files
            csv_files = list(extracted_data_dir.glob("*.csv"))
            if not csv_files:
                logger.warning("No CSV files found in extracted_data directory")
                return None
            
            logger.info(f"Found {len(csv_files)} CSV files to process")
            
            # Process each CSV file
            all_standardized_transactions = []
            for csv_file in csv_files:
                try:
                    logger.info(f"Processing CSV: {csv_file.name}")
                    
                    # Read CSV file
                    df = pd.read_csv(csv_file)
                    
                    # Extract search pattern from CSV filename for database lookup
                    search_pattern = extract_search_pattern_from_csv_filename(csv_file.name)
                    
                    # Get account nickname using database lookup
                    account_nickname = await self.transaction_standardizer.get_account_name(search_pattern)
                    
                    # Convert DataFrame to list of dictionaries
                    extracted_data = []
                    for _, row in df.iterrows():
                        row_dict = {}
                        for col, value in row.items():
                            if pd.isna(value):
                                row_dict[col] = ""
                            else:
                                row_dict[col] = str(value).strip()
                        
                        # Add metadata
                        row_dict['source_file'] = csv_file.name  # Use full filename for traceability
                        row_dict['account'] = account_nickname  # Use database lookup result
                        
                        extracted_data.append(row_dict)
                    
                    # Use dynamic processing method lookup with search pattern
                    standardized_df = await self.transaction_standardizer.process_with_dynamic_method(df, search_pattern, csv_file.name)
                    
                    # Convert DataFrame to list of dictionaries
                    if not standardized_df.empty:
                        standardized_data = standardized_df.to_dict('records')
                        all_standardized_transactions.extend(standardized_data)
                    
                    logger.info(f"Standardized {len(standardized_data)} transactions from {csv_file.name}")
                    
                except Exception as e:
                    logger.error(f"Error processing CSV {csv_file.name}: {e}")
                    continue
            
            if not all_standardized_transactions:
                logger.warning("No standardized transactions generated")
                return None
            
            # Save final combined CSV
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            csv_filename = f"standardized_transactions_{timestamp}.csv"
            csv_path = Path("data") / csv_filename
            
            # Ensure data directory exists
            csv_path.parent.mkdir(exist_ok=True)
            
            # Save to CSV with sorting by transaction date
            df_final = pd.DataFrame(all_standardized_transactions)
            
            # Sort by transaction_date (chronological order)
            if 'transaction_date' in df_final.columns:
                df_final['transaction_date'] = pd.to_datetime(df_final['transaction_date'], errors='coerce')
                df_final = df_final.sort_values('transaction_date', ascending=True)
                logger.info("📅 Sorted transactions by date (chronological order)")
            
            df_final.to_csv(csv_path, index=False)
            
            logger.info(f"💾 Saved {len(all_standardized_transactions)} standardized transactions to: {csv_path}")
            
            return str(csv_path)
            
        except Exception as e:
            logger.error(f"Error processing and combining CSVs: {e}")
            return None
    
    
    async def run_complete_workflow(self) -> Dict[str, Any]:
        """Run the complete statement processing workflow"""
        logger.info("🚀 Starting complete statement processing workflow")
        
        workflow_results = {
            "total_senders": 0,
            "total_statements_downloaded": 0,
            "total_statements_uploaded": 0,
            "total_statements_processed": 0,
            "temp_directory": str(self.temp_dir),
            "errors": [],
            "processed_statements": [],
            "all_standardized_data": []
        }
        
        try:
            # Step 1: Get all statement senders
            logger.info("📋 Step 1: Getting all statement senders")
            statement_senders_raw = await AccountOperations.get_all_statement_senders()
            
            # Handle comma-separated sender emails
            statement_senders = []
            for sender in statement_senders_raw:
                if ',' in sender:
                    # Split comma-separated emails and add each one
                    individual_senders = [s.strip() for s in sender.split(',') if s.strip()]
                    statement_senders.extend(individual_senders)
                else:
                    statement_senders.append(sender)
            
            # Remove duplicates while preserving order
            statement_senders = list(dict.fromkeys(statement_senders))
            workflow_results["total_senders"] = len(statement_senders)
            
            if not statement_senders:
                logger.warning("No statement senders found in accounts table")
                return workflow_results
            
            logger.info(f"Found {len(statement_senders)} statement senders")
            
            # Step 2: Calculate date range
            start_date, end_date = self._calculate_date_range()
            
            # Step 3: Process each sender
            for sender_email in statement_senders:
                try:
                    logger.info(f"🔄 Processing sender: {sender_email}")
                    
                    # Download statements from this sender
                    statements = await self._download_statements_from_sender(sender_email, start_date, end_date)
                    workflow_results["total_statements_downloaded"] += len(statements)
                    
                    # Process each statement
                    for statement_data in statements:
                        try:
                            # Extract data from statement
                            extraction_result = await self._process_statement_extraction(statement_data)
                            if extraction_result:
                                workflow_results["total_statements_processed"] += 1
                                
                                # Upload unlocked statement to cloud storage
                                cloud_path = await self._upload_unlocked_statement_to_cloud(statement_data, extraction_result)
                                if cloud_path:
                                    workflow_results["total_statements_uploaded"] += 1
                                
                                # Standardize and store
                                standardized_data = await self._standardize_and_store_data(extraction_result, statement_data)
                                if standardized_data:
                                    workflow_results["all_standardized_data"].extend(standardized_data)
                                
                                workflow_results["processed_statements"].append({
                                    "sender_email": statement_data["sender_email"],
                                    "filename": statement_data["normalized_filename"],
                                    "pdf_cloud_path": cloud_path,
                                    "csv_cloud_path": extraction_result.get("csv_cloud_path"),
                                    "extraction_success": True,
                                    "standardization_success": len(standardized_data) > 0 if standardized_data else False
                                })
                            else:
                                workflow_results["errors"].append(f"Failed to extract data from {statement_data['normalized_filename']}")
                        
                        except Exception as e:
                            error_msg = f"Error processing statement {statement_data.get('normalized_filename', 'unknown')}: {e}"
                            logger.error(error_msg)
                            workflow_results["errors"].append(error_msg)
                
                except Exception as e:
                    error_msg = f"Error processing sender {sender_email}: {e}"
                    logger.error(error_msg)
                    workflow_results["errors"].append(error_msg)
            
            logger.info("✅ Complete statement processing workflow finished")
            # Store all standardized data as CSV locally
            if workflow_results["all_standardized_data"]:
                logger.info("💾 Storing all standardized data as CSV locally")
                csv_path = await self._store_standardized_csv_locally(workflow_results["all_standardized_data"])
                if csv_path:
                    workflow_results["local_csv_path"] = str(csv_path)
                    logger.info(f"✅ Saved {len(workflow_results['all_standardized_data'])} transactions to: {csv_path}")
            
            logger.info(f"Results: {workflow_results['total_statements_downloaded']} downloaded, "
                       f"{workflow_results['total_statements_uploaded']} uploaded, "
                       f"{workflow_results['total_statements_processed']} processed")
            logger.info(f"Temp directory used: {workflow_results['temp_directory']}")
            
            return workflow_results
            
        except Exception as e:
            error_msg = f"Critical error in workflow: {e}"
            logger.error(error_msg)
            workflow_results["errors"].append(error_msg)
            return workflow_results
        
        finally:
            # Cleanup temp directory
            try:
                shutil.rmtree(self.temp_dir)
                logger.info(f"🧹 Cleaned up temp directory: {self.temp_dir}")
            except Exception as e:
                logger.warning(f"Failed to cleanup temp directory: {e}")
    
    async def _store_standardized_csv_locally(self, standardized_data: List[Dict[str, Any]]) -> Path:
        """Store standardized transaction data as CSV locally"""
        try:
            if not standardized_data:
                logger.warning("No standardized data to store")
                return None
            
            # Create data directory if it doesn't exist
            data_dir = Path("data")
            data_dir.mkdir(exist_ok=True)
            
            # Generate filename with timestamp
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            csv_filename = f"standardized_transactions_{timestamp}.csv"
            csv_path = data_dir / csv_filename
            
            # Convert to DataFrame and save with sorting by transaction date
            df = pd.DataFrame(standardized_data)
            
            # Sort by transaction_date (chronological order)
            if 'transaction_date' in df.columns:
                df['transaction_date'] = pd.to_datetime(df['transaction_date'], errors='coerce')
                df = df.sort_values('transaction_date', ascending=True)
                logger.info("📅 Sorted transactions by date (chronological order)")
            
            df.to_csv(csv_path, index=False)
            
            logger.info(f"💾 Stored {len(standardized_data)} standardized transactions to: {csv_path}")
            return csv_path
            
        except Exception as e:
            logger.error(f"Error storing standardized CSV: {e}")
            return None


# Convenience function for running the workflow
async def run_statement_workflow(account_ids: List[str] = None) -> Dict[str, Any]:
    """Run the complete statement processing workflow"""
    workflow = StatementWorkflow(account_ids=account_ids)
    return await workflow.run_complete_workflow()
