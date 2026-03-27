from __future__ import annotations

from typing import List, Optional

from sqlalchemy import text

from ..connection import get_session_factory
from src.utils.logger import get_logger

logger = get_logger(__name__)


class TagOperations:
    """Operations for managing transaction tags"""

    @staticmethod
    async def get_all_tags() -> List[dict]:
        """Get all active tags with usage counts"""
        session_factory = get_session_factory()
        async with session_factory() as session:
            result = await session.execute(
                text("""
                    SELECT
                        t.id, t.name, t.slug, t.color, t.description,
                        t.is_active, t.created_at, t.updated_at,
                        COUNT(tt.transaction_id) as usage_count
                    FROM tags t
                    LEFT JOIN transaction_tags tt ON t.id = tt.tag_id
                    WHERE t.is_active = true
                    GROUP BY t.id, t.name, t.slug, t.color, t.description, t.is_active, t.created_at, t.updated_at
                    ORDER BY usage_count DESC, t.name
                """)
            )
            rows = result.fetchall()
            tags = []
            for row in rows:
                tag_dict = dict(row._mapping)
                # Convert UUID to string
                tag_dict['id'] = str(tag_dict['id'])
                tags.append(tag_dict)
            return tags

    @staticmethod
    async def get_tag_by_id(tag_id: str) -> Optional[dict]:
        """Get tag by ID"""
        session_factory = get_session_factory()
        async with session_factory() as session:
            result = await session.execute(
                text("""
                    SELECT * FROM tags
                    WHERE id = :tag_id AND is_active = true
                """), {"tag_id": tag_id}
            )
            row = result.fetchone()
            if row:
                tag_dict = dict(row._mapping)
                # Convert UUID to string
                tag_dict['id'] = str(tag_dict['id'])
                return tag_dict
            return None

    @staticmethod
    async def get_tag_by_name(name: str) -> Optional[dict]:
        """Get tag by name (case-insensitive)"""
        session_factory = get_session_factory()
        async with session_factory() as session:
            result = await session.execute(
                text("""
                    SELECT * FROM tags
                    WHERE LOWER(name) = LOWER(:name) AND is_active = true
                """), {"name": name}
            )
            row = result.fetchone()
            if row:
                tag_dict = dict(row._mapping)
                # Convert UUID to string
                tag_dict['id'] = str(tag_dict['id'])
                return tag_dict
            return None

    @staticmethod
    async def search_tags(query: str, limit: int = 20) -> List[dict]:
        """Search tags by name (case-insensitive partial match)"""
        session_factory = get_session_factory()
        async with session_factory() as session:
            result = await session.execute(
                text("""
                    SELECT
                        t.id, t.name, t.slug, t.color, t.description,
                        t.is_active, t.created_at, t.updated_at,
                        COUNT(tt.transaction_id) as usage_count
                    FROM tags t
                    LEFT JOIN transaction_tags tt ON t.id = tt.tag_id
                    WHERE LOWER(t.name) LIKE LOWER(:query) AND t.is_active = true
                    GROUP BY t.id, t.name, t.slug, t.color, t.description, t.is_active, t.created_at, t.updated_at
                    ORDER BY
                        CASE WHEN LOWER(t.name) = LOWER(:exact_query) THEN 1 ELSE 2 END,
                        usage_count DESC,
                        t.name
                    LIMIT :limit
                """), {
                    "query": f"%{query}%",
                    "exact_query": query,
                    "limit": limit
                }
            )
            rows = result.fetchall()
            tags = []
            for row in rows:
                tag_dict = dict(row._mapping)
                # Convert UUID to string
                tag_dict['id'] = str(tag_dict['id'])
                tags.append(tag_dict)
            return tags

    @staticmethod
    async def create_tag(
        name: str,
        color: Optional[str] = None,
        description: Optional[str] = None
    ) -> str:
        """Create a new tag and return its ID"""
        session_factory = get_session_factory()
        async with session_factory() as session:
            import re

            # Check if active tag already exists
            existing = await TagOperations.get_tag_by_name(name)
            if existing:
                raise ValueError(f"Tag '{name}' already exists")

            # Check if a soft-deleted tag exists with this name — reactivate it
            result_inactive = await session.execute(
                text("SELECT id FROM tags WHERE LOWER(name) = LOWER(:name) AND is_active = false"),
                {"name": name}
            )
            inactive_row = result_inactive.fetchone()
            if inactive_row:
                tag_id = inactive_row[0]
                await session.execute(
                    text("UPDATE tags SET is_active = true, color = :color, updated_at = NOW() WHERE id = :id"),
                    {"color": color, "id": tag_id}
                )
                await session.commit()
                logger.info("Reactivated soft-deleted tag: %s (id=%s)", name, tag_id)
                return str(tag_id)

            # Generate slug from name (sanitize special characters)
            slug = name.lower().replace(' ', '-').replace('&', 'and')
            slug = re.sub(r'[^a-z0-9\-]', '-', slug)
            slug = re.sub(r'-+', '-', slug).strip('-')

            result = await session.execute(
                text("""
                    INSERT INTO tags (name, slug, color, description, is_active)
                    VALUES (:name, :slug, :color, :description, true)
                    RETURNING id
                """), {
                    "name": name,
                    "slug": slug,
                    "color": color,
                    "description": description
                }
            )
            tag_id = result.fetchone()[0]
            await session.commit()
            logger.info("Created new tag: %s (id=%s)", name, tag_id)
            return str(tag_id)
        # Note: ValueError is re-raised naturally; IntegrityError needs explicit handling
        # but since we use async with, we need to handle it differently.
        # The try/except for IntegrityError is handled inside the async with block above.

    @staticmethod
    async def update_tag(
        tag_id: str,
        name: Optional[str] = None,
        color: Optional[str] = None,
        description: Optional[str] = None
    ) -> bool:
        """Update a tag"""
        session_factory = get_session_factory()
        async with session_factory() as session:
            # Build dynamic UPDATE query
            set_clauses = []
            params = {"tag_id": tag_id}

            if name is not None:
                set_clauses.append("name = :name")
                set_clauses.append("slug = :slug")
                params["name"] = name
                params["slug"] = name.lower().replace(' ', '-').replace('&', 'and')
            if color is not None:
                set_clauses.append("color = :color")
                params["color"] = color
            if description is not None:
                set_clauses.append("description = :description")
                params["description"] = description

            if not set_clauses:
                return False

            set_clauses.append("updated_at = CURRENT_TIMESTAMP")

            query = f"""
                UPDATE tags
                SET {', '.join(set_clauses)}
                WHERE id = :tag_id AND is_active = true
            """

            result = await session.execute(text(query), params)
            await session.commit()
            success = result.rowcount > 0
            if success:
                logger.info("Updated tag id=%s", tag_id)
            return success

    @staticmethod
    async def delete_tag(tag_id: str) -> bool:
        """Soft delete a tag (set is_active = false)"""
        session_factory = get_session_factory()
        async with session_factory() as session:
            result = await session.execute(
                text("""
                    UPDATE tags
                    SET is_active = false, updated_at = CURRENT_TIMESTAMP
                    WHERE id = :tag_id
                """), {"tag_id": tag_id}
            )
            await session.commit()
            success = result.rowcount > 0
            if success:
                logger.info("Soft deleted tag id=%s", tag_id)
            return success

    @staticmethod
    async def upsert_tag(
        name: str,
        color: Optional[str] = None,
        description: Optional[str] = None
    ) -> str:
        """Upsert a tag (create if not exists, update if exists)"""
        # First try to get existing tag
        existing = await TagOperations.get_tag_by_name(name)
        if existing:
            # Update existing tag
            await TagOperations.update_tag(
                existing['id'],
                color=color,
                description=description
            )
            return existing['id']
        else:
            # Create new tag
            return await TagOperations.create_tag(
                name=name,
                color=color,
                description=description
            )

    @staticmethod
    async def get_tags_for_transaction(transaction_id: str) -> List[dict]:
        """Get all tags for a specific transaction"""
        session_factory = get_session_factory()
        async with session_factory() as session:
            result = await session.execute(
                text("""
                    SELECT t.id, t.name, t.color, t.description
                    FROM tags t
                    INNER JOIN transaction_tags tt ON t.id = tt.tag_id
                    WHERE tt.transaction_id = :transaction_id AND t.is_active = true
                    ORDER BY t.name
                """), {"transaction_id": transaction_id}
            )
            rows = result.fetchall()
            tags = []
            for row in rows:
                tag_dict = dict(row._mapping)
                # Convert UUID to string
                tag_dict['id'] = str(tag_dict['id'])
                tags.append(tag_dict)
            return tags

    @staticmethod
    async def add_tags_to_transaction(transaction_id: str, tag_ids: List[str]) -> bool:
        """Add tags to a transaction"""
        if not tag_ids:
            return True

        session_factory = get_session_factory()
        async with session_factory() as session:
            try:
                # Insert tag associations
                for tag_id in tag_ids:
                    await session.execute(
                        text("""
                            INSERT INTO transaction_tags (transaction_id, tag_id)
                            VALUES (:transaction_id, :tag_id)
                            ON CONFLICT (transaction_id, tag_id) DO NOTHING
                        """), {
                            "transaction_id": transaction_id,
                            "tag_id": tag_id
                        }
                    )

                await session.commit()
                logger.info("Added %d tags to transaction id=%s", len(tag_ids), transaction_id)
                return True
            except Exception:
                await session.rollback()
                logger.error("Failed to add tags to transaction", exc_info=True)
                return False

    @staticmethod
    async def remove_tags_from_transaction(transaction_id: str, tag_ids: List[str]) -> bool:
        """Remove tags from a transaction"""
        if not tag_ids:
            return True

        session_factory = get_session_factory()
        async with session_factory() as session:
            try:
                # Remove tag associations
                await session.execute(
                    text("""
                        DELETE FROM transaction_tags
                        WHERE transaction_id = :transaction_id AND tag_id = ANY(:tag_ids)
                    """), {
                        "transaction_id": transaction_id,
                        "tag_ids": tag_ids
                    }
                )

                await session.commit()
                logger.info("Removed %d tags from transaction id=%s", len(tag_ids), transaction_id)
                return True
            except Exception:
                await session.rollback()
                logger.error("Failed to remove tags from transaction", exc_info=True)
                return False

    @staticmethod
    async def set_transaction_tags(transaction_id: str, tag_ids: List[str]) -> bool:
        """Set tags for a transaction (replace all existing tags)"""
        session_factory = get_session_factory()
        async with session_factory() as session:
            try:
                # Remove all existing tags
                await session.execute(
                    text("""
                        DELETE FROM transaction_tags
                        WHERE transaction_id = :transaction_id
                    """), {"transaction_id": transaction_id}
                )

                # Add new tags
                if tag_ids:
                    for tag_id in tag_ids:
                        await session.execute(
                            text("""
                                INSERT INTO transaction_tags (transaction_id, tag_id)
                                VALUES (:transaction_id, :tag_id)
                            """), {
                                "transaction_id": transaction_id,
                                "tag_id": tag_id
                            }
                        )

                await session.commit()
                logger.info("Set %d tags for transaction id=%s", len(tag_ids), transaction_id)
                return True
            except Exception:
                await session.rollback()
                logger.error("Failed to set tags for transaction", exc_info=True)
                return False
