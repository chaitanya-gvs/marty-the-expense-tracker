#!/usr/bin/env python3
"""
Script to help set up a secondary Gmail account for the expense tracker.

This script guides you through the process of adding a second Gmail account
to your expense tracker system.
"""

import sys
import os
from pathlib import Path

# Add backend directory to Python path
backend_path = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(backend_path))

from src.utils.logger import get_logger
from src.utils.settings import get_settings

logger = get_logger(__name__)


def print_setup_instructions():
    """Print step-by-step instructions for setting up a secondary email account"""
    logger.info("=" * 80)
    logger.info("SECONDARY GMAIL ACCOUNT SETUP GUIDE")
    logger.info("=" * 80)
    
    logger.info("STEP 1: Google Cloud Console Setup")
    logger.info("-" * 40)
    logger.info("1. Go to https://console.cloud.google.com/")
    logger.info("2. Select your existing project (or create a new one)")
    logger.info("3. Go to 'APIs & Services' > 'Credentials'")
    logger.info("4. Find your existing OAuth 2.0 Client ID")
    logger.info("5. Add the secondary Gmail account to 'Test users' in OAuth consent screen")
    
    logger.info("STEP 2: Get Authorization URL")
    logger.info("-" * 40)
    logger.info("1. Run this command to get the authorization URL:")
    logger.info("   poetry run python -c \"")
    logger.info("   from src.services.email_ingestion.auth import EmailAuthHandler;")
    logger.info("   handler = EmailAuthHandler();")
    logger.info("   print('Authorization URL:', handler.get_authorization_url())\"")
    logger.info("2. Open the URL in your browser")
    logger.info("3. Sign in with your SECONDARY Gmail account")
    logger.info("4. Grant permissions to the application")
    logger.info("5. Copy the authorization code from the callback URL")
    
    logger.info("STEP 3: Exchange Code for Tokens")
    logger.info("-" * 40)
    logger.info("1. Run this command with your authorization code:")
    logger.info("   poetry run python -c \"")
    logger.info("   from src.services.email_ingestion.auth import EmailAuthHandler;")
    logger.info("   handler = EmailAuthHandler();")
    logger.info("   tokens = handler.exchange_code_for_tokens('YOUR_AUTHORIZATION_CODE');")
    logger.info("   print('Refresh Token:', tokens.get('refresh_token'))\"")
    logger.info("2. Copy the refresh token")
    
    logger.info("STEP 4: Update Environment Variables")
    logger.info("-" * 40)
    logger.info("Add these variables to your backend/configs/secrets/.env file:")
    logger.info("# Secondary Gmail Account")
    logger.info("GOOGLE_REFRESH_TOKEN_2=your_refresh_token_here")
    logger.info("GOOGLE_CLIENT_ID_2=your_client_id_here")
    logger.info("GOOGLE_CLIENT_SECRET_2=your_client_secret_here")
    logger.info("Note: You can use the same CLIENT_ID and CLIENT_SECRET as your primary account")
    
    logger.info("STEP 5: Test the Setup")
    logger.info("-" * 40)
    logger.info("1. Test the connection:")
    logger.info("   curl -X GET 'http://localhost:8000/mail/accounts'")
    logger.info("2. Test email ingestion from secondary account:")
    logger.info("   curl -X POST 'http://localhost:8000/mail/ingest?account_id=secondary'")
    logger.info("3. Test ingestion from all accounts:")
    logger.info("   curl -X POST 'http://localhost:8000/mail/ingest/all'")


def check_current_setup():
    """Check the current email account setup"""
    logger.info("CURRENT EMAIL ACCOUNT SETUP")
    logger.info("=" * 40)
    
    settings = get_settings()
    
    # Check primary account
    primary_configured = bool(settings.GOOGLE_REFRESH_TOKEN)
    logger.info(f"Primary Account: {'✅ Configured' if primary_configured else '❌ Not configured'}")
    if primary_configured:
        logger.info(f"  - Has refresh token: {'✅' if settings.GOOGLE_REFRESH_TOKEN else '❌'}")
        logger.info(f"  - Has client config: {'✅' if settings.GOOGLE_CLIENT_ID and settings.GOOGLE_CLIENT_SECRET else '❌'}")
    
    # Check secondary account
    secondary_configured = bool(settings.GOOGLE_REFRESH_TOKEN_2)
    logger.info(f"Secondary Account: {'✅ Configured' if secondary_configured else '❌ Not configured'}")
    if secondary_configured:
        logger.info(f"  - Has refresh token: {'✅' if settings.GOOGLE_REFRESH_TOKEN_2 else '❌'}")
        logger.info(f"  - Has client config: {'✅' if settings.GOOGLE_CLIENT_ID_2 and settings.GOOGLE_CLIENT_SECRET_2 else '❌'}")
    
    if not secondary_configured:
        logger.info("To add a secondary account, follow the setup instructions below.")
        return False
    else:
        logger.info("Secondary account is already configured! 🎉")
        return True


def main():
    """Main function"""
    logger.info("Gmail Multi-Account Setup Helper")
    logger.info("=" * 50)
    
    # Check current setup
    is_configured = check_current_setup()
    
    if not is_configured:
        print_setup_instructions()
    
    logger.info("=" * 80)
    logger.info("Setup complete! Your expense tracker now supports multiple Gmail accounts.")
    logger.info("=" * 80)


if __name__ == "__main__":
    main()
