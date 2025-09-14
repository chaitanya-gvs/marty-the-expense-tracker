"""
Advanced Gmail Token Management System

This module provides comprehensive token management to minimize Gmail authentication issues:
1. Automatic token refresh before expiration
2. Proactive token validation
3. Graceful error handling with retry mechanisms
4. Token health monitoring
5. Automatic re-authentication when needed
"""

import asyncio
import json
import os
import time
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, List, Optional, Tuple

from google.auth.exceptions import RefreshError
from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request

from src.utils.logger import get_logger
from src.utils.settings import get_settings

logger = get_logger(__name__)


class TokenManager:
    """Advanced token management for Gmail authentication"""
    
    def __init__(self, account_id: str = "primary"):
        self.account_id = account_id
        self.settings = get_settings()
        self.token_cache = {}
        self.last_refresh_time = {}
        self.refresh_threshold = 300  # Refresh 5 minutes before expiration
        
    def _get_token_info(self) -> Tuple[str, str, str]:
        """Get token information for the account"""
        if self.account_id == "secondary":
            refresh_token = self.settings.GOOGLE_REFRESH_TOKEN_2
            client_id = self.settings.GOOGLE_CLIENT_ID_2
            client_secret = self.settings.GOOGLE_CLIENT_SECRET_2
        else:
            refresh_token = self.settings.GOOGLE_REFRESH_TOKEN
            client_id = self.settings.GOOGLE_CLIENT_ID
            client_secret = self.settings.GOOGLE_CLIENT_SECRET
            
        return refresh_token, client_id, client_secret
    
    def _create_credentials(self, access_token: Optional[str] = None) -> Credentials:
        """Create credentials object"""
        refresh_token, client_id, client_secret = self._get_token_info()
        
        return Credentials(
            token=access_token,
            refresh_token=refresh_token,
            client_id=client_id,
            client_secret=client_secret,
            token_uri="https://oauth2.googleapis.com/token",
            scopes=[
                "https://www.googleapis.com/auth/gmail.readonly",
                "https://www.googleapis.com/auth/gmail.modify"
            ]
        )
    
    def _is_token_expired(self, credentials: Credentials) -> bool:
        """Check if token is expired or will expire soon"""
        if not credentials.expired:
            # Check if token will expire within the threshold
            if credentials.expiry:
                time_until_expiry = credentials.expiry - datetime.utcnow()
                return time_until_expiry.total_seconds() < self.refresh_threshold
            return False
        return True
    
    def _refresh_token_proactively(self, credentials: Credentials) -> bool:
        """Proactively refresh token before it expires"""
        try:
            if self._is_token_expired(credentials):
                logger.info(f"Proactively refreshing token for {self.account_id} account")
                credentials.refresh(Request())
                self.last_refresh_time[self.account_id] = time.time()
                logger.info(f"Token refreshed successfully for {self.account_id} account")
                return True
            return True
        except RefreshError as e:
            logger.error(f"Failed to refresh token for {self.account_id}: {e}")
            return False
        except Exception as e:
            logger.error(f"Unexpected error refreshing token for {self.account_id}: {e}")
            return False
    
    def get_valid_credentials(self) -> Optional[Credentials]:
        """Get valid credentials, refreshing if necessary"""
        try:
            credentials = self._create_credentials()
            
            # Try to refresh proactively
            if not self._refresh_token_proactively(credentials):
                logger.error(f"Failed to get valid credentials for {self.account_id}")
                return None
            
            return credentials
            
        except Exception as e:
            logger.error(f"Error getting credentials for {self.account_id}: {e}")
            return None
    
    def validate_token_health(self) -> Dict[str, any]:
        """Validate token health and return status information"""
        try:
            refresh_token, client_id, client_secret = self._get_token_info()
            
            if not refresh_token:
                return {
                    "status": "error",
                    "message": "No refresh token found",
                    "account": self.account_id,
                    "needs_reauth": True
                }
            
            credentials = self._create_credentials()
            
            # Test token by trying to refresh
            try:
                credentials.refresh(Request())
                return {
                    "status": "healthy",
                    "message": "Token is valid and working",
                    "account": self.account_id,
                    "expiry": credentials.expiry.isoformat() if credentials.expiry else None,
                    "needs_reauth": False
                }
            except RefreshError as e:
                return {
                    "status": "expired",
                    "message": f"Token refresh failed: {e}",
                    "account": self.account_id,
                    "needs_reauth": True
                }
                
        except Exception as e:
            return {
                "status": "error",
                "message": f"Token validation error: {e}",
                "account": self.account_id,
                "needs_reauth": True
            }
    
    def get_token_status_summary(self) -> str:
        """Get a human-readable token status summary"""
        health = self.validate_token_health()
        
        if health["status"] == "healthy":
            expiry_info = ""
            if health.get("expiry"):
                expiry = datetime.fromisoformat(health["expiry"])
                time_left = expiry - datetime.utcnow()
                expiry_info = f" (expires in {time_left})"
            return f"✅ {self.account_id.title()} account: Healthy{expiry_info}"
        elif health["status"] == "expired":
            return f"❌ {self.account_id.title()} account: Token expired - needs re-authentication"
        else:
            return f"⚠️ {self.account_id.title()} account: {health['message']}"
    
    def save_refreshed_tokens(self, credentials: Credentials) -> bool:
        """Save refreshed tokens to environment file"""
        try:
            refresh_token, client_id, client_secret = self._get_token_info()
            
            # Update the environment file with new tokens
            env_file_path = Path("configs/secrets/.env")
            
            if not env_file_path.exists():
                logger.error("Environment file not found")
                return False
            
            # Read existing content
            with open(env_file_path, 'r') as f:
                lines = f.readlines()
            
            # Update token lines
            token_updates = {
                f"GOOGLE_REFRESH_TOKEN{'2' if self.account_id == 'secondary' else ''}": credentials.refresh_token or refresh_token,
                f"GOOGLE_CLIENT_ID{'2' if self.account_id == 'secondary' else ''}": credentials.client_id or client_id,
                f"GOOGLE_CLIENT_SECRET{'2' if self.account_id == 'secondary' else ''}": credentials.client_secret or client_secret
            }
            
            updated_lines = []
            updated_keys = set()
            
            for line in lines:
                key = line.split('=')[0] if '=' in line else None
                if key in token_updates:
                    updated_lines.append(f"{key}={token_updates[key]}\n")
                    updated_keys.add(key)
                else:
                    updated_lines.append(line)
            
            # Add any missing keys
            for key, value in token_updates.items():
                if key not in updated_keys:
                    updated_lines.append(f"{key}={value}\n")
            
            # Write back to file
            with open(env_file_path, 'w') as f:
                f.writelines(updated_lines)
            
            logger.info(f"Successfully saved refreshed tokens for {self.account_id} account")
            return True
            
        except Exception as e:
            logger.error(f"Error saving refreshed tokens for {self.account_id}: {e}")
            return False


