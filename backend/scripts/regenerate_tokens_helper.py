#!/usr/bin/env python3
"""
Helper script to regenerate Gmail OAuth tokens for both accounts.
This script will guide you through the process step by step.
"""

import sys
from pathlib import Path

# Add backend directory to Python path
backend_path = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(backend_path))

from src.services.email_ingestion.auth import EmailAuthHandler
from src.utils.settings import get_settings
from src.utils.logger import get_logger

logger = get_logger(__name__)

def print_banner(text):
    """Print a formatted banner"""
    logger.info("\n" + "=" * 80)
    logger.info(f"  {text}")
    logger.info("=" * 80 + "\n")

def regenerate_primary_account():
    """Generate authorization URL for primary account"""
    print_banner("PRIMARY ACCOUNT (chaitanyagvs23)")
    
    handler = EmailAuthHandler()
    auth_url = handler.get_authorization_url()
    
    logger.info("📋 STEPS:")
    logger.info("1. Copy the URL below and open it in your browser")
    logger.info("2. Sign in with: chaitanyagvs23@gmail.com")
    logger.info("3. Grant permissions")
    logger.info("4. After redirect, copy the 'code=' parameter from the URL")
    logger.info("5. Save it for the next step")
    
    logger.info("🔗 AUTHORIZATION URL:")
    logger.info("-" * 80)
    logger.info(auth_url)
    logger.info("-" * 80)

def regenerate_secondary_account():
    """Generate authorization URL for secondary account"""
    print_banner("SECONDARY ACCOUNT (chaitanyagvs98)")
    
    handler = EmailAuthHandler()
    auth_url = handler.get_authorization_url()
    
    logger.info("📋 STEPS:")
    logger.info("1. Copy the URL below and open it in your browser")
    logger.info("2. Sign in with: chaitanyagvs98@gmail.com")
    logger.info("3. Grant permissions")
    logger.info("4. After redirect, copy the 'code=' parameter from the URL")
    logger.info("5. Save it for the next step")
    
    logger.info("🔗 AUTHORIZATION URL:")
    logger.info("-" * 80)
    logger.info(auth_url)
    logger.info("-" * 80)

def show_token_exchange_instructions():
    """Show instructions for exchanging authorization codes for tokens"""
    print_banner("TOKEN EXCHANGE INSTRUCTIONS")
    
    logger.info("After getting both authorization codes, update your .env file:")
    logger.info("🔧 FOR PRIMARY ACCOUNT:")
    logger.info("1. Run this command (replace YOUR_CODE with actual code):")
    logger.info("   poetry run python -c \"")
    logger.info("   from src.services.email_ingestion.auth import EmailAuthHandler;")
    logger.info("   handler = EmailAuthHandler();")
    logger.info("   tokens = handler.exchange_code_for_tokens('YOUR_CODE');")
    logger.info("   print('GOOGLE_REFRESH_TOKEN=' + tokens['refresh_token'])\"")
    logger.info("2. Copy the output and update GOOGLE_REFRESH_TOKEN in configs/.env")
    logger.info("🔧 FOR SECONDARY ACCOUNT:")
    logger.info("1. Run the same command with the secondary account code")
    logger.info("2. Copy the output and update GOOGLE_REFRESH_TOKEN_2 in configs/.env")

def main():
    """Main function"""
    print_banner("GMAIL TOKEN REGENERATION HELPER")
    
    logger.info("This script will help you regenerate tokens for both Gmail accounts.")
    logger.info("You'll need to complete the OAuth flow for each account separately.")
    
    settings = get_settings()
    
    # Check current configuration
    logger.info("📊 CURRENT CONFIGURATION:")
    logger.info(f"Primary Client ID: {'✅ Found' if settings.GOOGLE_CLIENT_ID else '❌ Missing'}")
    logger.info(f"Primary Refresh Token: {'✅ Found' if settings.GOOGLE_REFRESH_TOKEN else '❌ Missing'}")
    logger.info(f"Secondary Client ID: {'✅ Found' if settings.GOOGLE_CLIENT_ID_2 else '❌ Missing'}")
    logger.info(f"Secondary Refresh Token: {'✅ Found' if settings.GOOGLE_REFRESH_TOKEN_2 else '❌ Missing'}")
    
    # Generate URLs for both accounts
    regenerate_primary_account()
    input("Press Enter after completing primary account OAuth flow...")
    
    regenerate_secondary_account()
    input("Press Enter after completing secondary account OAuth flow...")
    
    show_token_exchange_instructions()
    
    logger.info("\n✅ DONE!")
    logger.info("After updating your .env file, restart your backend server.")
    logger.info("The email search will then work with both accounts.")

if __name__ == "__main__":
    main()

