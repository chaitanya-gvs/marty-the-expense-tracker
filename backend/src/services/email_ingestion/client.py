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
            
            # Extract Swiggy order info if this is a Swiggy email
            swiggy_order_info = None
            if "swiggy" in subject.lower() or "swiggy" in sender.lower():
                html_content = self._extract_html_content(message.get("payload", {}))
                if html_content:
                    swiggy_order_info = self._parse_swiggy_order_info(html_content)
            
            # Detect merchant type for generic merchant info
            merchant_info = self._detect_merchant_info(subject, sender, body)
            
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
            
            if swiggy_order_info:
                result["swiggy_order_info"] = swiggy_order_info
            
            if merchant_info:
                result["merchant_info"] = merchant_info
            
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
                
                # --- PRE-PROCESSING: REMOVE NOISE ---
                # Remove style, script, and other non-visible tags to prevent CSS leakage
                for tag in soup(["script", "style", "meta", "link", "noscript", "iframe"]):
                    tag.decompose()
                
                # Get clean plain text for regex searches where structure is less distinct
                plain_text = soup.get_text(separator=' ', strip=True)
                
                # --- 1. AMOUNT ---
                # Try specific data attributes first (most reliable)
                amount_elem = soup.find(attrs={"data-testid": "total_fare_amount"})
                if amount_elem:
                    amount_text = amount_elem.get_text(strip=True)
                    amount_match = re.search(r'[\d,]+\.?\d*', amount_text.replace(',', ''))
                    if amount_match:
                        trip_info["amount"] = amount_match.group()
                
                # Fallback: Look for "Total" followed by price in plain text
                if "amount" not in trip_info:
                    total_match = re.search(r'Total\s*(?:Fare|:)?\s*₹?\s*(\d+(?:,\d+)*(?:\.\d{2})?)', plain_text, re.I)
                    if total_match:
                         trip_info["amount"] = total_match.group(1).replace(',', '')

                # --- 2. VEHICLE TYPE ---
                # Search in clean plain text only
                # Patterns ordered by specificity
                vehicle_patterns = [
                    (r'\bUber\s*Premier\b', 'Uber Premier'),
                    (r'\bUber\s*XL\b', 'Uber XL'),
                    (r'\bUber\s*Go\s*Sedan\b', 'Uber Go Sedan'),
                    (r'\bUber\s*Go\b', 'Uber Go'),
                    (r'\bUber\s*Auto\b', 'Auto'),
                    (r'\bAuto\b', 'Auto'),
                    (r'\bMoto\b', 'Moto'),
                    (r'\bUber\s*X\b', 'Uber X'),
                    (r'\bUber\s*Intercity\b', 'Uber Intercity'),
                    (r'\bSedan\b', 'Sedan')  # Generic fallback
                ]
                
                for pattern, name in vehicle_patterns:
                    if re.search(pattern, plain_text, re.I):
                        trip_info["vehicle_type"] = name
                        break

                # --- 3. LOCATIONS (Pickup / Drop) ---
                # Uber emails typically list locations with timestamps
                # Look for time patterns (HH:MM) which act as anchors for addresses
                
                locations = []
                time_pattern = re.compile(r'(\d{1,2}:\d{2}\s*(?:AM|PM)?)', re.I)
                
                # Find all text nodes that look like times
                time_nodes = soup.find_all(string=time_pattern)
                
                for node in time_nodes:
                    time_val = node.strip()
                    parent = node.parent
                    if not parent: continue
                    
                    # Heuristic: The address is usually nearby in the DOM
                    # 1. Check siblings (common in some templates)
                    # 2. Check next table row (common in others)
                    # 3. Check "cousin" elements (up to tr, then next tr, then down)
                    
                    address_candidate = None
                    
                    # Check next sibling text
                    next_node = node.find_next(string=True)
                    if next_node and len(next_node.strip()) > 10 and not re.search(time_pattern, next_node):
                         address_candidate = next_node.strip()
                    
                    # If not found, check table structure (common in receipts)
                    # <tr><td>Time</td><td>Address</td></tr> OR <tr><td>Time</td></tr><tr><td>Address</td></tr>
                    if not address_candidate:
                        row = parent.find_parent('tr')
                        if row:
                            # Try next cell in same row
                            cells = row.find_all(['td', 'th'])
                            for i, cell in enumerate(cells):
                                if time_val in cell.get_text():
                                    if i + 1 < len(cells):
                                        text = cells[i+1].get_text(strip=True)
                                        if len(text) > 10: 
                                            address_candidate = text
                                    break
                            
                            # Try next row
                            if not address_candidate:
                                next_row = row.find_next_sibling('tr')
                                if next_row:
                                    text = next_row.get_text(separator=' ', strip=True)
                                    # clean up
                                    if len(text) > 10 and text != time_val:
                                        address_candidate = text

                    if address_candidate:
                        # Exclude common non-address phrases
                        skip_phrases = [
                            'Thanks for riding', 'Total', 'Fare', 'Switch payment', 
                            'Download', 'Help', 'Support', 'Rate or tip', 'Uber One',
                            'License Plate', 'Trip details'
                        ]
                        
                        # Validate address heuristic
                        is_addr = (len(address_candidate) > 12 and 
                                  not re.search(r'₹', address_candidate) and
                                  not any(phrase.lower() in address_candidate.lower() for phrase in skip_phrases))
                        
                        # Avoid duplicates
                        if is_addr and not any(loc['address'] == address_candidate for loc in locations):
                            locations.append({
                                'time': time_val,
                                'address': address_candidate
                            })
                            if len(locations) >= 2: break
                
                if len(locations) >= 1:
                    trip_info["from_location"] = locations[0]["address"]
                    trip_info["start_time"] = locations[0]["time"]
                if len(locations) >= 2:
                    trip_info["to_location"] = locations[1]["address"]
                    trip_info["end_time"] = locations[1]["time"]
                
                
                # --- 4. FARE BREAKDOWN (Items) ---
                items = []
                
                # Keywords identifying fare items
                fare_keywords = [
                    'Base Fare', 'Distance', 'Time', 'Subtotal', 'Booking Fee', 
                    'Promotion', 'Tolls', 'Taxes', 'Rounding', 'Wait Time', 
                    'Cancellation Fee', 'Access Fee', 'Surge', 'Insurance',
                    'Suggested fare', 'Trip Fare', 'Ride Fare'
                ]
                
                # Find the fare breakdown section
                # Usually a table. look for rows containing our keywords.
                
                # Iterate all table rows in the document
                for row in soup.find_all('tr'):
                    row_text = row.get_text(separator=' ', strip=True)
                    
                    # Check if this row looks like a fare item: "Name ... Amount"
                    for keyword in fare_keywords:
                        if keyword.lower() in row_text.lower():
                            # Try to extract name and amount
                            # Usually <td>Name</td> <td>Amount</td>
                            cells = row.find_all('td')
                            if len(cells) >= 2:
                                name_text = cells[0].get_text(strip=True)
                                amount_text = cells[-1].get_text(strip=True) # Amount usually last
                                
                                # Verify amount looks like currency
                                amount_match = re.search(r'[\d,]+\.?\d*', amount_text.replace(',', ''))
                                if amount_match and len(name_text) < 50:
                                    items.append({
                                        "name": name_text,
                                        "quantity": 1,
                                        # Optional: store price if we want, schema expects name/qty, maybe price in name?
                                        # For now, just name is fine, usage might vary.
                                    })
                                    # Append price to name for clarity in UI? "Base Fare (₹45.00)"
                                    items[-1]["name"] = f"{name_text} ({amount_text})"
                            break
                
                if items:
                    trip_info["items"] = items

                # Extract distance/duration
                dist_match = re.search(r'(\d+\.?\d*)\s*(kilometres|km)', plain_text, re.I)
                if dist_match:
                    trip_info["distance"] = f"{dist_match.group(1)} {dist_match.group(2)}"
                
                dur_match = re.search(r'(\d+)\s*(min|min\.|minutes)', plain_text, re.I)
                if dur_match:
                    trip_info["duration"] = f"{dur_match.group(1)} min"

            else:
                # RegEx fallback (simplified)
                # Cleanup
                plain_text = re.sub(r'<style[^>]*>.*?</style>', '', html_content, flags=re.DOTALL | re.IGNORECASE)
                plain_text = re.sub(r'<[^>]+>', ' ', plain_text)
                
                amount_match = re.search(r'Total\s*₹?\s*(\d+(?:,\d+)*(?:\.\d{2})?)', plain_text, re.I)
                if amount_match:
                    trip_info["amount"] = amount_match.group(1).replace(',', '')
                
                if 'Uber Auto' in plain_text: trip_info["vehicle_type"] = 'Auto'
                elif 'Uber Go' in plain_text: trip_info["vehicle_type"] = 'Uber Go'
                elif 'Uber Premier' in plain_text: trip_info["vehicle_type"] = 'Uber Premier'
                
        except Exception as e:
            logger.warning(f"Error parsing Uber trip info: {e}")
            return None
        
        return trip_info if trip_info else None

    def _parse_swiggy_order_info(self, html_content: str) -> Optional[dict[str, Any]]:
        """Parse Swiggy order information from email HTML"""
        if not html_content:
            return None
        
        order_info = {}
        
        try:
            if HAS_BS4:
                soup = BeautifulSoup(html_content, 'html.parser')
                
                # Get plain text for easier pattern matching
                plain_text = soup.get_text(separator=' ', strip=True)
                
                # Detect order type
                is_instamart = False
                if 'instamart' in plain_text.lower() or 'instamart' in str(html_content).lower():
                    order_info["order_type"] = "Instamart"
                    is_instamart = True
                    order_info["restaurant_name"] = "Swiggy Instamart"
                elif 'dineout' in plain_text.lower():
                    order_info["order_type"] = "Dineout"
                elif 'delivery' in plain_text.lower() or 'delivered' in plain_text.lower():
                    order_info["order_type"] = "Food Delivery"
                
                # Extract restaurant name (skip for Instamart as it's already set)
                if not is_instamart:
                    # Pattern: <p>Restaurant</p> followed by <h5>Restaurant Name</h5>
                    restaurant_label = soup.find('p', string=re.compile(r'^\s*Restaurant\s*$', re.I))
                    if restaurant_label:
                        # Look for h5 in the same parent or next sibling
                        parent = restaurant_label.find_parent()
                        if parent:
                            restaurant_h5 = parent.find('h5')
                            if restaurant_h5:
                                restaurant_name = restaurant_h5.get_text(strip=True)
                                if restaurant_name and len(restaurant_name) < 100:
                                    order_info["restaurant_name"] = restaurant_name
                    
                    # Fallback: Look for "at [Restaurant Name] was completed" pattern (Swiggy Dineout)
                    if "restaurant_name" not in order_info:
                        restaurant_match = re.search(r'at\s+([A-Z][A-Za-z\s&\'-]+?)\s+was\s+completed', plain_text)
                        if restaurant_match:
                            restaurant_name = restaurant_match.group(1).strip()
                            if len(restaurant_name) < 50 and restaurant_name not in ['Here', 'Your']:
                                order_info["restaurant_name"] = restaurant_name

                # Extract amount
                # For Instamart, prioritize extracting "Grand Total" from Order Summary table
                if is_instamart:
                    # Look for "Grand Total" in a table cell
                    grand_total_elem = soup.find(string=re.compile(r'Grand\s*Total', re.I))
                    if grand_total_elem:
                        # The amount is usually in the next cell or in the same row
                        row = grand_total_elem.find_parent('tr')
                        if row:
                            # Look for currency pattern in the row
                            amount_text = row.get_text(strip=True)
                            amount_match = re.search(r'₹?\s*(\d+(?:,\d+)*(?:\.\d{2})?)', amount_text)
                            if amount_match:
                                order_info["amount"] = amount_match.group(1).replace(',', '')
                
                # If amount not found (or not Instamart), try standard methods
                if "amount" not in order_info:
                    # Extract order amount from grand-total row
                    # Pattern: <tr class="grand-total">...<td>₹ 587</td></tr>
                    grand_total_row = soup.find('tr', class_='grand-total')
                    if grand_total_row:
                        amount_td = grand_total_row.find('td')
                        if amount_td:
                            amount_text = amount_td.get_text(strip=True)
                            # Extract number from text like "₹ 587" or "₹587"
                            amount_match = re.search(r'₹?\s*(\d+(?:,\d+)*(?:\.\d{2})?)', amount_text)
                            if amount_match:
                                order_info["amount"] = amount_match.group(1).replace(',', '')
                
                # Fallback amount extraction
                if "amount" not in order_info:
                    amount_patterns = [
                        r'Grand\s*Total[:\s]+₹?\s*(\d+(?:,\d+)*(?:\.\d{2})?)',
                        r'Order Total[:\s]+₹?\s*(\d+(?:,\d+)*(?:\.\d{2})?)',
                        r'payment of Rs\.\s*(\d+(?:,\d+)*)',  # Swiggy Dineout pattern
                        r'₹\s*(\d+(?:,\d+)*(?:\.\d{2})?)',
                        r'Rs\.?\s*(\d+(?:,\d+)*(?:\.\d{2})?)'
                    ]
                    
                    for pattern in amount_patterns:
                        amount_match = re.search(pattern, plain_text, re.I)
                        if amount_match:
                            amount_str = amount_match.group(1).replace(',', '')
                            order_info["amount"] = amount_str
                            break
                
                # Extract delivery address
                # Pattern: <p>Delivery To:</p> followed by <h5> tags with address parts
                # Instamart also uses "Deliver To:" or similar
                delivery_label = soup.find(string=re.compile(r'Deliver\w*\s+To:', re.I))
                if delivery_label:
                    parent = delivery_label.find_parent()
                    # Go up one more level if parent is just a formatting tag
                    if parent and parent.name in ['strong', 'b', 'span']:
                        parent = parent.find_parent()
                        
                    if parent:
                        # Collect all h5 tags after the label in the container
                        # For Instamart, address might be in p tags or just text following the label
                        container = parent.find_parent()
                        if container:
                            address_parts = []
                            # Try food delivery structure first
                            for h5 in container.find_all('h5'):
                                text = h5.get_text(strip=True)
                                if text:
                                    address_parts.append(text)
                            
                            if not address_parts:
                                # Try Instamart structure (often just text in div/p)
                                # Look for text content after the label
                                full_text = container.get_text(separator=' ', strip=True)
                                addr_match = re.search(r'Deliver\w*\s+To:\s*(.*?)(?:\s*Order|$)', full_text, re.I)
                                if addr_match:
                                    addr_text = addr_match.group(1).strip()
                                    if len(addr_text) > 10:
                                        address_parts.append(addr_text)

                        if address_parts:
                            # Join address parts, skipping the first one if it's just a name
                            if len(address_parts) > 1 and len(address_parts[0]) < 20 and not re.search(r'\d', address_parts[0]):
                                address_parts = address_parts[1:]
                            order_info["delivery_address"] = ', '.join(address_parts)
                
                # Fallback: Extract date/time from "Order delivered at" pattern
                datetime_match = re.search(r'(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),\s+([A-Z][a-z]+\s+\d{1,2},\s+\d{4})\s+(\d{1,2}:\d{2}\s*(?:AM|PM)?)', plain_text, re.I)
                if datetime_match:
                    order_info["order_date"] = datetime_match.group(2)
                    order_info["order_time"] = datetime_match.group(3)
                
                # Extract order ID
                order_id_match = re.search(r'Order\s*(?:#|No\.?|ID)?[:\s]*(\d+)', plain_text, re.I)
                if order_id_match:
                    order_info["order_id"] = order_id_match.group(1)
                
                # Extract order items
                items = []
                
                if is_instamart:
                    # Instamart items are often in individual tables or different structure
                    # Strategy: Look for rows with "Item Name" headers or just parse all tables looking for quantity pattern
                    # Instamart items often look like: <td>1 x Item Name</td> <td>₹Price</td>
                    
                    # Find all tables
                    tables = soup.find_all('table')
                    for table in tables:
                        # Convert table to text to see if it looks like an item
                        table_text = table.get_text(separator=' ', strip=True)
                        
                        # Skip summary tables
                        if any(k in table_text.lower() for k in ['grand total', 'item bill', 'handling fee', 'delivery partner fee']):
                            continue
                            
                        # Look for item pattern: quantity explicitly like "1 x " or just number start
                        # Instamart items usually have quantity "N x " at start of a cell
                        # Check rows
                        for row in table.find_all('tr'):
                            cells = row.find_all('td')
                            if not cells: 
                                continue
                                
                            cell_text = cells[0].get_text(strip=True)
                            # Match "1 x Item Name"
                            item_match = re.match(r'^(\d+)\s*x\s+(.+)$', cell_text, re.I)
                            if item_match:
                                quantity = int(item_match.group(1))
                                item_name = item_match.group(2).strip()
                                items.append({
                                    "name": item_name,
                                    "quantity": quantity
                                })
                elif order_info.get("order_type") == "Dineout":
                     # Dineout Bill Details -> Items
                     # Parse the "Bill Details" table
                     bill_header = soup.find(string=re.compile(r'Bill\s*Details', re.I))
                     if bill_header:
                         # Find the table containing this header
                         table = bill_header.find_parent('table')
                         if table:
                             for row in table.find_all('tr'):
                                 cells = row.find_all('td')
                                 if len(cells) >= 2:
                                     name = cells[0].get_text(strip=True)
                                     value_text = cells[1].get_text(strip=True)
                                     
                                     # Skip header row if parsed
                                     if "Bill Details" in name:
                                         continue
                                         
                                     # Check specific rows to extract main amount
                                     if "Total Paid" in name:
                                         amount_match = re.search(r'₹?\s*(\d+(?:,\d+)*(?:\.\d{2})?)', value_text)
                                         if amount_match:
                                             order_info["amount"] = amount_match.group(1).replace(',', '')
                                         continue

                                     # User requested to remove items for Dineout entirely
                                     # So we skip adding them to the items list
                             
                             # Also try to extract Restaurant Name from "Paid to:" pattern if not found
                             if "restaurant_name" not in order_info:
                                 paid_to_match = re.search(r'Paid\s+to:\s*([^,]+)', plain_text, re.I)
                                 if paid_to_match:
                                     order_info["restaurant_name"] = paid_to_match.group(1).strip()
                                     
                             # Try to extract address from "Paid to:" line
                             # Stop at "Here are the details" or newline
                             paid_to_full = re.search(r'Paid\s+to:\s*(.*?)(?:\s+Here\s+are\s+the\s+details|\n|$)', plain_text, re.I)
                             if paid_to_full:
                                 full_addr = paid_to_full.group(1).strip()
                                 # If it contains commas, assume parts after first comma are address
                                 parts = full_addr.split(',', 1)
                                 if len(parts) > 1:
                                     addr_clean = parts[1].strip()
                                     # Truncate if it's still too long (likely captured garbage)
                                     if len(addr_clean) > 100:
                                         addr_clean = addr_clean[:100] + "..."
                                     order_info["delivery_address"] = addr_clean

                else:
                    # Food Delivery items extraction
                    # Pattern: Table with header containing "Item Name", "Quantity", "Price"
                    item_header = soup.find('th', string=re.compile(r'Item\s+Name', re.I))
                    if item_header:
                        table = item_header.find_parent('table')
                        if table:
                            # Find all rows in the table body
                            for row in table.find_all('tr'):
                                cells = row.find_all('td')
                                if len(cells) >= 2:
                                    item_name = cells[0].get_text(strip=True)
                                    # Filter out cost breakdown rows (Item Total, Platform Fee, etc.)
                                    # Only include actual food items
                                    cost_keywords = [
                                        'total', 'fee', 'discount', 'tax', 'taxes', 'paid', 
                                        'packaging', 'delivery', 'applied', 'charge', 'gst',
                                        'cgst', 'sgst', 'igst', 'subtotal', 'grand total'
                                    ]
                                    is_cost_row = any(keyword in item_name.lower() for keyword in cost_keywords)
                                    
                                    # Check if there's a quantity or price
                                    if item_name and len(item_name) < 100 and not is_cost_row:
                                        # Try to find quantity (usually in format "1" or "2")
                                        quantity = 1
                                        if len(cells) >= 3:
                                            qty_text = cells[1].get_text(strip=True)
                                            qty_match = re.search(r'(\d+)', qty_text)
                                            if qty_match:
                                                quantity = int(qty_match.group(1))
                                        
                                        items.append({
                                            "name": item_name,
                                            "quantity": quantity
                                        })
                
                if items:
                    order_info["items"] = items

                # Extract savings/discount (Swiggy Dineout specific)
                savings_match = re.search(r'You saved Rs\.\s*(\d+(?:,\d+)*)', plain_text, re.I)
                if savings_match:
                    order_info["savings"] = savings_match.group(1).replace(',', '')
                
                # Extract number of diners (Swiggy Dineout specific)
                diners_match = re.search(r'for\s+(\d+)\s+(?:people|diners)', plain_text, re.I)
                if diners_match:
                    order_info["num_diners"] = int(diners_match.group(1))
                
            else:
                # Fallback to regex parsing if BeautifulSoup is not available
                plain_text = re.sub(r'<[^>]+>', ' ', html_content)
                
                # Detect Instamart
                if 'instamart' in plain_text.lower():
                    order_info["order_type"] = "Instamart"
                    order_info["restaurant_name"] = "Swiggy Instamart"
                
                # Extract restaurant name (if not Instamart)
                if "restaurant_name" not in order_info:
                    restaurant_match = re.search(r'Restaurant\s*</p>\s*<h5[^>]*>([^<]+)</h5>', html_content, re.I)
                    if restaurant_match:
                        order_info["restaurant_name"] = restaurant_match.group(1).strip()
                
                # Extract amount from grand-total
                amount_match = re.search(r'class="grand-total"[^>]*>.*?<td[^>]*>\s*₹?\s*(\d+(?:,\d+)*(?:\.\d{2})?)', html_content, re.I | re.DOTALL)
                if amount_match:
                    order_info["amount"] = amount_match.group(1).replace(',', '')
                else:
                    # Fallback for Instamart
                     amount_match = re.search(r'Grand\s*Total.*?₹?\s*(\d+(?:,\d+)*(?:\.\d{2})?)', plain_text, re.I | re.DOTALL)
                     if amount_match:
                        order_info["amount"] = amount_match.group(1).replace(',', '')
                
                # Extract order ID
                order_id_match = re.search(r'Order\s*(?:#|No\.?|ID)?[:\s]*(\d+)', plain_text, re.I)
                if order_id_match:
                    order_info["order_id"] = order_id_match.group(1)
        
        except Exception as e:
            logger.warning(f"Error parsing Swiggy order info: {e}")
            return None
        
        return order_info if order_info else None

    def _detect_merchant_info(self, subject: str, sender: str, body: str) -> Optional[dict[str, Any]]:
        """Detect merchant type and extract basic info from email"""
        merchant_info = None
        
        # Define merchant patterns
        merchants = {
            'uber': {'type': 'ride_sharing', 'patterns': ['uber']},
            'ola': {'type': 'ride_sharing', 'patterns': ['ola', 'olacabs']},
            'swiggy': {'type': 'food_delivery', 'patterns': ['swiggy']},
            'zomato': {'type': 'food_delivery', 'patterns': ['zomato']},
            'amazon': {'type': 'ecommerce', 'patterns': ['amazon']},
            'flipkart': {'type': 'ecommerce', 'patterns': ['flipkart']},
            'bigbasket': {'type': 'ecommerce', 'patterns': ['bigbasket']},
            'myntra': {'type': 'ecommerce', 'patterns': ['myntra']},
            'paytm': {'type': 'other', 'patterns': ['paytm']},
            'phonepe': {'type': 'other', 'patterns': ['phonepe']},
        }
        
        # Check subject and sender for merchant patterns
        combined_text = f"{subject} {sender}".lower()
        
        for merchant_name, merchant_data in merchants.items():
            for pattern in merchant_data['patterns']:
                if pattern in combined_text:
                    merchant_info = {
                        'merchant_name': merchant_name.capitalize(),
                        'merchant_type': merchant_data['type']
                    }
                    
                    # Try to extract order/transaction ID
                    order_id_match = re.search(r'(?:Order|Transaction|Trip|Booking)\s*(?:#|ID|No\.?)?[:\s]*([A-Z0-9-]+)', subject, re.I)
                    if order_id_match:
                        merchant_info['order_id'] = order_id_match.group(1)
                    
                    return merchant_info
        
        return None


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


