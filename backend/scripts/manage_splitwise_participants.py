#!/usr/bin/env python3
"""
Script to manage Splitwise participants.

This script:
1. Fetches friends from Splitwise
2. Finds participants by name and updates them with Splitwise IDs
3. Creates new participants with Splitwise IDs

Usage:
    poetry run python scripts/manage_splitwise_participants.py
"""

import sys
import asyncio
from pathlib import Path
from typing import Optional
from dotenv import load_dotenv

# Add the backend directory to Python path
backend_path = Path(__file__).parent.parent
sys.path.insert(0, str(backend_path))

# Load environment variables
load_dotenv(backend_path / "configs" / "secrets" / ".env")
load_dotenv(backend_path / "configs" / ".env")

from src.services.splitwise_processor.client import SplitwiseAPIClient
from src.services.database_manager.connection import get_session_factory
from src.models.participant import Participant
from src.utils.logger import get_logger
from sqlalchemy import select

logger = get_logger(__name__)


async def find_participant_by_name(session, name: str) -> Optional[Participant]:
    """Find a participant by name (case-insensitive)."""
    query = select(Participant).where(Participant.name.ilike(name))
    result = await session.execute(query)
    return result.scalar_one_or_none()


async def update_participant_with_splitwise_id(
    session, participant: Participant, splitwise_id: int, splitwise_email: Optional[str] = None
):
    """Update a participant with Splitwise ID."""
    participant.splitwise_id = splitwise_id
    if splitwise_email:
        participant.splitwise_email = splitwise_email
    await session.commit()
    await session.refresh(participant)
    logger.info(f"✅ Updated participant '{participant.name}' with Splitwise ID {splitwise_id}")


async def create_participant_with_splitwise_id(
    session, name: str, splitwise_id: int, splitwise_email: Optional[str] = None
):
    """Create a new participant with Splitwise ID."""
    new_participant = Participant(
        name=name,
        splitwise_id=splitwise_id,
        splitwise_email=splitwise_email
    )
    session.add(new_participant)
    await session.commit()
    await session.refresh(new_participant)
    logger.info(f"✅ Created participant '{name}' with Splitwise ID {splitwise_id}")


def find_friend_by_name(friends, name: str) -> Optional[dict]:
    """Find a friend in the friends list by name (case-insensitive partial match)."""
    name_lower = name.lower()
    for friend in friends:
        full_name = f"{friend.first_name} {friend.last_name or ''}".strip().lower()
        first_name_lower = friend.first_name.lower() if friend.first_name else ""
        
        # Check if name matches full name or first name
        if name_lower in full_name or name_lower in first_name_lower or first_name_lower in name_lower:
            return {
                "id": friend.id,
                "first_name": friend.first_name,
                "last_name": friend.last_name,
                "email": friend.email,
                "full_name": f"{friend.first_name} {friend.last_name or ''}".strip()
            }
    return None


