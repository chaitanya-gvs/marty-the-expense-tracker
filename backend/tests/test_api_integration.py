"""
Integration tests for the new API routes.
"""

import pytest
from fastapi.testclient import TestClient
from unittest.mock import AsyncMock, patch

from main import app


class TestTransactionRoutes:
    """Test transaction API routes."""
    
    def setup_method(self):
        """Set up test client."""
        self.client = TestClient(app)
    
    @patch('src.services.database_manager.operations.TransactionOperations.get_all_transactions')
    def test_get_transactions(self, mock_get_transactions):
        """Test getting transactions."""
        # Mock the database operation
        mock_transactions = [
            {
                'id': '1',
                'transaction_date': '2024-01-01',
                'amount': 100.0,
                'direction': 'debit',
                'account': 'Test Account',
                'category': 'Food',
                'description': 'Test transaction',
                'is_shared': False,
                'is_partial_refund': False,
                'transfer_group_id': None,
                'link_parent_id': None,
                'tags': [],
                'related_mails': [],
                'created_at': '2024-01-01T00:00:00',
                'updated_at': '2024-01-01T00:00:00'
            }
        ]
        mock_get_transactions.return_value = mock_transactions
        
        # Make request
        response = self.client.get("/api/transactions/")
        
        # Assert response
        assert response.status_code == 200
        data = response.json()
        assert "data" in data
        assert len(data["data"]) == 1
        assert data["data"][0]["id"] == "1"
        assert data["data"][0]["amount"] == 100.0


class TestCategoryRoutes:
    """Test category API routes (now under transactions)."""
    
    def setup_method(self):
        """Set up test client."""
        self.client = TestClient(app)
    
    @patch('src.apis.routes.transaction_routes.CategoryOperations.get_all_categories')
    def test_get_categories(self, mock_get_categories):
        """Test getting categories."""
        # Mock the database operation
        mock_categories = [
            {
                'id': '1',
                'name': 'Food',
                'color': '#FF0000',
                'is_hidden': False,
                'subcategories': [
                    {
                        'id': '1',
                        'name': 'Restaurants',
                        'color': '#FF0000',
                        'is_hidden': False
                    }
                ]
            }
        ]
        mock_get_categories.return_value = mock_categories
        
        # Make request
        response = self.client.get("/api/transactions/categories/")
        
        # Assert response
        assert response.status_code == 200
        data = response.json()
        assert "data" in data
        assert len(data["data"]) == 1
        assert data["data"][0]["name"] == "Food"
        assert len(data["data"][0]["subcategories"]) == 1


class TestTagRoutes:
    """Test tag API routes (now under transactions)."""
    
    def setup_method(self):
        """Set up test client."""
        self.client = TestClient(app)
    
    @patch('src.apis.routes.transaction_routes.TagOperations.get_all_tags')
    def test_get_tags(self, mock_get_tags):
        """Test getting tags."""
        # Mock the database operation
        mock_tags = [
            {
                'id': '1',
                'name': 'business',
                'color': '#0000FF',
                'usage_count': 5
            }
        ]
        mock_get_tags.return_value = mock_tags
        
        # Make request
        response = self.client.get("/api/transactions/tags/")
        
        # Assert response
        assert response.status_code == 200
        data = response.json()
        assert "data" in data
        assert len(data["data"]) == 1
        assert data["data"][0]["name"] == "business"
        assert data["data"][0]["usage_count"] == 5


class TestSuggestionRoutes:
    """Test suggestion API routes (now under transactions)."""
    
    def setup_method(self):
        """Set up test client."""
        self.client = TestClient(app)
    
    @patch('src.apis.routes.transaction_routes.SuggestionOperations.find_transfer_suggestions')
    def test_get_transfer_suggestions(self, mock_find_suggestions):
        """Test getting transfer suggestions."""
        # Mock the database operation
        mock_suggestions = [
            {
                'transactions': [
                    {
                        'id': '1',
                        'amount': 100.0,
                        'direction': 'debit',
                        'account': 'Account A'
                    },
                    {
                        'id': '2',
                        'amount': -100.0,
                        'direction': 'credit',
                        'account': 'Account B'
                    }
                ],
                'confidence': 0.8,
                'reason': 'Similar amounts within 2 hours'
            }
        ]
        mock_find_suggestions.return_value = mock_suggestions
        
        # Make request
        response = self.client.get("/api/transactions/suggestions/transfers")
        
        # Assert response
        assert response.status_code == 200
        data = response.json()
        assert "data" in data
        assert len(data["data"]) == 1
        assert data["data"][0]["confidence"] == 0.8


class TestSyncRoutes:
    """Test sync API routes."""
    
    def setup_method(self):
        """Set up test client."""
        self.client = TestClient(app)
    
    @patch('src.services.email_ingestion.service.EmailIngestionService.ingest_recent_transaction_emails')
    def test_sync_gmail(self, mock_ingest):
        """Test Gmail sync."""
        # Mock the email service
        mock_ingest.return_value = {
            'processed': 10,
            'extracted': 5,
            'errors': 0,
            'expenses': []
        }
        
        # Make request
        response = self.client.post("/api/sync/gmail")
        
        # Assert response
        assert response.status_code == 200
        data = response.json()
        assert "data" in data
        assert "message" in data


class TestUploadRoutes:
    """Test upload API routes."""
    
    def setup_method(self):
        """Set up test client."""
        self.client = TestClient(app)
    
    def test_get_upload_url(self):
        """Test getting upload URL."""
        # Make request
        response = self.client.post(
            "/api/upload/url",
            json={"filename": "test.csv"}
        )
        
        # Assert response
        assert response.status_code == 200
        data = response.json()
        assert "data" in data
        assert "upload_url" in data["data"]
        assert "file_id" in data["data"]


if __name__ == "__main__":
    pytest.main([__file__])
