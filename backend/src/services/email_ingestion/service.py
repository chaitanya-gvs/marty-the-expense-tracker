from __future__ import annotations

import asyncio
from typing import List, Dict, Any, Optional
from datetime import datetime, timedelta
import re

from src.services.email_ingestion.client import EmailClient
from src.services.llm_parser.parser import LLMExpenseParser
from src.utils.logger import get_logger

logger = get_logger(__name__)


class EmailIngestionService:
    def __init__(self):
        self.email_client = EmailClient()
        self.llm_parser = LLMExpenseParser()

    async def ingest_recent_transaction_emails(self, max_results: int = 25, days_back: int = 7) -> Dict[str, Any]:
        """Ingest recent transaction emails and extract expense data"""
        try:
            logger.info(f"Starting email ingestion for last {days_back} days")
            
            # Get recent transaction emails
            messages = self.email_client.list_recent_transaction_emails(max_results, days_back)
            
            if not messages:
                logger.info("No transaction emails found")
                return {"processed": 0, "extracted": 0, "errors": 0, "expenses": []}
            
            processed_count = 0
            extracted_count = 0
            error_count = 0
            extracted_expenses = []
            
            # Process each email
            for message in messages:
                try:
                    processed_count += 1
                    logger.info(f"Processing email {processed_count}/{len(messages)}: {message.get('id')}")
                    
                    # Get full email content
                    email_content = self.email_client.get_email_content(message['id'])
                    
                    # Extract expense data from email
                    expense_data = await self._extract_expense_from_email(email_content)
                    
                    if expense_data:
                        extracted_count += 1
                        extracted_expenses.append(expense_data)
                        logger.info(f"Successfully extracted expense: {expense_data.get('amount', 'N/A')} - {expense_data.get('description', 'N/A')}")
                    else:
                        logger.info(f"No expense data found in email: {email_content.get('subject', 'N/A')}")
                        
                except Exception as e:
                    error_count += 1
                    logger.error(f"Error processing email {message.get('id')}: {e}")
                    continue
            
            logger.info(f"Email ingestion completed. Processed: {processed_count}, Extracted: {extracted_count}, Errors: {error_count}")
            
            return {
                "processed": processed_count,
                "extracted": extracted_count,
                "errors": error_count,
                "expenses": extracted_expenses
            }
            
        except Exception as e:
            logger.error(f"Error in email ingestion: {e}")
            raise

    async def _extract_expense_from_email(self, email_content: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Extract expense information from email content using LLM"""
        try:
            # Prepare email data for LLM processing
            email_data = {
                "subject": email_content.get("subject", ""),
                "sender": email_content.get("sender", ""),
                "body": email_content.get("body", ""),
                "date": email_content.get("date", ""),
                "attachments": email_content.get("attachments", [])
            }
            
            # Use LLM to extract expense data
            expense_data = await self.llm_parser.extract_expense_from_email(email_data)
            
            if expense_data and expense_data.get("amount"):
                # Add metadata
                expense_data.update({
                    "source": "email",
                    "email_id": email_content.get("id"),
                    "email_subject": email_content.get("subject"),
                    "email_sender": email_content.get("sender"),
                    "email_date": email_content.get("date"),
                    "extracted_at": datetime.now().isoformat()
                })
                
                return expense_data
            
            return None
            
        except Exception as e:
            logger.error(f"Error extracting expense from email: {e}")
            return None

    async def search_and_ingest_emails(self, query: str, start_date: str, end_date: str) -> Dict[str, Any]:
        """Search for specific emails and ingest them"""
        try:
            logger.info(f"Searching emails with query: {query} from {start_date} to {end_date}")
            
            # Search emails
            messages = self.email_client.search_emails_by_date_range(start_date, end_date, query)
            
            if not messages:
                logger.info("No emails found matching search criteria")
                return {"processed": 0, "extracted": 0, "errors": 0, "expenses": []}
            
            processed_count = 0
            extracted_count = 0
            error_count = 0
            extracted_expenses = []
            
            # Process each email
            for message in messages:
                try:
                    processed_count += 1
                    logger.info(f"Processing search result {processed_count}/{len(messages)}: {message.get('id')}")
                    
                    # Get full email content
                    email_content = self.email_client.get_email_content(message['id'])
                    
                    # Extract expense data from email
                    expense_data = await self._extract_expense_from_email(email_content)
                    
                    if expense_data:
                        extracted_count += 1
                        extracted_expenses.append(expense_data)
                        logger.info(f"Successfully extracted expense: {expense_data.get('amount', 'N/A')} - {expense_data.get('description', 'N/A')}")
                    
                except Exception as e:
                    error_count += 1
                    logger.error(f"Error processing search result {message.get('id')}: {e}")
                    continue
            
            logger.info(f"Search and ingestion completed. Processed: {processed_count}, Extracted: {extracted_count}, Errors: {error_count}")
            
            return {
                "processed": processed_count,
                "extracted": extracted_count,
                "errors": error_count,
                "expenses": extracted_expenses
            }
            
        except Exception as e:
            logger.error(f"Error in search and ingestion: {e}")
            raise

    async def process_email_attachments(self, email_content: Dict[str, Any]) -> List[Dict[str, Any]]:
        """Process email attachments for expense data"""
        try:
            attachments = email_content.get("attachments", [])
            if not attachments:
                return []
            
            processed_attachments = []
            
            for attachment in attachments:
                try:
                    # Download attachment
                    attachment_data = self.email_client.download_attachment(
                        email_content["id"], 
                        attachment["attachment_id"]
                    )
                    
                    # Process attachment based on type
                    if attachment["mime_type"] in ["application/pdf", "image/jpeg", "image/png"]:
                        # Use OCR or PDF processing
                        processed_data = await self._process_attachment_file(
                            attachment_data, 
                            attachment["filename"], 
                            attachment["mime_type"]
                        )
                        
                        if processed_data:
                            processed_attachments.append(processed_data)
                    
                except Exception as e:
                    logger.error(f"Error processing attachment {attachment.get('filename')}: {e}")
                    continue
            
            return processed_attachments
            
        except Exception as e:
            logger.error(f"Error processing email attachments: {e}")
            return []

    async def _process_attachment_file(self, file_data: bytes, filename: str, mime_type: str) -> Optional[Dict[str, Any]]:
        """Process attachment file for expense data"""
        try:
            # For now, we'll use the LLM parser to extract text and parse it
            # In the future, you might want to add OCR processing here
            
            if mime_type.startswith("image/"):
                # Use OCR to extract text from images
                from src.services.ocr_engine.engine import OCREngine
                ocr_engine = OCREngine()
                extracted_text = await ocr_engine.extract_text_from_image(file_data)
                
                if extracted_text:
                    # Use LLM to parse the extracted text
                    expense_data = await self.llm_parser.extract_expense_from_text(extracted_text)
                    if expense_data:
                        expense_data.update({
                            "source": "email_attachment",
                            "filename": filename,
                            "mime_type": mime_type
                        })
                        return expense_data
            
            return None
            
        except Exception as e:
            logger.error(f"Error processing attachment file {filename}: {e}")
            return None

    def get_email_statistics(self, days_back: int = 30) -> Dict[str, Any]:
        """Get statistics about transaction emails"""
        try:
            # Get emails from different time periods
            recent_emails = self.email_client.list_recent_transaction_emails(max_results=100, days_back=days_back)
            
            # Group by sender domain
            sender_stats = {}
            for email in recent_emails:
                try:
                    email_content = self.email_client.get_email_content(email['id'])
                    sender = email_content.get('sender', '')
                    
                    # Extract domain from email
                    domain_match = re.search(r'@([^>]+)', sender)
                    if domain_match:
                        domain = domain_match.group(1)
                        sender_stats[domain] = sender_stats.get(domain, 0) + 1
                except Exception as e:
                    logger.error(f"Error getting email content for stats: {e}")
                    continue
            
            return {
                "total_emails": len(recent_emails),
                "sender_statistics": sender_stats,
                "period_days": days_back
            }
            
        except Exception as e:
            logger.error(f"Error getting email statistics: {e}")
            raise