async def main():
    """Main function to manage Splitwise participants."""
    try:
        logger.info("🔍 Fetching Splitwise friends...")
        client = SplitwiseAPIClient()
        friends = client.get_friends()
        
        if not friends:
            logger.warning("No friends found in Splitwise")
            return
        
        logger.info(f"Found {len(friends)} friends in Splitwise:")
        for friend in friends:
            full_name = f"{friend.first_name} {friend.last_name or ''}".strip()
            logger.info(f"  - {full_name} (ID: {friend.id}, Email: {friend.email or 'N/A'})")
        
        session_factory = get_session_factory()
        async with session_factory() as session:
            # Process Dewang/Devang
            logger.info("\n📝 Processing Dewang...")
            dewang_friend = find_friend_by_name(friends, "Dewang")
            if not dewang_friend:
                # Try "Devang" as alternative spelling
                dewang_friend = find_friend_by_name(friends, "Devang")
            
            if dewang_friend:
                logger.info(f"Found Dewang/Devang in Splitwise: {dewang_friend['full_name']} (ID: {dewang_friend['id']})")
                # Try to find participant by various name patterns
                participant = await find_participant_by_name(session, "Dewang")
                if not participant:
                    participant = await find_participant_by_name(session, "Devang")
                if not participant:
                    # Try "Dewang Vincchi" (full name)
                    participant = await find_participant_by_name(session, "Dewang Vincchi")
                
                if participant:
                    if participant.splitwise_id:
                        logger.info(f"Participant '{participant.name}' already has Splitwise ID {participant.splitwise_id}")
                        if participant.splitwise_id != dewang_friend['id']:
                            logger.warning(f"⚠️  Splitwise ID mismatch! Existing: {participant.splitwise_id}, Found: {dewang_friend['id']}")
                            logger.info(f"Updating Splitwise ID to {dewang_friend['id']}")
                            await update_participant_with_splitwise_id(
                                session, participant, dewang_friend['id'], dewang_friend.get('email')
                            )
                    else:
                        logger.info(f"Updating participant '{participant.name}' with Splitwise ID {dewang_friend['id']}")
                        await update_participant_with_splitwise_id(
                            session, participant, dewang_friend['id'], dewang_friend.get('email')
                        )
                else:
                    logger.warning("Participant 'Dewang' or 'Devang' not found in database. Please create it manually first.")
            else:
                logger.warning("❌ Could not find 'Dewang' or 'Devang' in Splitwise friends list")
            
            # Process Harshwardhan Shrivas
            logger.info("\n📝 Processing Harshwardhan Shrivas...")
            harshwardhan_friend = find_friend_by_name(friends, "Harshwardhan")
            if harshwardhan_friend:
                logger.info(f"Found Harshwardhan in Splitwise: {harshwardhan_friend['full_name']} (ID: {harshwardhan_friend['id']})")
                participant = await find_participant_by_name(session, "Harshwardhan Shrivas")
                if participant:
                    if participant.splitwise_id:
                        logger.info(f"Participant '{participant.name}' already has Splitwise ID {participant.splitwise_id}")
                        if participant.splitwise_id != harshwardhan_friend['id']:
                            logger.warning(f"⚠️  Splitwise ID mismatch! Existing: {participant.splitwise_id}, Found: {harshwardhan_friend['id']}")
                            response = input(f"Update Splitwise ID to {harshwardhan_friend['id']}? (y/n): ")
                            if response.lower() == 'y':
                                await update_participant_with_splitwise_id(
                                    session, participant, harshwardhan_friend['id'], harshwardhan_friend.get('email')
                                )
                    else:
                        logger.info(f"Updating participant '{participant.name}' with Splitwise ID {harshwardhan_friend['id']}")
                        await update_participant_with_splitwise_id(
                            session, participant, harshwardhan_friend['id'], harshwardhan_friend.get('email')
                        )
                else:
                    # Try to find by just "Harshwardhan"
                    participant = await find_participant_by_name(session, "Harshwardhan")
                    if participant:
                        logger.info(f"Found participant '{participant.name}', updating with Splitwise ID")
                        await update_participant_with_splitwise_id(
                            session, participant, harshwardhan_friend['id'], harshwardhan_friend.get('email')
                        )
                    else:
                        logger.info(f"Creating new participant '{harshwardhan_friend['full_name']}' with Splitwise ID {harshwardhan_friend['id']}")
                        await create_participant_with_splitwise_id(
                            session, harshwardhan_friend['full_name'], harshwardhan_friend['id'], harshwardhan_friend.get('email')
                        )
            else:
                logger.warning("❌ Could not find 'Harshwardhan' in Splitwise friends list")
        
        logger.info("\n✅ Done!")
        
    except Exception as e:
        logger.error(f"Error managing Splitwise participants: {e}")
        raise


if __name__ == "__main__":
    asyncio.run(main())

