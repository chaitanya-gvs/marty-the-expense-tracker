"""
Password Manager for Bank and Credit Card Statements

Manages passwords for accessing password-protected PDF statements
by querying the accounts database.
"""

from typing import Optional

from src.services.database_manager import get_account_by_email
from src.utils.logger import get_logger

logger = get_logger(__name__)


class BankPasswordManager:
    """Manages passwords for bank statements by querying the accounts database."""

    async def get_password_for_sender_async(self, sender_email: str) -> Optional[str]:
        """Look up the statement password for a given sender email address."""
        logger.info(f"Looking up password for sender: {sender_email}")
        try:
            account = await get_account_by_email(sender_email)
            if account:
                logger.info(f"Found matching account: {account.get('nickname', account.get('bank_name'))}")
                return account.get("statement_password")
            logger.warning(f"No account found for sender: {sender_email}")
            return None
        except Exception as e:
            logger.error(f"Error looking up password for sender {sender_email}: {e}", exc_info=True)
            return None


def get_password_manager() -> BankPasswordManager:
    return BankPasswordManager()
