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

def print_banner(text):
    """Print a formatted banner"""
    print("\n" + "=" * 80)
    print(f"  {text}")
    print("=" * 80 + "\n")

def regenerate_primary_account():
    """Generate authorization URL for primary account"""
    print_banner("PRIMARY ACCOUNT (chaitanyagvs23)")
    
    handler = EmailAuthHandler()
    auth_url = handler.get_authorization_url()
    
    print("📋 STEPS:")
    print("1. Copy the URL below and open it in your browser")
    print("2. Sign in with: chaitanyagvs23@gmail.com")
    print("3. Grant permissions")
    print("4. After redirect, copy the 'code=' parameter from the URL")
    print("5. Save it for the next step\n")
    
    print("🔗 AUTHORIZATION URL:")
    print("-" * 80)
    print(auth_url)
    print("-" * 80)
    print()

def regenerate_secondary_account():
    """Generate authorization URL for secondary account"""
    print_banner("SECONDARY ACCOUNT (chaitanyagvs98)")
    
    handler = EmailAuthHandler()
    auth_url = handler.get_authorization_url()
    
    print("📋 STEPS:")
    print("1. Copy the URL below and open it in your browser")
    print("2. Sign in with: chaitanyagvs98@gmail.com")
    print("3. Grant permissions")
    print("4. After redirect, copy the 'code=' parameter from the URL")
    print("5. Save it for the next step\n")
    
    print("🔗 AUTHORIZATION URL:")
    print("-" * 80)
    print(auth_url)
    print("-" * 80)
    print()

def show_token_exchange_instructions():
    """Show instructions for exchanging authorization codes for tokens"""
    print_banner("TOKEN EXCHANGE INSTRUCTIONS")
    
    print("After getting both authorization codes, update your .env file:")
    print()
    print("🔧 FOR PRIMARY ACCOUNT:")
    print("1. Run this command (replace YOUR_CODE with actual code):")
    print("   poetry run python -c \"")
    print("   from src.services.email_ingestion.auth import EmailAuthHandler;")
    print("   handler = EmailAuthHandler();")
    print("   tokens = handler.exchange_code_for_tokens('YOUR_CODE');")
    print("   print('GOOGLE_REFRESH_TOKEN=' + tokens['refresh_token'])\"")
    print()
    print("2. Copy the output and update GOOGLE_REFRESH_TOKEN in configs/.env")
    print()
    
    print("🔧 FOR SECONDARY ACCOUNT:")
    print("1. Run the same command with the secondary account code")
    print("2. Copy the output and update GOOGLE_REFRESH_TOKEN_2 in configs/.env")
    print()

def main():
    """Main function"""
    print_banner("GMAIL TOKEN REGENERATION HELPER")
    
    print("This script will help you regenerate tokens for both Gmail accounts.")
    print("You'll need to complete the OAuth flow for each account separately.\n")
    
    settings = get_settings()
    
    # Check current configuration
    print("📊 CURRENT CONFIGURATION:")
    print(f"Primary Client ID: {'✅ Found' if settings.GOOGLE_CLIENT_ID else '❌ Missing'}")
    print(f"Primary Refresh Token: {'✅ Found' if settings.GOOGLE_REFRESH_TOKEN else '❌ Missing'}")
    print(f"Secondary Client ID: {'✅ Found' if settings.GOOGLE_CLIENT_ID_2 else '❌ Missing'}")
    print(f"Secondary Refresh Token: {'✅ Found' if settings.GOOGLE_REFRESH_TOKEN_2 else '❌ Missing'}")
    print()
    
    # Generate URLs for both accounts
    regenerate_primary_account()
    input("Press Enter after completing primary account OAuth flow...")
    
    regenerate_secondary_account()
    input("Press Enter after completing secondary account OAuth flow...")
    
    show_token_exchange_instructions()
    
    print("\n✅ DONE!")
    print("After updating your .env file, restart your backend server.")
    print("The email search will then work with both accounts.")

if __name__ == "__main__":
    main()

