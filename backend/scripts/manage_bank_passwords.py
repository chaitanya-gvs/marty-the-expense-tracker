#!/usr/bin/env python3
"""
Bank Password Management Script

This script helps you manage passwords for bank statements and credit card statements.
"""

import argparse
import sys
from pathlib import Path

# Add the backend directory to Python path
backend_path = Path(__file__).parent.parent
sys.path.insert(0, str(backend_path))

from src.utils.password_manager import get_password_manager
from src.utils.logger import get_logger

logger = get_logger(__name__)


def show_password_summary():
    """Show a summary of stored passwords"""
    pm = get_password_manager()
    accounts = pm.list_accounts()
    
    logger.info("🔐 Bank Password Summary")
    logger.info("=" * 50)
    
    total_accounts = sum(len(accounts[acc_type]) for acc_type in accounts)
    logger.info(f"Total accounts: {total_accounts}")
    
    for account_type, account_list in accounts.items():
        logger.info(f"\n{account_type.replace('_', ' ').title()}: {len(account_list)}")
        for account in account_list:
            logger.info(f"  - {account}")


def show_detailed_passwords():
    """Show detailed password information"""
    pm = get_password_manager()
    accounts = pm.list_accounts()
    
    logger.info("🔐 Detailed Password Information")
    logger.info("=" * 50)
    
    for account_type, account_list in accounts.items():
        logger.info(f"\n{account_type.replace('_', ' ').title()}:")
        logger.info("-" * 30)
        
        for account_name in account_list:
            password = pm.get_password_for_account(account_name, account_type)
            if password:
                # Mask password for security
                masked_password = "*" * min(len(password), 8) + "..." if len(password) > 8 else "*" * len(password)
                logger.info(f"  {account_name}: {masked_password}")
            else:
                logger.info(f"  {account_name}: No password set")


def add_password():
    """Add a new password interactively"""
    pm = get_password_manager()
    
    logger.info("🔐 Add New Password")
    logger.info("=" * 30)
    
    # Account type selection
    logger.info("\nAccount types:")
    logger.info("1. bank_statements")
    logger.info("2. credit_cards") 
    logger.info("3. investment_accounts")
    
    type_choice = input("\nSelect account type (1-3): ").strip()
    
    type_mapping = {
        "1": "bank_statements",
        "2": "credit_cards",
        "3": "investment_accounts"
    }
    
    if type_choice not in type_mapping:
        logger.error("❌ Invalid choice")
        return
    
    account_type = type_mapping[type_choice]
    
    # Get account details
    account_name = input(f"Enter account name: ").strip()
    if not account_name:
        logger.error("❌ Account name is required")
        return
    
    password = input("Enter password: ").strip()
    if not password:
        logger.error("❌ Password is required")
        return
    
    account_number = input("Enter account number (optional): ").strip()
    notes = input("Enter notes (optional): ").strip()
    
    # Add password
    success = pm.add_password(
        account_type=account_type,
        account_name=account_name,
        password=password,
        account_number=account_number if account_number else None,
        notes=notes if notes else None
    )
    
    if success:
        logger.info(f"✅ Password added successfully for {account_name}")
    else:
        logger.error("❌ Failed to add password")


def remove_password():
    """Remove a password interactively"""
    pm = get_password_manager()
    
    logger.info("🗑️ Remove Password")
    logger.info("=" * 30)
    
    # Show available accounts
    accounts = pm.list_accounts()
    logger.info("\nAvailable accounts:")
    
    account_choices = []
    choice_num = 1
    
    for account_type, account_list in accounts.items():
        for account_name in account_list:
            logger.info(f"{choice_num}. {account_type.replace('_', ' ').title()} - {account_name}")
            account_choices.append((account_type, account_name))
            choice_num += 1
    
    if not account_choices:
        logger.warning("No accounts found")
        return
    
    try:
        choice = int(input(f"\nSelect account to remove (1-{len(account_choices)}): ").strip())
        if 1 <= choice <= len(account_choices):
            account_type, account_name = account_choices[choice - 1]
            
            # Confirm deletion
            confirm = input(f"Are you sure you want to remove password for {account_name}? (y/N): ").strip().lower()
            if confirm in ['y', 'yes']:
                success = pm.remove_password(account_type, account_name)
                if success:
                    logger.info(f"✅ Password removed for {account_name}")
                else:
                    logger.error(f"❌ Failed to remove password for {account_name}")
            else:
                logger.info("Operation cancelled")
        else:
            logger.error("❌ Invalid choice")
    except ValueError:
        logger.error("❌ Please enter a valid number")


def search_passwords(query: str):
    """Search passwords by query"""
    pm = get_password_manager()
    results = pm.search_accounts(query)
    
    logger.info(f"🔍 Search Results for '{query}'")
    logger.info("=" * 50)
    
    if not results:
        logger.info("No accounts found matching your search")
        return
    
    for result in results:
        logger.info(f"\nType: {result['type'].replace('_', ' ').title()}")
        logger.info(f"Name: {result['name']}")
        
        info = result['info']
        if 'account_number' in info:
            logger.info(f"Account: {info['account_number']}")
        if 'notes' in info:
            logger.info(f"Notes: {info['notes']}")
        
        # Show masked password
        password = info.get('password', '')
        if password:
            masked_password = "*" * min(len(password), 8) + "..." if len(password) > 8 else "*" * len(password)
            logger.info(f"Password: {masked_password}")


def test_password_lookup():
    """Test password lookup for common email domains"""
    pm = get_password_manager()
    
    logger.info("🧪 Test Password Lookup")
    logger.info("=" * 50)
    
    test_domains = [
        "alerts@axisbank.com",
        "statements@hdfcbank.com", 
        "alerts@icicibank.com",
        "noreply@yesbank.in",
        "info@bseindia.in"
    ]
    
    for email in test_domains:
        password = pm.get_password_for_sender(email)
        if password:
            masked_password = "*" * min(len(password), 8) + "..." if len(password) > 8 else "*" * len(password)
            logger.info(f"✅ {email}: {masked_password}")
        else:
            logger.warning(f"❌ {email}: No password found")


def main():
    parser = argparse.ArgumentParser(description="Manage bank and credit card statement passwords")
    parser.add_argument("--summary", action="store_true", help="Show password summary")
    parser.add_argument("--detailed", action="store_true", help="Show detailed password information")
    parser.add_argument("--add", action="store_true", help="Add new password interactively")
    parser.add_argument("--remove", action="store_true", help="Remove password interactively")
    parser.add_argument("--search", metavar="QUERY", help="Search passwords by query")
    parser.add_argument("--test", action="store_true", help="Test password lookup for common domains")
    
    args = parser.parse_args()
    
    # Check if we're in the right directory
    if not Path("pyproject.toml").exists():
        logger.error("❌ Please run this script from the backend directory")
        sys.exit(1)
    
    if args.summary:
        show_password_summary()
    elif args.detailed:
        show_detailed_passwords()
    elif args.add:
        add_password()
    elif args.remove:
        remove_password()
    elif args.search:
        search_passwords(args.search)
    elif args.test:
        test_password_lookup()
    else:
        # Default: show summary
        show_password_summary()
        logger.info("\n💡 Use --help to see all available options")


if __name__ == "__main__":
    main()
