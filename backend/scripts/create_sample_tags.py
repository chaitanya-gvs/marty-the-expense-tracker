#!/usr/bin/env python3
"""
Script to create sample tags for testing
"""

import asyncio
import sys
from pathlib import Path

# Add the backend directory to Python path
backend_path = Path(__file__).parent.parent
sys.path.insert(0, str(backend_path))

from src.services.database_manager.operations import TagOperations
from src.utils.logger import get_logger

logger = get_logger(__name__)

async def create_sample_tags():
    """Create sample tags for testing"""
    
    sample_tags = [
        {"name": "Business", "color": "#3B82F6"},
        {"name": "Personal", "color": "#10B981"},
        {"name": "Travel", "color": "#F59E0B"},
        {"name": "Food", "color": "#EF4444"},
        {"name": "Entertainment", "color": "#8B5CF6"},
        {"name": "Shopping", "color": "#EC4899"},
        {"name": "Healthcare", "color": "#06B6D4"},
        {"name": "Transportation", "color": "#84CC16"},
        {"name": "Utilities", "color": "#6B7280"},
        {"name": "Investment", "color": "#059669"},
    ]
    
    created_count = 0
    
    for tag_data in sample_tags:
        try:
            tag_id = await TagOperations.create_tag(
                name=tag_data["name"],
                color=tag_data["color"]
            )
            logger.info(f"Created tag: {tag_data['name']} (ID: {tag_id})")
            created_count += 1
        except ValueError as e:
            logger.info(f"Tag '{tag_data['name']}' already exists: {e}")
        except Exception as e:
            logger.error(f"Failed to create tag '{tag_data['name']}': {e}")
    
    logger.info(f"Successfully created {created_count} new tags")
    return created_count

async def main():
    """Main function"""
    try:
        created_count = await create_sample_tags()
        print(f"✅ Created {created_count} sample tags")
    except Exception as e:
        logger.error(f"Script failed: {e}")
        print(f"❌ Script failed: {e}")
        sys.exit(1)

if __name__ == "__main__":
    asyncio.run(main())
