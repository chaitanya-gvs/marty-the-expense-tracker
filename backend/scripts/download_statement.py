#!/usr/bin/env python3
"""
Download and Process Statement PDF

This script downloads a specific PDF attachment and processes it.
"""

import sys
from pathlib import Path

# Add the backend directory to Python path
backend_path = Path(__file__).parent.parent
sys.path.insert(0, str(backend_path))

from src.services.email_ingestion.client import EmailClient
from src.services.statement_processor.pdf_processor import get_pdf_processor
from src.utils.password_manager import get_password_manager
from src.utils.logger import get_logger

logger = get_logger(__name__)


def download_and_process_statement(email_id: str, attachment_index: int = 0):
    """Download and process a specific statement attachment"""
    try:
        # Get email client and processors
        email_client = EmailClient()
        pdf_processor = get_pdf_processor()
        password_manager = get_password_manager()
        
        print(f"📧 Processing email: {email_id}")
        print("=" * 50)
        
        # Get full email content
        email_content = email_client.get_email_content(email_id)
        
        print(f"Subject: {email_content.get('subject', 'No subject')}")
        print(f"From: {email_content.get('sender', 'Unknown sender')}")
        print(f"Date: {email_content.get('date', 'Unknown date')}")
        
        # Check attachments
        attachments = email_content.get('attachments', [])
        if not attachments:
            print("❌ No attachments found in this email")
            return
        
        print(f"\n📎 Found {len(attachments)} attachment(s):")
        for i, att in enumerate(attachments):
            print(f"  {i+1}. {att.get('filename', 'Unknown')} ({att.get('mime_type', 'Unknown type')})")
        
        # Select attachment
        if attachment_index >= len(attachments):
            print(f"❌ Invalid attachment index {attachment_index}. Max: {len(attachments)-1}")
            return
        
        selected_attachment = attachments[attachment_index]
        filename = selected_attachment.get('filename', 'unknown')
        mime_type = selected_attachment.get('mime_type', '')
        
        print(f"\n🔍 Processing attachment: {filename}")
        print(f"Type: {mime_type}")
        
        # Check if it's a PDF
        if 'pdf' not in mime_type.lower() and not filename.lower().endswith('.pdf'):
            print("⚠️ This doesn't appear to be a PDF file")
            print("Still attempting to process...")
        
        # Get password for sender
        sender = email_content.get('sender', '')
        password = password_manager.get_password_for_sender(sender)
        
        if password:
            print(f"🔐 Found password for {sender}")
            # Mask password for display
            masked_password = "*" * min(len(password), 8) + "..." if len(password) > 8 else "*" * len(password)
            print(f"Password: {masked_password}")
        else:
            print(f"❌ No password found for {sender}")
            print("Will attempt to process without password...")
        
        # Process the attachment
        print(f"\n📥 Downloading and processing attachment...")
        
        try:
            # Use the PDF processor to process the statement email
            result = pdf_processor.process_statement_email(email_content)
            
            if result["success"]:
                print(f"✅ Successfully processed {result['attachments_processed']} attachment(s)")
                
                for i, attachment_result in enumerate(result["results"]):
                    if attachment_result["success"]:
                        print(f"\n📄 Attachment {i+1}: {attachment_result['filename']}")
                        print(f"Password used: {attachment_result['password_used']}")
                        
                        extraction_result = attachment_result.get("extraction_result", {})
                        if extraction_result.get("success"):
                            print(f"✅ Text extraction successful")
                            print(f"Method: {extraction_result.get('method', 'Unknown')}")
                            print(f"Pages: {extraction_result.get('pages', 0)}")
                            
                            # Show first 200 characters of extracted text
                            text = extraction_result.get("text", "")
                            if text:
                                preview = text[:200] + "..." if len(text) > 200 else text
                                print(f"\n📝 Text Preview:")
                                print(f"{preview}")
                        else:
                            print(f"❌ Text extraction failed: {extraction_result.get('error', 'Unknown error')}")
                    else:
                        print(f"❌ Failed to process attachment: {attachment_result.get('error', 'Unknown error')}")
            else:
                print(f"❌ Failed to process statement email: {result.get('error', 'Unknown error')}")
                
        except Exception as e:
            print(f"❌ Error during PDF processing: {e}")
            logger.error(f"Error processing PDF: {e}")
        
        print(f"\n📋 Next steps:")
        print(f"1. Parse financial transactions from extracted text")
        print(f"2. Categorize expenses and income")
        print(f"3. Store data in database")
        print(f"4. Generate expense reports")
        
    except Exception as e:
        print(f"❌ Error processing statement: {e}")
        logger.error(f"Error in download_and_process_statement: {e}")


def main():
    if len(sys.argv) < 2:
        print("Usage: poetry run python scripts/download_statement.py <email_id> [attachment_index]")
        print("\nExample:")
        print("  poetry run python scripts/download_statement.py 19909a8fef4a20b5")
        print("  poetry run python scripts/download_statement.py 19909a8fef4a20b5 0")
        print("\nAvailable email IDs from recent emails:")
        print("  19909a8fef4a20b5 - Your Axis Bank Atlas Credit Card ending XX54 - September 2025")
        print("  1990992781126921 - Funds / Securities Balance (BSE)")
        return
    
    email_id = sys.argv[1]
    attachment_index = int(sys.argv[2]) if len(sys.argv) > 2 else 0
    
    download_and_process_statement(email_id, attachment_index)


if __name__ == "__main__":
    main()
