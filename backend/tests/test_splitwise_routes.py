"""Tests for splitwise_routes endpoints."""
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient
from main import app

client = TestClient(app)


def _make_friend(id, first_name, last_name, balance):
    return {"id": id, "first_name": first_name, "last_name": last_name, "net_balance": balance}


class TestGetFriends:
    @patch("src.apis.routes.splitwise_routes.SplitwiseAPIClient")
    def test_returns_friends_sorted_nonzero_first(self, MockClient):
        mock_instance = MockClient.return_value
        mock_instance.get_friends_with_balances.return_value = [
            _make_friend(1, "Alice", "", 0.0),
            _make_friend(2, "Bob", "Smith", 500.0),
            _make_friend(3, "Carol", None, -100.0),
        ]
        response = client.get("/api/splitwise/friends")
        assert response.status_code == 200
        data = response.json()
        assert len(data) == 3
        assert data[0]["id"] == 2   # 500 largest
        assert data[1]["id"] == 3   # 100
        assert data[2]["id"] == 1   # 0

    @patch("src.apis.routes.splitwise_routes.SplitwiseAPIClient")
    def test_empty_last_name_becomes_null(self, MockClient):
        mock_instance = MockClient.return_value
        mock_instance.get_friends_with_balances.return_value = [
            _make_friend(1, "Alice", "", 50.0),
        ]
        response = client.get("/api/splitwise/friends")
        assert response.status_code == 200
        data = response.json()
        assert data[0]["last_name"] is None

    @patch("src.apis.routes.splitwise_routes.SplitwiseAPIClient")
    def test_none_last_name_stays_null(self, MockClient):
        mock_instance = MockClient.return_value
        mock_instance.get_friends_with_balances.return_value = [
            _make_friend(1, "Bob", None, 100.0),
        ]
        response = client.get("/api/splitwise/friends")
        assert response.status_code == 200
        data = response.json()
        assert data[0]["last_name"] is None


class TestGetFriendExpenses:
    @patch("src.apis.routes.splitwise_routes.requests")
    @patch("src.apis.routes.splitwise_routes.SplitwiseAPIClient")
    def test_filters_to_friend_and_excludes_deleted(self, MockClient, mock_requests):
        mock_instance = MockClient.return_value
        mock_instance.base_url = "https://secure.splitwise.com/api/v3.0"
        mock_instance.headers = {"Authorization": "Bearer test"}

        raw_expenses = [
            # Deleted — should be excluded
            {
                "id": 99,
                "description": "Old expense",
                "cost": "50.00",
                "date": "2025-01-01T00:00:00Z",
                "deleted_at": "2025-01-05T00:00:00Z",
                "category": None,
                "group": None,
                "users": [{"user": {"id": 42}, "paid_share": "50.00", "owed_share": "25.00"}],
            },
            # Live and includes friend 42
            {
                "id": 1,
                "description": "Dinner",
                "cost": "200.00",
                "date": "2025-03-10T00:00:00Z",
                "deleted_at": None,
                "category": {"name": "Food"},
                "group": {"name": "Roommates"},
                "users": [
                    {"user": {"id": 42, "first_name": "Bob", "last_name": "Smith"}, "paid_share": "200.00", "owed_share": "100.00"},
                    {"user": {"id": 99, "first_name": "Me", "last_name": "User"}, "paid_share": "0.00", "owed_share": "100.00"},
                ],
            },
            # Does NOT include friend 42 — should be excluded
            {
                "id": 2,
                "description": "Other expense",
                "cost": "100.00",
                "date": "2025-03-09T00:00:00Z",
                "deleted_at": None,
                "category": None,
                "group": None,
                "users": [{"user": {"id": 99, "first_name": "Me", "last_name": "User"}, "paid_share": "100.00", "owed_share": "100.00"}],
            },
        ]

        mock_response = MagicMock()
        mock_response.json.return_value = {"expenses": raw_expenses}
        mock_response.raise_for_status.return_value = None
        mock_requests.get.return_value = mock_response

        response = client.get("/api/splitwise/friend/42/expenses")
        assert response.status_code == 200
        data = response.json()
        assert len(data) == 1
        assert data[0]["id"] == 1
        assert data[0]["description"] == "Dinner"
        assert data[0]["category"] == "Food"
        assert data[0]["group_name"] == "Roommates"
        assert len(data[0]["users"]) == 2

    @patch("src.apis.routes.splitwise_routes.requests")
    @patch("src.apis.routes.splitwise_routes.SplitwiseAPIClient")
    def test_expenses_sorted_date_descending(self, MockClient, mock_requests):
        mock_instance = MockClient.return_value
        mock_instance.base_url = "https://secure.splitwise.com/api/v3.0"
        mock_instance.headers = {}

        raw_expenses = [
            {
                "id": 1, "description": "Older", "cost": "50.00",
                "date": "2025-01-01T00:00:00Z", "deleted_at": None,
                "category": None, "group": None,
                "users": [{"user": {"id": 42, "first_name": "Bob", "last_name": None}, "paid_share": "50.00", "owed_share": "25.00"}],
            },
            {
                "id": 2, "description": "Newer", "cost": "100.00",
                "date": "2025-06-01T00:00:00Z", "deleted_at": None,
                "category": None, "group": None,
                "users": [{"user": {"id": 42, "first_name": "Bob", "last_name": None}, "paid_share": "100.00", "owed_share": "50.00"}],
            },
        ]

        mock_response = MagicMock()
        mock_response.json.return_value = {"expenses": raw_expenses}
        mock_response.raise_for_status.return_value = None
        mock_requests.get.return_value = mock_response

        response = client.get("/api/splitwise/friend/42/expenses")
        assert response.status_code == 200
        data = response.json()
        assert len(data) == 2
        assert data[0]["id"] == 2  # Newer first
        assert data[1]["id"] == 1