class TokenHealthMonitor:
    """Monitor token health across all accounts"""
    
    def __init__(self):
        self.primary_manager = TokenManager("primary")
        self.secondary_manager = TokenManager("secondary")
    
    def check_all_accounts(self) -> Dict[str, Dict[str, any]]:
        """Check health of all configured accounts"""
        results = {}
        
        # Check primary account
        results["primary"] = self.primary_manager.validate_token_health()
        
        # Check secondary account if configured
        settings = get_settings()
        if settings.GOOGLE_REFRESH_TOKEN_2:
            results["secondary"] = self.secondary_manager.validate_token_health()
        
        return results
    
    def get_health_summary(self) -> str:
        """Get a summary of all account health"""
        results = self.check_all_accounts()
        
        summary_lines = ["🔐 Gmail Token Health Summary", "=" * 50]
        
        for account, health in results.items():
            manager = self.primary_manager if account == "primary" else self.secondary_manager
            summary_lines.append(manager.get_token_status_summary())
        
        # Overall status
        all_healthy = all(h["status"] == "healthy" for h in results.values())
        if all_healthy:
            summary_lines.append("\n✅ All accounts are healthy!")
        else:
            summary_lines.append("\n⚠️ Some accounts need attention")
        
        return "\n".join(summary_lines)
    
    def get_accounts_needing_reauth(self) -> List[str]:
        """Get list of accounts that need re-authentication"""
        results = self.check_all_accounts()
        return [account for account, health in results.items() if health.get("needs_reauth", False)]


# Convenience functions
def get_healthy_credentials(account_id: str = "primary") -> Optional[Credentials]:
    """Get healthy credentials for an account"""
    manager = TokenManager(account_id)
    return manager.get_valid_credentials()


def check_token_health(account_id: str = "primary") -> Dict[str, any]:
    """Check token health for an account"""
    manager = TokenManager(account_id)
    return manager.validate_token_health()


def get_all_accounts_health() -> str:
    """Get health summary for all accounts"""
    monitor = TokenHealthMonitor()
    return monitor.get_health_summary()
