from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from typing import Dict, Any

from src.services.email_ingestion.auth import EmailAuthHandler
from src.services.email_ingestion.service import EmailIngestionService


router = APIRouter(prefix="/mail", tags=["mail"])


class GmailAuthResponse(BaseModel):
    authorization_url: str


class GmailCallbackResponse(BaseModel):
    success: bool
    message: str


class EmailIngestResponse(BaseModel):
    processed: int
    extracted: int
    errors: int
    expenses: list[Dict[str, Any]]


# Gmail OAuth endpoints
@router.get("/oauth/authorize", response_model=GmailAuthResponse)
async def gmail_authorize():
    """Generate Gmail OAuth authorization URL"""
    try:
        oauth_handler = EmailAuthHandler()
        authorization_url = oauth_handler.get_authorization_url()
        return GmailAuthResponse(authorization_url=authorization_url)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to generate authorization URL: {str(e)}")


@router.get("/oauth/callback", response_model=GmailCallbackResponse)
async def gmail_oauth_callback(code: str = Query(...)):
    """Handle Gmail OAuth callback and exchange code for tokens"""
    try:
        oauth_handler = EmailAuthHandler()
        token_info = oauth_handler.exchange_code_for_tokens(code)
        
        # Save tokens to environment (for development)
        oauth_handler.save_tokens_to_env(token_info)
        
        return GmailCallbackResponse(
            success=True,
            message="Gmail authentication successful! You can now use Gmail features."
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"OAuth callback failed: {str(e)}")


@router.get("/oauth/validate")
async def gmail_validate_credentials():
    """Validate if Gmail credentials are still valid"""
    try:
        from src.utils.settings import get_settings
        settings = get_settings()
        
        if not settings.GOOGLE_REFRESH_TOKEN:
            raise HTTPException(status_code=401, detail="No Gmail credentials configured")
        
        oauth_handler = EmailAuthHandler()
        is_valid = oauth_handler.validate_credentials(
            "",  # We don't have access token, so pass empty string
            settings.GOOGLE_REFRESH_TOKEN
        )
        
        return {"valid": is_valid}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Validation failed: {str(e)}")


# Email ingestion endpoints
@router.post("/ingest", response_model=EmailIngestResponse)
async def gmail_ingest_emails(
    max_results: int = Query(25, ge=1, le=100),
    days_back: int = Query(7, ge=1, le=365)
):
    """Ingest recent transaction emails from Gmail"""
    try:
        email_service = EmailIngestionService()
        result = await email_service.ingest_recent_transaction_emails(max_results, days_back)
        return EmailIngestResponse(**result)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Email ingestion failed: {str(e)}")


@router.post("/search", response_model=EmailIngestResponse)
async def gmail_search_and_ingest(
    query: str = Query(..., description="Search query for emails"),
    start_date: str = Query(..., description="Start date (YYYY/MM/DD)"),
    end_date: str = Query(..., description="End date (YYYY/MM/DD)")
):
    """Search for specific emails and ingest them"""
    try:
        email_service = EmailIngestionService()
        result = await email_service.search_and_ingest_emails(query, start_date, end_date)
        return EmailIngestResponse(**result)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Email search and ingestion failed: {str(e)}")


@router.get("/statistics")
async def gmail_statistics(days_back: int = Query(30, ge=1, le=365)):
    """Get statistics about transaction emails"""
    try:
        email_service = EmailIngestionService()
        stats = email_service.get_email_statistics(days_back)
        return stats
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get email statistics: {str(e)}")


@router.get("/test-connection")
async def gmail_test_connection():
    """Test Gmail API connection"""
    try:
        from src.services.email_ingestion.client import EmailClient
        email_client = EmailClient()
        
        # Try to list a few emails to test connection
        messages = email_client.list_recent_transaction_emails(max_results=1, days_back=1)
        
        return {
            "connected": True,
            "message": "Gmail API connection successful",
            "test_emails_found": len(messages)
        }
    except Exception as e:
        return {
            "connected": False,
            "message": f"Gmail API connection failed: {str(e)}",
            "test_emails_found": 0
        }
