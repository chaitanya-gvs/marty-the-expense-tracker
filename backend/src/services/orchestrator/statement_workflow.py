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

import calendar
import os
import re
import shutil
import tempfile
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Callable, Dict, List, Optional, Any

import pandas as pd
from googleapiclient.discovery import build

from src.services.database_manager.operations import AccountOperations, StatementLogOperations, TransactionOperations
from src.services.email_ingestion.client import EmailClient
from src.services.email_ingestion.token_manager import TokenManager
from src.services.cloud_storage.gcs_service import GoogleCloudStorageService
from src.services.statement_processor.document_extractor import DocumentExtractor
from .transaction_standardizer import TransactionStandardizer
from src.utils.filename_utils import nickname_to_filename_prefix
from src.services.statement_processor.pdf_unlocker import PDFUnlocker
from src.services.splitwise_processor.service import SplitwiseService
from src.utils.logger import get_logger
from src.utils.password_manager import BankPasswordManager
from .statement_extractor_helper import StatementExtractorHelper
from .splitwise_processor_helper import SplitwiseProcessorHelper
from .data_standardizer_helper import DataStandardizerHelper
from src.services.email_ingestion.dedup_service import DeduplicationService
from src.services.database_manager.operations.review_queue_operations import ReviewQueueOperations
from src.services.email_ingestion.alert_ingestion_service import AlertIngestionService

logger = get_logger(__name__)


def get_secondary_account_setting() -> bool:
    """Get secondary account setting from environment variables."""
    enable_secondary = os.getenv("ENABLE_SECONDARY_ACCOUNT", "false").lower()
    return enable_secondary in ("true", "1", "yes", "on")


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
                
    except Exception:
        logger.error(f"Error extracting search pattern from {csv_filename}", exc_info=True)
        return csv_filename.replace('.csv', '').replace('_extracted', '')


