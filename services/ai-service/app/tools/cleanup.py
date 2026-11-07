import asyncio
import sys
from typing import Optional
from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase

from app.core.config import get_settings
from app.core.logging import logger, setup_logging


async def remove_orphan_chunks(db: Optional[AsyncDatabase] = None) -> dict[str, int]:
    """
    Finds and deletes chunks whose parent source document no longer exists in the sources collection.
    Returns: {"orphan_sources": int, "deleted_chunks": int}
    """
    settings = get_settings()
    client: Optional[AsyncMongoClient] = None

    if db is None:
        client = AsyncMongoClient(settings.MONGODB_URI)
        db = client[settings.MONGODB_DB_NAME]

    try:
        # 1. Distinct sourceId in chunks collection
        chunk_source_ids = await db.chunks.distinct("sourceId")
        if not chunk_source_ids:
            return {"orphan_sources": 0, "deleted_chunks": 0}

        # 2. Match against sources collection
        cursor = db.sources.find({"_id": {"$in": chunk_source_ids}}, {"_id": 1})
        existing_sources = await cursor.to_list(length=len(chunk_source_ids))
        existing_source_ids = {s["_id"] for s in existing_sources}

        # 3. Identify orphans
        orphan_source_ids = [sid for sid in chunk_source_ids if sid not in existing_source_ids]
        if not orphan_source_ids:
            return {"orphan_sources": 0, "deleted_chunks": 0}

        # 4. Remove orphan chunks
        res = await db.chunks.delete_many({"sourceId": {"$in": orphan_source_ids}})
        deleted_count = res.deleted_count

        logger.info(
            f"Removed {deleted_count} orphan chunks across {len(orphan_source_ids)} deleted sources."
        )
        return {
            "orphan_sources": len(orphan_source_ids),
            "deleted_chunks": deleted_count,
        }

    finally:
        if client:
            await client.close()


def main() -> None:
    """CLI entrypoint for cleanup tool."""
    setup_logging()
    print("Running orphan chunk cleanup...")
    try:
        results = asyncio.run(remove_orphan_chunks())
        print(f"Cleanup complete:")
        print(f"  Orphan sources found: {results['orphan_sources']}")
        print(f"  Chunks removed: {results['deleted_chunks']}")
        sys.exit(0)
    except Exception as e:
        print(f"Cleanup failed: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()

