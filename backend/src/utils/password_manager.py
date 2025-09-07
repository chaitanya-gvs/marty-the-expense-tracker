"""
Password Manager for Bank and Credit Card Statements

This module manages passwords for accessing password-protected PDF statements.
"""

import asyncio
import json
import re
from pathlib import Path
from typing import Dict, List, Any, Optional, Tuple

from src.services.database_manager import get_account_by_email
from src.utils.logger import get_logger

logger = get_logger(__name__)


class BankPasswordManager:
    """Manages passwords for bank statements and credit card statements"""
    
    def __init__(self, passwords_file: str = "configs/secrets/bank_passwords.json"):
        self.passwords_file = Path(passwords_file)
        self.passwords = self._load_passwords()
    
    def _load_passwords(self) -> Dict[str, Any]:
        """Load passwords from JSON file"""
        try:
            if not self.passwords_file.exists():
                logger.warning(f"Password file not found at {self.passwords_file}")
                return self._get_default_structure()
            
            with open(self.passwords_file, 'r', encoding='utf-8') as f:
                passwords = json.load(f)
            
            logger.info(f"Loaded passwords from {self.passwords_file}")
            return passwords
            
        except Exception as e:
            logger.error(f"Error loading passwords: {e}")
            return self._get_default_structure()
    
    def _get_default_structure(self) -> Dict[str, Any]:
        """Return default password structure"""
        return {
            "bank_statements": {},
            "credit_cards": {},
            "investment_accounts": {},
            "settings": {
                "encryption_enabled": False,
                "password_hint": "No passwords configured",
                "last_updated": "2025-09-02"
            }
        }
    
    def get_password_for_sender(self, sender_email: str) -> Optional[str]:
        """Get password for a specific sender email using statement_sender field"""
        logger.info(f"Looking up password for sender: {sender_email}")
        
        try:
            # For now, we'll use a synchronous approach by running the async function
            
            try:
                # Try to get the current event loop
                loop = asyncio.get_event_loop()
                if loop.is_running():
                    # If we're in an async context, we need to handle this differently
                    logger.warning("Running in async context - consider using get_password_for_sender_async")
                    return None
                else:
                    # We can run the async function
                    account = loop.run_until_complete(get_account_by_email(sender_email))
            except RuntimeError:
                # No event loop, create one
                account = asyncio.run(get_account_by_email(sender_email))
            
            if account:
                logger.info(f"Found matching account: {account.get('nickname', account.get('bank_name'))}")
                return account.get('statement_password')
            else:
                logger.warning(f"No account found for sender: {sender_email}")
                return None
                
        except Exception as e:
            logger.error(f"Error looking up password for sender {sender_email}: {e}")
            return None
    
    async def get_password_for_sender_async(self, sender_email: str) -> Optional[str]:
        """Async version of get_password_for_sender"""
        logger.info(f"Looking up password for sender: {sender_email}")
        
        try:
            account = await get_account_by_email(sender_email)
            
            if account:
                logger.info(f"Found matching account: {account.get('nickname', account.get('bank_name'))}")
                return account.get('statement_password')
            else:
                logger.warning(f"No account found for sender: {sender_email}")
                return None
                
        except Exception as e:
            logger.error(f"Error looking up password for sender {sender_email}: {e}")
            return None
        
        
        

    
    def _normalize_email(self, email: str) -> str:
        """Normalize email for comparison (lowercase, trim whitespace)"""
        return email.lower().strip()
    
    def get_password_for_account(self, account_name: str, account_type: str = None) -> Optional[str]:
        """Get password for a specific account"""
        if account_type:
            if account_type in self.passwords:
                return self.passwords[account_type].get(account_name, {}).get("password")
        else:
            # Search in all types
            for account_type in ["bank_statements", "credit_cards", "investment_accounts"]:
                if account_name in self.passwords.get(account_type, {}):
                    return self.passwords[account_type][account_name].get("password")
        
        return None
    
    def add_password(self, account_type: str, account_name: str, password: str, 
                    account_number: str = None, statement_sender: str = None, notes: str = None) -> bool:
        """Add or update a password"""
        try:
            if account_type not in self.passwords:
                self.passwords[account_type] = {}
            
            if account_name not in self.passwords[account_type]:
                self.passwords[account_type][account_name] = {}
            
            self.passwords[account_type][account_name]["password"] = password
            
            if account_number:
                self.passwords[account_type][account_name]["account_number"] = account_number
            
            if statement_sender:
                self.passwords[account_type][account_name]["statement_sender"] = statement_sender
            
            if notes:
                self.passwords[account_type][account_name]["notes"] = notes
            
            # Update timestamp
            self.passwords["settings"]["last_updated"] = "2025-09-02"  # In production, use actual date
            
            # Save to file
            self._save_passwords()
            
            logger.info(f"Added password for {account_type}/{account_name}")
            return True
            
        except Exception as e:
            logger.error(f"Error adding password: {e}")
            return False
    
    def remove_password(self, account_type: str, account_name: str) -> bool:
        """Remove a password"""
        try:
            if (account_type in self.passwords and 
                account_name in self.passwords[account_type]):
                
                del self.passwords[account_type][account_name]
                self._save_passwords()
                
                logger.info(f"Removed password for {account_type}/{account_name}")
                return True
            
            return False
            
        except Exception as e:
            logger.error(f"Error removing password: {e}")
            return False
    
    def _save_passwords(self) -> None:
        """Save passwords to file"""
        try:
            # Create directory if it doesn't exist
            self.passwords_file.parent.mkdir(parents=True, exist_ok=True)
            
            with open(self.passwords_file, 'w', encoding='utf-8') as f:
                json.dump(self.passwords, f, indent=2)
                
        except Exception as e:
            logger.error(f"Error saving passwords: {e}")
    
    def reload_config(self) -> None:
        """Reload configuration from file"""
        self.passwords = self._load_passwords()
        logger.info("Password configuration reloaded")
    
    def list_accounts(self) -> Dict[str, List[str]]:
        """List all accounts by type"""
        return {
            "bank_statements": list(self.passwords.get("bank_statements", {}).keys()),
            "credit_cards": list(self.passwords.get("credit_cards", {}).keys()),
            "investment_accounts": list(self.passwords.get("investment_accounts", {}).keys())
        }
    
    def search_accounts(self, query: str) -> List[Dict[str, Any]]:
        """Search accounts by name, number, statement_sender, or notes"""
        results = []
        query_lower = query.lower()
        
        for account_type, accounts in self.passwords.items():
            if account_type == "settings":
                continue
                
            for account_name, account_info in accounts.items():
                # Search in account name
                if query_lower in account_name.lower():
                    results.append({
                        "type": account_type,
                        "name": account_name,
                        "info": account_info
                    })
                    continue
                
                # Search in account number
                if "account_number" in account_info:
                    if query_lower in account_info["account_number"].lower():
                        results.append({
                            "type": account_type,
                            "name": account_name,
                            "info": account_info
                        })
                        continue
                
                # Search in statement_sender
                if "statement_sender" in account_info:
                    if query_lower in account_info["statement_sender"].lower():
                        results.append({
                            "type": account_type,
                            "name": account_name,
                            "info": account_info
                        })
                        continue
                
                # Search in notes
                if "notes" in account_info:
                    if query_lower in account_info["notes"].lower():
                        results.append({
                            "type": account_type,
                            "name": account_name,
                            "info": account_info
                        })
        
        return results


# Global instance for easy access
password_manager = BankPasswordManager()


def get_password_manager() -> BankPasswordManager:
    """Get the global password manager instance"""
    # Force reload to ensure we have the latest passwords
    password_manager.reload_config()
    return password_manager
