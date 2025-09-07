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
    print("=" * 80)
    print("SECONDARY GMAIL ACCOUNT SETUP GUIDE")
    print("=" * 80)
    print()
    
    print("STEP 1: Google Cloud Console Setup")
    print("-" * 40)
    print("1. Go to https://console.cloud.google.com/")
    print("2. Select your existing project (or create a new one)")
    print("3. Go to 'APIs & Services' > 'Credentials'")
    print("4. Find your existing OAuth 2.0 Client ID")
    print("5. Add the secondary Gmail account to 'Test users' in OAuth consent screen")
    print()
    
    print("STEP 2: Get Authorization URL")
    print("-" * 40)
    print("1. Run this command to get the authorization URL:")
    print("   poetry run python -c \"")
    print("   from src.services.email_ingestion.auth import EmailAuthHandler;")
    print("   handler = EmailAuthHandler();")
    print("   print('Authorization URL:', handler.get_authorization_url())\"")
    print()
    print("2. Open the URL in your browser")
    print("3. Sign in with your SECONDARY Gmail account")
    print("4. Grant permissions to the application")
    print("5. Copy the authorization code from the callback URL")
    print()
    
    print("STEP 3: Exchange Code for Tokens")
    print("-" * 40)
    print("1. Run this command with your authorization code:")
    print("   poetry run python -c \"")
    print("   from src.services.email_ingestion.auth import EmailAuthHandler;")
    print("   handler = EmailAuthHandler();")
    print("   tokens = handler.exchange_code_for_tokens('YOUR_AUTHORIZATION_CODE');")
    print("   print('Refresh Token:', tokens.get('refresh_token'))\"")
    print()
    print("2. Copy the refresh token")
    print()
    
    print("STEP 4: Update Environment Variables")
    print("-" * 40)
    print("Add these variables to your backend/configs/secrets/.env file:")
    print()
    print("# Secondary Gmail Account")
    print("GOOGLE_REFRESH_TOKEN_2=your_refresh_token_here")
    print("GOOGLE_CLIENT_ID_2=your_client_id_here")
    print("GOOGLE_CLIENT_SECRET_2=your_client_secret_here")
    print()
    print("Note: You can use the same CLIENT_ID and CLIENT_SECRET as your primary account")
    print()
    
    print("STEP 5: Test the Setup")
    print("-" * 40)
    print("1. Test the connection:")
    print("   curl -X GET 'http://localhost:8000/mail/accounts'")
    print()
    print("2. Test email ingestion from secondary account:")
    print("   curl -X POST 'http://localhost:8000/mail/ingest?account_id=secondary'")
    print()
    print("3. Test ingestion from all accounts:")
    print("   curl -X POST 'http://localhost:8000/mail/ingest/all'")
    print()


def check_current_setup():
    """Check the current email account setup"""
    print("CURRENT EMAIL ACCOUNT SETUP")
    print("=" * 40)
    
    settings = get_settings()
    
    # Check primary account
    primary_configured = bool(settings.GOOGLE_REFRESH_TOKEN)
    print(f"Primary Account: {'✅ Configured' if primary_configured else '❌ Not configured'}")
    if primary_configured:
        print(f"  - Has refresh token: {'✅' if settings.GOOGLE_REFRESH_TOKEN else '❌'}")
        print(f"  - Has client config: {'✅' if settings.GOOGLE_CLIENT_ID and settings.GOOGLE_CLIENT_SECRET else '❌'}")
    
    # Check secondary account
    secondary_configured = bool(settings.GOOGLE_REFRESH_TOKEN_2)
    print(f"Secondary Account: {'✅ Configured' if secondary_configured else '❌ Not configured'}")
    if secondary_configured:
        print(f"  - Has refresh token: {'✅' if settings.GOOGLE_REFRESH_TOKEN_2 else '❌'}")
        print(f"  - Has client config: {'✅' if settings.GOOGLE_CLIENT_ID_2 and settings.GOOGLE_CLIENT_SECRET_2 else '❌'}")
    
    print()
    
    if not secondary_configured:
        print("To add a secondary account, follow the setup instructions below.")
        print()
        return False
    else:
        print("Secondary account is already configured! 🎉")
        return True


def main():
    """Main function"""
    print("Gmail Multi-Account Setup Helper")
    print("=" * 50)
    print()
    
    # Check current setup
    is_configured = check_current_setup()
    
    if not is_configured:
        print_setup_instructions()
    
    print("=" * 80)
    print("Setup complete! Your expense tracker now supports multiple Gmail accounts.")
    print("=" * 80)


if __name__ == "__main__":
    main()
