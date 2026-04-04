"""
FastAPI routes for participant management.
"""

from __future__ import annotations

from typing import Optional
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query
from sqlalchemy import select, or_, func

from src.services.database_manager.models.participant import Participant
from src.apis.schemas.participants import (
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


@router.get("", response_model=ParticipantListResponse)
async def list_participants(
    search: Optional[str] = Query(None, description="Search by name"),
    limit: Optional[int] = Query(None, ge=1, le=500, description="Maximum number of results"),
):
    """
    List all participants with optional filtering.
    
    - **search**: Filter participants by name (case-insensitive partial match)
    - **limit**: Maximum number of participants to return
    """
    logger.info("Listing participants: search=%r", search)
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
            
            logger.info("Returned %d participants", total)
            return ParticipantListResponse(
                participants=[ParticipantResponse.model_validate(p) for p in participants],
                total=total
            )

    except Exception:
        logger.error("Failed to list participants", exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get("/{participant_id}", response_model=ParticipantResponse)
async def get_participant(participant_id: UUID):
    """
    Get a specific participant by ID.
    """
    logger.info("Fetching participant id=%s", participant_id)
    try:
        session_factory = get_session_factory()
        async with session_factory() as session:
            query = select(Participant).where(Participant.id == participant_id)
            result = await session.execute(query)
            participant = result.scalar_one_or_none()

            if not participant:
                raise HTTPException(status_code=404, detail=f"Participant with ID {participant_id} not found")

            logger.info("Returned participant id=%s", participant_id)
            return ParticipantResponse.model_validate(participant)

    except HTTPException:
        raise
    except Exception:
        logger.error("Failed to get participant id=%s", participant_id, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.post("", response_model=ParticipantResponse, status_code=201)
async def create_participant(participant: ParticipantCreate):
    """
    Create a new participant.
    
    - **name**: Display name of the participant (required, must be unique)
    - **splitwise_id**: Splitwise user ID for mapping (optional, must be unique if provided)
    - **splitwise_email**: Splitwise email for additional mapping (optional)
    - **notes**: Additional notes about the participant (optional)
    """
    logger.info("Creating participant: name=%s", participant.name)
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
            
            logger.info("Created participant id=%s", new_participant.id)
            return ParticipantResponse.model_validate(new_participant)

    except HTTPException:
        raise
    except Exception:
        logger.error("Failed to create participant", exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.put("/{participant_id}", response_model=ParticipantResponse)
async def update_participant(participant_id: UUID, participant_update: ParticipantUpdate):
    """
    Update an existing participant.
    
    All fields are optional - only provided fields will be updated.
    """
    logger.info("Updating participant id=%s", participant_id)
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
            
            logger.info("Updated participant id=%s", participant_id)
            return ParticipantResponse.model_validate(existing_participant)

    except HTTPException:
        raise
    except Exception:
        logger.error("Failed to update participant id=%s", participant_id, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.delete("/{participant_id}", status_code=204)
async def delete_participant(participant_id: UUID):
    """
    Delete a participant.
    
    Note: This will only delete the participant record. Any existing transactions
    with this participant name will not be affected.
    """
    logger.info("Deleting participant id=%s", participant_id)
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

            logger.info("Deleted participant id=%s", participant_id)
            return None

    except HTTPException:
        raise
    except Exception:
        logger.error("Failed to delete participant id=%s", participant_id, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")

