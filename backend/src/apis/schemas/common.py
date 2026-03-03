from typing import Any, Dict, Optional

from pydantic import BaseModel


class ApiResponse(BaseModel):
    """Standard API response wrapper."""

    data: Any
    pagination: Optional[Dict[str, Any]] = None
    message: Optional[str] = None
