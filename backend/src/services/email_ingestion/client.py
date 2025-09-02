from __future__ import annotations

import base64
import email
import json
from typing import Any, List, Optional
from datetime import datetime, timedelta
from pathlib import Path

from googleapiclient.discovery import build
from google.oauth2.credentials import Credentials
from google.auth.exceptions import RefreshError

from src.utils.logger import get_logger
from src.utils.settings import get_settings

logger = get_logger(__name__)


class EmailClient:
    def __init__(self):
        self.settings = get_settings()
        self.client_config = self._load_client_config()
        self.creds = Credentials(
            None,
            refresh_token=self.settings.GOOGLE_REFRESH_TOKEN,
            client_id=self.client_config.get("client_id"),
            client_secret=self.client_config.get("client_secret"),
            token_uri="https://oauth2.googleapis.com/token",
        )
        self.service = build("gmail", "v1", credentials=self.creds, cache_discovery=False)

    def _load_client_config(self) -> dict:
        """Load client configuration from JSON file or environment variables"""
        # Try to load from JSON file first
        if self.settings.GOOGLE_CLIENT_SECRET_FILE:
            json_path = Path(self.settings.GOOGLE_CLIENT_SECRET_FILE)
            if json_path.exists():
                try:
                    with open(json_path, 'r') as f:
                        client_config = json.load(f)
                    web_config = client_config.get("web", {})
                    logger.info(f"Loaded Gmail credentials from {json_path}")
                    return {
                        "client_id": web_config.get("client_id"),
                        "client_secret": web_config.get("client_secret")
                    }
                except Exception as e:
                    logger.warning(f"Failed to load JSON file {json_path}: {e}")
        
        # Fallback to environment variables
        if self.settings.GOOGLE_CLIENT_ID and self.settings.GOOGLE_CLIENT_SECRET:
            logger.info("Using Gmail credentials from environment variables")
            return {
                "client_id": self.settings.GOOGLE_CLIENT_ID,
                "client_secret": self.settings.GOOGLE_CLIENT_SECRET
            }
        
        # No credentials found
        return {}

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
        """List recent transaction-related emails"""
        if not self._refresh_credentials():
            raise Exception("Failed to authenticate with Gmail")

        # Load configuration and build search query
        from src.utils.email_config import get_email_config
        config = get_email_config()
        
        # Build query for transaction-related emails
        date_filter = (datetime.now() - timedelta(days=days_back)).strftime("%Y/%m/%d")
        base_query = config.build_transaction_query()
        query = f"after:{date_filter} AND ({base_query})"
        
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
                        import re
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


