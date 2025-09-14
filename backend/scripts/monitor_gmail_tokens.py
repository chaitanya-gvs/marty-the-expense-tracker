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
    print("🔍 CHECKING GMAIL TOKEN HEALTH")
    print("=" * 60)
    
    monitor = TokenHealthMonitor()
    summary = monitor.get_health_summary()
    print(summary)
    
    # Check if any accounts need re-authentication
    accounts_needing_reauth = monitor.get_accounts_needing_reauth()
    if accounts_needing_reauth:
        print(f"\n⚠️  Accounts needing re-authentication: {', '.join(accounts_needing_reauth)}")
        print("Run: poetry run python scripts/regenerate_gmail_tokens.py")
    else:
        print("\n✅ All accounts are healthy and ready to use!")


def refresh_tokens_proactively():
    """Proactively refresh tokens for all accounts"""
    print("🔄 PROACTIVELY REFRESHING TOKENS")
    print("=" * 60)
    
    monitor = TokenHealthMonitor()
    results = monitor.check_all_accounts()
    
    refreshed_count = 0
    for account, health in results.items():
        if health["status"] == "healthy":
            manager = TokenManager(account)
            credentials = manager.get_valid_credentials()
            if credentials:
                print(f"✅ {account.title()} account: Token refreshed proactively")
                refreshed_count += 1
            else:
                print(f"❌ {account.title()} account: Failed to refresh token")
        else:
            print(f"⚠️ {account.title()} account: Needs re-authentication")
    
    print(f"\n📊 Summary: {refreshed_count} tokens refreshed successfully")


def setup_token_monitoring():
    """Set up automated token monitoring"""
    print("⚙️  SETTING UP TOKEN MONITORING")
    print("=" * 60)
    
    print("To set up automated token monitoring, you can:")
    print()
    print("1. Add a cron job to run this script periodically:")
    print("   # Check token health every 6 hours")
    print("   0 */6 * * * cd /path/to/expense-tracker/backend && poetry run python scripts/monitor_gmail_tokens.py --check")
    print()
    print("2. Add proactive refresh to your workflow:")
    print("   # Refresh tokens before running workflow")
    print("   poetry run python scripts/monitor_gmail_tokens.py --refresh")
    print("   poetry run python scripts/run_workflow_with_resume.py --full")
    print()
    print("3. Set up alerts for token expiration:")
    print("   # Check daily and alert if tokens need attention")
    print("   0 9 * * * cd /path/to/expense-tracker/backend && poetry run python scripts/monitor_gmail_tokens.py --check --alert")


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
            print("\n" + "=" * 60)
            print("📋 RECOMMENDATIONS:")
            print("1. Run this script regularly to monitor token health")
            print("2. Set up automated monitoring with cron jobs")
            print("3. Use --refresh before running workflows")
            print("4. Keep backup of your OAuth credentials")


if __name__ == "__main__":
    main()
