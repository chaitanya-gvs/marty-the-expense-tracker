from __future__ import annotations

from typing import List, Optional

from sqlalchemy import text

from ..connection import get_session_factory
from src.utils.logger import get_logger

logger = get_logger(__name__)


class CategoryOperations:
    """Operations for managing transaction categories"""

    @staticmethod
    async def get_all_categories(transaction_type: Optional[str] = None) -> List[dict]:
        """Get all active categories, optionally filtered by transaction_type

        Args:
            transaction_type: Optional filter by 'debit', 'credit', or None for all
        """
        session_factory = get_session_factory()
        async with session_factory() as session:
            query = """
                SELECT id, name, slug, color, parent_id, sort_order,
                       is_active, transaction_type, created_at, updated_at
                FROM categories
                WHERE is_active = true
            """
            params = {}

            # Filter by transaction_type if provided
            # When filtering by transaction_type, show categories that match that type OR categories with NULL (applicable to both)
            if transaction_type:
                query += " AND (transaction_type = :transaction_type OR transaction_type IS NULL)"
                params["transaction_type"] = transaction_type

            query += " ORDER BY sort_order, name"

            result = await session.execute(text(query), params)
            rows = result.fetchall()
            return [dict(row._mapping) for row in rows]

    @staticmethod
    async def get_category_by_id(category_id: str) -> Optional[dict]:
        """Get category by ID"""
        session_factory = get_session_factory()
        async with session_factory() as session:
            result = await session.execute(
                text("""
                    SELECT * FROM categories
                    WHERE id = :category_id AND is_active = true
                """), {"category_id": category_id}
            )
            row = result.fetchone()
            return dict(row._mapping) if row else None

    @staticmethod
    async def get_category_by_name(name: str) -> Optional[dict]:
        """Get category by name (case-insensitive)"""
        session_factory = get_session_factory()
        async with session_factory() as session:
            result = await session.execute(
                text("""
                    SELECT * FROM categories
                    WHERE LOWER(name) = LOWER(:name) AND is_active = true
                """), {"name": name}
            )
            row = result.fetchone()
            return dict(row._mapping) if row else None

    @staticmethod
    async def search_categories(query: str, limit: int = 20, transaction_type: Optional[str] = None) -> List[dict]:
        """Search categories by name (case-insensitive partial match)

        Args:
            query: Search query string
            limit: Maximum number of results
            transaction_type: Optional filter by 'debit', 'credit', or None for all
        """
        session_factory = get_session_factory()
        async with session_factory() as session:
            sql_query = """
                SELECT * FROM categories
                WHERE LOWER(name) LIKE LOWER(:query) AND is_active = true
            """
            params = {
                "query": f"%{query}%",
                "exact_query": query,
                "limit": limit
            }

            # Filter by transaction_type if provided
            # When filtering by transaction_type, show categories that match that type OR categories with NULL (applicable to both)
            if transaction_type:
                sql_query += " AND (transaction_type = :transaction_type OR transaction_type IS NULL)"
                params["transaction_type"] = transaction_type

            sql_query += """
                ORDER BY
                    CASE WHEN LOWER(name) = LOWER(:exact_query) THEN 1 ELSE 2 END,
                    name
                LIMIT :limit
            """

            result = await session.execute(text(sql_query), params)
            rows = result.fetchall()
            return [dict(row._mapping) for row in rows]

    @staticmethod
    async def create_category(
        name: str,
        color: Optional[str] = None,
        parent_id: Optional[str] = None,
        sort_order: Optional[int] = None,
        transaction_type: Optional[str] = None
    ) -> str:
        """Create a new category and return its ID

        Args:
            name: Category name
            color: Optional color hex code
            parent_id: Optional parent category ID
            sort_order: Optional sort order
            transaction_type: Optional transaction type ('debit', 'credit', or None for both)
        """
        session_factory = get_session_factory()
        async with session_factory() as session:
            # Check if category already exists
            existing = await CategoryOperations.get_category_by_name(name)
            if existing:
                raise ValueError(f"Category '{name}' already exists")

            # Generate unique slug from name
            base_slug = name.lower().replace(' ', '-').replace('&', 'and')
            slug = base_slug
            counter = 1

            # Check if slug already exists (including inactive categories)
            while True:
                check_result = await session.execute(
                    text("SELECT id FROM categories WHERE slug = :slug"),
                    {"slug": slug}
                )
                if not check_result.fetchone():
                    break
                slug = f"{base_slug}-{counter}"
                counter += 1

            # Get next sort order if not provided
            if sort_order is None:
                result = await session.execute(
                    text("SELECT COALESCE(MAX(sort_order), 0) + 1 FROM categories")
                )
                sort_order = result.fetchone()[0]

            # Validate transaction_type if provided
            if transaction_type is not None and transaction_type not in ("debit", "credit"):
                raise ValueError(f"Invalid transaction_type: {transaction_type}. Must be 'debit', 'credit', or None")

            result = await session.execute(
                text("""
                    INSERT INTO categories (name, slug, color, parent_id, sort_order, is_active, transaction_type)
                    VALUES (:name, :slug, :color, :parent_id, :sort_order, true, :transaction_type)
                    RETURNING id
                """), {
                    "name": name,
                    "slug": slug,
                    "color": color,
                    "parent_id": parent_id,
                    "sort_order": sort_order,
                    "transaction_type": transaction_type
                }
            )
            category_id = result.fetchone()[0]
            await session.commit()
            logger.info("Created new category: %s (id=%s)", name, category_id)
            return str(category_id)

    @staticmethod
    async def update_category(
        category_id: str,
        name: Optional[str] = None,
        color: Optional[str] = None,
        parent_id: Optional[str] = None,
        sort_order: Optional[int] = None,
        transaction_type: Optional[str] = None
    ) -> bool:
        """Update a category

        Args:
            category_id: Category ID to update
            name: Optional new name
            color: Optional new color
            parent_id: Optional new parent ID
            sort_order: Optional new sort order
            transaction_type: Optional transaction type ('debit', 'credit', or None for both)
        """
        session_factory = get_session_factory()
        async with session_factory() as session:
            # Build dynamic UPDATE query
            set_clauses = []
            params = {"category_id": category_id}

            if name is not None:
                set_clauses.append("name = :name")
                set_clauses.append("slug = :slug")
                params["name"] = name

                # Generate unique slug
                base_slug = name.lower().replace(' ', '-').replace('&', 'and')
                slug = base_slug
                counter = 1

                # Check if slug already exists for a different category (including inactive)
                while True:
                    check_result = await session.execute(
                        text("SELECT id FROM categories WHERE slug = :slug AND id != :category_id"),
                        {"slug": slug, "category_id": category_id}
                    )
                    if not check_result.fetchone():
                        break
                    slug = f"{base_slug}-{counter}"
                    counter += 1

                params["slug"] = slug
            if color is not None:
                set_clauses.append("color = :color")
                params["color"] = color
            if parent_id is not None:
                set_clauses.append("parent_id = :parent_id")
                params["parent_id"] = parent_id
            if sort_order is not None:
                set_clauses.append("sort_order = :sort_order")
                params["sort_order"] = sort_order
            # Handle transaction_type update
            # Allow setting to NULL by passing empty string, or setting to a value
            if transaction_type is not None:
                if transaction_type == "":
                    # Empty string means set to NULL - use SQL NULL directly
                    set_clauses.append("transaction_type = NULL")
                else:
                    # Validate transaction_type value
                    if transaction_type not in ("debit", "credit"):
                        raise ValueError(f"Invalid transaction_type: {transaction_type}. Must be 'debit', 'credit', or empty string for NULL")
                    set_clauses.append("transaction_type = :transaction_type")
                    params["transaction_type"] = transaction_type

            if not set_clauses:
                return False

            set_clauses.append("updated_at = CURRENT_TIMESTAMP")

            query = f"""
                UPDATE categories
                SET {', '.join(set_clauses)}
                WHERE id = :category_id AND is_active = true
            """

            result = await session.execute(text(query), params)
            await session.commit()
            success = result.rowcount > 0
            if success:
                logger.info("Updated category id=%s", category_id)
            return success

    @staticmethod
    async def delete_category(category_id: str) -> bool:
        """Soft delete a category (set is_active = false)"""
        session_factory = get_session_factory()
        async with session_factory() as session:
            result = await session.execute(
                text("""
                    UPDATE categories
                    SET is_active = false, updated_at = CURRENT_TIMESTAMP
                    WHERE id = :category_id
                """), {"category_id": category_id}
            )
            await session.commit()
            success = result.rowcount > 0
            if success:
                logger.info("Soft deleted category id=%s", category_id)
            return success

    @staticmethod
    async def upsert_category(
        name: str,
        color: Optional[str] = None,
        parent_id: Optional[str] = None,
        sort_order: Optional[int] = None
    ) -> str:
        """Upsert a category (create if not exists, update if exists)"""
        # First try to get existing category
        existing = await CategoryOperations.get_category_by_name(name)
        if existing:
            # Update existing category
            await CategoryOperations.update_category(
                existing['id'],
                color=color,
                parent_id=parent_id,
                sort_order=sort_order
            )
            return existing['id']
        else:
            # Create new category
            return await CategoryOperations.create_category(
                name=name,
                color=color,
                parent_id=parent_id,
                sort_order=sort_order
            )
