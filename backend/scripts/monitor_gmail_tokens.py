#!/usr/bin/env python3
"""
Gmail Token Health Monitor and Maintenance Script

This script helps you:
1. Monitor token health across all accounts
2. Proactively refresh tokens before expiration
3. Get alerts when tokens need re-authentication
4. Automatically maintain token health
"""

import sys
import asyncio
from pathlib import Path

# Add backend directory to Python path
backend_path = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(backend_path))

from src.services.email_ingestion.token_manager import TokenHealthMonitor, TokenManager
from src.utils.logger import get_logger

logger = get_logger(__name__)


def check_token_health():
    """Check and display token health for all accounts"""
    logger.info("🔍 CHECKING GMAIL TOKEN HEALTH")
    logger.info("=" * 60)
    
    monitor = TokenHealthMonitor()
    summary = monitor.get_health_summary()
    logger.info(summary)
    
    # Check if any accounts need re-authentication
    accounts_needing_reauth = monitor.get_accounts_needing_reauth()
    if accounts_needing_reauth:
        logger.warning(f"\n⚠️  Accounts needing re-authentication: {', '.join(accounts_needing_reauth)}")
        logger.warning("Run: poetry run python scripts/regenerate_gmail_tokens.py")
    else:
        logger.info("\n✅ All accounts are healthy and ready to use!")


def refresh_tokens_proactively():
    """Proactively refresh tokens for all accounts"""
    logger.info("🔄 PROACTIVELY REFRESHING TOKENS")
    logger.info("=" * 60)
    
    monitor = TokenHealthMonitor()
    results = monitor.check_all_accounts()
    
    refreshed_count = 0
    for account, health in results.items():
        if health["status"] == "healthy":
            manager = TokenManager(account)
            credentials = manager.get_valid_credentials()
            if credentials:
                logger.info(f"✅ {account.title()} account: Token refreshed proactively")
                refreshed_count += 1
            else:
                logger.error(f"❌ {account.title()} account: Failed to refresh token")
        else:
            logger.warning(f"⚠️ {account.title()} account: Needs re-authentication")
    
    logger.info(f"\n📊 Summary: {refreshed_count} tokens refreshed successfully")


def setup_token_monitoring():
    """Set up automated token monitoring"""
    logger.info("⚙️  SETTING UP TOKEN MONITORING")
    logger.info("=" * 60)
    
    logger.info("To set up automated token monitoring, you can:")
    logger.info("1. Add a cron job to run this script periodically:")
    logger.info("   # Check token health every 6 hours")
    logger.info("   0 */6 * * * cd /path/to/expense-tracker/backend && poetry run python scripts/monitor_gmail_tokens.py --check")
    logger.info("2. Add proactive refresh to your workflow:")
    logger.info("   # Refresh tokens before running workflow")
    logger.info("   poetry run python scripts/monitor_gmail_tokens.py --refresh")
    logger.info("   poetry run python scripts/run_workflow_with_resume.py --full")
    logger.info("3. Set up alerts for token expiration:")
    logger.info("   # Check daily and alert if tokens need attention")
    logger.info("   0 9 * * * cd /path/to/expense-tracker/backend && poetry run python scripts/monitor_gmail_tokens.py --check --alert")


def main():
    """Main function"""
    import argparse
    
    parser = argparse.ArgumentParser(description="Gmail Token Health Monitor")
    parser.add_argument("--check", action="store_true", help="Check token health")
    parser.add_argument("--refresh", action="store_true", help="Proactively refresh tokens")
    parser.add_argument("--setup", action="store_true", help="Show setup instructions")
    parser.add_argument("--alert", action="store_true", help="Show alerts for accounts needing attention")
    
    args = parser.parse_args()
    
    if args.check:
        check_token_health()
    elif args.refresh:
        refresh_tokens_proactively()
    elif args.setup:
        setup_token_monitoring()
    else:
        # Default: show health check
        check_token_health()
        
        if args.alert:
            logger.info("\n" + "=" * 60)
            logger.info("📋 RECOMMENDATIONS:")
            logger.info("1. Run this script regularly to monitor token health")
            logger.info("2. Set up automated monitoring with cron jobs")
            logger.info("3. Use --refresh before running workflows")
            logger.info("4. Keep backup of your OAuth credentials")


if __name__ == "__main__":
    main()
