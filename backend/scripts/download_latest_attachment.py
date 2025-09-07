#!/usr/bin/env python3
"""
Download Latest Attachment Script

This script downloads the latest attachment from a specific sender's email.
Useful for getting the latest bank statements automatically.
"""

import sys
import argparse
from pathlib import Path
from typing import Optional, List, Dict, Any

# Add the backend directory to Python path
backend_path = Path(__file__).parent.parent
sys.path.insert(0, str(backend_path))

from src.services.email_ingestion.client import EmailClient
from src.utils.logger import get_logger

logger = get_logger(__name__)


class LatestAttachmentDownloader:
    """Download the latest attachment from a specific sender"""
    
    def __init__(self):
        self.email_client = EmailClient()
        
        # Create output directory
        self.download_dir = Path("data/statements/locked_statements")
        self.download_dir.mkdir(parents=True, exist_ok=True)
    
    def download_latest_attachment(self, sender_email: str, file_type: str = "pdf") -> Optional[Dict[str, Any]]:
        """
        Download the latest attachment from a specific sender with normalized filename
        
        Args:
            sender_email: Email address of the sender
            file_type: Type of file to download (default: pdf)
            
        Returns:
            Dictionary containing download results, or None if failed
        """
        try:
            # Use the new normalized naming method from EmailClient
            result = self.email_client.download_latest_attachment_with_normalized_name(
                sender_email=sender_email,
                file_type=file_type,
                download_dir=str(self.download_dir)
            )
            
            if result and result.get("success"):
                logger.info(f"✅ Successfully downloaded attachment with normalized name")
                return result
            else:
                logger.error(f"❌ Failed to download attachment: {result.get('error') if result else 'Unknown error'}")
                return result
                
        except Exception as e:
            logger.error(f"Error downloading latest attachment: {e}")
            return {
                "success": False,
                "error": str(e)
            }
    
    
    def list_senders(self) -> List[str]:
        """List common sender emails for bank statements"""
        return [
            "cc.statements@axisbank.com",
            "statements@hdfcbank.com", 
            "statements@icicibank.com",
            "statements@sbi.co.in",
            "estatement@yesbank.in"
        ]


def main():
    """Main entry point"""
    parser = argparse.ArgumentParser(description="Download latest attachment from a specific sender")
    parser.add_argument("sender_email", help="Email address of the sender")
    parser.add_argument("--file-type", default="pdf", help="Type of file to download (default: pdf)")
    parser.add_argument("--list-senders", action="store_true", help="List common bank statement senders")
    
    args = parser.parse_args()
    
    downloader = LatestAttachmentDownloader()
    
    if args.list_senders:
        print("🏦 Common Bank Statement Senders:")
        for sender in downloader.list_senders():
            print(f"  📧 {sender}")
        return
    
    print(f"📧 Downloading latest {args.file_type.upper()} attachment from: {args.sender_email}")
    print("-" * 60)
    
    try:
        # Download latest attachment
        result = downloader.download_latest_attachment(args.sender_email, args.file_type)
        
        if result and result.get("success"):
            print("✅ Download successful!")
            print(f"📨 Email: {result.get('email_subject')}")
            print(f"📅 Date: {result.get('email_date')}")
            print(f"📎 Original filename: {result.get('original_filename')}")
            print(f"📝 Normalized filename: {result.get('normalized_filename')}")
            print(f"💾 Saved to: {result.get('saved_path')}")
            print(f"📊 File size: {result.get('file_size')} bytes")
        else:
            print("❌ Download failed!")
            if result:
                print(f"Error: {result.get('error')}")
                if result.get('email_subject'):
                    print(f"Email: {result.get('email_subject')}")
                    print(f"Date: {result.get('email_date')}")
            else:
                print("Unknown error occurred")
            sys.exit(1)
            
    except Exception as e:
        print(f"❌ Script failed with error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()
