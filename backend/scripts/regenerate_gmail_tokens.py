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
    logger.info("🔍 CHECKING CURRENT TOKEN STATUS")
    logger.info("=" * 50)
    
    settings = get_settings()
    
    # Check if we have the basic configuration
    has_client_config = bool(settings.GOOGLE_CLIENT_ID and settings.GOOGLE_CLIENT_SECRET)
    has_refresh_token = bool(settings.GOOGLE_REFRESH_TOKEN)
    
    logger.info(f"Client Configuration: {'✅ Found' if has_client_config else '❌ Missing'}")
    logger.info(f"Refresh Token: {'✅ Found' if has_refresh_token else '❌ Missing'}")
    
    if has_client_config and has_refresh_token:
        logger.info("🔄 Testing token validity...")
        try:
            handler = EmailAuthHandler()
            # For validation, we only need the refresh token since access tokens expire quickly
            is_valid = handler.validate_credentials(
                None,  # No access token needed for validation
                settings.GOOGLE_REFRESH_TOKEN
            )
            logger.info(f"Token Status: {'✅ Valid' if is_valid else '❌ Expired/Invalid'}")
            return is_valid
        except Exception as e:
            logger.error("Token Status: ❌ Error", exc_info=True)
            return False
    else:
        logger.warning("❌ Cannot test tokens - missing configuration")
        return False


def generate_authorization_url():
    """Generate a new authorization URL"""
    logger.info("\n🔗 GENERATING AUTHORIZATION URL")
    logger.info("=" * 50)
    
    try:
        handler = EmailAuthHandler()
        auth_url = handler.get_authorization_url()
        
        logger.info("✅ Authorization URL generated successfully!")
        logger.info("\n📋 NEXT STEPS:")
        logger.info("1. Copy the URL below and open it in your browser")
        logger.info("2. Sign in with your Gmail account")
        logger.info("3. Grant permissions to the application")
        logger.info("4. Copy the authorization code from the callback URL")
        logger.info("\n🔗 AUTHORIZATION URL:")
        logger.info("-" * 80)
        logger.info(auth_url)
        logger.info("-" * 80)
        
        return auth_url
    except Exception as e:
        logger.error("❌ Error generating authorization URL", exc_info=True)
        return None


def exchange_code_for_tokens(authorization_code: str):
    """Exchange authorization code for new tokens"""
    logger.info("\n🔄 EXCHANGING CODE FOR TOKENS")
    logger.info("=" * 50)
    
    try:
        handler = EmailAuthHandler()
        token_info = handler.exchange_code_for_tokens(authorization_code)
        
        logger.info("✅ Successfully exchanged authorization code for tokens!")
        logger.info("\n📋 NEW TOKEN INFORMATION:")
        logger.info(f"Access Token: {token_info.get('access_token', 'N/A')[:20]}...")
        logger.info(f"Refresh Token: {token_info.get('refresh_token', 'N/A')[:20]}...")
        logger.info(f"Client ID: {token_info.get('client_id', 'N/A')}")
        logger.info(f"Scopes: {', '.join(token_info.get('scopes', []))}")
        
        # Save tokens to environment file
        logger.info("\n💾 SAVING TOKENS TO ENVIRONMENT FILE...")
        handler.save_tokens_to_env(token_info)
        logger.info("✅ Tokens saved successfully!")
        
        return token_info
    except Exception as e:
        logger.error("❌ Error exchanging code for tokens", exc_info=True)
        return None


def test_new_tokens():
    """Test the newly generated tokens"""
    logger.info("\n🧪 TESTING NEW TOKENS")
    logger.info("=" * 50)
    
    try:
        settings = get_settings()
        handler = EmailAuthHandler()
        
        is_valid = handler.validate_credentials(
            None,  # No access token needed for validation
            settings.GOOGLE_REFRESH_TOKEN
        )
        
        if is_valid:
            logger.info("✅ New tokens are working correctly!")
            return True
        else:
            logger.error("❌ New tokens are still not working")
            return False
    except Exception as e:
        logger.error("❌ Error testing tokens", exc_info=True)
        return False


def main():
    """Main function"""
    logger.info("🔐 GMAIL TOKEN REGENERATION TOOL")
    logger.info("=" * 60)
    
    # Check current token status
    tokens_valid = check_current_tokens()
    
    if tokens_valid:
        logger.info("\n✅ Your current tokens are working fine!")
        logger.info("No regeneration needed.")
        return
    
    logger.info("\n🔄 Tokens need to be regenerated. Let's fix this!")
    
    # Generate authorization URL
    auth_url = generate_authorization_url()
    if not auth_url:
        logger.error("\n❌ Failed to generate authorization URL. Please check your configuration.")
        return
    
    # Get authorization code from user
    logger.info("\n⏳ WAITING FOR AUTHORIZATION CODE...")
    logger.info("After completing the OAuth flow, paste the authorization code below:")
    authorization_code = input("\nAuthorization Code: ").strip()
    
    if not authorization_code:
        logger.warning("❌ No authorization code provided. Exiting.")
        return
    
    # Exchange code for tokens
    token_info = exchange_code_for_tokens(authorization_code)
    if not token_info:
        logger.error("\n❌ Failed to exchange code for tokens.")
        return
    
    # Test new tokens
    if test_new_tokens():
        logger.info("\n🎉 SUCCESS! Your Gmail tokens have been regenerated successfully!")
        logger.info("\n📋 SUMMARY:")
        logger.info("- New tokens generated and saved")
        logger.info("- Environment configuration updated")
        logger.info("- Tokens validated and working")
        logger.info("\n✅ You can now run your expense tracker workflow again!")
    else:
        logger.error("\n❌ Something went wrong. Please try the process again.")


if __name__ == "__main__":
    main()
