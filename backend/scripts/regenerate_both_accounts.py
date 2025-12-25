#!/usr/bin/env python3
"""
Comprehensive script to regenerate Gmail OAuth tokens for both primary and secondary accounts.
This script guides you through the OAuth flow for each account and automatically updates your .env file.
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


def check_current_configuration():
    """Check and display current configuration status"""
    print_banner("CURRENT CONFIGURATION STATUS")
    
    settings = get_settings()
    
    logger.info("📊 PRIMARY ACCOUNT:")
    logger.info(f"   Client ID: {'✅ Found' if settings.GOOGLE_CLIENT_ID else '❌ Missing'}")
    logger.info(f"   Client Secret: {'✅ Found' if settings.GOOGLE_CLIENT_SECRET else '❌ Missing'}")
    logger.info(f"   Refresh Token: {'✅ Found' if settings.GOOGLE_REFRESH_TOKEN else '❌ Missing'}")
    logger.info(f"   Client Secret File: {'✅ Found' if settings.GOOGLE_CLIENT_SECRET_FILE else '❌ Missing'}")
    
    logger.info("📊 SECONDARY ACCOUNT:")
    logger.info(f"   Client ID: {'✅ Found' if settings.GOOGLE_CLIENT_ID_2 else '❌ Missing'}")
    logger.info(f"   Client Secret: {'✅ Found' if settings.GOOGLE_CLIENT_SECRET_2 else '❌ Missing'}")
    logger.info(f"   Refresh Token: {'✅ Found' if settings.GOOGLE_REFRESH_TOKEN_2 else '❌ Missing'}")
    logger.info(f"   Client Secret File: {'✅ Found' if settings.GOOGLE_CLIENT_SECRET_FILE_2 else '❌ Missing'}")
    
    return settings


def regenerate_account(account_id: str, account_email: str):
    """Complete OAuth flow for a specific account"""
    print_banner(f"{account_id.upper()} ACCOUNT ({account_email})")
    
    try:
        # Create handler for this account
        handler = EmailAuthHandler(account_id=account_id)
        
        # Generate authorization URL
        logger.info("🔗 Generating authorization URL...")
        auth_url = handler.get_authorization_url()
        
        logger.info("\n📋 INSTRUCTIONS:")
        logger.info("1. Copy the URL below and open it in your browser")
        logger.info(f"2. Sign in with: {account_email}")
        logger.info("3. Grant permissions to the application")
        logger.info("4. After redirect, copy the 'code=' parameter from the callback URL")
        logger.info("   (The URL will look like: http://localhost:8080/?code=YOUR_CODE_HERE&scope=...)")
        logger.info("🔗 AUTHORIZATION URL:")
        logger.info("-" * 80)
        logger.info(auth_url)
        logger.info("-" * 80)
        
        # Get authorization code from user
        authorization_code = input("📝 Paste the authorization code here: ").strip()
        
        if not authorization_code:
            logger.warning("❌ No authorization code provided. Skipping this account.")
            return False
        
        # Exchange code for tokens
        logger.info("\n🔄 Exchanging authorization code for tokens...")
        token_info = handler.exchange_code_for_tokens(authorization_code)
        
        logger.info("✅ Successfully obtained tokens!")
        logger.info(f"   Refresh Token: {token_info.get('refresh_token', 'N/A')[:30]}...")
        
        # Save tokens to .env file
        logger.info("💾 Saving tokens to environment file...")
        handler.save_tokens_to_env(token_info)
        logger.info("✅ Tokens saved successfully!")
        
        return True
        
    except Exception as e:
        logger.error("❌ Error during OAuth flow", exc_info=True)
        return False


def main():
    """Main function"""
    print_banner("GMAIL TOKEN REGENERATION FOR BOTH ACCOUNTS")
    
    logger.info("This script will help you regenerate Gmail OAuth tokens for both accounts.")
    logger.info("You'll complete the OAuth flow for each account separately.")
    
    # Check current configuration
    settings = check_current_configuration()
    
    # Ask which accounts to regenerate
    logger.info("Which accounts would you like to regenerate?")
    logger.info("1. Primary account only")
    logger.info("2. Secondary account only")
    logger.info("3. Both accounts")
    
    choice = input("Enter your choice (1/2/3): ").strip()
    
    if choice == "1":
        # Regenerate primary account
        regenerate_account("primary", "chaitanyagvs23@gmail.com")
    elif choice == "2":
        # Regenerate secondary account
        regenerate_account("secondary", "chaitanyagvs98@gmail.com")
    elif choice == "3":
        # Regenerate both accounts
        logger.info("\n🔄 Starting with PRIMARY account...")
        regenerate_account("primary", "chaitanyagvs23@gmail.com")
        
        input("\nPress Enter to continue with secondary account...")
        
        logger.info("\n🔄 Starting with SECONDARY account...")
        regenerate_account("secondary", "chaitanyagvs98@gmail.com")
    else:
        logger.error("❌ Invalid choice. Exiting.")
        return
    
    print_banner("REGENERATION COMPLETE")
    logger.info("✅ Token regeneration process completed!")
    logger.info("📋 NEXT STEPS:")
    logger.info("1. Verify that tokens were saved to configs/secrets/.env")
    logger.info("2. Restart your backend server")
    logger.info("3. Test email search functionality")
    logger.info("🎉 You're all set!")


if __name__ == "__main__":
    main()

