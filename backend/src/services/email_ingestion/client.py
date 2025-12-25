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
from src.services.email_ingestion.token_manager import TokenManager
from src.utils.logger import get_logger
from src.utils.settings import get_settings

logger = get_logger(__name__)

# Try to import BeautifulSoup for HTML parsing
try:
    from bs4 import BeautifulSoup
    HAS_BS4 = True
except ImportError:
    HAS_BS4 = False
    logger.warning("BeautifulSoup4 not available, using regex for HTML parsing")


class EmailClient:
    def __init__(self, account_id: str = "primary"):
        self.settings = get_settings()
        self.account_id = account_id
        self.client_config = self._load_client_config()
        self.token_manager = TokenManager(account_id)
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
        """Refresh Gmail credentials if needed using advanced token management"""
        try:
            # Use the token manager for proactive refresh
            new_creds = self.token_manager.get_valid_credentials()
            if new_creds:
                self.creds = new_creds
                # Rebuild the service with new credentials
                self.service = build("gmail", "v1", credentials=self.creds, cache_discovery=False)
                logger.info(f"Gmail credentials refreshed successfully for {self.account_id} account")
                return True
            else:
                logger.error(f"Failed to get valid credentials for {self.account_id} account")
                return False
        except Exception as e:
            logger.error(f"Failed to refresh Gmail credentials for {self.account_id}", exc_info=True)
            return False

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
            logger.error("Error listing Gmail messages", exc_info=True)
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
            
            # Extract Uber trip info if this is an Uber email
            uber_trip_info = None
            if "uber" in subject.lower() or "uber" in sender.lower():
                html_content = self._extract_html_content(message.get("payload", {}))
                if html_content:
                    uber_trip_info = self._parse_uber_trip_info(html_content)
            
            result = {
                "id": message_id,
                "subject": subject,
                "sender": sender,
                "date": date,
                "body": body,
                "attachments": attachments,
                "raw_message": message
            }
            
            if uber_trip_info:
                result["uber_trip_info"] = uber_trip_info
            
            return result
        except Exception as e:
            logger.error(f"Error getting email content for {message_id}", exc_info=True)
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
                        # Convert HTML to text, removing style/script tags and their content
                        text_content = self._html_to_text(html_content)
                        body_parts.append(text_content)
            
            return "\n".join(body_parts)
        
        return ""

    def _html_to_text(self, html_content: str) -> str:
        """Convert HTML to plain text, removing style/script tags and cleaning up"""
        if HAS_BS4:
            try:
                soup = BeautifulSoup(html_content, 'html.parser')
                # Remove style and script tags
                for tag in soup(['style', 'script', 'noscript', 'link']):
                    tag.decompose()
                # Remove inline styles
                for tag in soup.find_all(True):
                    if tag.get('style'):
                        del tag['style']
                # Get text and clean up
                text = soup.get_text(separator='\n', strip=True)
                # Remove CSS-like patterns that might have leaked through (more aggressive)
                # Match @media, @font-face, and other @ rules with nested braces
                text = re.sub(r'@media[^{]*\{[^{}]*(\{[^{}]*\}[^{}]*)*\}', '', text, flags=re.DOTALL | re.IGNORECASE)
                text = re.sub(r'@font-face[^{]*\{[^{}]*(\{[^{}]*\}[^{}]*)*\}', '', text, flags=re.DOTALL | re.IGNORECASE)
                text = re.sub(r'@[a-z-]+\s*[^{]*\{[^{}]*(\{[^{}]*\}[^{}]*)*\}', '', text, flags=re.DOTALL | re.IGNORECASE)
                # Remove any remaining CSS-like patterns
                text = re.sub(r'@media\s+[^{]*', '', text, flags=re.IGNORECASE)
                text = re.sub(r'@font-face\s*', '', text, flags=re.IGNORECASE)
                text = re.sub(r'@[a-z-]+\s+', '', text, flags=re.IGNORECASE)
                # Remove excessive whitespace
                text = re.sub(r'\n\s*\n\s*\n+', '\n\n', text)
                return text
            except Exception as e:
                logger.warning(f"Error parsing HTML with BeautifulSoup: {e}, falling back to regex")
        
        # Fallback to regex-based approach
        # Remove style and script tags with their content
        text = re.sub(r'<style[^>]*>.*?</style>', '', html_content, flags=re.DOTALL | re.IGNORECASE)
        text = re.sub(r'<script[^>]*>.*?</script>', '', text, flags=re.DOTALL | re.IGNORECASE)
        text = re.sub(r'<noscript[^>]*>.*?</noscript>', '', text, flags=re.DOTALL | re.IGNORECASE)
        text = re.sub(r'<link[^>]*>', '', text, flags=re.IGNORECASE)
        # Remove inline styles
        text = re.sub(r'style\s*=\s*["\'][^"\']*["\']', '', text, flags=re.IGNORECASE)
        # Remove CSS @ rules that might appear in text (more aggressive)
        # Match @media, @font-face, and other @ rules with nested braces
        text = re.sub(r'@media[^{]*\{[^{}]*(\{[^{}]*\}[^{}]*)*\}', '', text, flags=re.DOTALL | re.IGNORECASE)
        text = re.sub(r'@font-face[^{]*\{[^{}]*(\{[^{}]*\}[^{}]*)*\}', '', text, flags=re.DOTALL | re.IGNORECASE)
        text = re.sub(r'@[a-z-]+\s*[^{]*\{[^{}]*(\{[^{}]*\}[^{}]*)*\}', '', text, flags=re.DOTALL | re.IGNORECASE)
        # Remove any remaining CSS-like patterns
        text = re.sub(r'@media\s+[^{]*', '', text, flags=re.IGNORECASE)
        text = re.sub(r'@font-face\s*', '', text, flags=re.IGNORECASE)
        text = re.sub(r'@[a-z-]+\s+', '', text, flags=re.IGNORECASE)
        # Remove all remaining HTML tags
        text = re.sub(r'<[^>]+>', '', text)
        # Clean up whitespace
        text = re.sub(r'\n\s*\n\s*\n+', '\n\n', text)
        text = re.sub(r'[ \t]+', ' ', text)
        return text.strip()

    def _extract_html_content(self, payload: dict) -> Optional[str]:
        """Extract HTML content from Gmail message payload"""
        if "body" in payload and payload["body"].get("data"):
            # Simple HTML email
            data = payload["body"]["data"]
            content = base64.urlsafe_b64decode(data).decode("utf-8", errors="ignore")
            if "<html" in content.lower() or "<body" in content.lower():
                return content
            return None
        
        elif "parts" in payload:
            # Multipart email - look for HTML part
            for part in payload["parts"]:
                if part.get("mimeType") == "text/html":
                    if part.get("body", {}).get("data"):
                        data = part["body"]["data"]
                        return base64.urlsafe_b64decode(data).decode("utf-8", errors="ignore")
                # Recursively check nested parts
                elif "parts" in part:
                    html_content = self._extract_html_content(part)
                    if html_content:
                        return html_content
        
        return None

    def _parse_uber_trip_info(self, html_content: str) -> Optional[dict[str, Any]]:
        """Parse Uber trip information from email HTML"""
        if not html_content:
            return None
        
        trip_info = {}
        
        try:
            if HAS_BS4:
                soup = BeautifulSoup(html_content, 'html.parser')
                
                # Extract amount
                amount_elem = soup.find(attrs={"data-testid": "total_fare_amount"})
                if amount_elem:
                    amount_text = amount_elem.get_text(strip=True)
                    # Remove currency symbols and extract number
                    amount_match = re.search(r'[\d,]+\.?\d*', amount_text.replace(',', ''))
                    if amount_match:
                        trip_info["amount"] = amount_match.group()
                
                # Extract vehicle type (look for badge/span with "Auto", "UberX", etc.)
                vehicle_patterns = [r'\bAuto\b', r'\bUberX\b', r'\bUberGo\b', r'\bUberXL\b', r'\bUberPremier\b']
                for pattern in vehicle_patterns:
                    vehicle_elem = soup.find(string=re.compile(pattern, re.I))
                    if vehicle_elem:
                        trip_info["vehicle_type"] = vehicle_elem.strip()
                        break
                
                # Extract distance and duration (format: "11.63 kilometres | 41 minutes")
                distance_duration_elem = soup.find(string=re.compile(r'\d+\.?\d*\s*(kilometres|km|miles|mi).*?\d+\s*(minutes|mins|hours|hrs)', re.I))
                if distance_duration_elem:
                    text = distance_duration_elem.strip()
                    # Extract distance
                    distance_match = re.search(r'(\d+\.?\d*)\s*(kilometres|km|miles|mi)', text, re.I)
                    if distance_match:
                        trip_info["distance"] = f"{distance_match.group(1)} {distance_match.group(2).lower()}"
                    # Extract duration
                    duration_match = re.search(r'(\d+)\s*(minutes|mins|hours|hrs)', text, re.I)
                    if duration_match:
                        trip_info["duration"] = f"{duration_match.group(1)} {duration_match.group(2).lower()}"
                
                # Extract from and to locations
                # Uber emails have structure: time (like "10:39") in one table row, address in next row
                # Look for table rows containing time patterns
                time_pattern = re.compile(r'^\d{1,2}:\d{2}$')
                locations = []
                
                # Find all elements that contain time patterns (exact match for HH:MM format)
                all_elements = soup.find_all(string=time_pattern)
                
                for time_text in all_elements:
                    time_value = time_text.strip()
                    # Get the parent element (usually a td)
                    parent = time_text.parent
                    if not parent:
                        continue
                    
                    # Try multiple strategies to find the address
                    address_text = None
                    
                    # Strategy 1: Look for next table row (most common in Uber emails)
                    parent_tr = parent.find_parent('tr')
                    if parent_tr:
                        next_tr = parent_tr.find_next_sibling('tr')
                        if next_tr:
                            # Get all text from the next row
                            address_candidate = next_tr.get_text(separator=' ', strip=True)
                            if len(address_candidate) > 20 and address_candidate != time_value:
                                address_text = address_candidate
                    
                    # Strategy 2: Look for next sibling td in the same row
                    if not address_text and parent.name == 'td':
                        next_td = parent.find_next_sibling('td')
                        if next_td:
                            address_candidate = next_td.get_text(separator=' ', strip=True)
                            if len(address_candidate) > 20 and address_candidate != time_value:
                                address_text = address_candidate
                    
                    # Strategy 3: Look for next element in the DOM
                    if not address_text:
                        next_elem = parent.find_next()
                        if next_elem:
                            address_candidate = next_elem.get_text(separator=' ', strip=True)
                            if len(address_candidate) > 20 and address_candidate != time_value:
                                address_text = address_candidate
                    
                    # Validate address text
                    if address_text and len(address_text) > 20:
                        # Check if it looks like an address (contains common address words or is long enough)
                        address_lower = address_text.lower()
                        is_address = (
                            any(word in address_lower for word in [
                                'road', 'street', 'avenue', 'lane', 'nagar', 'bangalore', 
                                'bengaluru', 'india', 'floor', 'tower', 'rd', 'st', 'ave',
                                'karnataka', 'mumbai', 'delhi', 'chennai', 'hyderabad', 'pune'
                            ]) or len(address_text) > 50  # Long text is likely an address
                        )
                        
                        if is_address:
                            locations.append({
                                'time': time_value,
                                'address': address_text
                            })
                
                # Remove duplicates and keep only first two locations
                seen_addresses = set()
                unique_locations = []
                for loc in locations:
                    # Normalize address for comparison (remove extra spaces)
                    normalized_addr = ' '.join(loc['address'].split())
                    if normalized_addr not in seen_addresses:
                        seen_addresses.add(normalized_addr)
                        unique_locations.append({
                            'time': loc['time'],
                            'address': normalized_addr
                        })
                        if len(unique_locations) >= 2:
                            break
                
                # The first location is typically "from" and the second is "to"
                if len(unique_locations) >= 1:
                    trip_info["from_location"] = unique_locations[0]["address"]
                    trip_info["start_time"] = unique_locations[0]["time"]
                if len(unique_locations) >= 2:
                    trip_info["to_location"] = unique_locations[1]["address"]
                    trip_info["end_time"] = unique_locations[1]["time"]
                
            else:
                # Fallback to regex parsing if BeautifulSoup is not available
                # Extract amount
                amount_match = re.search(r'data-testid="total_fare_amount"[^>]*>([^<]+)', html_content)
                if amount_match:
                    amount_text = amount_match.group(1)
                    amount_num = re.search(r'[\d,]+\.?\d*', amount_text.replace(',', ''))
                    if amount_num:
                        trip_info["amount"] = amount_num.group()
                
                # Extract locations using regex (fallback when BeautifulSoup not available)
                # Look for time pattern in table row followed by address in next table row
                # Pattern: time in <td>...</td></tr><tr><td>address</td>
                time_address_pattern = r'<td[^>]*>(\d{1,2}:\d{2})</td>\s*</tr>\s*<tr>\s*<td[^>]*>([^<]+(?:Road|Street|Avenue|Lane|Nagar|Bangalore|Bengaluru|India|Floor|Tower|Rd|St|Ave)[^<]{20,})</td>'
                matches = re.finditer(time_address_pattern, html_content, re.IGNORECASE | re.DOTALL)
                locations = []
                seen_addresses = set()
                for match in matches:
                    address = match.group(2).strip()
                    if address not in seen_addresses and len(address) > 20:
                        seen_addresses.add(address)
                        locations.append({
                            'time': match.group(1),
                            'address': address
                        })
                        if len(locations) >= 2:
                            break
                
                if len(locations) >= 1:
                    trip_info["from_location"] = locations[0]["address"]
                    trip_info["start_time"] = locations[0]["time"]
                if len(locations) >= 2:
                    trip_info["to_location"] = locations[1]["address"]
                    trip_info["end_time"] = locations[1]["time"]
        
        except Exception as e:
            logger.warning(f"Error parsing Uber trip info: {e}")
            return None
        
        return trip_info if trip_info else None

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
            logger.error(f"Error downloading attachment {attachment_id}", exc_info=True)
            raise

    def search_emails_by_date_range(self, start_date: str, end_date: str, query: str = "") -> List[dict[str, Any]]:
        """
        Search emails within a date range with optional query
        
        Note: Gmail's 'before:' operator is exclusive, so we add 1 day to end_date
        to include emails on the end_date itself.
        """
        if not self._refresh_credentials():
            raise Exception("Failed to authenticate with Gmail")

        # Gmail's 'before:' is exclusive, so add 1 day to include the end_date
        from datetime import datetime, timedelta
        end_date_obj = datetime.strptime(end_date, "%Y/%m/%d")
        end_date_inclusive = (end_date_obj + timedelta(days=1)).strftime("%Y/%m/%d")
        
        date_query = f"after:{start_date} before:{end_date_inclusive}"
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
            logger.error("Error searching emails", exc_info=True)
            raise

    def search_emails_for_transaction(
        self,
        transaction_date: str,
        transaction_amount: float,
        date_offset_days: int = 1,
        include_amount_filter: bool = True,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
        custom_search_term: Optional[str] = None,
        search_amount: Optional[float] = None,
        also_search_amount_minus_one: bool = False
    ) -> List[dict[str, Any]]:
        """
        Search Gmail for emails related to a transaction.
        
        Args:
            transaction_date: Transaction date in YYYY-MM-DD format
            transaction_amount: Transaction amount
            date_offset_days: Days to search before/after transaction date
            include_amount_filter: Whether to filter by amount
            start_date: Custom start date (YYYY-MM-DD), overrides date_offset_days
            end_date: Custom end date (YYYY-MM-DD), overrides date_offset_days
            custom_search_term: Custom search term (e.g., 'Uber', 'Swiggy')
            search_amount: Optional override for search amount
            also_search_amount_minus_one: Also search for amount-1 (for UPI rounding)
        
        Returns:
            List of email metadata dictionaries
        """
        if not self._refresh_credentials():
            raise Exception("Failed to authenticate with Gmail")
        
        try:
            # Parse transaction date
            from datetime import datetime as dt
            trans_date = dt.strptime(transaction_date.split()[0], "%Y-%m-%d") if " " in transaction_date else dt.strptime(transaction_date, "%Y-%m-%d")
            
            # Build date range
            if start_date and end_date:
                # Use custom dates
                start = dt.strptime(start_date, "%Y-%m-%d")
                end = dt.strptime(end_date, "%Y-%m-%d")
            else:
                # Use offset from transaction date
                start = trans_date - timedelta(days=date_offset_days)
                end = trans_date + timedelta(days=date_offset_days)
            
            # Format dates for Gmail query (YYYY/MM/DD)
            start_str = start.strftime("%Y/%m/%d")
            end_str = end.strftime("%Y/%m/%d")
            date_query = f"after:{start_str} before:{end_str}"
            
            # Build search query
            query_parts = [date_query]
            
            # Add custom search term if provided
            if custom_search_term:
                query_parts.append(custom_search_term)
            
            # Add amount filter if enabled
            if include_amount_filter:
                # Use search_amount if provided, otherwise use transaction_amount
                amount_to_search = search_amount if search_amount is not None else abs(transaction_amount)
                
                # Format amount for search (handle both decimal and integer amounts)
                if amount_to_search == int(amount_to_search):
                    amount_str = str(int(amount_to_search))
                else:
                    amount_str = str(amount_to_search)
                
                # Build amount search query
                if also_search_amount_minus_one:
                    # Search for either amount or amount-1
                    amount_minus_one = amount_to_search - 1
                    if amount_minus_one == int(amount_minus_one):
                        amount_minus_one_str = str(int(amount_minus_one))
                    else:
                        amount_minus_one_str = str(amount_minus_one)
                    # Use OR to search for either amount
                    query_parts.append(f'("{amount_str}" OR "{amount_minus_one_str}")')
                else:
                    # Search for amount only
                    query_parts.append(f'"{amount_str}"')
            
            # Build final query
            full_query = " ".join(query_parts)
            
            logger.info(f"Searching emails with query: {full_query}")
            
            # Search for messages
            resp = (
                self.service.users()
                .messages()
                .list(userId="me", q=full_query, maxResults=50)
                .execute()
            )
            
            messages = resp.get("messages", [])
            logger.info(f"Found {len(messages)} matching emails")
            
            # Get detailed information for each message
            email_results = []
            for msg in messages:
                try:
                    # Get message details
                    message = (
                        self.service.users()
                        .messages()
                        .get(userId="me", id=msg["id"], format="metadata", metadataHeaders=["Subject", "From", "Date"])
                        .execute()
                    )
                    
                    # Extract headers
                    headers = message.get("payload", {}).get("headers", [])
                    subject = next((h["value"] for h in headers if h["name"] == "Subject"), "")
                    sender = next((h["value"] for h in headers if h["name"] == "From"), "")
                    date = next((h["value"] for h in headers if h["name"] == "Date"), "")
                    
                    email_results.append({
                        "id": msg["id"],
                        "subject": subject,
                        "sender": sender,
                        "date": date,
                        "snippet": message.get("snippet", "")
                    })
                except Exception as e:
                    logger.warning(f"Failed to get details for message {msg.get('id')}: {e}")
                    continue
            
            return email_results
            
        except Exception as e:
            logger.error("Error searching emails for transaction", exc_info=True)
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
            logger.error(f"Error getting email thread {thread_id}", exc_info=True)
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
            logger.error("Error downloading latest attachment", exc_info=True)
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
            logger.error("Error generating normalized filename", exc_info=True)
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
            logger.error("Error saving attachment", exc_info=True)
            return None


