#!/usr/bin/env python3
"""
Script to regenerate Gmail OAuth tokens for the expense tracker.

This script helps you regenerate expired or revoked Gmail tokens by:
1. Generating a new authorization URL
2. Helping you exchange the authorization code for new tokens
3. Updating your environment configuration
"""

import sys
import os
from pathlib import Path

# Add backend directory to Python path
backend_path = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(backend_path))

from src.services.email_ingestion.auth import EmailAuthHandler
from src.utils.logger import get_logger
from src.utils.settings import get_settings

logger = get_logger(__name__)


def check_current_tokens():
    """Check the current token status"""
    print("🔍 CHECKING CURRENT TOKEN STATUS")
    print("=" * 50)
    
    settings = get_settings()
    
    # Check if we have the basic configuration
    has_client_config = bool(settings.GOOGLE_CLIENT_ID and settings.GOOGLE_CLIENT_SECRET)
    has_refresh_token = bool(settings.GOOGLE_REFRESH_TOKEN)
    
    print(f"Client Configuration: {'✅ Found' if has_client_config else '❌ Missing'}")
    print(f"Refresh Token: {'✅ Found' if has_refresh_token else '❌ Missing'}")
    
    if has_client_config and has_refresh_token:
        print("\n🔄 Testing token validity...")
        try:
            handler = EmailAuthHandler()
            # For validation, we only need the refresh token since access tokens expire quickly
            is_valid = handler.validate_credentials(
                None,  # No access token needed for validation
                settings.GOOGLE_REFRESH_TOKEN
            )
            print(f"Token Status: {'✅ Valid' if is_valid else '❌ Expired/Invalid'}")
            return is_valid
        except Exception as e:
            print(f"Token Status: ❌ Error - {e}")
            return False
    else:
        print("❌ Cannot test tokens - missing configuration")
        return False


def generate_authorization_url():
    """Generate a new authorization URL"""
    print("\n🔗 GENERATING AUTHORIZATION URL")
    print("=" * 50)
    
    try:
        handler = EmailAuthHandler()
        auth_url = handler.get_authorization_url()
        
        print("✅ Authorization URL generated successfully!")
        print("\n📋 NEXT STEPS:")
        print("1. Copy the URL below and open it in your browser")
        print("2. Sign in with your Gmail account")
        print("3. Grant permissions to the application")
        print("4. Copy the authorization code from the callback URL")
        print("\n🔗 AUTHORIZATION URL:")
        print("-" * 80)
        print(auth_url)
        print("-" * 80)
        
        return auth_url
    except Exception as e:
        print(f"❌ Error generating authorization URL: {e}")
        return None


def exchange_code_for_tokens(authorization_code: str):
    """Exchange authorization code for new tokens"""
    print("\n🔄 EXCHANGING CODE FOR TOKENS")
    print("=" * 50)
    
    try:
        handler = EmailAuthHandler()
        token_info = handler.exchange_code_for_tokens(authorization_code)
        
        print("✅ Successfully exchanged authorization code for tokens!")
        print("\n📋 NEW TOKEN INFORMATION:")
        print(f"Access Token: {token_info.get('access_token', 'N/A')[:20]}...")
        print(f"Refresh Token: {token_info.get('refresh_token', 'N/A')[:20]}...")
        print(f"Client ID: {token_info.get('client_id', 'N/A')}")
        print(f"Scopes: {', '.join(token_info.get('scopes', []))}")
        
        # Save tokens to environment file
        print("\n💾 SAVING TOKENS TO ENVIRONMENT FILE...")
        handler.save_tokens_to_env(token_info)
        print("✅ Tokens saved successfully!")
        
        return token_info
    except Exception as e:
        print(f"❌ Error exchanging code for tokens: {e}")
        return None


def test_new_tokens():
    """Test the newly generated tokens"""
    print("\n🧪 TESTING NEW TOKENS")
    print("=" * 50)
    
    try:
        settings = get_settings()
        handler = EmailAuthHandler()
        
        is_valid = handler.validate_credentials(
            None,  # No access token needed for validation
            settings.GOOGLE_REFRESH_TOKEN
        )
        
        if is_valid:
            print("✅ New tokens are working correctly!")
            return True
        else:
            print("❌ New tokens are still not working")
            return False
    except Exception as e:
        print(f"❌ Error testing tokens: {e}")
        return False


def main():
    """Main function"""
    print("🔐 GMAIL TOKEN REGENERATION TOOL")
    print("=" * 60)
    print()
    
    # Check current token status
    tokens_valid = check_current_tokens()
    
    if tokens_valid:
        print("\n✅ Your current tokens are working fine!")
        print("No regeneration needed.")
        return
    
    print("\n🔄 Tokens need to be regenerated. Let's fix this!")
    
    # Generate authorization URL
    auth_url = generate_authorization_url()
    if not auth_url:
        print("\n❌ Failed to generate authorization URL. Please check your configuration.")
        return
    
    # Get authorization code from user
    print("\n⏳ WAITING FOR AUTHORIZATION CODE...")
    print("After completing the OAuth flow, paste the authorization code below:")
    authorization_code = input("\nAuthorization Code: ").strip()
    
    if not authorization_code:
        print("❌ No authorization code provided. Exiting.")
        return
    
    # Exchange code for tokens
    token_info = exchange_code_for_tokens(authorization_code)
    if not token_info:
        print("\n❌ Failed to exchange code for tokens.")
        return
    
    # Test new tokens
    if test_new_tokens():
        print("\n🎉 SUCCESS! Your Gmail tokens have been regenerated successfully!")
        print("\n📋 SUMMARY:")
        print("- New tokens generated and saved")
        print("- Environment configuration updated")
        print("- Tokens validated and working")
        print("\n✅ You can now run your expense tracker workflow again!")
    else:
        print("\n❌ Something went wrong. Please try the process again.")


if __name__ == "__main__":
    main()
