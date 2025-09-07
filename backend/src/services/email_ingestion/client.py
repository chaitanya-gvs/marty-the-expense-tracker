from __future__ import annotations

import asyncio
import base64
import email
import json
import re
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, List, Optional

from google.auth.exceptions import RefreshError
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build

from src.services.database_manager.operations import AccountOperations
from src.utils.logger import get_logger
from src.utils.settings import get_settings

logger = get_logger(__name__)


class EmailClient:
    def __init__(self, account_id: str = "primary"):
        self.settings = get_settings()
        self.account_id = account_id
        self.client_config = self._load_client_config()
        self.creds = self._get_credentials()
        self.service = build("gmail", "v1", credentials=self.creds, cache_discovery=False)

    def _load_client_config(self) -> dict:
        """Load client configuration from JSON file or environment variables"""
        # Determine which account credentials to use
        if self.account_id == "secondary":
            client_secret_file = self.settings.GOOGLE_CLIENT_SECRET_FILE_2
            client_id = self.settings.GOOGLE_CLIENT_ID_2
            client_secret = self.settings.GOOGLE_CLIENT_SECRET_2
        else:  # primary account
            client_secret_file = self.settings.GOOGLE_CLIENT_SECRET_FILE
            client_id = self.settings.GOOGLE_CLIENT_ID
            client_secret = self.settings.GOOGLE_CLIENT_SECRET
        
        # Try to load from JSON file first
        if client_secret_file:
            json_path = Path(client_secret_file)
            if json_path.exists():
                try:
                    with open(json_path, 'r') as f:
                        client_config = json.load(f)
                    web_config = client_config.get("web", {})
                    logger.info(f"Loaded Gmail credentials for {self.account_id} account from {json_path}")
                    return {
                        "client_id": web_config.get("client_id"),
                        "client_secret": web_config.get("client_secret")
                    }
                except Exception as e:
                    logger.warning(f"Failed to load JSON file {json_path}: {e}")
        
        # Fallback to environment variables
        if client_id and client_secret:
            logger.info(f"Using Gmail credentials for {self.account_id} account from environment variables")
            return {
                "client_id": client_id,
                "client_secret": client_secret
            }
        
        # No credentials found
        logger.warning(f"No credentials found for {self.account_id} account")
        return {}
    
    def _get_credentials(self) -> Credentials:
        """Get credentials for the specified account"""
        if self.account_id == "secondary":
            refresh_token = self.settings.GOOGLE_REFRESH_TOKEN_2
        else:  # primary account
            refresh_token = self.settings.GOOGLE_REFRESH_TOKEN
        
        if not refresh_token:
            raise ValueError(f"No refresh token found for {self.account_id} account")
        
        return Credentials(
            None,
            refresh_token=refresh_token,
            client_id=self.client_config.get("client_id"),
            client_secret=self.client_config.get("client_secret"),
            token_uri="https://oauth2.googleapis.com/token",
        )

    def _refresh_credentials(self) -> bool:
        """Refresh Gmail credentials if needed"""
        try:
            if self.creds.expired:
                self.creds.refresh(None)
                logger.info("Gmail credentials refreshed successfully")
                return True
        except RefreshError as e:
            logger.error(f"Failed to refresh Gmail credentials: {e}")
            return False
        return True

    def list_recent_transaction_emails(self, max_results: int = 25, days_back: int = 7) -> List[dict[str, Any]]:
        """List recent transaction-related emails using simple keyword search"""
        if not self._refresh_credentials():
            raise Exception("Failed to authenticate with Gmail")

        # Build simple query for transaction-related emails
        date_filter = (datetime.now() - timedelta(days=days_back)).strftime("%Y/%m/%d")
        query = f"after:{date_filter} AND (statement OR transaction OR receipt OR payment OR invoice)"
        
        logger.info(f"Using search query: {query}")
        
        try:
            resp = (
                self.service.users()
                .messages()
                .list(userId="me", q=query, maxResults=max_results)
                .execute()
            )
            messages = resp.get("messages", [])
            logger.info(f"Found {len(messages)} transaction emails")
            return messages
        except Exception as e:
            logger.error(f"Error listing Gmail messages: {e}")
            raise

    def get_email_content(self, message_id: str) -> dict[str, Any]:
        """Get full email content including body and attachments"""
        if not self._refresh_credentials():
            raise Exception("Failed to authenticate with Gmail")

        try:
            message = (
                self.service.users()
                .messages()
                .get(userId="me", id=message_id, format="full")
                .execute()
            )
            
            # Parse email headers
            headers = message.get("payload", {}).get("headers", [])
            subject = next((h["value"] for h in headers if h["name"] == "Subject"), "")
            sender = next((h["value"] for h in headers if h["name"] == "From"), "")
            date = next((h["value"] for h in headers if h["name"] == "Date"), "")
            
            # Extract email body
            body = self._extract_email_body(message.get("payload", {}))
            
            # Extract attachments
            attachments = self._extract_attachments(message.get("payload", {}))
            
            return {
                "id": message_id,
                "subject": subject,
                "sender": sender,
                "date": date,
                "body": body,
                "attachments": attachments,
                "raw_message": message
            }
        except Exception as e:
            logger.error(f"Error getting email content for {message_id}: {e}")
            raise

    def _extract_email_body(self, payload: dict) -> str:
        """Extract email body from Gmail message payload"""
        if "body" in payload and payload["body"].get("data"):
            # Simple text email
            data = payload["body"]["data"]
            return base64.urlsafe_b64decode(data).decode("utf-8", errors="ignore")
        
        elif "parts" in payload:
            # Multipart email
            body_parts = []
            for part in payload["parts"]:
                if part.get("mimeType") == "text/plain":
                    if part.get("body", {}).get("data"):
                        data = part["body"]["data"]
                        body_parts.append(base64.urlsafe_b64decode(data).decode("utf-8", errors="ignore"))
                elif part.get("mimeType") == "text/html":
                    # Fallback to HTML if no plain text
                    if part.get("body", {}).get("data"):
                        data = part["body"]["data"]
                        html_content = base64.urlsafe_b64decode(data).decode("utf-8", errors="ignore")
                        # Simple HTML to text conversion (you might want to use BeautifulSoup for better parsing)
                        text_content = re.sub(r'<[^>]+>', '', html_content)
                        body_parts.append(text_content)
            
            return "\n".join(body_parts)
        
        return ""

    def _extract_attachments(self, payload: dict) -> List[dict]:
        """Extract attachment information from Gmail message payload"""
        attachments = []
        
        def _process_part(part):
            if part.get("filename") and part.get("body", {}).get("attachmentId"):
                attachments.append({
                    "filename": part["filename"],
                    "mime_type": part.get("mimeType", ""),
                    "size": part.get("body", {}).get("size", 0),
                    "attachment_id": part["body"]["attachmentId"]
                })
            
            if "parts" in part:
                for subpart in part["parts"]:
                    _process_part(subpart)
        
        _process_part(payload)
        return attachments

    def download_attachment(self, message_id: str, attachment_id: str) -> bytes:
        """Download attachment content"""
        if not self._refresh_credentials():
            raise Exception("Failed to authenticate with Gmail")

        try:
            attachment = (
                self.service.users()
                .messages()
                .attachments()
                .get(userId="me", messageId=message_id, id=attachment_id)
                .execute()
            )
            
            data = attachment["data"]
            return base64.urlsafe_b64decode(data)
        except Exception as e:
            logger.error(f"Error downloading attachment {attachment_id}: {e}")
            raise

    def search_emails_by_date_range(self, start_date: str, end_date: str, query: str = "") -> List[dict[str, Any]]:
        """Search emails within a date range with optional query"""
        if not self._refresh_credentials():
            raise Exception("Failed to authenticate with Gmail")

        date_query = f"after:{start_date} before:{end_date}"
        full_query = f"{date_query} {query}".strip()
        
        try:
            resp = (
                self.service.users()
                .messages()
                .list(userId="me", q=full_query, maxResults=100)
                .execute()
            )
            return resp.get("messages", [])
        except Exception as e:
            logger.error(f"Error searching emails: {e}")
            raise

    def get_email_thread(self, thread_id: str) -> dict[str, Any]:
        """Get full email thread"""
        if not self._refresh_credentials():
            raise Exception("Failed to authenticate with Gmail")

        try:
            thread = (
                self.service.users()
                .threads()
                .get(userId="me", id=thread_id)
                .execute()
            )
            return thread
        except Exception as e:
            logger.error(f"Error getting email thread {thread_id}: {e}")
            raise

    def download_latest_attachment_with_normalized_name(self, sender_email: str, file_type: str = "pdf", download_dir: str = "data/statements/locked_statements") -> Optional[dict[str, Any]]:
        """
        Download the latest attachment from a specific sender with normalized filename
        
        Args:
            sender_email: Email address of the sender
            file_type: Type of file to download (default: pdf)
            download_dir: Directory to save the attachment
            
        Returns:
            Dictionary containing download results, or None if failed
        """
        try:
            logger.info(f"📧 Searching for latest email from: {sender_email}")
            
            # Search for emails from this sender
            query = f"from:{sender_email}"
            emails = self.search_emails_by_date_range(
                start_date="2025/01/01",  # Start from beginning of year
                end_date="2025/12/31",    # End of year
                query=query
            )
            
            if not emails:
                logger.warning(f"No emails found from {sender_email}")
                return None
            
            logger.info(f"✅ Found {len(emails)} emails from {sender_email}")
            
            # Get the latest email (first in the list)
            latest_email = emails[0]
            email_id = latest_email.get("id")
            
            # Get email details to find attachments and date
            email_details = self.get_email_content(email_id)
            if not email_details:
                logger.error("Failed to get email details")
                return None
            
            subject = email_details.get("subject", "No subject")
            date = email_details.get("date", "Unknown date")
            attachments = email_details.get("attachments", [])
            
            logger.info(f"📨 Latest email: {subject} ({date})")
            
            if not attachments:
                logger.warning("No attachments found in the latest email")
                return {
                    "success": False,
                    "error": "No attachments found",
                    "email_subject": subject,
                    "email_date": date
                }
            
            logger.info(f"📎 Found {len(attachments)} attachments")
            
            # Filter attachments by file type
            matching_attachments = [
                att for att in attachments 
                if att.get("filename", "").lower().endswith(f".{file_type.lower()}")
            ]
            
            if not matching_attachments:
                logger.warning(f"No {file_type.upper()} attachments found")
                return {
                    "success": False,
                    "error": f"No {file_type.upper()} attachments found",
                    "email_subject": subject,
                    "email_date": date,
                    "total_attachments": len(attachments)
                }
            
            logger.info(f"📄 Found {len(matching_attachments)} {file_type.upper()} attachments")
            
            # Download the first matching attachment
            attachment = matching_attachments[0]
            original_filename = attachment.get("filename", "unknown")
            attachment_id = attachment.get("attachment_id")
            
            logger.info(f"⬇️ Downloading: {original_filename}")
            
            # Download attachment data
            attachment_data = self.download_attachment(email_id, attachment_id)
            if not attachment_data:
                logger.error("Failed to download attachment data")
                return {
                    "success": False,
                    "error": "Failed to download attachment data",
                    "email_subject": subject,
                    "email_date": date
                }
            
            # Generate normalized filename
            normalized_filename = self._generate_normalized_filename(sender_email, date, file_type)
            
            # Save attachment to file
            saved_path = self._save_attachment_with_normalized_name(normalized_filename, attachment_data, download_dir)
            if not saved_path:
                logger.error("Failed to save attachment")
                return {
                    "success": False,
                    "error": "Failed to save attachment",
                    "email_subject": subject,
                    "email_date": date
                }
            
            logger.info(f"💾 Attachment saved to: {saved_path}")
            
            return {
                "success": True,
                "email_subject": subject,
                "email_date": date,
                "original_filename": original_filename,
                "normalized_filename": normalized_filename,
                "saved_path": saved_path,
                "file_size": len(attachment_data)
            }
            
        except Exception as e:
            logger.error(f"Error downloading latest attachment: {e}")
            return {
                "success": False,
                "error": str(e)
            }

    def _generate_normalized_filename(self, sender_email: str, email_date: str, file_type: str) -> str:
        """Generate normalized filename using account nickname and email date"""
        try:
            # Get account nickname from database
            # Run async function in sync context
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            try:
                nickname = loop.run_until_complete(
                    AccountOperations.get_account_nickname_by_sender(sender_email)
                )
            finally:
                loop.close()
            
            # Use nickname if available, otherwise use sender email domain
            if nickname:
                # Convert to lowercase and replace spaces with underscores
                base_name = nickname.lower().replace(' ', '_')
            else:
                # Extract domain from email as fallback
                domain = sender_email.split('@')[1].split('.')[0]
                base_name = domain.lower()
            
            # Parse email date and format it
            # Try to parse the email date (Gmail format)
            try:
                # Remove timezone info and parse
                date_str = re.sub(r'\s+\([^)]+\)$', '', email_date)
                parsed_date = datetime.strptime(date_str, "%a, %d %b %Y %H:%M:%S %z")
                formatted_date = parsed_date.strftime("%Y%m%d")
            except:
                # Fallback to current date if parsing fails
                formatted_date = datetime.now().strftime("%Y%m%d")
                logger.warning(f"Could not parse email date '{email_date}', using current date")
            
            # Create normalized filename
            normalized_filename = f"{base_name}_{formatted_date}.{file_type}"
            
            return normalized_filename
            
        except Exception as e:
            logger.error(f"Error generating normalized filename: {e}")
            # Fallback to timestamp-based filename
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            return f"statement_{timestamp}.{file_type}"

    def _save_attachment_with_normalized_name(self, filename: str, attachment_data: bytes, download_dir: str) -> Optional[str]:
        """Save attachment data to file with normalized filename"""
        try:
            # Create output directory
            download_path = Path(download_dir)
            download_path.mkdir(parents=True, exist_ok=True)
            
            # Create file path
            file_path = download_path / filename
            
            # Write attachment data
            with open(file_path, 'wb') as f:
                f.write(attachment_data)
            
            return str(file_path)
            
        except Exception as e:
            logger.error(f"Error saving attachment: {e}")
            return None


