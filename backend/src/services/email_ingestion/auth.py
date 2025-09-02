from __future__ import annotations

import json
import os
from typing import Optional
from urllib.parse import urlencode
from pathlib import Path

from google_auth_oauthlib.flow import Flow
from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request

from src.utils.logger import get_logger
from src.utils.settings import get_settings

logger = get_logger(__name__)


class EmailAuthHandler:
    def __init__(self):
        self.settings = get_settings()
        self.client_config = self._load_client_config()

    def _load_client_config(self) -> dict:
        """Load client configuration from JSON file or environment variables"""
        # Try to load from JSON file first
        if self.settings.GOOGLE_CLIENT_SECRET_FILE:
            json_path = Path(self.settings.GOOGLE_CLIENT_SECRET_FILE)
            if json_path.exists():
                try:
                    with open(json_path, 'r') as f:
                        client_config = json.load(f)
                    logger.info(f"Loaded Gmail credentials from {json_path}")
                    return client_config
                except Exception as e:
                    logger.warning(f"Failed to load JSON file {json_path}: {e}")
        
        # Fallback to environment variables
        if self.settings.GOOGLE_CLIENT_ID and self.settings.GOOGLE_CLIENT_SECRET:
            logger.info("Using Gmail credentials from environment variables")
            return {
                "web": {
                    "client_id": self.settings.GOOGLE_CLIENT_ID,
                    "client_secret": self.settings.GOOGLE_CLIENT_SECRET,
                    "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                    "token_uri": "https://oauth2.googleapis.com/token",
                    "redirect_uris": [self.settings.GOOGLE_REDIRECT_URI],
                    "scopes": [
                        "https://www.googleapis.com/auth/gmail.readonly",
                        "https://www.googleapis.com/auth/gmail.modify"
                    ]
                }
            }
        
        # No credentials found
        return {}

    def get_authorization_url(self) -> str:
        """Generate authorization URL for Gmail OAuth"""
        try:
            # Validate that client config is loaded
            if not self.client_config or "web" not in self.client_config:
                raise ValueError("Gmail credentials not configured. Please ensure client_secret.json exists or set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in configs/secrets/.env")
            
            web_config = self.client_config["web"]
            if not web_config.get("client_id") or not web_config.get("client_secret"):
                raise ValueError("Gmail credentials incomplete. Please check your client_secret.json file")
            
            flow = Flow.from_client_config(
                self.client_config,
                scopes=web_config.get("scopes", [
                    "https://www.googleapis.com/auth/gmail.readonly",
                    "https://www.googleapis.com/auth/gmail.modify"
                ])
            )
            flow.redirect_uri = self.settings.GOOGLE_REDIRECT_URI
            
            authorization_url, state = flow.authorization_url(
                access_type='offline',
                include_granted_scopes='true',
                prompt='consent'
            )
            
            logger.info("Generated Gmail OAuth authorization URL")
            return authorization_url
        except Exception as e:
            logger.error(f"Error generating authorization URL: {e}")
            raise

    def exchange_code_for_tokens(self, authorization_code: str) -> dict:
        """Exchange authorization code for access and refresh tokens"""
        try:
            flow = Flow.from_client_config(
                self.client_config,
                scopes=self.client_config["web"]["scopes"]
            )
            flow.redirect_uri = self.settings.GOOGLE_REDIRECT_URI
            
            # Exchange authorization code for tokens
            flow.fetch_token(code=authorization_code)
            
            credentials = flow.credentials
            
            token_info = {
                "access_token": credentials.token,
                "refresh_token": credentials.refresh_token,
                "token_uri": credentials.token_uri,
                "client_id": credentials.client_id,
                "client_secret": credentials.client_secret,
                "scopes": credentials.scopes
            }
            
            logger.info("Successfully exchanged authorization code for tokens")
            return token_info
        except Exception as e:
            logger.error(f"Error exchanging authorization code for tokens: {e}")
            raise

    def refresh_access_token(self, refresh_token: str) -> dict:
        """Refresh access token using refresh token"""
        try:
            credentials = Credentials(
                None,
                refresh_token=refresh_token,
                client_id=self.settings.GOOGLE_CLIENT_ID,
                client_secret=self.settings.GOOGLE_CLIENT_SECRET,
                token_uri="https://oauth2.googleapis.com/token"
            )
            
            # Refresh the credentials
            credentials.refresh(Request())
            
            token_info = {
                "access_token": credentials.token,
                "refresh_token": credentials.refresh_token,
                "token_uri": credentials.token_uri,
                "client_id": credentials.client_id,
                "client_secret": credentials.client_secret,
                "scopes": credentials.scopes
            }
            
            logger.info("Successfully refreshed access token")
            return token_info
        except Exception as e:
            logger.error(f"Error refreshing access token: {e}")
            raise

    def validate_credentials(self, access_token: str, refresh_token: str) -> bool:
        """Validate if the credentials are still valid"""
        try:
            credentials = Credentials(
                access_token,
                refresh_token=refresh_token,
                client_id=self.settings.GOOGLE_CLIENT_ID,
                client_secret=self.settings.GOOGLE_CLIENT_SECRET,
                token_uri="https://oauth2.googleapis.com/token"
            )
            
            # Try to refresh to check if credentials are valid
            credentials.refresh(Request())
            logger.info("Credentials validation successful")
            return True
        except Exception as e:
            logger.error(f"Credentials validation failed: {e}")
            return False

    def save_tokens_to_env(self, token_info: dict) -> None:
        """Save tokens to environment file (for development)"""
        try:
            env_file_path = os.path.join(
                os.path.dirname(__file__), 
                "../../../configs/secrets/.env"
            )
            
            # Read existing env file
            with open(env_file_path, 'r') as f:
                lines = f.readlines()
            
            # Update or add token lines
            token_updates = {
                "GOOGLE_REFRESH_TOKEN": token_info.get("refresh_token", ""),
                "GOOGLE_CLIENT_ID": token_info.get("client_id", ""),
                "GOOGLE_CLIENT_SECRET": token_info.get("client_secret", "")
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
            
            logger.info("Successfully saved tokens to secrets environment file")
        except Exception as e:
            logger.error(f"Error saving tokens to secrets environment file: {e}")
            raise
