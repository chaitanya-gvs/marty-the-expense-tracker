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
import json
import os
import re
import shutil
import tempfile
from datetime import datetime, timedelta
from pathlib import Path
from typing import Callable, Dict, List, Optional, Any

import pandas as pd
from googleapiclient.discovery import build

from src.services.database_manager.operations import AccountOperations, TransactionOperations
from src.services.email_ingestion.client import EmailClient
from src.services.email_ingestion.token_manager import TokenManager
from src.services.cloud_storage.gcs_service import GoogleCloudStorageService
from src.services.statement_processor.document_extractor import DocumentExtractor
from .transaction_standardizer import TransactionStandardizer
from src.services.statement_processor.pdf_unlocker import PDFUnlocker
from src.services.splitwise_processor.service import SplitwiseService
from src.utils.logger import get_logger
from src.utils.password_manager import BankPasswordManager

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
        logger.info(f"Created temp directory: {self.temp_dir}")
        logger.info(f"Initialized email clients for accounts: {self.account_ids}")
        logger.info(f"Secondary account enabled: {self.enable_secondary_account}")
    
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
        logger.info("Refreshing Gmail tokens for all accounts...")
        self._emit("token_refresh_started", "token_refresh", f"Refreshing Gmail tokens for accounts: {', '.join(self.account_ids)}")
        all_success = True
        for account_id in self.account_ids:
            try:
                token_manager = TokenManager(account_id)
                credentials = token_manager.get_valid_credentials()
                if credentials:
                    logger.info(f"Successfully refreshed token for {account_id} account")
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
                    logger.warning(f"Failed to refresh token for {account_id} account")
                    self._emit(
                        "token_refresh_failed", "token_refresh",
                        f"Failed to refresh token for {account_id} account",
                        account=account_id, level="warning",
                    )
                    all_success = False
            except Exception as e:
                logger.error(f"Error refreshing token for {account_id} account", exc_info=True)
                self._emit(
                    "token_refresh_failed", "token_refresh",
                    f"Error refreshing token for {account_id}: {e}",
                    account=account_id, level="error",
                )
                all_success = False

        if all_success:
            logger.info("All tokens refreshed successfully")
        else:
            logger.warning("Some tokens failed to refresh - workflow may encounter authentication errors")

        return all_success
    
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
        
        logger.info(f"Splitwise date range: {start_date.strftime('%Y-%m-%d')} to {end_date.strftime('%Y-%m-%d')}")
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
            
        except Exception:
            logger.error(f"Error parsing email date {email_date}", exc_info=True)
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
        self._emit(
            "email_search_started", "email_search",
            f"Searching for statements from {sender_email} ({start_date} → {end_date})",
            data={"sender": sender_email, "start_date": start_date, "end_date": end_date},
        )
        
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
                                
                                self._emit(
                                    "pdf_download_started", "pdf_download",
                                    f"Downloading attachment: {original_filename}",
                                    data={"filename": original_filename, "subject": subject},
                                )
                                
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
                                
                                file_size = temp_file_path.stat().st_size
                                logger.info(f"Downloaded from {account_id}: {normalized_filename}")
                                self._emit(
                                    "pdf_downloaded", "pdf_download",
                                    f"Downloaded {normalized_filename} ({file_size // 1024} KB)",
                                    account=account_id, level="success",
                                    data={"filename": normalized_filename, "file_size_bytes": file_size},
                                )
                                
                                all_downloaded_statements.append({
                                    "sender_email": sender_email,
                                    "email_date": email_date,
                                    "email_subject": subject,
                                    "original_filename": original_filename,
                                    "normalized_filename": normalized_filename,
                                    "temp_file_path": str(temp_file_path),
                                    "file_size": file_size,
                                    "source_account": account_id
                                })
                                
                            except Exception as e:
                                logger.error(f"Error downloading attachment {attachment.get('filename')} from {account_id}", exc_info=True)
                                self._emit(
                                    "pdf_download_failed", "pdf_download",
                                    f"Failed to download {attachment.get('filename')}: {e}",
                                    account=account_id, level="error",
                                    data={"filename": attachment.get("filename"), "error": str(e)},
                                )
                                continue
                    
                    except Exception:
                        logger.error(f"Error processing email {email_data.get('id')} from {account_id}", exc_info=True)
                        continue
            
            except Exception as e:
                logger.error(f"Error searching in {account_id} account for {sender_email}", exc_info=True)
                self._emit(
                    "email_search_failed", "email_search",
                    f"Error searching {account_id} account for {sender_email}: {e}",
                    account=account_id, level="error",
                    data={"sender": sender_email, "error": str(e)},
                )
                continue
        
        logger.info(f"Total statements downloaded for {sender_email}: {len(all_downloaded_statements)}")

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

    async def _unlock_pdf_async(self, pdf_path: Path, sender_email: str) -> Dict[str, Any]:
        """Async version of PDF unlocking that uses async password lookup"""
        try:
            # Ensure pdf_path is a Path object
            pdf_path = Path(pdf_path)
            logger.info(f"Unlocking PDF: {pdf_path.name}")
            
            # Get password using async method
            password = await self.password_manager.get_password_for_sender_async(sender_email)
            if not password:
                return {
                    "success": False,
                    "error": f"No password found for sender: {sender_email}"
                }
            
            logger.info("Password found")
            
            # Use the existing PDF unlocker with the password
            unlock_result = self.pdf_unlocker.unlock_pdf_with_password(pdf_path, password)
            return unlock_result
            
        except Exception as e:
            logger.error(f"Error unlocking PDF {pdf_path}", exc_info=True)
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
                logger.warning(f"No account nickname found, using fallback: {account_nickname}")
            
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
            
        except Exception:
            logger.error("Error generating normalized filename", exc_info=True)
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

            unlocked_filename = normalized_filename.replace("_locked.pdf", "_unlocked.pdf")
            statement_month = self._get_previous_month_folder(email_date)
            prefix = f"{statement_month}/unlocked_statements/"

            cloud_files = self.cloud_storage.list_files(prefix)
            for file_info in (cloud_files or []):
                cloud_name = file_info.get("name", "")
                if cloud_name.endswith(unlocked_filename) or unlocked_filename in cloud_name:
                    logger.info(f"Found existing unlocked PDF in GCS: {cloud_name}")
                    return cloud_name
            return None
        except Exception:
            logger.error("Error checking unlocked PDF in GCS", exc_info=True)
            return None

    async def _process_statement_extraction(self, statement_data: Dict[str, Any], override: bool = False) -> Optional[Dict[str, Any]]:
        """
        Process statement for data extraction and unlock PDF.

        3-tier skip logic (applied when override=False):
          Tier 1 — CSV already in GCS?       → skip everything
          Tier 2 — Unlocked PDF already in GCS? → download it, skip local unlock, run extraction
          Tier 3 — Neither                    → full path: unlock locally, extract, upload both
        When override=True all tiers are bypassed and the full path is always taken.
        """
        try:
            temp_file_path = statement_data["temp_file_path"]
            normalized_filename = statement_data["normalized_filename"]
            sender_email = statement_data["sender_email"]

            # Get account nickname from database
            account_nickname = await AccountOperations.get_account_nickname_by_sender(sender_email)
            if not account_nickname:
                logger.error(f"No account nickname found for sender: {sender_email}", exc_info=True)
                self._emit(
                    "extraction_failed", "extraction",
                    f"No account nickname found for sender {sender_email}",
                    level="error",
                    data={"filename": normalized_filename, "sender": sender_email},
                )
                return None

            unlocked_path = None

            if not override:
                # Tier 1: CSV already extracted in GCS?
                already_extracted = await self.check_statement_already_extracted(statement_data)
                if already_extracted:
                    logger.info(f"Skipping extraction for {normalized_filename} - data already exists in cloud storage")
                    self._emit(
                        "extraction_skipped", "extraction",
                        f"Skipping {normalized_filename} — already extracted in GCS",
                        level="info",
                        data={"filename": normalized_filename, "account": account_nickname},
                    )
                    return {
                        "success": True,
                        "skipped": True,
                        "reason": "Data already extracted",
                        "extraction_schema": "skipped",
                        "csv_cloud_path": "already_exists",
                    }

                # Tier 2: Unlocked PDF already in GCS?
                unlocked_gcs_path = await self._check_unlocked_pdf_in_gcs(statement_data)
                if unlocked_gcs_path:
                    unlocked_filename = normalized_filename.replace("_locked.pdf", "_unlocked.pdf")
                    temp_unlocked = self.temp_dir / unlocked_filename
                    download_result = self.cloud_storage.download_file(unlocked_gcs_path, str(temp_unlocked))
                    if download_result.get("success"):
                        unlocked_path = str(temp_unlocked)
                        logger.info(f"Resuming extraction from existing GCS unlocked PDF: {unlocked_gcs_path}")
                        self._emit(
                            "pdf_resume_from_gcs", "pdf_unlock",
                            f"Using existing unlocked PDF from GCS for {normalized_filename}",
                            level="info",
                            data={"filename": normalized_filename, "account": account_nickname, "gcs_path": unlocked_gcs_path},
                        )
                    else:
                        logger.warning(f"Failed to download unlocked PDF from GCS ({unlocked_gcs_path}), falling back to local unlock")

            # Tier 3 (or override, or Tier 2 download failed): unlock locally
            if unlocked_path is None:
                self._emit(
                    "pdf_unlock_started", "pdf_unlock",
                    f"Unlocking {normalized_filename}",
                    data={"filename": normalized_filename, "account": account_nickname},
                )
                unlock_result = await self._unlock_pdf_async(temp_file_path, sender_email)
                if not unlock_result.get("success"):
                    logger.warning(f"Could not unlock PDF: {normalized_filename}")
                    self._emit(
                        "pdf_unlock_failed", "pdf_unlock",
                        f"Could not unlock {normalized_filename}: {unlock_result.get('error', 'unknown error')}",
                        level="warning",
                        data={"filename": normalized_filename, "error": unlock_result.get("error")},
                    )
                    unlocked_path = temp_file_path
                else:
                    unlocked_path = unlock_result.get("unlocked_path")
                    logger.info(f"Successfully unlocked PDF: {normalized_filename}")
                    self._emit(
                        "pdf_unlocked", "pdf_unlock",
                        f"Unlocked {normalized_filename}",
                        level="success",
                        data={"filename": normalized_filename, "account": account_nickname},
                    )

            # Extract data from unlocked PDF
            self._emit(
                "extraction_started", "extraction",
                f"Extracting transactions from {normalized_filename} ({account_nickname})",
                data={"filename": normalized_filename, "account": account_nickname},
            )
            extraction_result = self.document_extractor.extract_from_pdf(
                pdf_path=unlocked_path,
                account_nickname=account_nickname,
                save_results=True,
                email_date=statement_data.get("email_date")
            )

            # Clean up local CSV file after successful cloud upload
            if extraction_result.get("success") and extraction_result.get("csv_file"):
                try:
                    csv_file_path = Path(extraction_result["csv_file"])
                    if csv_file_path.exists():
                        csv_file_path.unlink()
                        logger.info(f"Cleaned up local CSV file: {csv_file_path.name}")
                except Exception as e:
                    logger.warning(f"Failed to clean up local CSV file: {e}")

            if extraction_result.get("success"):
                logger.info(f"Extracted data from: {normalized_filename}")
                self._emit(
                    "extraction_complete", "extraction",
                    f"Extracted data from {normalized_filename}",
                    level="success",
                    data={
                        "filename": normalized_filename,
                        "account": account_nickname,
                        "csv_cloud_path": extraction_result.get("csv_cloud_path"),
                    },
                )
                return extraction_result
            else:
                logger.error(f"Failed to extract data from: {normalized_filename}", exc_info=True)
                self._emit(
                    "extraction_failed", "extraction",
                    f"Failed to extract data from {normalized_filename}",
                    level="error",
                    data={"filename": normalized_filename, "account": account_nickname},
                )
                return None

        except Exception as e:
            logger.error("Error processing statement extraction", exc_info=True)
            self._emit(
                "extraction_failed", "extraction",
                f"Unexpected error extracting {statement_data.get('normalized_filename', 'unknown')}: {e}",
                level="error",
                data={"filename": statement_data.get("normalized_filename"), "error": str(e)},
            )
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
                logger.info(f"☁Uploaded unlocked statement to cloud: {cloud_path}")
                self._emit(
                    "gcs_uploaded", "gcs_upload",
                    f"Uploaded unlocked PDF to GCS: {cloud_path}",
                    level="success",
                    data={"filename": unlocked_filename, "cloud_path": cloud_path},
                )
                return cloud_path
            else:
                logger.error(f"Failed to upload unlocked statement to cloud: {upload_result.get('error')}", exc_info=True)
                self._emit(
                    "gcs_upload_failed", "gcs_upload",
                    f"Failed to upload {unlocked_filename} to GCS: {upload_result.get('error')}",
                    level="error",
                    data={"filename": unlocked_filename, "error": upload_result.get("error")},
                )
                return None
                
        except Exception as e:
            logger.error("Error uploading unlocked statement to cloud storage", exc_info=True)
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
        custom_end_date: Optional[datetime] = None
    ) -> Optional[Dict[str, Any]]:
        """Process Splitwise data and upload to cloud storage"""
        try:
            logger.info("Processing Splitwise data")
            
            # Calculate date range for previous month, or use custom dates
            if custom_start_date and custom_end_date:
                logger.info(
                    f"Using custom Splitwise date range: {custom_start_date.strftime('%Y-%m-%d')} to {custom_end_date.strftime('%Y-%m-%d')}"
                )
                start_date = custom_start_date
                end_date = custom_end_date
            else:
                start_date, end_date = self._calculate_splitwise_date_range()
            
            self._emit(
                "splitwise_sync_started", "splitwise",
                f"Fetching Splitwise transactions ({start_date.strftime('%Y-%m-%d')} → {end_date.strftime('%Y-%m-%d')})",
                data={"start_date": start_date.isoformat(), "end_date": end_date.isoformat()},
            )
            
            # Get Splitwise transactions for the date range
            splitwise_transactions = self.splitwise_service.get_transactions_for_past_month(
                exclude_created_by_me=True,
                include_only_my_transactions=True,
                start_date=start_date,
                end_date=end_date
            )
            
            if not splitwise_transactions:
                logger.info("No Splitwise transactions found for the date range")
                self._emit(
                    "splitwise_sync_complete", "splitwise",
                    "No Splitwise transactions found for the date range",
                    level="warning",
                    data={"transaction_count": 0},
                )
                return None
            
            logger.info(f"Found {len(splitwise_transactions)} Splitwise transactions")
            
            # Convert to DataFrame
            splitwise_data = []
            for transaction in splitwise_transactions:
                # Extract split_breakdown from raw_data if it exists
                split_breakdown = None
                if transaction.raw_data and isinstance(transaction.raw_data, dict):
                    split_breakdown = transaction.raw_data.get('split_breakdown')
                
                # Serialize complex objects to JSON to avoid datetime serialization issues
                def serialize_for_csv(obj):
                    """Serialize object for CSV storage, handling datetime objects"""
                    if obj is None:
                        return None
                    if isinstance(obj, dict):
                        cleaned = {}
                        for k, v in obj.items():
                            if isinstance(v, datetime):
                                cleaned[k] = v.isoformat()
                            elif isinstance(v, dict):
                                cleaned[k] = serialize_for_csv(v)
                            elif isinstance(v, list):
                                cleaned[k] = [serialize_for_csv(item) for item in v]
                            else:
                                cleaned[k] = v
                        return cleaned
                    elif isinstance(obj, list):
                        return [serialize_for_csv(item) for item in obj]
                    elif isinstance(obj, datetime):
                        return obj.isoformat()
                    return obj
                
                # Serialize raw_data and split_breakdown to JSON strings
                raw_data_json = json.dumps(serialize_for_csv(transaction.raw_data)) if transaction.raw_data else None
                split_breakdown_json = json.dumps(serialize_for_csv(split_breakdown)) if split_breakdown else None
                
                splitwise_data.append({
                    'date': transaction.date.strftime('%Y-%m-%d'),
                    'description': transaction.description,
                    'amount': transaction.amount,  # Total amount, not my_share
                    'my_share': transaction.my_share,  # User's share
                    'category': transaction.category,
                    'group_name': transaction.group_name,
                    'source': transaction.source,
                    'created_by': transaction.created_by,
                    'total_participants': transaction.total_participants,
                    'participants': ', '.join(transaction.participants),
                    'paid_by': transaction.paid_by,  # Who paid for the transaction
                    'split_breakdown': split_breakdown_json,  # JSON-serialized split breakdown
                    'is_payment': transaction.is_payment,
                    'external_id': transaction.splitwise_id,
                    'raw_data': raw_data_json  # JSON-serialized raw data
                })
            
            # Create DataFrame
            df = pd.DataFrame(splitwise_data)
            
            # Generate filename using the end date
            end_date_str = end_date.strftime("%Y%m%d")
            csv_filename = f"splitwise_{end_date_str}_extracted.csv"
            
            # Save to temp directory first
            temp_csv_path = self.temp_dir / csv_filename
            df.to_csv(temp_csv_path, index=False)
            
            # Generate cloud path using the start date's month
            cloud_month = start_date.strftime("%Y-%m")
            cloud_path = f"{cloud_month}/extracted_data/{csv_filename}"
            
            # Upload to cloud storage
            upload_result = self.cloud_storage.upload_file(
                local_file_path=str(temp_csv_path),
                cloud_path=cloud_path,
                content_type="text/csv",
                metadata={
                    "source": "splitwise",
                    "date_range_start": start_date.isoformat(),
                    "date_range_end": end_date.isoformat(),
                    "transaction_count": len(splitwise_transactions),
                    "upload_timestamp": datetime.now().isoformat()
                }
            )
            
            if upload_result.get("success"):
                logger.info(f"☁Uploaded Splitwise data to cloud: {cloud_path}")
                self._emit(
                    "splitwise_sync_complete", "splitwise",
                    f"Fetched {len(splitwise_transactions)} Splitwise transactions and uploaded CSV to GCS",
                    level="success",
                    data={
                        "transaction_count": len(splitwise_transactions),
                        "cloud_path": cloud_path,
                    },
                )
                return {
                    "success": True,
                    "cloud_path": cloud_path,
                    "transaction_count": len(splitwise_transactions),
                    "csv_filename": csv_filename,
                    "temp_csv_path": str(temp_csv_path)
                }
            else:
                logger.error(f"Failed to upload Splitwise data to cloud: {upload_result.get('error')}", exc_info=True)
                self._emit(
                    "splitwise_sync_failed", "splitwise",
                    f"Failed to upload Splitwise CSV to GCS: {upload_result.get('error')}",
                    level="error",
                    data={"error": upload_result.get("error")},
                )
                return None
                
        except Exception as e:
            error_msg = f"Error processing Splitwise data: {e}"
            logger.error(error_msg, exc_info=True)
            self._emit(
                "splitwise_sync_failed", "splitwise",
                f"Splitwise processing error: {e}",
                level="error",
                data={"error": str(e)},
            )
            if continue_on_error:
                logger.warning("Continuing workflow despite Splitwise error")
                return None
            else:
                raise Exception(error_msg)
    
    
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
                
        except Exception:
            logger.error(f"Error standardizing data from {extraction_result.get('saved_path', 'unknown')}", exc_info=True)
            return []
    
    
    async def run_complete_workflow(
        self,
        resume_from_standardization: bool = False,
        custom_start_date: Optional[str] = None,
        custom_end_date: Optional[str] = None,
        custom_splitwise_start_date: Optional[datetime] = None,
        custom_splitwise_end_date: Optional[datetime] = None,
        override: bool = False,
    ) -> Dict[str, Any]:
        """
        Run the complete statement processing workflow

        Args:
            resume_from_standardization: If True, skip document extraction and start from standardization
            override: If True, bypass all GCS resume checks and re-extract every statement from scratch
        """
        if resume_from_standardization:
            logger.info("Resuming workflow from standardization step (skipping document extraction)")
            self._emit(
                "workflow_started", "workflow",
                "Resuming workflow from standardization — skipping email/extraction steps",
                data={"mode": "resume"},
            )
        else:
            logger.info("Starting complete statement processing workflow")
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
            "all_standardized_data": []
        }
        
        try:
            # Step 0: Refresh Gmail tokens proactively
            if not resume_from_standardization:
                logger.info("Step 0: Refreshing Gmail tokens...")
                await self._refresh_all_tokens()
            
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

            # Override with custom date range if provided
            if custom_start_date and custom_end_date:
                logger.info(
                    f"Using custom date range override: {custom_start_date} to {custom_end_date}"
                )
                start_date = custom_start_date
                end_date = custom_end_date
            
            # Step 3: Process each sender (skipped when resuming from standardization)
            if not resume_from_standardization:
                logger.info("Starting document extraction step")
                for sender_email in statement_senders:
                    try:
                        logger.info(f"Processing sender: {sender_email}")
                        
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
                                        logger.info(f"Skipped extraction for {statement_data['normalized_filename']}")

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
                                            last_day_iso = f"{year_num}-{month_num:02d}-{last_day:02d}"
                                            await AccountOperations.update_last_statement_date(str(account["id"]), last_day_iso)
                                            await AccountOperations.update_last_processed_at(str(account["id"]))
                                            logger.info(
                                                f"Updated account {account.get('nickname', statement_data['sender_email'])}: "
                                                f"last_statement_date={last_day_iso}"
                                            )
                                        else:
                                            logger.warning(f"Could not find account for sender {statement_data['sender_email']} — skipping date update")
                                    except Exception as e:
                                        logger.warning(f"Failed to update account dates for {statement_data['sender_email']}: {e}")
                                else:
                                    workflow_results["errors"].append(f"Failed to extract data from {statement_data['normalized_filename']}")
                            
                            except Exception as e:
                                error_msg = f"Error processing statement {statement_data.get('normalized_filename', 'unknown')}: {e}"
                                logger.error(error_msg, exc_info=True)
                                workflow_results["errors"].append(error_msg)
                    
                    except Exception as e:
                        error_msg = f"Error processing sender {sender_email}: {e}"
                        logger.error(error_msg, exc_info=True)
                        workflow_results["errors"].append(error_msg)
            
            # Step 4: Process Splitwise data
            logger.info("Step 4: Processing Splitwise data")
            splitwise_result = await self._process_splitwise_data(
                continue_on_error=True,
                custom_start_date=custom_splitwise_start_date,
                custom_end_date=custom_splitwise_end_date
            )
            if splitwise_result:
                workflow_results["splitwise_processed"] = True
                workflow_results["splitwise_cloud_path"] = splitwise_result.get("cloud_path")
                workflow_results["splitwise_transaction_count"] = splitwise_result.get("transaction_count")
                logger.info(f"Processed {splitwise_result.get('transaction_count')} Splitwise transactions")
            else:
                workflow_results["splitwise_processed"] = False
                logger.warning("Splitwise processing failed or no data found")
            
            # Step 5: Standardize and combine all data
            logger.info("Step 5: Standardizing and combining all transaction data")
            combined_data = await self._standardize_and_combine_all_data()
            if combined_data:
                workflow_results["combined_transaction_count"] = len(combined_data)
                workflow_results["all_standardized_data"] = combined_data
                logger.info(f"Combined and standardized {len(combined_data)} total transactions")
                
                # Step 6: Store data in database
                logger.info("Step 6: Storing transactions in database")
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
                        },
                    )
                else:
                    workflow_results["database_errors"] = db_result.get("errors", [])
                    logger.error(f"Database storage failed: {db_result.get('errors', [])}", exc_info=True)
                    self._emit(
                        "db_insert_complete", "db_insert",
                        f"DB insert failed: {db_result.get('errors', [])}",
                        level="error",
                        data={"errors": db_result.get("errors", [])},
                    )
            else:
                logger.warning("No combined transaction data generated")
            
            logger.info("Complete statement processing workflow finished")
            
            skipped_count = workflow_results.get('total_statements_skipped', 0)
            logger.info(f"Results: {workflow_results['total_statements_downloaded']} downloaded, "
                       f"{workflow_results['total_statements_uploaded']} uploaded, "
                       f"{workflow_results['total_statements_processed']} processed, "
                       f"{skipped_count} skipped (already extracted), "
                       f"{workflow_results.get('splitwise_transaction_count', 0)} Splitwise transactions, "
                       f"{workflow_results.get('combined_transaction_count', 0)} total combined transactions, "
                       f"{workflow_results.get('database_inserted_count', 0)} inserted to database, "
                       f"{workflow_results.get('database_skipped_count', 0)} skipped (duplicates)")
            logger.info(f"Temp directory used: {workflow_results['temp_directory']}")
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
            logger.error(error_msg, exc_info=True)
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
                logger.info(f"Cleaned up temp directory: {self.temp_dir}")
            except Exception as e:
                logger.warning(f"Failed to cleanup temp directory: {e}")
    
    async def _standardize_and_combine_all_data(self) -> List[Dict[str, Any]]:
        """Standardize and combine all transaction data from cloud storage"""
        try:
            logger.info("Standardizing and combining all transaction data")
            
            # Get all CSV files from cloud storage for the previous month
            start_date, end_date = self._calculate_splitwise_date_range()
            previous_month = start_date.strftime("%Y-%m")
            
            # List all CSV files in the extracted_data directory for the month
            cloud_csv_files = self.cloud_storage.list_files(f"{previous_month}/extracted_data/")
            
            if not cloud_csv_files:
                logger.warning(f"No CSV files found in cloud storage for {previous_month}")
                self._emit(
                    "standardization_started", "standardization",
                    f"No CSV files found in GCS for {previous_month}",
                    level="warning",
                )
                return []
            
            csv_files_only = [f for f in cloud_csv_files if f.get("name", "").endswith(".csv")]
            logger.info(f"Found {len(csv_files_only)} CSV files in cloud storage")
            self._emit(
                "standardization_started", "standardization",
                f"Standardizing {len(csv_files_only)} CSV file(s) from GCS ({previous_month})",
                data={"csv_count": len(csv_files_only), "month": previous_month},
            )
            
            all_standardized_data = []
            
            # Process each CSV file
            for cloud_file_info in cloud_csv_files:
                try:
                    # Extract filename from file info dictionary
                    cloud_file = cloud_file_info.get("name", "")
                    if not cloud_file.endswith('.csv'):
                        continue
                    
                    logger.info(f"Processing cloud CSV: {cloud_file}")
                    self._emit(
                        "standardization_file_started", "standardization",
                        f"Standardizing {Path(cloud_file).name}",
                        data={"cloud_file": cloud_file},
                    )
                    
                    # Download CSV from cloud storage to temp directory
                    temp_csv_path = self.temp_dir / Path(cloud_file).name
                    download_result = self.cloud_storage.download_file(cloud_file, str(temp_csv_path))
                    
                    if not download_result.get("success"):
                        logger.error(f"Failed to download {cloud_file}: {download_result.get('error')}", exc_info=True)
                        self._emit(
                            "standardization_file_failed", "standardization",
                            f"Failed to download {Path(cloud_file).name} from GCS",
                            level="error",
                            data={"cloud_file": cloud_file, "error": download_result.get("error")},
                        )
                        continue
                    
                    # Read CSV file
                    df = pd.read_csv(temp_csv_path)
                    
                    # Determine if this is Splitwise or bank data
                    if "splitwise" in cloud_file.lower():
                        # Process Splitwise data
                        standardized_df = self.transaction_standardizer.standardize_splitwise_data(df)
                    else:
                        # Process bank data - extract search pattern from filename
                        search_pattern = extract_search_pattern_from_csv_filename(Path(cloud_file).name)
                        standardized_df = await self.transaction_standardizer.process_with_dynamic_method(
                            df, search_pattern, Path(cloud_file).name
                        )
                    
                    if not standardized_df.empty:
                        standardized_data = standardized_df.to_dict('records')
                        all_standardized_data.extend(standardized_data)
                        logger.info(f"Standardized {len(standardized_data)} transactions from {cloud_file}")
                        self._emit(
                            "standardization_file_complete", "standardization",
                            f"Standardized {len(standardized_data)} transaction(s) from {Path(cloud_file).name}",
                            level="success",
                            data={"cloud_file": cloud_file, "row_count": len(standardized_data)},
                        )
                    else:
                        self._emit(
                            "standardization_file_complete", "standardization",
                            f"No transactions extracted from {Path(cloud_file).name}",
                            level="warning",
                            data={"cloud_file": cloud_file, "row_count": 0},
                        )
                    
                except Exception as e:
                    logger.error(f"Error processing cloud CSV {cloud_file}", exc_info=True)
                    self._emit(
                        "standardization_file_failed", "standardization",
                        f"Error standardizing {Path(cloud_file).name}: {e}",
                        level="error",
                        data={"cloud_file": cloud_file, "error": str(e)},
                    )
                    continue
            
            if all_standardized_data:
                # Remove duplicates using composite key
                deduplicated_data = await self._remove_duplicate_transactions(all_standardized_data)
                logger.info(f"Removed {len(all_standardized_data) - len(deduplicated_data)} duplicate transactions")
                
                # Sort by transaction date (chronological order - oldest first)
                sorted_data = await self._sort_transactions_by_date(deduplicated_data)
                logger.info(f"Sorted {len(sorted_data)} transactions by date (chronological order)")
                
                self._emit(
                    "standardization_complete", "standardization",
                    f"Standardization complete: {len(sorted_data)} unique transaction(s) across all sources",
                    level="success",
                    data={
                        "total_before_dedup": len(all_standardized_data),
                        "total_after_dedup": len(sorted_data),
                        "duplicates_removed": len(all_standardized_data) - len(deduplicated_data),
                    },
                )
                return sorted_data
            else:
                logger.warning("No standardized transaction data generated")
                self._emit(
                    "standardization_complete", "standardization",
                    "No transaction data generated from any CSV source",
                    level="warning",
                    data={"total_after_dedup": 0},
                )
                return []
                
        except Exception as e:
            logger.error("Error standardizing and combining all data", exc_info=True)
            self._emit(
                "standardization_complete", "standardization",
                f"Standardization failed: {e}",
                level="error",
                data={"error": str(e)},
            )
            return []
    
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
            
            logger.info(f"Deduplication: {len(transactions)} -> {len(unique_transactions)} transactions")
            return unique_transactions
            
        except Exception:
            logger.error("Error removing duplicate transactions", exc_info=True)
            return transactions
    
    async def _sort_transactions_by_date(self, transactions: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Sort transactions by date in chronological order (oldest first)"""
        try:
            if not transactions:
                return transactions
            
            # Sort by transaction_date (chronological order - oldest first)
            def sort_key(x):
                date_val = x.get('transaction_date')
                time_val = x.get('transaction_time', '00:00:00')
                
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
            
            logger.info(f"Sorted {len(sorted_transactions)} transactions by date")
            return sorted_transactions
            
        except Exception:
            logger.error("Error sorting transactions by date", exc_info=True)
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
                logger.info(f"No CSV files found in cloud storage for {previous_month}")
                return False
            
            # Filter for CSV files
            csv_files = [f for f in cloud_csv_files if f.get("name", "").endswith('.csv')]
            
            if csv_files:
                logger.info(f"Found {len(csv_files)} CSV files in cloud storage for {previous_month}")
                return True
            else:
                logger.info(f"No CSV files found in cloud storage for {previous_month}")
                return False
                
        except Exception:
            logger.error("Error checking cloud CSV files", exc_info=True)
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
                logger.warning(f"No account nickname found for sender: {sender_email}")
                return False
            
            # Generate expected CSV filename pattern
            nickname_clean = account_nickname.lower().replace(" ", "_").replace("_credit_card", "").replace("_account", "")
            
            # Extract date from normalized filename or use email date
            date_str = self._extract_date_from_filename(normalized_filename) or self._extract_date_from_email_date(email_date)
            expected_csv_pattern = f"{nickname_clean}_{date_str}_extracted.csv"
            
            # Calculate the month directory for cloud storage (use previous month logic)
            start_date, end_date = self._calculate_splitwise_date_range()
            month_dir = start_date.strftime("%Y-%m")
            
            # List CSV files in the month directory
            cloud_csv_files = self.cloud_storage.list_files(f"{month_dir}/extracted_data/")
            
            if not cloud_csv_files:
                logger.info(f"No CSV files found in cloud storage for {month_dir}")
                return False
            
            # Check if any CSV file matches our expected pattern
            for cloud_file_info in cloud_csv_files:
                cloud_filename = cloud_file_info.get("name", "")
                if cloud_filename.endswith('.csv') and expected_csv_pattern in cloud_filename:
                    logger.info(f"Found existing extracted data for {normalized_filename}: {cloud_filename}")
                    return True
            
            logger.info(f"No existing extracted data found for {normalized_filename}")
            return False
            
        except Exception:
            logger.error("Error checking if statement already extracted", exc_info=True)
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
            logger.warning(f"Error extracting date from filename {filename}: {e}")
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
            logger.warning(f"Could not parse email date: {email_date}, using current date")
            return datetime.now()
            
        except Exception:
            logger.error(f"Error parsing email date {email_date}", exc_info=True)
            return datetime.now()
    
    def _extract_date_from_email_date(self, email_date: str) -> str:
        """Extract date string in YYYYMMDD format from email date"""
        try:
            email_datetime = self._parse_email_date(email_date)
            return email_datetime.strftime("%Y%m%d")
        except Exception as e:
            logger.warning(f"Error extracting date from email date {email_date}: {e}")
            return datetime.now().strftime("%Y%m%d")
    
    async def run_resume_workflow(self) -> Dict[str, Any]:
        """Run workflow resuming from standardization step (skip document extraction)"""
        logger.info("Starting resume workflow - skipping document extraction")
        return await self.run_complete_workflow(resume_from_standardization=True)

    async def run_splitwise_only_workflow(
        self,
        custom_start_date: Optional[datetime] = None,
        custom_end_date: Optional[datetime] = None,
    ) -> Dict[str, Any]:
        """Run Splitwise-only workflow: fetch → GCS → standardize → DB insert."""
        logger.info("Starting Splitwise-only workflow")
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
            logger.error(error_msg, exc_info=True)
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
                logger.info(f"Cleaned up temp directory: {self.temp_dir}")
            except Exception as e:
                logger.warning(f"Failed to cleanup temp directory: {e}")
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
