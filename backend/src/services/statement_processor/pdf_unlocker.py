"""
PDF Unlocker Service

Handles unlocking password-protected PDF statements and saves them
to the unlocked_statements directory.
"""
import asyncio
import re
import shutil
from datetime import datetime
from pathlib import Path
from typing import Dict, Any, Optional

import fitz

from src.services.database_manager.operations import AccountOperations
from src.utils.logger import get_logger
from src.utils.password_manager import get_password_manager

logger = get_logger(__name__)


class PDFUnlocker:
    """Unlock password-protected PDF statements and save them."""

    def __init__(self):
        self.password_manager = get_password_manager()
        self.unlocked_dir = Path("data/statements/unlocked_statements")
        self.unlocked_dir.mkdir(parents=True, exist_ok=True)

    def unlock_pdf(self, pdf_path: str) -> Dict[str, Any]:
        """
        Unlock a password-protected PDF statement.

        Returns a dict with 'success' bool and either 'unlocked_path' or 'error'.
        """
        try:
            pdf_path = Path(pdf_path)
            if not pdf_path.exists():
                return {"success": False, "error": f"PDF file not found: {pdf_path}"}

            logger.info(f"Unlocking PDF: {pdf_path.name}")

            password = self._get_password_for_bank(pdf_path.name)
            if not password:
                return {"success": False, "error": "No password found for this PDF"}

            logger.info("Password found, proceeding with unlock")

            if self._unlock_pdf_with_password(pdf_path, password):
                saved_path = self._save_unlocked_pdf(pdf_path)
                if saved_path:
                    logger.info(f"Unlocked PDF saved to: {saved_path}")
                    return {"success": True, "unlocked_path": saved_path}
                return {"success": False, "error": "Failed to save unlocked PDF"}
            return {"success": False, "error": "Password authentication failed"}

        except Exception as e:
            logger.error(f"Error unlocking PDF {pdf_path}", exc_info=True)
            return {"success": False, "error": str(e)}

    def unlock_pdf_with_password(self, pdf_path: Path, password: str) -> Dict[str, Any]:
        """
        Unlock a password-protected PDF with a provided password.

        Returns a dict with 'success' bool and either 'unlocked_path' or 'error'.
        """
        try:
            pdf_path = Path(pdf_path)
            if not pdf_path.exists():
                return {"success": False, "error": f"PDF file not found: {pdf_path}"}

            logger.info(f"Unlocking PDF with provided password: {pdf_path.name}")

            if self._unlock_pdf_with_password(pdf_path, password):
                saved_path = self._save_unlocked_pdf(pdf_path)
                if saved_path:
                    logger.info(f"Unlocked PDF saved to: {saved_path}")
                    return {"success": True, "unlocked_path": saved_path}
                return {"success": False, "error": "Failed to save unlocked PDF"}
            return {"success": False, "error": "Password authentication failed"}

        except Exception as e:
            logger.error("Error unlocking PDF", exc_info=True)
            return {"success": False, "error": str(e)}

    def _get_password_for_bank(self, filename: str) -> Optional[str]:
        """Resolve sender email from filename and look up the statement password."""
        try:
            sender_email = self._get_sender_email_from_filename(filename)
            if not sender_email:
                return None
            return asyncio.run(self.password_manager.get_password_for_sender_async(sender_email))
        except Exception:
            logger.error("Error getting password", exc_info=True)
            return None

    def _get_sender_email_from_filename(self, filename: str) -> Optional[str]:
        """Map bank name in filename to the known statement sender email."""
        filename_lower = filename.lower()
        if "axis" in filename_lower:
            return "cc.statements@axisbank.com"
        if "hdfc" in filename_lower:
            return "emailstatements.cc@hdfcbank.net"
        if "icici" in filename_lower:
            return "credit_cards@icicibank.com"
        if "sbi" in filename_lower:
            return "Statements@sbicard.com"
        if "yes" in filename_lower:
            return "estatement@yesbank.in"
        return None

    def _unlock_pdf_with_password(self, pdf_path: Path, password: str) -> bool:
        """Authenticate and create an unlocked copy of the PDF."""
        try:
            doc = fitz.open(str(pdf_path))
            if not doc.authenticate(password):
                logger.warning("PDF authentication failed")
                doc.close()
                return False

            logger.info("Authentication successful, creating unlocked version")
            unlocked_doc = fitz.open()
            for page_num in range(len(doc)):
                unlocked_doc.insert_pdf(doc, from_page=page_num, to_page=page_num)

            temp_path = pdf_path.parent / f"{pdf_path.stem}_temp_unlocked.pdf"
            unlocked_doc.save(str(temp_path))
            doc.close()
            unlocked_doc.close()
            self._temp_unlocked_path = temp_path
            return True

        except Exception:
            logger.error("PyMuPDF unlock failed", exc_info=True)
            return False

    def _save_unlocked_pdf(self, original_path: Path) -> Optional[str]:
        """Move the temporary unlocked PDF to the final output directory."""
        try:
            if not hasattr(self, "_temp_unlocked_path") or not self._temp_unlocked_path.exists():
                logger.error("No temporary unlocked PDF found")
                return None

            normalized_filename = self._generate_normalized_unlocked_filename(original_path.name)
            output_file = self.unlocked_dir / normalized_filename
            shutil.move(str(self._temp_unlocked_path), str(output_file))
            self._temp_unlocked_path = None
            return str(output_file)

        except Exception:
            logger.error("Error saving unlocked PDF", exc_info=True)
            return None

    def _generate_normalized_unlocked_filename(self, original_filename: str) -> str:
        """Generate a normalized output filename using the account nickname."""
        try:
            sender_email = self._get_sender_email_from_filename(original_filename)
            if not sender_email:
                return f"{Path(original_filename).stem}_unlocked.pdf"

            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            try:
                nickname = loop.run_until_complete(
                    AccountOperations.get_account_nickname_by_sender(sender_email)
                )
            finally:
                loop.close()

            if nickname:
                base_name = nickname.lower().replace(" ", "_")
            else:
                base_name = sender_email.split("@")[1].split(".")[0].lower()

            formatted_date = self._extract_date_from_filename(original_filename)
            return f"{base_name}_{formatted_date}_unlocked.pdf"

        except Exception:
            logger.error("Error generating normalized unlocked filename", exc_info=True)
            return f"{Path(original_filename).stem}_unlocked.pdf"

    def _extract_date_from_filename(self, filename: str) -> str:
        """Extract date from filename or fall back to today."""
        date_patterns = [
            r"(\d{4})(\d{2})(\d{2})",
            r"(\d{4})-(\d{2})-(\d{2})",
            r"(\d{4})/(\d{2})/(\d{2})",
        ]
        for pattern in date_patterns:
            match = re.search(pattern, filename)
            if match:
                year, month, day = match.groups()
                return f"{year}{month}{day}"
        return datetime.now().strftime("%Y%m%d")
