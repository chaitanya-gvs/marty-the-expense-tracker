#!/usr/bin/env python3
"""
Keep Gmail Tokens Alive Script

This script refreshes Gmail OAuth tokens periodically to prevent them from expiring.
Google refresh tokens expire if not used for 6 months, so running this script
weekly or monthly will keep them active.

Usage:
    # Run manually
    poetry run python scripts/keep_tokens_alive.py
    
    # Set up cron job (weekly on Sunday at 2 AM)
    0 2 * * 0 cd /path/to/expense-tracker/backend && poetry run python scripts/keep_tokens_alive.py
"""

import sys
from pathlib import Path

# Add backend directory to Python path
backend_path = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(backend_path))

from src.services.email_ingestion.token_manager import TokenManager, TokenHealthMonitor
from src.utils.logger import get_logger
from src.utils.settings import get_settings

logger = get_logger(__name__)


def keep_tokens_alive():
    """Refresh tokens for all configured accounts to keep them alive"""
    logger.info("🔄 KEEPING GMAIL TOKENS ALIVE")
    logger.info("=" * 60)
    
    settings = get_settings()
    accounts_to_refresh = []
    
    # Check which accounts are configured
    if settings.GOOGLE_REFRESH_TOKEN:
        accounts_to_refresh.append("primary")
    if settings.GOOGLE_REFRESH_TOKEN_2:
        accounts_to_refresh.append("secondary")
    
    if not accounts_to_refresh:
        logger.warning("❌ No Gmail accounts configured")
        return False
    
    logger.info(f"📋 Found {len(accounts_to_refresh)} configured account(s): {', '.join(accounts_to_refresh)}")
    
    all_success = True
    
    for account_id in accounts_to_refresh:
        logger.info(f"🔄 Refreshing {account_id} account token...")
        try:
            token_manager = TokenManager(account_id)
            
            # Get valid credentials (this will refresh if needed)
            credentials = token_manager.get_valid_credentials()
            
            if credentials:
                logger.info(f"✅ {account_id.title()} account: Token refreshed successfully")
                if credentials.expiry:
                    from datetime import datetime
                    time_left = credentials.expiry - datetime.utcnow()
                    logger.info(f"   Access token expires in: {time_left}")
            else:
                logger.error(f"❌ {account_id.title()} account: Failed to refresh token")
                all_success = False
                
        except Exception as e:
            logger.error(f"❌ {account_id.title()} account: Error", exc_info=True)
            all_success = False
    
    # Check overall health
    logger.info("📊 TOKEN HEALTH SUMMARY")
    logger.info("=" * 60)
    monitor = TokenHealthMonitor()
    summary = monitor.get_health_summary()
    logger.info(summary)
    
    if all_success:
        logger.info("✅ All tokens refreshed successfully!")
        logger.info("💡 Tokens will remain active for another 6 months")
        return True
    else:
        logger.warning("⚠️ Some tokens failed to refresh")
        logger.warning("💡 You may need to regenerate tokens using:")
        logger.warning("   poetry run python scripts/regenerate_both_accounts.py")
        return False


def main():
    """Main function"""
    try:
        success = keep_tokens_alive()
        sys.exit(0 if success else 1)
    except KeyboardInterrupt:
        logger.warning("\n\n⚠️ Interrupted by user")
        sys.exit(1)
    except Exception as e:
        logger.error("❌ Unexpected error in keep_tokens_alive", exc_info=True)
        sys.exit(1)


if __name__ == "__main__":
    main()