class StatementWorkflow:
    """Orchestrates the complete statement processing workflow"""
    
    def __init__(
        self,
        account_ids: List[str] = None,
        enable_secondary_account: bool = None,
        event_callback: Optional[Callable[[dict], None]] = None,
    ):
        """
        Initialize the StatementWorkflow
        
        Args:
            account_ids: List of account IDs to use. If None, uses default accounts based on enable_secondary_account
            enable_secondary_account: If True, includes secondary account. If False, only uses primary account.
                                    If None, uses environment variable ENABLE_SECONDARY_ACCOUNT (default: False)
            event_callback: Optional callable invoked with a status event dict at key workflow moments.
                            Used by the API layer to stream real-time progress over SSE.
        """
        # Get secondary account setting from environment if not provided
        if enable_secondary_account is None:
            enable_secondary_account = get_secondary_account_setting()
        
        # Set account IDs based on secondary account flag
        if account_ids is None:
            if enable_secondary_account:
                self.account_ids = ["primary", "secondary"]  # chaitanyagvs23@gmail.com and chaitanyagvs98@gmail.com
            else:
                self.account_ids = ["primary"]  # Only chaitanyagvs23@gmail.com
        else:
            self.account_ids = account_ids
        
        self.enable_secondary_account = enable_secondary_account
        self.event_callback = event_callback
        
        # Initialize email clients for both accounts
        self.email_clients = {}
        for account_id in self.account_ids:
            self.email_clients[account_id] = EmailClient(account_id=account_id)
        
        self.cloud_storage = GoogleCloudStorageService()
        self.document_extractor = DocumentExtractor()
        self.transaction_standardizer = TransactionStandardizer()
        self.pdf_unlocker = PDFUnlocker()
        self.password_manager = BankPasswordManager()
        self.splitwise_service = SplitwiseService()
        
        # Create temp directory for processing
        self.temp_dir = Path(tempfile.mkdtemp(prefix="statement_processing_"))
        self.job_id: Optional[str] = None
        logger.info(f"Created temp directory: {self.temp_dir}", extra=self._log_extra())
        logger.info(f"Initialized email clients for accounts: {self.account_ids}", extra=self._log_extra())
        logger.info(f"Secondary account enabled: {self.enable_secondary_account}", extra=self._log_extra())

        # Initialize extraction/processing helper objects
        self._extractor_helper = StatementExtractorHelper(
            document_extractor=self.document_extractor,
            cloud_storage=self.cloud_storage,
            unlock_pdf_async=self._unlock_pdf_async,
            check_unlocked_pdf_in_gcs=self._check_unlocked_pdf_in_gcs,
            check_statement_already_extracted=self.check_statement_already_extracted,
            temp_dir=self.temp_dir,
            emit=self._emit,
            log_extra=self._log_extra,
        )
        self._splitwise_helper = SplitwiseProcessorHelper(
            splitwise_service=self.splitwise_service,
            cloud_storage=self.cloud_storage,
            temp_dir=self.temp_dir,
            calculate_splitwise_date_range=self._calculate_splitwise_date_range,
            emit=self._emit,
            log_extra=self._log_extra,
        )
        self._data_standardizer_helper = DataStandardizerHelper(
            transaction_standardizer=self.transaction_standardizer,
            cloud_storage=self.cloud_storage,
            temp_dir=self.temp_dir,
            calculate_splitwise_date_range=self._calculate_splitwise_date_range,
            remove_duplicate_transactions=self._remove_duplicate_transactions,
            sort_transactions_by_date=self._sort_transactions_by_date,
            emit=self._emit,
            log_extra=self._log_extra,
        )
    
    def _emit(
        self,
        event_type: str,
        step: str,
        message: str,
        account: str = None,
        level: str = "info",
        data: dict = None,
    ) -> None:
        """Emit a workflow status event to the registered callback (no-op when callback is None)."""
        if self.event_callback is None:
            return
        event = {
            "event": event_type,
            "step": step,
            "message": message,
            "account": account,
            "level": level,
            "timestamp": datetime.utcnow().isoformat() + "Z",
            "data": data or {},
        }
        self.event_callback(event)

    async def _refresh_all_tokens(self) -> bool:
        """Refresh Gmail tokens for all accounts before starting workflow."""
        logger.info("Refreshing Gmail tokens for all accounts...", extra=self._log_extra())
        self._emit("token_refresh_started", "token_refresh", f"Refreshing Gmail tokens for accounts: {', '.join(self.account_ids)}")
        all_success = True
        for account_id in self.account_ids:
            try:
                token_manager = TokenManager(account_id)
                credentials = token_manager.get_valid_credentials()
                if credentials:
                    logger.info(f"Successfully refreshed token for {account_id} account", extra=self._log_extra())
                    if account_id in self.email_clients:
                        self.email_clients[account_id].creds = credentials
                        self.email_clients[account_id].service = build(
                            "gmail", "v1",
                            credentials=credentials,
                            cache_discovery=False
                        )
                    self._emit(
                        "token_refresh_complete", "token_refresh",
                        f"Token refreshed for {account_id} account",
                        account=account_id, level="success",
                    )
                else:
                    logger.warning(f"Failed to refresh token for {account_id} account", extra=self._log_extra())
                    self._emit(
                        "token_refresh_failed", "token_refresh",
                        f"Failed to refresh token for {account_id} account",
                        account=account_id, level="warning",
                    )
                    all_success = False
            except Exception as e:
                logger.error(f"Error refreshing token for {account_id} account", exc_info=True, extra=self._log_extra())
                self._emit(
                    "token_refresh_failed", "token_refresh",
                    f"Error refreshing token for {account_id}: {e}",
                    account=account_id, level="error",
                )
                all_success = False

        if all_success:
            logger.info("All tokens refreshed successfully", extra=self._log_extra())
        else:
            logger.warning("Some tokens failed to refresh - workflow may encounter authentication errors", extra=self._log_extra())

        return all_success
    
    def _calculate_date_range(self) -> tuple[str, str]:
        """
        Calculate date range for statement retrieval:
        From 13th of previous month to 13th of current month.
        SBI Savings statement arrives on the 12th, so the 13th window captures it.
        """
        now = datetime.now()

        # Current month 13th
        current_month_13th = now.replace(day=13)

        # Previous month 13th
        if now.month == 1:
            previous_month_13th = now.replace(year=now.year - 1, month=12, day=13)
        else:
            previous_month_13th = now.replace(month=now.month - 1, day=13)

        # Format dates for Gmail API (YYYY/MM/DD)
        start_date = previous_month_13th.strftime("%Y/%m/%d")
        end_date = current_month_13th.strftime("%Y/%m/%d")

        logger.info(f"Date range for statement retrieval: {start_date} to {end_date}", extra=self._log_extra())
        return start_date, end_date
    
    def _calculate_splitwise_date_range(self) -> tuple[datetime, datetime]:
        """
        Calculate date range for Splitwise data retrieval:
        From 1st of previous month to last day of previous month
        """
        now = datetime.now()
        
        # Calculate previous month
        if now.month == 1:
            prev_month = 12
            prev_year = now.year - 1
        else:
            prev_month = now.month - 1
            prev_year = now.year
        
        # First day of previous month
        start_date = datetime(prev_year, prev_month, 1)
        
        # Last day of previous month
        if prev_month == 12:
            next_month = 1
            next_year = prev_year + 1
        else:
            next_month = prev_month + 1
            next_year = prev_year
        
        end_date = datetime(next_year, next_month, 1) - timedelta(days=1)
        
        logger.info(f"Splitwise date range: {start_date.strftime('%Y-%m-%d')} to {end_date.strftime('%Y-%m-%d')}", extra=self._log_extra())
        return start_date, end_date
    
    
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
                        logger.warning(f"Could not parse email date '{email_date}', using current date", extra=self._log_extra())
            
            # Get previous month
            if email_datetime.month == 1:
                prev_month = 12
                prev_year = email_datetime.year - 1
            else:
                prev_month = email_datetime.month - 1
                prev_year = email_datetime.year
            
            # Format as YYYY-MM (e.g., "2025-08")
            return f"{prev_year}-{prev_month:02d}"
            
        except Exception:
            logger.error(f"Error parsing email date {email_date}", exc_info=True, extra=self._log_extra())
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
        logger.info(f"🔍 Searching for statements from {sender_email}", extra=self._log_extra())
        _account_info = await AccountOperations.get_account_by_sender_email(sender_email)
        _account_db_id = str(_account_info["id"]) if _account_info else None
        account_nickname = _account_info.get("nickname") if _account_info else None
        self._emit(
            "email_search_started", "email_search",
            f"Searching for statements from {sender_email} ({start_date} → {end_date})",
            data={
                "sender": sender_email,
                "account_nickname": account_nickname,
                "start_date": start_date,
                "end_date": end_date,
            },
        )
        
        all_downloaded_statements = []
        
        # Search in all email accounts
        for account_id, email_client in self.email_clients.items():
            try:
                logger.info(f"📧 Searching in {account_id} account for {sender_email}", extra=self._log_extra())
                
                # Search for emails from this sender in date range that contain "statement"
                query = f"from:{sender_email} statement"
                emails = email_client.search_emails_by_date_range(start_date, end_date, query)
                
                if not emails:
                    logger.info(f"No emails found from {sender_email} in {account_id} account", extra=self._log_extra())
                    continue
                
                logger.info(f"📧 Found {len(emails)} emails from {sender_email} in {account_id} account", extra=self._log_extra())
                self._emit(
                    "email_found", "email_search",
                    f"Found {len(emails)} email(s) from {sender_email} in {account_id} account",
                    account=account_id,
                    data={"sender": sender_email, "email_count": len(emails)},
                )
                
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

                                # Early skip: don't download if already extracted/db_inserted
                                normalized_filename = await self._generate_normalized_filename(
                                    sender_email, email_date, original_filename
                                )
                                log_key = normalized_filename.replace("_locked.pdf", "")
                                if await StatementLogOperations.check_already_extracted(log_key):
                                    logger.info(
                                        f"Skipping download of {original_filename} — already processed ({log_key})",
                                        extra=self._log_extra(),
                                    )
                                    self._emit(
                                        "pdf_skipped_already_processed", "pdf_download",
                                        f"Skipped {original_filename} — already processed",
                                        data={"filename": original_filename, "log_key": log_key},
                                    )
                                    continue

                                self._emit(
                                    "pdf_download_started", "pdf_download",
                                    f"Downloading attachment: {original_filename}",
                                    data={"filename": original_filename, "subject": subject},
                                )

                                # Download attachment data
                                attachment_data = email_client.download_attachment(email_id, attachment_id)
                                if not attachment_data:
                                    continue

                                # Save to temp directory
                                temp_file_path = self.temp_dir / normalized_filename
                                with open(temp_file_path, "wb") as f:
                                    f.write(attachment_data)
                                
                                file_size = temp_file_path.stat().st_size
                                logger.info(f"Downloaded from {account_id}: {normalized_filename}", extra=self._log_extra())
                                self._emit(
                                    "pdf_downloaded", "pdf_download",
                                    f"Downloaded {normalized_filename} ({file_size // 1024} KB)",
                                    account=account_id, level="success",
                                    data={"filename": normalized_filename, "file_size_bytes": file_size},
                                )

                                statement_month = self._get_previous_month_folder(email_date)
                                all_downloaded_statements.append({
                                    "sender_email": sender_email,
                                    "email_date": email_date,
                                    "email_subject": subject,
                                    "original_filename": original_filename,
                                    "normalized_filename": normalized_filename,
                                    "log_key": log_key,
                                    "temp_file_path": str(temp_file_path),
                                    "file_size": file_size,
                                    "source_account": account_id
                                })
                                try:
                                    await StatementLogOperations.upsert_log({
                                        "normalized_filename": log_key,
                                        "sender_email": sender_email,
                                        "email_date": email_date,
                                        "statement_month": statement_month,
                                        "status": "downloaded",
                                        "job_id": self.job_id,
                                        "account_id": _account_db_id,
                                        "account_nickname": account_nickname,
                                    })
                                except Exception:
                                    logger.warning(f"Failed to upsert log for {log_key}", exc_info=True, extra=self._log_extra())
                                
                            except Exception as e:
                                logger.error(f"Error downloading attachment {attachment.get('filename')} from {account_id}", exc_info=True, extra=self._log_extra())
                                self._emit(
                                    "pdf_download_failed", "pdf_download",
                                    f"Failed to download {attachment.get('filename')}: {e}",
                                    account=account_id, level="error",
                                    data={"filename": attachment.get("filename"), "error": str(e)},
                                )
                                continue
                    
                    except Exception:
                        logger.error(f"Error processing email {email_data.get('id')} from {account_id}", exc_info=True, extra=self._log_extra())
                        continue
            
            except Exception as e:
                logger.error(f"Error searching in {account_id} account for {sender_email}", exc_info=True, extra=self._log_extra())
                self._emit(
                    "email_search_failed", "email_search",
                    f"Error searching {account_id} account for {sender_email}: {e}",
                    account=account_id, level="error",
                    data={"sender": sender_email, "error": str(e)},
                )
                continue
        
        logger.info(f"Total statements downloaded for {sender_email}: {len(all_downloaded_statements)}", extra=self._log_extra())

        # Deduplicate: keep only the latest statement per (sender, statement_month)
        deduplicated = self._deduplicate_statements_by_account_month(all_downloaded_statements)

        self._emit(
            "email_search_complete", "email_search",
            f"Downloaded {len(all_downloaded_statements)} statement(s) from {sender_email}"
            + (f", kept {len(deduplicated)} after deduplication" if len(deduplicated) < len(all_downloaded_statements) else ""),
            level="success" if deduplicated else "info",
            data={
                "sender": sender_email,
                "downloaded_count": len(all_downloaded_statements),
                "kept_count": len(deduplicated),
            },
        )
        return deduplicated
    
    def _deduplicate_statements_by_account_month(
        self, statements: List[Dict[str, Any]]
    ) -> List[Dict[str, Any]]:
        """
        For each (sender_email, statement_month) group keep only the statement
        with the latest email date (most recent = most up-to-date).
        Emits statement_duplicate_skipped for every dropped statement.
        """
        groups: Dict[tuple, Dict[str, Any]] = {}
        for s in statements:
            month = self._get_previous_month_folder(s["email_date"])
            key = (s["sender_email"], month)
            existing = groups.get(key)
            if existing is None:
                groups[key] = s
            else:
                s_dt = self._parse_email_date(s["email_date"])
                ex_dt = self._parse_email_date(existing["email_date"])
                if s_dt > ex_dt:
                    # s is newer — drop existing
                    self._emit(
                        "statement_duplicate_skipped", "email_search",
                        f"Skipped duplicate statement {existing['normalized_filename']} for {month} — kept newer one",
                        level="info",
                        data={
                            "dropped_filename": existing["normalized_filename"],
                            "kept_filename": s["normalized_filename"],
                            "statement_month": month,
                        },
                    )
                    groups[key] = s
                else:
                    # existing is newer (or equal) — drop s
                    self._emit(
                        "statement_duplicate_skipped", "email_search",
                        f"Skipped duplicate statement {s['normalized_filename']} for {month} — kept newer one",
                        level="info",
                        data={
                            "dropped_filename": s["normalized_filename"],
                            "kept_filename": existing["normalized_filename"],
                            "statement_month": month,
                        },
                    )
        return list(groups.values())

    async def _unlock_pdf_async(self, pdf_path: Path, sender_email: str, account_nickname: Optional[str] = None) -> Dict[str, Any]:
        """Async version of PDF unlocking that uses async password lookup"""
        try:
            # Ensure pdf_path is a Path object
            pdf_path = Path(pdf_path)
            logger.info(f"Unlocking PDF: {pdf_path.name}", extra=self._log_extra())
            
            # Get password using async method
            password = await self.password_manager.get_password_for_sender_async(sender_email)
            if not password:
                return {
                    "success": False,
                    "error": f"No password found for sender: {sender_email}"
                }
            
            logger.info("Password found", extra=self._log_extra())
            
            # Use the existing PDF unlocker with the password
            unlock_result = self.pdf_unlocker.unlock_pdf_with_password(pdf_path, password, account_nickname=account_nickname)
            return unlock_result
            
        except Exception as e:
            logger.error(f"Error unlocking PDF {pdf_path}", exc_info=True, extra=self._log_extra())
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
                logger.warning(f"No account nickname found, using fallback: {account_nickname}", extra=self._log_extra())
            
            # Process nickname: {account}_{date} convention (no savings, credit card, account suffix)
            processed_nickname = nickname_to_filename_prefix(account_nickname)
            
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
                        logger.warning(f"Could not parse email date '{email_date}', using current date", extra=self._log_extra())
            
            date_str = email_datetime.strftime("%Y%m%d")
            
            # Generate normalized filename (no secondary suffix)
            normalized_filename = f"{processed_nickname}_{date_str}_locked.pdf"
            
            return normalized_filename
            
        except Exception:
            logger.error("Error generating normalized filename", exc_info=True, extra=self._log_extra())
            # Fallback filename
            return f"statement_{datetime.now().strftime('%Y%m%d_%H%M%S')}.pdf"
    
    async def _check_unlocked_pdf_in_gcs(self, statement_data: Dict[str, Any]) -> Optional[str]:
        """
        Check whether the unlocked PDF for this statement already exists in GCS.
        Returns the GCS cloud path if found, None otherwise.
        """
        try:
            normalized_filename = statement_data["normalized_filename"]
            email_date = statement_data["email_date"]

            unlocked_filename = normalized_filename.replace("_locked.pdf", ".pdf")
            statement_month = self._get_previous_month_folder(email_date)
            prefix = f"{statement_month}/unlocked_statements/"

            cloud_files = self.cloud_storage.list_files(prefix)
            for file_info in (cloud_files or []):
                cloud_name = file_info.get("name", "")
                if cloud_name.endswith(unlocked_filename) or unlocked_filename in cloud_name:
                    logger.info(f"Found existing unlocked PDF in GCS: {cloud_name}", extra=self._log_extra())
                    return cloud_name
            return None
        except Exception:
            logger.error("Error checking unlocked PDF in GCS", exc_info=True, extra=self._log_extra())
            return None

    async def _process_statement_extraction(self, statement_data: Dict[str, Any], override: bool = False) -> Optional[Dict[str, Any]]:
        """Delegate to StatementExtractorHelper."""
        return await self._extractor_helper.process(
            statement_data, job_id=self.job_id, override=override
        )
    
    async def _upload_unlocked_statement_to_cloud(self, statement_data: Dict[str, Any], extraction_result: Dict[str, Any]) -> Optional[str]:
        """Upload only the unlocked statement to cloud storage"""
        try:
            temp_file_path = statement_data["temp_file_path"]
            normalized_filename = statement_data["normalized_filename"]
            sender_email = statement_data["sender_email"]
            email_date = statement_data["email_date"]
            log_key = statement_data.get("log_key") or normalized_filename.replace("_locked.pdf", "")
            
            # Unlock the PDF first
            account_nickname = await AccountOperations.get_account_nickname_by_sender(sender_email)
            unlock_result = await self._unlock_pdf_async(temp_file_path, sender_email, account_nickname=account_nickname)
            if not unlock_result.get("success"):
                logger.warning(f"Could not unlock PDF for upload: {normalized_filename}", extra=self._log_extra())
                return None
            
            unlocked_path = unlock_result.get("unlocked_path")
            
            # Generate cloud path for unlocked statement: {account}_{date}.pdf
            _date_match = re.search(r"_(\d{8})(?:_locked)?\.pdf$", normalized_filename)
            _date_str = _date_match.group(1) if _date_match else datetime.now().strftime("%Y%m%d")
            if account_nickname:
                _nick_clean = nickname_to_filename_prefix(account_nickname)
                unlocked_filename = f"{_nick_clean}_{_date_str}.pdf"
            else:
                # Fallback: strip _locked suffix from normalized filename
                unlocked_filename = normalized_filename.replace("_locked.pdf", ".pdf")
            cloud_path = self._generate_cloud_path(sender_email, email_date, unlocked_filename)
            
            self._emit(
                "gcs_upload_started", "gcs_upload",
                f"Uploading unlocked PDF to GCS: {unlocked_filename}",
                data={"filename": unlocked_filename, "cloud_path": cloud_path},
            )
            
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
                logger.info(f"☁Uploaded unlocked statement to cloud: {cloud_path}", extra=self._log_extra())
                self._emit(
                    "gcs_uploaded", "gcs_upload",
                    f"Uploaded unlocked PDF to GCS: {cloud_path}",
                    level="success",
                    data={"filename": unlocked_filename, "cloud_path": cloud_path},
                )
                try:
                    await StatementLogOperations.update_status(
                        log_key, "pdf_stored",
                        unlocked_cloud_path=cloud_path,
                        job_id=self.job_id,
                    )
                except Exception:
                    logger.warning(f"Failed to update log status to pdf_stored for {log_key}", exc_info=True, extra=self._log_extra())
                return cloud_path
            else:
                logger.error(f"Failed to upload unlocked statement to cloud: {upload_result.get('error')}", exc_info=True, extra=self._log_extra())
                self._emit(
                    "gcs_upload_failed", "gcs_upload",
                    f"Failed to upload {unlocked_filename} to GCS: {upload_result.get('error')}",
                    level="error",
                    data={"filename": unlocked_filename, "error": upload_result.get("error")},
                )
                try:
                    await StatementLogOperations.set_error(
                        log_key, f"PDF upload failed: {upload_result.get('error')}"
                    )
                except Exception:
                    logger.warning(f"Failed to set error in log for {log_key}", exc_info=True, extra=self._log_extra())
                return None

        except Exception as e:
            logger.error("Error uploading unlocked statement to cloud storage", exc_info=True, extra=self._log_extra())
            self._emit(
                "gcs_upload_failed", "gcs_upload",
                f"Unexpected error uploading {statement_data.get('normalized_filename', 'unknown')} to GCS: {e}",
                level="error",
                data={"error": str(e)},
            )
            return None
    
    async def _process_splitwise_data(
        self,
        continue_on_error: bool = True,
        custom_start_date: Optional[datetime] = None,
        custom_end_date: Optional[datetime] = None,
    ) -> Optional[Dict[str, Any]]:
        """Delegate to SplitwiseProcessorHelper."""
        return await self._splitwise_helper.process(
            override=getattr(self, "override", False),
            continue_on_error=continue_on_error,
            custom_start_date=custom_start_date,
            custom_end_date=custom_end_date,
        )
    
    
    async def _standardize_and_store_data(self, extraction_result: Dict[str, Any], statement_data: Dict[str, Any]) -> List[Dict[str, Any]]:
        """Standardize extracted data using dynamic method lookup"""
        try:
            csv_file_path = extraction_result.get("saved_path")
            if not csv_file_path:
                logger.warning("No CSV file path in extraction result", extra=self._log_extra())
                return []
            
            csv_file_path = Path(csv_file_path)
            if not csv_file_path.exists():
                logger.warning(f"CSV file does not exist: {csv_file_path}", extra=self._log_extra())
                return []
            
            # Read the extracted CSV
            df = pd.read_csv(csv_file_path)

            # Update transaction_count in the statement log (log_key = filename without _extracted suffix)
            try:
                log_key = csv_file_path.stem.replace("_extracted", "")
                await StatementLogOperations.update_status(
                    log_key, "csv_stored",
                    transaction_count=len(df),
                    job_id=self.job_id,
                )
            except Exception:
                logger.warning(f"Failed to update transaction_count in log for {csv_file_path.name}", exc_info=True, extra=self._log_extra())

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
                logger.info(f"Standardized {len(standardized_data)} transactions from {csv_file_path.name}", extra=self._log_extra())
                return standardized_data
            else:
                logger.warning(f"No standardized transactions generated from {csv_file_path.name}", extra=self._log_extra())
                return []
                
        except Exception:
            logger.error(f"Error standardizing data from {extraction_result.get('saved_path', 'unknown')}", exc_info=True, extra=self._log_extra())
            return []
    
    
    def _log_extra(self) -> dict:
        """Return extra dict with job_id for logger calls when job_id is set."""
        if self.job_id:
            return {"job_id": self.job_id}
        return {}

    async def run_complete_workflow(
        self,
        resume_from_standardization: bool = False,
        include_email_ingestion: bool = True,
        include_statement: bool = True,
        include_splitwise: bool = True,
        custom_start_date: Optional[str] = None,
        custom_end_date: Optional[str] = None,
        custom_splitwise_start_date: Optional[datetime] = None,
        custom_splitwise_end_date: Optional[datetime] = None,
        email_since_date: Optional[datetime] = None,
        override: bool = False,
        job_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Run the complete statement processing workflow

        Args:
            resume_from_standardization: If True, skip document extraction and start from standardization
            override: If True, bypass all GCS resume checks and re-extract every statement from scratch
            job_id: Optional job ID from API; when set, used for statement_processing_log and log extras
        """
        self.job_id = job_id or datetime.now().isoformat()
        self.override = override

        if resume_from_standardization:
            logger.info("Resuming workflow from standardization step (skipping document extraction)", extra=self._log_extra())
            self._emit(
                "workflow_started", "workflow",
                "Resuming workflow from standardization — skipping email/extraction steps",
                data={"mode": "resume"},
            )
        else:
            logger.info("Starting complete statement processing workflow", extra=self._log_extra())
            self._emit(
                "workflow_started", "workflow",
                "Starting full statement processing workflow",
                data={"mode": "full"},
            )
        
        workflow_results = {
            "total_senders": 0,
            "total_statements_downloaded": 0,
            "total_statements_uploaded": 0,
            "total_statements_processed": 0,
            "splitwise_processed": False,
            "splitwise_cloud_path": None,
            "splitwise_transaction_count": 0,
            "combined_transaction_count": 0,
            "database_inserted_count": 0,
            "database_skipped_count": 0,
            "database_error_count": 0,
            "database_errors": [],
            "temp_directory": str(self.temp_dir),
            "errors": [],
            "processed_statements": [],
            "all_standardized_data": [],
            "email_ingestion": None,
        }
        
        try:
            # Step 0: Refresh Gmail tokens proactively (needed for email ingestion and statement download)
            if (include_email_ingestion or include_statement) and not resume_from_standardization:
                logger.info("Step 0: Refreshing Gmail tokens...", extra=self._log_extra())
                await self._refresh_all_tokens()
            
            # Step 1: Email alert ingestion
            if include_email_ingestion:
                logger.info("📧 Step 1: Running email alert ingestion", extra=self._log_extra())
                self._emit(
                    "email_ingestion_started", "email_ingestion",
                    "Starting email alert ingestion for all alert-enabled accounts",
                )
                try:
                    ingestion_svc = AlertIngestionService()
                    ingestion_result = await ingestion_svc.run(since_date=email_since_date)
                    workflow_results["email_ingestion"] = ingestion_result
                    self._emit(
                        "email_ingestion_complete", "email_ingestion",
                        (
                            f"Email ingestion complete: {ingestion_result['inserted']} inserted, "
                            f"{ingestion_result['skipped']} skipped, "
                            f"{ingestion_result['errors']} errors"
                        ),
                        level="success" if ingestion_result["errors"] == 0 else "warning",
                        data=ingestion_result,
                    )
                except Exception as e:
                    logger.warning(
                        "Email ingestion failed, continuing workflow",
                        exc_info=True, extra=self._log_extra(),
                    )
                    workflow_results["errors"].append(f"Email ingestion: {e}")
                    self._emit(
                        "email_ingestion_error", "email_ingestion",
                        f"Email ingestion failed (non-fatal): {e}",
                        level="warning",
                    )
            else:
                self._emit(
                    "email_ingestion_skipped", "email_ingestion",
                    "Email ingestion skipped (toggle off)",
                )

            # Steps 2-4: Statement download + extraction
            if include_statement:
                # Step 2: Get all statement senders
                logger.info("📋 Step 2: Getting all statement senders", extra=self._log_extra())
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
                    logger.warning("No statement senders found in accounts table", extra=self._log_extra())
                    # Don't return — Splitwise may still need to run
                else:
                    logger.info(f"Found {len(statement_senders)} statement senders", extra=self._log_extra())

                    # Step 3: Calculate date range
                    start_date, end_date = self._calculate_date_range()

                    # Override with custom date range if provided
                    if custom_start_date and custom_end_date:
                        logger.info(
                            f"Using custom date range override: {custom_start_date} to {custom_end_date}"
                        )
                        start_date = custom_start_date
                        end_date = custom_end_date

                    # Step 4: Process each sender (skipped when resuming from standardization)
                    if not resume_from_standardization:
                        logger.info("Starting document extraction step", extra=self._log_extra())
                        # Derive the expected statement month (previous calendar month)
                        _now = datetime.now()
                        _prev_month = (_now.month - 1) or 12
                        _prev_year = _now.year if _now.month > 1 else _now.year - 1
                        expected_statement_month = f"{_prev_year}-{_prev_month:02d}"

                        for sender_email in statement_senders:
                            try:
                                logger.info(f"Processing sender: {sender_email}", extra=self._log_extra())

                                # Skip sender entirely if all their statements are already db_inserted
                                if not override:
                                    account_nickname_for_check = await AccountOperations.get_account_nickname_by_sender(sender_email)
                                    sender_done = await StatementLogOperations.check_sender_fully_complete(
                                        sender_email, expected_statement_month
                                    )
                                    if sender_done:
                                        logger.info(
                                            f"All statements already complete for {sender_email} ({expected_statement_month}) — skipping",
                                            extra=self._log_extra(),
                                        )
                                        self._emit(
                                            "account_already_complete", "email_search",
                                            f"Already fully processed for {expected_statement_month}",
                                            level="success",
                                            data={
                                                "sender": sender_email,
                                                "account_nickname": account_nickname_for_check,
                                                "statement_month": expected_statement_month,
                                            },
                                        )
                                        continue

                                # Download statements from this sender
                                statements = await self._download_statements_from_sender(sender_email, start_date, end_date)
                                workflow_results["total_statements_downloaded"] += len(statements)

                                # Process each statement
                                for statement_data in statements:
                                    try:
                                        # Extract data from statement
                                        extraction_result = await self._process_statement_extraction(statement_data, override=override)
                                        if extraction_result:
                                            workflow_results["total_statements_processed"] += 1

                                            # Track if extraction was skipped
                                            if extraction_result.get("skipped"):
                                                workflow_results["total_statements_skipped"] = workflow_results.get("total_statements_skipped", 0) + 1
                                                logger.info(f"Skipped extraction for {statement_data['normalized_filename']}", extra=self._log_extra())

                                            # Upload unlocked statement to cloud storage (only if not skipped)
                                            cloud_path = None
                                            if not extraction_result.get("skipped"):
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
                                                "pdf_cloud_path": cloud_path if not extraction_result.get("skipped") else "skipped",
                                                "csv_cloud_path": extraction_result.get("csv_cloud_path"),
                                                "extraction_success": True,
                                                "extraction_skipped": extraction_result.get("skipped", False),
                                                "standardization_success": len(standardized_data) > 0 if standardized_data else False
                                            })

                                            # Update last_statement_date and last_processed_at for this account
                                            try:
                                                account = await AccountOperations.get_account_by_statement_sender(
                                                    statement_data["sender_email"]
                                                )
                                                if account:
                                                    stmt_month = self._get_previous_month_folder(statement_data["email_date"])
                                                    year_num = int(stmt_month[:4])
                                                    month_num = int(stmt_month[5:])
                                                    last_day = calendar.monthrange(year_num, month_num)[1]
                                                    last_day_date = date(year_num, month_num, last_day)
                                                    await AccountOperations.update_last_statement_date(str(account["id"]), last_day_date)
                                                    await AccountOperations.update_last_processed_at(str(account["id"]))
                                                    logger.info(
                                                        f"Updated account {account.get('nickname', statement_data['sender_email'])}: "
                                                        f"last_statement_date={last_day_date.isoformat()}"
                                                    )
                                                else:
                                                    logger.warning(f"Could not find account for sender {statement_data['sender_email']} — skipping date update", extra=self._log_extra())
                                            except Exception as e:
                                                logger.warning(f"Failed to update account dates for {statement_data['sender_email']}: {e}", extra=self._log_extra())
                                        else:
                                            workflow_results["errors"].append(f"Failed to extract data from {statement_data['normalized_filename']}")

                                    except Exception as e:
                                        error_msg = f"Error processing statement {statement_data.get('normalized_filename', 'unknown')}: {e}"
                                        logger.error(error_msg, exc_info=True, extra=self._log_extra())
                                        workflow_results["errors"].append(error_msg)

                            except Exception as e:
                                error_msg = f"Error processing sender {sender_email}: {e}"
                                logger.error(error_msg, exc_info=True, extra=self._log_extra())
                                workflow_results["errors"].append(error_msg)

            # Step 5: Splitwise sync
            if include_splitwise:
                logger.info("Step 5: Processing Splitwise data", extra=self._log_extra())
                splitwise_result = await self._process_splitwise_data(
                    continue_on_error=True,
                    custom_start_date=custom_splitwise_start_date,
                    custom_end_date=custom_splitwise_end_date
                )
                if splitwise_result:
                    workflow_results["splitwise_processed"] = True
                    workflow_results["splitwise_cloud_path"] = splitwise_result.get("cloud_path")
                    workflow_results["splitwise_transaction_count"] = splitwise_result.get("transaction_count")
                    logger.info(f"Processed {splitwise_result.get('transaction_count')} Splitwise transactions", extra=self._log_extra())
                else:
                    workflow_results["splitwise_processed"] = False
                    logger.warning("Splitwise processing failed or no data found", extra=self._log_extra())
            
            # Steps 6-8: Standardize, dedup, and insert (runs if any data was collected)
            if include_statement or include_splitwise:
                logger.info("Step 6: Standardizing and combining all transaction data", extra=self._log_extra())
                combined_data = await self._standardize_and_combine_all_data()
                if combined_data:
                    workflow_results["combined_transaction_count"] = len(combined_data)
                    workflow_results["all_standardized_data"] = combined_data
                    logger.info(f"Combined and standardized {len(combined_data)} total transactions", extra=self._log_extra())

                    # Step 7: Deduplication pass — match statement transactions against email-ingested ones
                    logger.info("Step 7: Running dedup pass for statement transactions", extra=self._log_extra())
                    self._emit(
                        "dedup_started", "dedup",
                        f"Checking {len(combined_data)} transaction(s) for email-alert duplicates",
                    )
                    combined_data, dedup_stats = await self._run_dedup_pass(combined_data)
                    workflow_results["dedup_confirmed"] = dedup_stats["confirmed"]
                    workflow_results["dedup_review_queued"] = dedup_stats["review_queued"]
                    workflow_results["dedup_insert_ready"] = dedup_stats["insert_ready"]
                    if dedup_stats["confirmed"] > 0 or dedup_stats["review_queued"] > 0:
                        self._emit(
                            "dedup_complete", "dedup",
                            (
                                f"Dedup complete: {dedup_stats['confirmed']} confirmed via email alerts, "
                                f"{dedup_stats['review_queued']} sent to review queue, "
                                f"{dedup_stats['insert_ready']} ready for insert"
                            ),
                            level="success",
                            data=dedup_stats,
                        )
                    else:
                        self._emit(
                            "dedup_complete", "dedup",
                            "Dedup complete: no email-alert matches found, all transactions will be inserted normally",
                            data=dedup_stats,
                        )

                    # Step 8: Store data in database
                    logger.info("Step 8: Storing transactions in database", extra=self._log_extra())
                    self._emit(
                        "db_insert_started", "db_insert",
                        f"Inserting {len(combined_data)} transaction(s) into the database",
                        data={"transaction_count": len(combined_data)},
                    )
                    db_result = await TransactionOperations.bulk_insert_transactions(
                        combined_data,
                        check_duplicates=True,
                        upsert_splitwise=True  # Update existing Splitwise transactions with latest data
                    )

                    if db_result.get("success"):
                        workflow_results["database_inserted_count"] = db_result.get("inserted_count", 0)
                        workflow_results["database_updated_count"] = db_result.get("updated_count", 0)
                        workflow_results["database_skipped_count"] = db_result.get("skipped_count", 0)
                        workflow_results["database_error_count"] = db_result.get("error_count", 0)
                        logger.info(f"Database storage: {db_result.get('inserted_count', 0)} inserted, "
                                   f"{db_result.get('updated_count', 0)} updated, "
                                   f"{db_result.get('skipped_count', 0)} skipped, "
                                   f"{db_result.get('error_count', 0)} errors")
                        # Mark statements as db_inserted only if standardization actually produced data.
                        # Extraction-skipped statements (already done) and failed extractions (no CSV)
                        # must not be stamped db_inserted — they need to remain retryable.
                        for stmt in workflow_results.get("processed_statements", []):
                            if not stmt.get("extraction_skipped") and stmt.get("standardization_success"):
                                stmt_log_key = stmt["filename"].replace("_locked.pdf", "")
                                try:
                                    await StatementLogOperations.update_status(
                                        stmt_log_key, "db_inserted", job_id=self.job_id
                                    )
                                except Exception:
                                    logger.warning(f"Failed to mark {stmt_log_key} as db_inserted", exc_info=True, extra=self._log_extra())
                        self._emit(
                            "db_insert_complete", "db_insert",
                            (
                                f"DB insert complete: {db_result.get('inserted_count', 0)} inserted, "
                                f"{db_result.get('updated_count', 0)} updated, "
                                f"{db_result.get('skipped_count', 0)} skipped"
                            ),
                            level="success",
                            data={
                                "inserted": db_result.get("inserted_count", 0),
                                "updated": db_result.get("updated_count", 0),
                                "skipped": db_result.get("skipped_count", 0),
                                "errors": db_result.get("error_count", 0),
                                "splitwise_upsert_updates": db_result.get("splitwise_upsert_updates") or [],
                            },
                        )
                    else:
                        workflow_results["database_errors"] = db_result.get("errors", [])
                        logger.error(f"Database storage failed: {db_result.get('errors', [])}", exc_info=True, extra=self._log_extra())
                        self._emit(
                            "db_insert_complete", "db_insert",
                            f"DB insert failed: {db_result.get('errors', [])}",
                            level="error",
                            data={"errors": db_result.get("errors", [])},
                        )
                else:
                    logger.warning("No combined transaction data generated", extra=self._log_extra())
            
            logger.info("Complete statement processing workflow finished", extra=self._log_extra())
            
            skipped_count = workflow_results.get('total_statements_skipped', 0)
            logger.info(f"Results: {workflow_results['total_statements_downloaded']} downloaded, "
                       f"{workflow_results['total_statements_uploaded']} uploaded, "
                       f"{workflow_results['total_statements_processed']} processed, "
                       f"{skipped_count} skipped (already extracted), "
                       f"{workflow_results.get('splitwise_transaction_count', 0)} Splitwise transactions, "
                       f"{workflow_results.get('combined_transaction_count', 0)} total combined transactions, "
                       f"{workflow_results.get('database_inserted_count', 0)} inserted to database, "
                       f"{workflow_results.get('database_skipped_count', 0)} skipped (duplicates)")
            logger.info(f"Temp directory used: {workflow_results['temp_directory']}", extra=self._log_extra())
            self._emit(
                "workflow_complete", "workflow",
                (
                    f"Workflow complete — {workflow_results.get('database_inserted_count', 0)} inserted, "
                    f"{workflow_results.get('database_updated_count', 0)} updated, "
                    f"{workflow_results.get('database_skipped_count', 0)} skipped"
                ),
                level="success",
                data={
                    "statements_downloaded": workflow_results["total_statements_downloaded"],
                    "statements_processed": workflow_results["total_statements_processed"],
                    "splitwise_transactions": workflow_results.get("splitwise_transaction_count", 0),
                    "db_inserted": workflow_results.get("database_inserted_count", 0),
                    "db_updated": workflow_results.get("database_updated_count", 0),
                    "db_skipped": workflow_results.get("database_skipped_count", 0),
                    "errors": workflow_results["errors"],
                },
            )
            
            return workflow_results
            
        except Exception as e:
            error_msg = f"Critical error in workflow: {e}"
            logger.error(error_msg, exc_info=True, extra=self._log_extra())
            workflow_results["errors"].append(error_msg)
            self._emit(
                "workflow_error", "workflow",
                f"Critical workflow error: {e}",
                level="error",
                data={"error": str(e)},
            )
            return workflow_results
        
        finally:
            # Cleanup temp directory
            try:
                shutil.rmtree(self.temp_dir)
                logger.info(f"Cleaned up temp directory: {self.temp_dir}", extra=self._log_extra())
            except Exception as e:
                logger.warning(f"Failed to cleanup temp directory: {e}", extra=self._log_extra())
    
    async def _run_dedup_pass(
        self, combined_data: List[Dict[str, Any]]
    ) -> tuple[List[Dict[str, Any]], Dict[str, int]]:
        """Run deduplication on statement transactions before DB insertion.

        For each non-Splitwise transaction, checks if a matching email-ingested
        transaction already exists.  Confirmed matches are skipped (the email
        transaction is marked statement-confirmed).  Ambiguous matches and
        unmatched transactions from alert-enabled accounts go to the review
        queue.  Unmatched transactions from non-alert accounts pass through
        for normal insertion.

        Returns:
            A tuple of (filtered_data, stats_dict) where *filtered_data* is
            the list of transactions that should still be bulk-inserted.
        """
        dedup_svc = DeduplicationService()
        stats = {"confirmed": 0, "review_queued": 0, "insert_ready": 0, "splitwise_passthrough": 0}

        # Build a cache: account nickname -> bool(has alert_sender)
        try:
            all_accounts = await AccountOperations.get_all_accounts()
            alert_sender_cache: Dict[str, bool] = {
                acct["nickname"]: bool(acct.get("alert_sender"))
                for acct in all_accounts
            }
        except Exception:
            logger.warning(
                "Failed to load accounts for dedup — skipping dedup pass",
                exc_info=True, extra=self._log_extra(),
            )
            stats["insert_ready"] = len(combined_data)
            return combined_data, stats

        filtered: List[Dict[str, Any]] = []

        for tx in combined_data:
            account_name = tx.get("account", "")

            # Splitwise transactions bypass dedup entirely
            if account_name.lower() == "splitwise":
                filtered.append(tx)
                stats["splitwise_passthrough"] += 1
                continue

            has_alert = alert_sender_cache.get(account_name, False)

            try:
                result = await dedup_svc.match_statement_transaction(tx, has_alert_sender=has_alert)
            except Exception:
                logger.warning(
                    "Dedup failed for tx %s / %s — inserting normally",
                    account_name, tx.get("reference_number"),
                    exc_info=True, extra=self._log_extra(),
                )
                filtered.append(tx)
                stats["insert_ready"] += 1
                continue

            if result.is_confirmed:
                logger.info(
                    "Dedup: confirmed match (tier %s) for %s ref=%s -> email tx %s",
                    result.tier, account_name, tx.get("reference_number"), result.matched_id,
                    extra=self._log_extra(),
                )
                stats["confirmed"] += 1
                # Skip insertion — the email-ingested transaction is already in DB

            elif result.is_ambiguous:
                logger.info(
                    "Dedup: ambiguous match for %s ref=%s — sending to review queue",
                    account_name, tx.get("reference_number"), extra=self._log_extra(),
                )
                try:
                    await ReviewQueueOperations.add_item(
                        review_type="ambiguous",
                        transaction_date=tx["transaction_date"],
                        amount=tx["amount"],
                        description=tx.get("description", ""),
                        account=account_name,
                        direction=tx.get("direction", "debit"),
                        transaction_type=tx.get("transaction_type", ""),
                        reference_number=tx.get("reference_number"),
                        raw_data=tx,
                        ambiguous_candidate_ids=result.candidate_ids,
                    )
                except Exception:
                    logger.warning(
                        "Failed to add ambiguous tx to review queue — inserting normally",
                        exc_info=True, extra=self._log_extra(),
                    )
                    filtered.append(tx)
                    stats["insert_ready"] += 1
                    continue
                stats["review_queued"] += 1

            elif has_alert:
                # Unmatched but account has alert_sender — send to review queue
                logger.info(
                    "Dedup: unmatched tx for alert-enabled account %s — sending to review queue",
                    account_name, extra=self._log_extra(),
                )
                try:
                    await ReviewQueueOperations.add_item(
                        review_type="statement_only",
                        transaction_date=tx["transaction_date"],
                        amount=tx["amount"],
                        description=tx.get("description", ""),
                        account=account_name,
                        direction=tx.get("direction", "debit"),
                        transaction_type=tx.get("transaction_type", ""),
                        reference_number=tx.get("reference_number"),
                        raw_data=tx,
                    )
                except Exception:
                    logger.warning(
                        "Failed to add statement-only tx to review queue — inserting normally",
                        exc_info=True, extra=self._log_extra(),
                    )
                    filtered.append(tx)
                    stats["insert_ready"] += 1
                    continue
                stats["review_queued"] += 1

            else:
                # Unmatched, no alert sender — insert normally
                filtered.append(tx)
                stats["insert_ready"] += 1

        logger.info(
            "Dedup pass complete: %d confirmed, %d review-queued, %d insert-ready, %d splitwise",
            stats["confirmed"], stats["review_queued"], stats["insert_ready"], stats["splitwise_passthrough"],
            extra=self._log_extra(),
        )
        return filtered, stats

    async def _standardize_and_combine_all_data(self) -> List[Dict[str, Any]]:
        """Delegate to DataStandardizerHelper."""
        return await self._data_standardizer_helper.process(
            override=getattr(self, "override", False),
            job_id=self.job_id,
        )
    
    async def _remove_duplicate_transactions(self, transactions: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Remove duplicate transactions using composite key"""
        try:
            seen_transactions = set()
            unique_transactions = []
            
            for transaction in transactions:
                # Create composite key
                composite_key = (
                    transaction.get('transaction_date', ''),
                    round(float(transaction.get('amount', 0)), 2),
                    transaction.get('account', ''),
                    transaction.get('description', '').lower().strip(),
                    transaction.get('source_file', ''),
                    str(transaction.get('raw_data', ''))
                )
                
                if composite_key not in seen_transactions:
                    seen_transactions.add(composite_key)
                    unique_transactions.append(transaction)
            
            logger.info(f"Deduplication: {len(transactions)} -> {len(unique_transactions)} transactions", extra=self._log_extra())
            return unique_transactions
            
        except Exception:
            logger.error("Error removing duplicate transactions", exc_info=True, extra=self._log_extra())
            return transactions
    
    async def _sort_transactions_by_date(self, transactions: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Sort transactions by date in chronological order (oldest first)"""
        try:
            if not transactions:
                return transactions
            
            # Sort by transaction_date (chronological order - oldest first)
            def sort_key(x):
                date_val = x.get('transaction_date')
                time_val = x.get('transaction_time') or '00:00:00'
                
                # Handle different date types
                if pd.isna(date_val) or date_val is None:
                    return ('9999-12-31', time_val)
                elif hasattr(date_val, 'date'):  # pandas Timestamp
                    return (date_val.date().isoformat(), time_val)
                elif isinstance(date_val, str):
                    return (date_val, time_val)
                elif hasattr(date_val, 'isoformat'):  # datetime.date object
                    return (date_val.isoformat(), time_val)
                else:
                    # Fallback for any other type
                    return ('9999-12-31', time_val)
            
            sorted_transactions = sorted(transactions, key=sort_key)
            
            logger.info(f"Sorted {len(sorted_transactions)} transactions by date", extra=self._log_extra())
            return sorted_transactions
            
        except Exception:
            logger.error("Error sorting transactions by date", exc_info=True, extra=self._log_extra())
            return transactions
    
    async def check_cloud_csvs_exist(self) -> bool:
        """Check if CSV files exist in cloud storage for the current processing month"""
        try:
            # Calculate date range for previous month
            start_date, end_date = self._calculate_splitwise_date_range()
            previous_month = start_date.strftime("%Y-%m")
            
            # List all CSV files in the extracted_data directory for the month
            cloud_csv_files = self.cloud_storage.list_files(f"{previous_month}/extracted_data/")
            
            if not cloud_csv_files:
                logger.info(f"No CSV files found in cloud storage for {previous_month}", extra=self._log_extra())
                return False
            
            # Filter for CSV files
            csv_files = [f for f in cloud_csv_files if f.get("name", "").endswith('.csv')]
            
            if csv_files:
                logger.info(f"Found {len(csv_files)} CSV files in cloud storage for {previous_month}", extra=self._log_extra())
                return True
            else:
                logger.info(f"No CSV files found in cloud storage for {previous_month}", extra=self._log_extra())
                return False
                
        except Exception:
            logger.error("Error checking cloud CSV files", exc_info=True, extra=self._log_extra())
            return False
    
    async def check_statement_already_extracted(self, statement_data: Dict[str, Any]) -> bool:
        """Check if we already have extracted CSV data for this specific statement"""
        try:
            sender_email = statement_data["sender_email"]
            email_date = statement_data["email_date"]
            normalized_filename = statement_data["normalized_filename"]
            
            
            # Get account nickname to determine expected CSV filename pattern
            account_nickname = await AccountOperations.get_account_nickname_by_sender(sender_email)
            if not account_nickname:
                logger.warning(f"No account nickname found for sender: {sender_email}", extra=self._log_extra())
                return False
            
            # Generate expected CSV filename pattern (matches document_extractor: {account}_{date}.csv)
            nickname_clean = nickname_to_filename_prefix(account_nickname)
            
            # Extract date from normalized filename or use email date
            date_str = self._extract_date_from_filename(normalized_filename) or self._extract_date_from_email_date(email_date)
            # Match {account}_{date}.csv or legacy {account}_{date}_extracted.csv
            expected_prefix = f"{nickname_clean}_{date_str}"
            
            # Calculate the month directory for cloud storage (use previous month logic)
            start_date, end_date = self._calculate_splitwise_date_range()
            month_dir = start_date.strftime("%Y-%m")
            
            # List CSV files in the month directory
            cloud_csv_files = self.cloud_storage.list_files(f"{month_dir}/extracted_data/")
            
            if not cloud_csv_files:
                logger.info(f"No CSV files found in cloud storage for {month_dir}", extra=self._log_extra())
                return False
            
            # Check if any CSV file matches our expected pattern
            for cloud_file_info in cloud_csv_files:
                cloud_filename = cloud_file_info.get("name", "")
                if not cloud_filename.endswith('.csv'):
                    continue
                stem = Path(cloud_filename).stem
                if stem == expected_prefix:
                    logger.info(f"Found existing extracted data for {normalized_filename}: {cloud_filename}", extra=self._log_extra())
                    return True
            
            logger.info(f"No existing extracted data found for {normalized_filename}", extra=self._log_extra())
            return False
            
        except Exception:
            logger.error("Error checking if statement already extracted", exc_info=True, extra=self._log_extra())
            return False
    
    def _extract_date_from_filename(self, filename: str) -> Optional[str]:
        """Extract date from filename in YYYYMMDD format"""
        try:
            # Pattern for YYYYMMDD
            date_pattern = r'(\d{8})'
            match = re.search(date_pattern, filename)
            if match:
                return match.group(1)
            
            # Pattern for YYYY-MM-DD
            date_pattern = r'(\d{4}-\d{2}-\d{2})'
            match = re.search(date_pattern, filename)
            if match:
                return match.group(1).replace("-", "")
            
            return None
            
        except Exception as e:
            logger.warning(f"Error extracting date from filename {filename}: {e}", extra=self._log_extra())
            return None
    
    def _parse_email_date(self, email_date: str) -> datetime:
        """Parse email date string to datetime object"""
        try:
            # Try different email date formats
            email_date_formats = [
                "%Y-%m-%d",                    # 2025-09-03
                "%a, %d %b %Y %H:%M:%S %z",   # Wed, 03 Sep 2025 06:48:41 +0530
                "%a, %d %b %Y %H:%M:%S",       # Wed, 03 Sep 2025 06:48:41
                "%d %b %Y %H:%M:%S %z",        # 03 Sep 2025 06:48:41 +0530
                "%d %b %Y %H:%M:%S",           # 03 Sep 2025 06:48:41
            ]
            
            for fmt in email_date_formats:
                try:
                    return datetime.strptime(email_date, fmt)
                except ValueError:
                    continue
            
            # If all formats fail, try to extract just the date part
            date_match = re.search(r'(\d{4}-\d{2}-\d{2})', email_date)
            if date_match:
                return datetime.strptime(date_match.group(1), "%Y-%m-%d")
            
            # Fallback to current date
            logger.warning(f"Could not parse email date: {email_date}, using current date", extra=self._log_extra())
            return datetime.now()
            
        except Exception:
            logger.error(f"Error parsing email date {email_date}", exc_info=True, extra=self._log_extra())
            return datetime.now()
    
    def _extract_date_from_email_date(self, email_date: str) -> str:
        """Extract date string in YYYYMMDD format from email date"""
        try:
            email_datetime = self._parse_email_date(email_date)
            return email_datetime.strftime("%Y%m%d")
        except Exception as e:
            logger.warning(f"Error extracting date from email date {email_date}: {e}", extra=self._log_extra())
            return datetime.now().strftime("%Y%m%d")
    
    async def run_resume_workflow(self) -> Dict[str, Any]:
        """Run workflow resuming from standardization step (skip document extraction)"""
        logger.info("Starting resume workflow - skipping document extraction", extra=self._log_extra())
        return await self.run_complete_workflow(resume_from_standardization=True)

    async def run_splitwise_only_workflow(
        self,
        custom_start_date: Optional[datetime] = None,
        custom_end_date: Optional[datetime] = None,
        job_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Run Splitwise-only workflow: fetch → GCS → standardize → DB insert."""
        logger.info("Starting Splitwise-only workflow", extra=self._log_extra())
        self._emit(
            "workflow_started", "workflow",
            "Starting Splitwise-only workflow",
            data={"mode": "splitwise_only"},
        )
        workflow_results: Dict[str, Any] = {
            "splitwise_processed": False,
            "splitwise_cloud_path": None,
            "splitwise_transaction_count": 0,
            "combined_transaction_count": 0,
            "database_inserted_count": 0,
            "database_updated_count": 0,
            "database_skipped_count": 0,
            "database_error_count": 0,
            "database_errors": [],
            "errors": [],
        }
        try:
            splitwise_result = await self._process_splitwise_data(
                continue_on_error=False,
                custom_start_date=custom_start_date,
                custom_end_date=custom_end_date,
            )
            if not splitwise_result:
                workflow_results["errors"].append("Splitwise processing returned no data")
                self._emit(
                    "workflow_error", "workflow",
                    "Splitwise-only workflow failed — no Splitwise data returned",
                    level="error",
                    data={"error": "No Splitwise data"},
                )
                return workflow_results

            workflow_results["splitwise_processed"] = True
            workflow_results["splitwise_cloud_path"] = splitwise_result.get("cloud_path")
            workflow_results["splitwise_transaction_count"] = splitwise_result.get("transaction_count", 0)

            # Standardize from GCS (reuses the same combine logic)
            combined_data = await self._standardize_and_combine_all_data()
            if combined_data:
                workflow_results["combined_transaction_count"] = len(combined_data)
                self._emit(
                    "db_insert_started", "db_insert",
                    f"Inserting {len(combined_data)} Splitwise transaction(s) into the database",
                    data={"transaction_count": len(combined_data)},
                )
                db_result = await TransactionOperations.bulk_insert_transactions(
                    combined_data,
                    check_duplicates=True,
                    upsert_splitwise=True,
                )
                if db_result.get("success"):
                    workflow_results["database_inserted_count"] = db_result.get("inserted_count", 0)
                    workflow_results["database_updated_count"] = db_result.get("updated_count", 0)
                    workflow_results["database_skipped_count"] = db_result.get("skipped_count", 0)
                    workflow_results["database_error_count"] = db_result.get("error_count", 0)
                    self._emit(
                        "db_insert_complete", "db_insert",
                        (
                            f"DB insert complete: {db_result.get('inserted_count', 0)} inserted, "
                            f"{db_result.get('updated_count', 0)} updated, "
                            f"{db_result.get('skipped_count', 0)} skipped"
                        ),
                        level="success",
                        data={
                            "inserted": db_result.get("inserted_count", 0),
                            "updated": db_result.get("updated_count", 0),
                            "skipped": db_result.get("skipped_count", 0),
                        },
                    )
                else:
                    workflow_results["database_errors"] = db_result.get("errors", [])

            self._emit(
                "workflow_complete", "workflow",
                (
                    f"Splitwise-only workflow complete — "
                    f"{workflow_results.get('database_inserted_count', 0)} inserted, "
                    f"{workflow_results.get('database_updated_count', 0)} updated"
                ),
                level="success",
                data={
                    "splitwise_transactions": workflow_results["splitwise_transaction_count"],
                    "db_inserted": workflow_results.get("database_inserted_count", 0),
                    "db_updated": workflow_results.get("database_updated_count", 0),
                    "db_skipped": workflow_results.get("database_skipped_count", 0),
                },
            )
        except Exception as e:
            error_msg = f"Critical error in Splitwise-only workflow: {e}"
            logger.error(error_msg, exc_info=True, extra=self._log_extra())
            workflow_results["errors"].append(error_msg)
            self._emit(
                "workflow_error", "workflow",
                f"Critical error in Splitwise-only workflow: {e}",
                level="error",
                data={"error": str(e)},
            )
        finally:
            try:
                shutil.rmtree(self.temp_dir)
                logger.info(f"Cleaned up temp directory: {self.temp_dir}", extra=self._log_extra())
            except Exception as e:
                logger.warning(f"Failed to cleanup temp directory: {e}", extra=self._log_extra())
        return workflow_results


# Convenience function for running the workflow
async def run_statement_workflow(
    account_ids: List[str] = None,
    enable_secondary_account: bool = None,
    custom_start_date: Optional[str] = None,
    custom_end_date: Optional[str] = None,
    custom_splitwise_start_date: Optional[datetime] = None,
    custom_splitwise_end_date: Optional[datetime] = None,
    event_callback: Optional[Callable[[dict], None]] = None,
    override: bool = False,
    job_id: Optional[str] = None,
) -> Dict[str, Any]:
    """Run the complete statement processing workflow."""
    workflow = StatementWorkflow(
        account_ids=account_ids,
        enable_secondary_account=enable_secondary_account,
        event_callback=event_callback,
    )
    return await workflow.run_complete_workflow(
        resume_from_standardization=False,
        custom_start_date=custom_start_date,
        custom_end_date=custom_end_date,
        custom_splitwise_start_date=custom_splitwise_start_date,
        custom_splitwise_end_date=custom_splitwise_end_date,
        override=override,
        job_id=job_id,
    )


# Convenience function for resuming the workflow
async def run_resume_workflow(
    account_ids: List[str] = None,
    enable_secondary_account: bool = None,
    custom_start_date: Optional[str] = None,
    custom_end_date: Optional[str] = None,
    custom_splitwise_start_date: Optional[datetime] = None,
    custom_splitwise_end_date: Optional[datetime] = None,
    event_callback: Optional[Callable[[dict], None]] = None,
    override: bool = False,
    job_id: Optional[str] = None,
) -> Dict[str, Any]:
    """Run workflow resuming from standardization step (skip document extraction)."""
    workflow = StatementWorkflow(
        account_ids=account_ids,
        enable_secondary_account=enable_secondary_account,
        event_callback=event_callback,
    )
    return await workflow.run_complete_workflow(
        resume_from_standardization=True,
        custom_start_date=custom_start_date,
        custom_end_date=custom_end_date,
        custom_splitwise_start_date=custom_splitwise_start_date,
        custom_splitwise_end_date=custom_splitwise_end_date,
        override=override,
        job_id=job_id,
    )


# Convenience function to check if resume is possible
async def can_resume_workflow(
    account_ids: List[str] = None,
    enable_secondary_account: bool = None,
    custom_start_date: Optional[str] = None,
    custom_end_date: Optional[str] = None,
) -> bool:
    """
    Check if workflow can be resumed (CSVs exist in cloud storage).

    Note: custom_start_date/custom_end_date are accepted for CLI compatibility
    but are not currently used in the resume-check logic, since cloud layout
    is organized by month.
    """
    workflow = StatementWorkflow(
        account_ids=account_ids,
        enable_secondary_account=enable_secondary_account,
    )
    return await workflow.check_cloud_csvs_exist()
