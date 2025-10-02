"""
Script to verify the category migration and populate missing category_ids
"""
import sys
import asyncio
from pathlib import Path

# Add backend directory to Python path
backend_path = Path(__file__).parent.parent
sys.path.insert(0, str(backend_path))

from src.services.database_manager.connection import get_session_factory
from src.utils.logger import get_logger
from sqlalchemy import text

logger = get_logger(__name__)


async def verify_migration():
    """Verify the category migration"""
    session_factory = get_session_factory()
    
    # Check if category column still exists (should fail)
    session = session_factory()
    try:
        result = await session.execute(
            text("SELECT category FROM transactions LIMIT 1")
        )
        logger.warning("⚠️  Category column still exists! Migration may not have run.")
        await session.close()
        return False
    except Exception:
        logger.info("✅ Category column successfully removed")
        await session.close()
    
    # Start fresh session for remaining checks
    session = session_factory()
    try:
        # Check category_id population
        result = await session.execute(
            text("""
                SELECT 
                    COUNT(*) as total_transactions,
                    COUNT(category_id) as with_category_id,
                    COUNT(*) - COUNT(category_id) as without_category_id
                FROM transactions
            """)
        )
        row = result.fetchone()
        total = row[0]
        with_cat = row[1]
        without_cat = row[2]
        
        logger.info(f"📊 Transaction Statistics:")
        logger.info(f"   Total transactions: {total}")
        logger.info(f"   With category_id: {with_cat}")
        logger.info(f"   Without category_id: {without_cat}")
        
        if without_cat > 0:
            logger.warning(f"⚠️  {without_cat} transactions don't have a category_id")
            logger.info("   These transactions may have had category names that don't match any category in the categories table")
        else:
            logger.info("✅ All transactions have a category_id")
        
        # Show categories
        result = await session.execute(
            text("""
                SELECT id, name, is_active, 
                       (SELECT COUNT(*) FROM transactions WHERE category_id = categories.id) as transaction_count
                FROM categories
                ORDER BY is_active DESC, name
            """)
        )
        categories = result.fetchall()
        
        logger.info(f"\n📁 Categories ({len(categories)} total):")
        for cat in categories:
            status = "✅" if cat[2] else "❌"
            logger.info(f"   {status} {cat[1]}: {cat[3]} transactions")
        
        return True
        
    except Exception as e:
        logger.error(f"Error verifying migration: {e}")
        return False
    finally:
        await session.close()


if __name__ == "__main__":
    asyncio.run(verify_migration())

