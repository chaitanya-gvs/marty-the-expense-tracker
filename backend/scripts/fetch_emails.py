#!/usr/bin/env python3
"""
Gmail Email Fetcher Script

This script fetches and displays emails from Gmail using the configured OAuth setup.
It can search for emails from specific senders, with specific subjects, or recent emails.

Usage:
    poetry run python scripts/fetch_emails.py --sender amazon.com --limit 5
    poetry run python scripts/fetch_emails.py --subject "receipt" --limit 10
    poetry run python scripts/fetch_emails.py --recent --limit 20
    poetry run python scripts/fetch_emails.py --days 7 --limit 15
"""

import argparse
import sys
import json
from pathlib import Path
from datetime import datetime, timedelta
from typing import List, Dict, Any, Optional

# Add the backend directory to Python path
backend_path = Path(__file__).parent.parent
sys.path.insert(0, str(backend_path))

from src.services.email_ingestion.client import EmailClient
from src.utils.settings import get_settings
from src.utils.logger import get_logger

logger = get_logger(__name__)


class EmailFetcher:
    def __init__(self):
        self.email_client = EmailClient()
        self.settings = get_settings()

    def fetch_emails_by_sender(self, sender: str, limit: int = 10) -> List[Dict[str, Any]]:
        """Fetch emails from a specific sender"""
        try:
            logger.info(f"Fetching emails from {sender} (limit: {limit})")
            
            # Build query for sender
            query = f"from:{sender}"
            
            # Get emails from the last 30 days
            date_filter = (datetime.now() - timedelta(days=30)).strftime("%Y/%m/%d")
            query += f" after:{date_filter}"
            
            messages = self.email_client.search_emails_by_date_range(
                start_date=date_filter,
                end_date=datetime.now().strftime("%Y/%m/%d"),
                query=query
            )
            
            # Limit results
            messages = messages[:limit]
            
            # Get full content for each email
            emails = []
            for message in messages:
                try:
                    email_content = self.email_client.get_email_content(message['id'])
                    emails.append(email_content)
                except Exception as e:
                    logger.error(f"Error getting content for email {message['id']}: {e}")
                    continue
            
            return emails
            
        except Exception as e:
            logger.error(f"Error fetching emails from {sender}: {e}")
            raise

    def fetch_emails_by_subject(self, subject: str, limit: int = 10) -> List[Dict[str, Any]]:
        """Fetch emails with specific subject keywords"""
        try:
            logger.info(f"Fetching emails with subject '{subject}' (limit: {limit})")
            
            # Build query for subject
            query = f"subject:{subject}"
            
            # Get emails from the last 30 days
            date_filter = (datetime.now() - timedelta(days=30)).strftime("%Y/%m/%d")
            query += f" after:{date_filter}"
            
            messages = self.email_client.search_emails_by_date_range(
                start_date=date_filter,
                end_date=datetime.now().strftime("%Y/%m/%d"),
                query=query
            )
            
            # Limit results
            messages = messages[:limit]
            
            # Get full content for each email
            emails = []
            for message in messages:
                try:
                    email_content = self.email_client.get_email_content(message['id'])
                    emails.append(email_content)
                except Exception as e:
                    logger.error(f"Error getting content for email {message['id']}: {e}")
                    continue
            
            return emails
            
        except Exception as e:
            logger.error(f"Error fetching emails with subject '{subject}': {e}")
            raise

    def fetch_recent_transaction_emails(self, limit: int = 10, days_back: int = 7) -> List[Dict[str, Any]]:
        """Fetch recent transaction emails"""
        try:
            logger.info(f"Fetching recent transaction emails (limit: {limit}, days: {days_back})")
            
            messages = self.email_client.list_recent_transaction_emails(
                max_results=limit,
                days_back=days_back
            )
            
            # Get full content for each email
            emails = []
            for message in messages:
                try:
                    email_content = self.email_client.get_email_content(message['id'])
                    emails.append(email_content)
                except Exception as e:
                    logger.error(f"Error getting content for email {message['id']}: {e}")
                    continue
            
            return emails
            
        except Exception as e:
            logger.error(f"Error fetching recent transaction emails: {e}")
            raise

    def fetch_emails_by_date_range(self, days_back: int, limit: int = 10) -> List[Dict[str, Any]]:
        """Fetch emails from a specific date range"""
        try:
            logger.info(f"Fetching emails from last {days_back} days (limit: {limit})")
            
            start_date = (datetime.now() - timedelta(days=days_back)).strftime("%Y/%m/%d")
            end_date = datetime.now().strftime("%Y/%m/%d")
            
            messages = self.email_client.search_emails_by_date_range(
                start_date=start_date,
                end_date=end_date,
                query=""
            )
            
            # Limit results
            messages = messages[:limit]
            
            # Get full content for each email
            emails = []
            for message in messages:
                try:
                    email_content = self.email_client.get_email_content(message['id'])
                    emails.append(email_content)
                except Exception as e:
                    logger.error(f"Error getting content for email {message['id']}: {e}")
                    continue
            
            return emails
            
        except Exception as e:
            logger.error(f"Error fetching emails by date range: {e}")
            raise

    def display_email(self, email: Dict[str, Any], index: int = 0) -> None:
        """Display a single email in a formatted way"""
        print(f"\n{'='*80}")
        print(f"EMAIL #{index + 1}")
        print(f"{'='*80}")
        print(f"Subject: {email.get('subject', 'No subject')}")
        print(f"From: {email.get('sender', 'Unknown sender')}")
        print(f"Date: {email.get('date', 'Unknown date')}")
        print(f"ID: {email.get('id', 'Unknown ID')}")
        
        # Show attachments if any
        attachments = email.get('attachments', [])
        if attachments:
            print(f"Attachments: {len(attachments)}")
            for i, attachment in enumerate(attachments):
                print(f"  {i+1}. {attachment.get('filename', 'Unknown')} ({attachment.get('mime_type', 'Unknown type')})")
        
        # Show email body (truncated)
        body = email.get('body', '')
        if body:
            # Truncate body if too long
            max_length = 500
            if len(body) > max_length:
                body = body[:max_length] + "..."
            print(f"\nBody:\n{body}")
        else:
            print("\nBody: No text content")
        
        print(f"{'='*80}")

    def display_emails_summary(self, emails: List[Dict[str, Any]]) -> None:
        """Display a summary of fetched emails"""
        if not emails:
            print("No emails found.")
            return
        
        print(f"\n📧 Found {len(emails)} emails:")
        print("-" * 80)
        
        for i, email in enumerate(emails):
            subject = email.get('subject', 'No subject')
            sender = email.get('sender', 'Unknown sender')
            date = email.get('date', 'Unknown date')
            
            # Truncate long fields
            subject = subject[:50] + "..." if len(subject) > 50 else subject
            sender = sender[:40] + "..." if len(sender) > 40 else sender
            
            print(f"{i+1:2d}. {subject}")
            print(f"     From: {sender}")
            print(f"     Date: {date}")
            print()


