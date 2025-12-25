"""
PDF Unlocker Service

This service handles unlocking password-protected PDF statements using the password manager
and saves them to the unlocked_statements directory.
"""
import asyncio
import re
import shutil
import sys
import traceback
from datetime import datetime
from pathlib import Path
from typing import Dict, Any, Optional

import fitz

# Add the backend directory to Python path
backend_path = Path(__file__).parent.parent.parent.parent
sys.path.insert(0, str(backend_path))

from src.services.database_manager.operations import AccountOperations
from src.utils.logger import get_logger
from src.utils.password_manager import get_password_manager

logger = get_logger(__name__)


class PDFUnlocker:
    """Unlock password-protected PDF statements and save them"""
    
    def __init__(self):
        self.password_manager = get_password_manager()
        
        # Create output directory
        self.unlocked_dir = Path("data/statements/unlocked_statements")
        self.unlocked_dir.mkdir(parents=True, exist_ok=True)
    
    def unlock_pdf(self, pdf_path: str) -> Dict[str, Any]:
        """
        Unlock a password-protected PDF statement
        
        Args:
            pdf_path: Path to the locked PDF file
            
        Returns:
            Dictionary containing unlock results and metadata
        """
        try:
            pdf_path = Path(pdf_path)
            if not pdf_path.exists():
                return {
                    "success": False,
                    "error": f"PDF file not found: {pdf_path}"
                }
            
            logger.info(f"🔓 Unlocking PDF: {pdf_path.name}")
            
            # Get password for this bank
            password = self._get_password_for_bank(pdf_path.name)
            if not password:
                return {
                    "success": False,
                    "error": f"No password found for this PDF"
                }
            
            logger.info("🔑 Password found")
            
            # Unlock the PDF
            if self._unlock_pdf_with_password(pdf_path, password):
                # Save unlocked version
                saved_path = self._save_unlocked_pdf(pdf_path)
                if saved_path:
                    logger.info(f"💾 Unlocked PDF saved to: {saved_path}")
                    return {
                        "success": True,
                        "unlocked_path": saved_path
                    }
                else:
                    return {
                        "success": False,
                        "error": "Failed to save unlocked PDF"
                    }
            else:
                return {
                    "success": False,
                    "error": "Password authentication failed"
                }
            
        except Exception as e:
            logger.error(f"Error unlocking PDF {pdf_path}", exc_info=True)
            return {
                "success": False,
                "error": str(e)
            }
    
    def unlock_pdf_with_password(self, pdf_path: Path, password: str) -> Dict[str, Any]:
        """
        Unlock a password-protected PDF statement with provided password
        
        Args:
            pdf_path: Path to the locked PDF file
            password: Password to unlock the PDF
            
        Returns:
            Dictionary containing unlock results and metadata
        """
        try:
            pdf_path = Path(pdf_path)
            if not pdf_path.exists():
                return {
                    "success": False,
                    "error": f"PDF file not found: {pdf_path}"
                }
            
            logger.info(f"🔓 Unlocking PDF with provided password: {pdf_path.name}")
            
            # Unlock the PDF
            if self._unlock_pdf_with_password(pdf_path, password):
                # Save unlocked version
                saved_path = self._save_unlocked_pdf(pdf_path)
                if saved_path:
                    logger.info(f"💾 Unlocked PDF saved to: {saved_path}")
                    return {
                        "success": True,
                        "unlocked_path": saved_path
                    }
                else:
                    return {
                        "success": False,
                        "error": "Failed to save unlocked PDF"
                    }
            else:
                return {
                    "success": False,
                    "error": "Password authentication failed"
                }
                
        except Exception as e:
            logger.error("Error unlocking PDF", exc_info=True)
            return {
                "success": False,
                "error": str(e)
            }
    
    def _get_password_for_bank(self, filename: str) -> Optional[str]:
        """Get password for a specific bank type"""
        try:
            filename_lower = filename.lower()
            
            # Map bank types to sender emails
            if "axis" in filename_lower:
                sender_email = "cc.statements@axisbank.com"
            elif "hdfc" in filename_lower:
                sender_email = "emailstatements.cc@hdfcbank.net"
            elif "icici" in filename_lower:
                sender_email = "credit_cards@icicibank.com"
            elif "sbi" in filename_lower:
                sender_email = "Statements@sbicard.com"
            elif "yes" in filename_lower:
                sender_email = "estatement@yesbank.in"
            else:
                return None
            
            return self.password_manager.get_password_for_sender(sender_email)
            
        except Exception as e:
            logger.error("Error getting password", exc_info=True)
            return None
    
    def _get_sender_email_from_filename(self, filename: str) -> Optional[str]:
        """Get sender email from filename for normalized naming"""
        try:
            filename_lower = filename.lower()
            
            # Map bank types to sender emails
            if "axis" in filename_lower:
                return "cc.statements@axisbank.com"
            elif "hdfc" in filename_lower:
                return "emailstatements.cc@hdfcbank.net"
            elif "icici" in filename_lower:
                return "credit_cards@icicibank.com"
            elif "sbi" in filename_lower:
                return "Statements@sbicard.com"
            elif "yes" in filename_lower:
                return "estatement@yesbank.in"
            else:
                return None
                
        except Exception as e:
            logger.error("Error getting sender email from filename", exc_info=True)
            return None
    
    def _unlock_pdf_with_password(self, pdf_path: Path, password: str) -> bool:
        """Unlock PDF using the provided password"""
        try:
            # Open PDF with PyMuPDF
            doc = fitz.open(str(pdf_path))
            
            # Try to authenticate
            if not doc.authenticate(password):
                logger.warning("PyMuPDF authentication failed")
                doc.close()
                return False
            
            # If authentication successful, create unlocked version
            logger.info("✅ Password authentication successful, creating unlocked version")
            
            # Create a new unlocked document
            unlocked_doc = fitz.open()
            
            # Copy all pages from the authenticated document
            for page_num in range(len(doc)):
                page = doc.load_page(page_num)
                unlocked_doc.insert_pdf(doc, from_page=page_num, to_page=page_num)
            
            # Save the unlocked version to a temporary file
            temp_path = pdf_path.parent / f"{pdf_path.stem}_temp_unlocked.pdf"
            unlocked_doc.save(str(temp_path))
            
            # Close documents
            doc.close()
            unlocked_doc.close()
            
            # Store the temp path for later use
            self._temp_unlocked_path = temp_path
            
            return True
            
        except Exception as e:
            logger.error("PyMuPDF unlock failed", exc_info=True)
            return False
    
    def _save_unlocked_pdf(self, original_path: Path) -> Optional[str]:
        """Save the unlocked PDF to the unlocked_statements directory with normalized naming"""
        try:
            # Check if we have a temporary unlocked file
            if not hasattr(self, '_temp_unlocked_path') or not self._temp_unlocked_path.exists():
                logger.error("No temporary unlocked PDF found")
                return None
            
            # Generate normalized filename
            normalized_filename = self._generate_normalized_unlocked_filename(original_path.name)
            output_file = self.unlocked_dir / normalized_filename
            
            # Move the temporary unlocked file to the final location
            shutil.move(str(self._temp_unlocked_path), str(output_file))
            
            # Clean up the temporary path
            self._temp_unlocked_path = None
            
            return str(output_file)
            
        except Exception as e:
            logger.error("Error saving unlocked PDF", exc_info=True)
            return None
    
    def _generate_normalized_unlocked_filename(self, original_filename: str) -> str:
        """Generate normalized filename for unlocked PDF using account nickname"""
        try:
            # Get sender email from filename
            sender_email = self._get_sender_email_from_filename(original_filename)
            if not sender_email:
                # Fallback to original filename with _unlocked suffix
                return f"{Path(original_filename).stem}_unlocked.pdf"
            
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
            
            # Try to extract date from original filename or use current date
            formatted_date = self._extract_date_from_filename(original_filename)
            
            # Create normalized filename with _unlocked suffix
            normalized_filename = f"{base_name}_{formatted_date}_unlocked.pdf"
            
            return normalized_filename
            
        except Exception as e:
            logger.error("Error generating normalized unlocked filename", exc_info=True)
            # Fallback to original filename with _unlocked suffix
            return f"{Path(original_filename).stem}_unlocked.pdf"
    
    def _extract_date_from_filename(self, filename: str) -> str:
        """Extract date from filename or use current date as fallback"""
        try:
            # Try to find date patterns in filename (YYYYMMDD, YYYY-MM-DD, etc.)
            date_patterns = [
                r'(\d{4})(\d{2})(\d{2})',  # YYYYMMDD
                r'(\d{4})-(\d{2})-(\d{2})',  # YYYY-MM-DD
                r'(\d{4})/(\d{2})/(\d{2})',  # YYYY/MM/DD
            ]
            
            for pattern in date_patterns:
                match = re.search(pattern, filename)
                if match:
                    year, month, day = match.groups()
                    return f"{year}{month}{day}"
            
            # If no date found, use current date
            return datetime.now().strftime("%Y%m%d")
            
        except Exception as e:
            logger.warning(f"Could not extract date from filename '{filename}', using current date: {e}")
            return datetime.now().strftime("%Y%m%d")


