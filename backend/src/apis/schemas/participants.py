"""
API schemas for participant endpoints.
"""

from datetime import datetime
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, Field, ConfigDict


class ParticipantBase(BaseModel):
    """Base participant schema with common fields"""
    name: str = Field(..., min_length=1, max_length=255, description="Display name of the participant")
    splitwise_id: Optional[int] = Field(None, description="Splitwise user ID for mapping")
    splitwise_email: Optional[str] = Field(None, max_length=255, description="Splitwise email for additional mapping")
    notes: Optional[str] = Field(None, description="Additional notes about the participant")


class ParticipantCreate(ParticipantBase):
    """Schema for creating a new participant"""
    pass


class ParticipantUpdate(BaseModel):
    """Schema for updating a participant (all fields optional)"""
    name: Optional[str] = Field(None, min_length=1, max_length=255, description="Display name of the participant")
    splitwise_id: Optional[int] = Field(None, description="Splitwise user ID for mapping")
    splitwise_email: Optional[str] = Field(None, max_length=255, description="Splitwise email for additional mapping")
    notes: Optional[str] = Field(None, description="Additional notes about the participant")


class ParticipantResponse(ParticipantBase):
    """Schema for participant response"""
    id: UUID
    created_at: datetime
    updated_at: datetime
    
    model_config = ConfigDict(from_attributes=True)


class ParticipantListResponse(BaseModel):
    """Schema for list of participants"""
    participants: list[ParticipantResponse]
    total: int