def main():
    parser = argparse.ArgumentParser(description="Fetch emails from Gmail")
    parser.add_argument("--sender", help="Search for emails from specific sender (e.g., amazon.com)")
    parser.add_argument("--subject", help="Search for emails with specific subject keywords")
    parser.add_argument("--recent", action="store_true", help="Fetch recent transaction emails")
    parser.add_argument("--days", type=int, help="Fetch emails from last N days")
    parser.add_argument("--limit", type=int, default=10, help="Maximum number of emails to fetch (default: 10)")
    parser.add_argument("--detailed", action="store_true", help="Show detailed email content")
    parser.add_argument("--json", action="store_true", help="Output in JSON format")
    
    args = parser.parse_args()
    
    # Check if we're in the right directory
    if not Path("pyproject.toml").exists():
        print("❌ Please run this script from the backend directory")
        sys.exit(1)
    
    # Validate arguments
    if not any([args.sender, args.subject, args.recent, args.days]):
        print("❌ Please specify one of: --sender, --subject, --recent, or --days")
        parser.print_help()
        sys.exit(1)
    
    try:
        fetcher = EmailFetcher()
        emails = []
        
        if args.sender:
            emails = fetcher.fetch_emails_by_sender(args.sender, args.limit)
        elif args.subject:
            emails = fetcher.fetch_emails_by_subject(args.subject, args.limit)
        elif args.recent:
            emails = fetcher.fetch_recent_transaction_emails(args.limit)
        elif args.days:
            emails = fetcher.fetch_emails_by_date_range(args.days, args.limit)
        
        if args.json:
            # Output as JSON
            print(json.dumps(emails, indent=2, default=str))
        elif args.detailed:
            # Show detailed content
            for i, email in enumerate(emails):
                fetcher.display_email(email, i)
        else:
            # Show summary
            fetcher.display_emails_summary(emails)
        
        print(f"\n✅ Successfully fetched {len(emails)} emails")
        
    except Exception as e:
        print(f"❌ Error: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()

