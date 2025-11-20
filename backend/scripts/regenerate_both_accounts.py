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


def print_banner(text):
    """Print a formatted banner"""
    print("\n" + "=" * 80)
    print(f"  {text}")
    print("=" * 80 + "\n")


def check_current_configuration():
    """Check and display current configuration status"""
    print_banner("CURRENT CONFIGURATION STATUS")
    
    settings = get_settings()
    
    print("📊 PRIMARY ACCOUNT:")
    print(f"   Client ID: {'✅ Found' if settings.GOOGLE_CLIENT_ID else '❌ Missing'}")
    print(f"   Client Secret: {'✅ Found' if settings.GOOGLE_CLIENT_SECRET else '❌ Missing'}")
    print(f"   Refresh Token: {'✅ Found' if settings.GOOGLE_REFRESH_TOKEN else '❌ Missing'}")
    print(f"   Client Secret File: {'✅ Found' if settings.GOOGLE_CLIENT_SECRET_FILE else '❌ Missing'}")
    print()
    
    print("📊 SECONDARY ACCOUNT:")
    print(f"   Client ID: {'✅ Found' if settings.GOOGLE_CLIENT_ID_2 else '❌ Missing'}")
    print(f"   Client Secret: {'✅ Found' if settings.GOOGLE_CLIENT_SECRET_2 else '❌ Missing'}")
    print(f"   Refresh Token: {'✅ Found' if settings.GOOGLE_REFRESH_TOKEN_2 else '❌ Missing'}")
    print(f"   Client Secret File: {'✅ Found' if settings.GOOGLE_CLIENT_SECRET_FILE_2 else '❌ Missing'}")
    print()
    
    return settings


def regenerate_account(account_id: str, account_email: str):
    """Complete OAuth flow for a specific account"""
    print_banner(f"{account_id.upper()} ACCOUNT ({account_email})")
    
    try:
        # Create handler for this account
        handler = EmailAuthHandler(account_id=account_id)
        
        # Generate authorization URL
        print("🔗 Generating authorization URL...")
        auth_url = handler.get_authorization_url()
        
        print("\n📋 INSTRUCTIONS:")
        print("1. Copy the URL below and open it in your browser")
        print(f"2. Sign in with: {account_email}")
        print("3. Grant permissions to the application")
        print("4. After redirect, copy the 'code=' parameter from the callback URL")
        print("   (The URL will look like: http://localhost:8080/?code=YOUR_CODE_HERE&scope=...)")
        print()
        print("🔗 AUTHORIZATION URL:")
        print("-" * 80)
        print(auth_url)
        print("-" * 80)
        print()
        
        # Get authorization code from user
        authorization_code = input("📝 Paste the authorization code here: ").strip()
        
        if not authorization_code:
            print("❌ No authorization code provided. Skipping this account.")
            return False
        
        # Exchange code for tokens
        print("\n🔄 Exchanging authorization code for tokens...")
        token_info = handler.exchange_code_for_tokens(authorization_code)
        
        print("✅ Successfully obtained tokens!")
        print(f"   Refresh Token: {token_info.get('refresh_token', 'N/A')[:30]}...")
        print()
        
        # Save tokens to .env file
        print("💾 Saving tokens to environment file...")
        handler.save_tokens_to_env(token_info)
        print("✅ Tokens saved successfully!")
        print()
        
        return True
        
    except Exception as e:
        print(f"❌ Error during OAuth flow: {e}")
        print()
        return False


def main():
    """Main function"""
    print_banner("GMAIL TOKEN REGENERATION FOR BOTH ACCOUNTS")
    
    print("This script will help you regenerate Gmail OAuth tokens for both accounts.")
    print("You'll complete the OAuth flow for each account separately.\n")
    
    # Check current configuration
    settings = check_current_configuration()
    
    # Ask which accounts to regenerate
    print("Which accounts would you like to regenerate?")
    print("1. Primary account only")
    print("2. Secondary account only")
    print("3. Both accounts")
    print()
    
    choice = input("Enter your choice (1/2/3): ").strip()
    
    if choice == "1":
        # Regenerate primary account
        regenerate_account("primary", "chaitanyagvs23@gmail.com")
    elif choice == "2":
        # Regenerate secondary account
        regenerate_account("secondary", "chaitanyagvs98@gmail.com")
    elif choice == "3":
        # Regenerate both accounts
        print("\n🔄 Starting with PRIMARY account...")
        regenerate_account("primary", "chaitanyagvs23@gmail.com")
        
        input("\nPress Enter to continue with secondary account...")
        
        print("\n🔄 Starting with SECONDARY account...")
        regenerate_account("secondary", "chaitanyagvs98@gmail.com")
    else:
        print("❌ Invalid choice. Exiting.")
        return
    
    print_banner("REGENERATION COMPLETE")
    print("✅ Token regeneration process completed!")
    print()
    print("📋 NEXT STEPS:")
    print("1. Verify that tokens were saved to configs/secrets/.env")
    print("2. Restart your backend server")
    print("3. Test email search functionality")
    print()
    print("🎉 You're all set!")


if __name__ == "__main__":
    main()