# Global instance for easy access
pdf_unlocker = PDFUnlocker()


def get_pdf_unlocker() -> PDFUnlocker:
    """Get the global PDF unlocker instance"""
    return pdf_unlocker


if __name__ == "__main__":
    """Test the PDF unlocker service"""
    
    # Test file path - Yes Bank statement downloaded
    test_pdf = "/Users/chaitanya/Documents/Dev/personal-projects/expense-tracker/backend/data/statements/locked_statements/yes_bank_savings_account_20250904.pdf"
    
    logger.info("🔓 Testing PDF Unlocker Service")
    logger.info(f"📄 Test file: {test_pdf}")
    logger.info("-" * 60)
    
    try:
        # Create unlocker instance
        unlocker = PDFUnlocker()
        
        # Check if test file exists
        if not Path(test_pdf).exists():
            logger.error(f"❌ Test file not found: {test_pdf}")
            logger.warning("💡 Please place a locked PDF in the locked_statements directory to test")
            exit(1)
        
        logger.info("✅ Test file found")
        
        # Test password retrieval
        logger.info(f"\n🔑 Testing password retrieval...")
        password = unlocker._get_password_for_bank(Path(test_pdf).name)
        if password:
            logger.info(f"✅ Password found: {password[:3]}...")
        else:
            logger.error("❌ No password found for this bank")
            logger.warning("💡 Please add a password using the password manager")
            exit(1)
        
        # Test PDF unlocking
        logger.info(f"\n🔓 Testing PDF unlocking...")
        result = unlocker.unlock_pdf(test_pdf)
        
        if result.get("success"):
            logger.info("✅ PDF unlocked successfully!")
            logger.info(f"💾 Unlocked PDF saved to: {result.get('unlocked_path')}")
        else:
            logger.error("❌ PDF unlocking failed!")
            logger.error(f"Error: {result.get('error')}")
            
    except Exception as e:
        logger.error("❌ Test failed", exc_info=True)
