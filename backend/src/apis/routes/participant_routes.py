"""
FastAPI routes for participant management.
"""

from __future__ import annotations

from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query
from sqlalchemy import select, or_, func
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.participant import Participant
from src.schemas.api.participants import (
    ParticipantCreate,
    ParticipantUpdate,
    ParticipantResponse,
    ParticipantListResponse,
)
from src.services.database_manager.connection import get_session_factory
from src.utils.logger import get_logger

logger = get_logger(__name__)

router = APIRouter(prefix="/participants", tags=["participants"])


async def get_db_session():
    """Dependency to get database session"""
    session_factory = get_session_factory()
    async with session_factory() as session:
        yield session


# ============================================================================
# PARTICIPANT ROUTES
# ============================================================================


@router.get("/", response_model=ParticipantListResponse)
async def list_participants(
    search: Optional[str] = Query(None, description="Search by name"),
    limit: Optional[int] = Query(None, ge=1, le=500, description="Maximum number of results"),
):
    """
    List all participants with optional filtering.
    
    - **search**: Filter participants by name (case-insensitive partial match)
    - **limit**: Maximum number of participants to return
    """
    try:
        session_factory = get_session_factory()
        async with session_factory() as session:
            # Build query
            query = select(Participant).order_by(Participant.name)
            
            # Apply search filter
            if search:
                search_pattern = f"%{search}%"
                query = query.where(
                    or_(
                        Participant.name.ilike(search_pattern),
                        Participant.splitwise_email.ilike(search_pattern)
                    )
                )
            
            # Apply limit
            if limit:
                query = query.limit(limit)
            
            # Execute query
            result = await session.execute(query)
            participants = result.scalars().all()
            
            # Get total count (without limit)
            count_query = select(func.count(Participant.id))
            if search:
                search_pattern = f"%{search}%"
                count_query = count_query.where(
                    or_(
                        Participant.name.ilike(search_pattern),
                        Participant.splitwise_email.ilike(search_pattern)
                    )
                )
            count_result = await session.execute(count_query)
            total = count_result.scalar() or 0
            
            return ParticipantListResponse(
                participants=[ParticipantResponse.model_validate(p) for p in participants],
                total=total
            )
    
    except Exception as e:
        logger.error(f"Error listing participants: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to list participants: {str(e)}")


@router.get("/{participant_id}", response_model=ParticipantResponse)
async def get_participant(participant_id: UUID):
    """
    Get a specific participant by ID.
    """
    try:
        session_factory = get_session_factory()
        async with session_factory() as session:
            query = select(Participant).where(Participant.id == participant_id)
            result = await session.execute(query)
            participant = result.scalar_one_or_none()
            
            if not participant:
                raise HTTPException(status_code=404, detail=f"Participant with ID {participant_id} not found")
            
            return ParticipantResponse.model_validate(participant)
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting participant {participant_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get participant: {str(e)}")


@router.post("/", response_model=ParticipantResponse, status_code=201)
async def create_participant(participant: ParticipantCreate):
    """
    Create a new participant.
    
    - **name**: Display name of the participant (required, must be unique)
    - **splitwise_id**: Splitwise user ID for mapping (optional, must be unique if provided)
    - **splitwise_email**: Splitwise email for additional mapping (optional)
    - **notes**: Additional notes about the participant (optional)
    """
    try:
        session_factory = get_session_factory()
        async with session_factory() as session:
            # Check if name already exists
            existing_query = select(Participant).where(Participant.name == participant.name)
            existing_result = await session.execute(existing_query)
            if existing_result.scalar_one_or_none():
                raise HTTPException(status_code=400, detail=f"Participant with name '{participant.name}' already exists")
            
            # Check if splitwise_id already exists (if provided)
            if participant.splitwise_id is not None:
                existing_sw_query = select(Participant).where(Participant.splitwise_id == participant.splitwise_id)
                existing_sw_result = await session.execute(existing_sw_query)
                if existing_sw_result.scalar_one_or_none():
                    raise HTTPException(
                        status_code=400,
                        detail=f"Participant with Splitwise ID {participant.splitwise_id} already exists"
                    )
            
            # Create new participant
            new_participant = Participant(**participant.model_dump())
            session.add(new_participant)
            await session.commit()
            await session.refresh(new_participant)
            
            logger.info(f"Created participant: {new_participant.name} (ID: {new_participant.id})")
            return ParticipantResponse.model_validate(new_participant)
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error creating participant: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to create participant: {str(e)}")


@router.put("/{participant_id}", response_model=ParticipantResponse)
async def update_participant(participant_id: UUID, participant_update: ParticipantUpdate):
    """
    Update an existing participant.
    
    All fields are optional - only provided fields will be updated.
    """
    try:
        session_factory = get_session_factory()
        async with session_factory() as session:
            # Get existing participant
            query = select(Participant).where(Participant.id == participant_id)
            result = await session.execute(query)
            existing_participant = result.scalar_one_or_none()
            
            if not existing_participant:
                raise HTTPException(status_code=404, detail=f"Participant with ID {participant_id} not found")
            
            # Check for name conflicts (if name is being updated)
            if participant_update.name and participant_update.name != existing_participant.name:
                name_query = select(Participant).where(Participant.name == participant_update.name)
                name_result = await session.execute(name_query)
                if name_result.scalar_one_or_none():
                    raise HTTPException(
                        status_code=400,
                        detail=f"Participant with name '{participant_update.name}' already exists"
                    )
            
            # Check for splitwise_id conflicts (if splitwise_id is being updated)
            if (
                participant_update.splitwise_id is not None
                and participant_update.splitwise_id != existing_participant.splitwise_id
            ):
                sw_query = select(Participant).where(Participant.splitwise_id == participant_update.splitwise_id)
                sw_result = await session.execute(sw_query)
                if sw_result.scalar_one_or_none():
                    raise HTTPException(
                        status_code=400,
                        detail=f"Participant with Splitwise ID {participant_update.splitwise_id} already exists"
                    )
            
            # Update participant
            update_data = participant_update.model_dump(exclude_unset=True)
            for key, value in update_data.items():
                setattr(existing_participant, key, value)
            
            await session.commit()
            await session.refresh(existing_participant)
            
            logger.info(f"Updated participant: {existing_participant.name} (ID: {participant_id})")
            return ParticipantResponse.model_validate(existing_participant)
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating participant {participant_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to update participant: {str(e)}")


@router.delete("/{participant_id}", status_code=204)
async def delete_participant(participant_id: UUID):
    """
    Delete a participant.
    
    Note: This will only delete the participant record. Any existing transactions
    with this participant name will not be affected.
    """
    try:
        session_factory = get_session_factory()
        async with session_factory() as session:
            # Get existing participant
            query = select(Participant).where(Participant.id == participant_id)
            result = await session.execute(query)
            participant = result.scalar_one_or_none()
            
            if not participant:
                raise HTTPException(status_code=404, detail=f"Participant with ID {participant_id} not found")
            
            # Delete participant
            await session.delete(participant)
            await session.commit()
            
            logger.info(f"Deleted participant: {participant.name} (ID: {participant_id})")
            return None
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting participant {participant_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to delete participant: {str(e)}")

