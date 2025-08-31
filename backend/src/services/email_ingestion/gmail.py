from __future__ import annotations

from typing import Any

from googleapiclient.discovery import build
from google.oauth2.credentials import Credentials

from src.utils.settings import get_settings


class GmailClient:
    def __init__(self):
        self.settings = get_settings()
        self.creds = Credentials(
            None,
            refresh_token=self.settings.GOOGLE_REFRESH_TOKEN,
            client_id=self.settings.GOOGLE_CLIENT_ID,
            client_secret=self.settings.GOOGLE_CLIENT_SECRET,
            token_uri="https://oauth2.googleapis.com/token",
        )
        self.service = build("gmail", "v1", credentials=self.creds, cache_discovery=False)

    def list_recent_transaction_emails(self, max_results: int = 25) -> list[dict[str, Any]]:
        # Minimal stub: query typical transaction-like emails
        query = "OR ".join([
            'subject:(transaction)',
            'subject:(purchase)',
            'subject:(alert)',
            'subject:(payment)',
        ])
        resp = (
            self.service.users()
            .messages()
            .list(userId="me", q=query, maxResults=max_results)
            .execute()
        )
        return resp.get("messages", [])


