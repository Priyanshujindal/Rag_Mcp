import argparse
import asyncio
import sys
import time
from typing import Any, Optional
from pymongo import AsyncMongoClient
from pymongo.asynchronous.collection import AsyncCollection
from pymongo.asynchronous.database import AsyncDatabase
from pymongo.errors import OperationFailure
from pymongo.operations import SearchIndexModel

from app.core.config import get_settings
from app.core.logging import logger, setup_logging

CHUNKS_COLLECTION = "chunks"
VECTOR_INDEX_NAME = "chunks_vector"
TEXT_INDEX_NAME = "chunks_text"


def get_expected_vector_index_definition(dimensions: int) -> dict[str, Any]:
    """Definition for Atlas Vector Search index on chunks collection."""
    return {
        "fields": [
            {
                "type": "vector",
                "path": "embedding",
                "numDimensions": dimensions,
                "similarity": "cosine",
            },
            {"type": "filter", "path": "workspaceId"},
            {"type": "filter", "path": "knowledgeBaseId"},
            {"type": "filter", "path": "sourceId"},
        ]
    }


def get_expected_text_index_definition() -> dict[str, Any]:
    """Definition for Atlas Search full-text index on chunks collection."""
    return {
        "mappings": {
            "dynamic": False,
            "fields": {
                "text": {
                    "type": "string",
                    "analyzer": "lucene.standard",
                },
                "metadata": {
                    "type": "document",
                    "fields": {
                        "title": {
                            "type": "string",
                            "analyzer": "lucene.standard",
                        }
                    },
                },
                "workspaceId": {"type": "objectId"},
                "knowledgeBaseId": {"type": "objectId"},
                "sourceId": {"type": "objectId"},
            },
        }
    }


def verify_vector_index_definition(existing_def: dict[str, Any], expected_dimensions: int) -> None:
    """
    Checks if an existing vector index definition matches expected dimensions and structure.
    Raises RuntimeError if there is a mismatch (e.g. dimensions mismatch).
    """
    fields = existing_def.get("fields", [])
    vec_field = next((f for f in fields if f.get("type") == "vector" and f.get("path") == "embedding"), None)
    if not vec_field:
        raise RuntimeError(
            f"Existing index '{VECTOR_INDEX_NAME}' is missing the vector field on 'embedding'. Definition: {existing_def}"
        )

    existing_dim = vec_field.get("numDimensions")
    if existing_dim != expected_dimensions:
        raise RuntimeError(
            f"Embedding dimension mismatch in index '{VECTOR_INDEX_NAME}': existing index has "
            f"numDimensions={existing_dim}, but current configuration requires {expected_dimensions}. "
            "Changing embedding dimensions requires creating a new index and re-embedding all chunks."
        )

    similarity = vec_field.get("similarity")
    if similarity != "cosine":
        raise RuntimeError(
            f"Similarity metric mismatch in index '{VECTOR_INDEX_NAME}': existing index has "
            f"similarity='{similarity}', but expected 'cosine'."
        )


def verify_text_index_definition(existing_def: dict[str, Any]) -> None:
    """
    Checks if an existing text index definition contains required search and filter fields.
    Raises RuntimeError if crucial fields are missing or mismatched.
    """
    mappings = existing_def.get("mappings", {})
    fields = mappings.get("fields", {})

    if "text" not in fields:
        raise RuntimeError(f"Existing index '{TEXT_INDEX_NAME}' is missing the 'text' field.")

    for filter_field in ("workspaceId", "knowledgeBaseId", "sourceId"):
        if filter_field not in fields:
            raise RuntimeError(
                f"Existing index '{TEXT_INDEX_NAME}' is missing required filter field '{filter_field}'."
            )
        field_type = fields[filter_field].get("type")
        if field_type != "objectId":
            logger.warning(
                f"Text index filter field '{filter_field}' has type '{field_type}', expected 'objectId'."
            )


async def drop_legacy_indexes(collection: AsyncCollection) -> list[str]:
    """
    Drops legacy 'idx_source_contenthash_unique' index if it exists.
    Catches OperationFailure if the index does not exist, staying idempotent.
    Returns list of dropped index names.
    """
    dropped = []
    try:
        await collection.drop_index("idx_source_contenthash_unique")
        dropped.append("idx_source_contenthash_unique")
        logger.info("Dropped legacy index 'idx_source_contenthash_unique'")
    except OperationFailure:
        # Index not found or already dropped
        pass
    return dropped


async def ensure_regular_indexes(collection: AsyncCollection) -> list[str]:
    """Creates required standard B-tree indexes idempotently."""
    created = []

    # 1. Scoped hierarchy lookup index: (workspaceId, knowledgeBaseId, sourceId)
    idx1 = await collection.create_index(
        [("workspaceId", 1), ("knowledgeBaseId", 1), ("sourceId", 1)],
        name="idx_workspace_kb_source",
    )
    created.append(idx1)

    # 2. Source ingestion run cleanup/lookup index: (sourceId, ingestionId)
    idx2 = await collection.create_index(
        [("sourceId", 1), ("ingestionId", 1)],
        name="idx_source_ingestion",
    )
    created.append(idx2)

    # 3. Source + Ingestion scoped content deduplication unique index: (sourceId, ingestionId, contentHash)
    idx3 = await collection.create_index(
        [("sourceId", 1), ("ingestionId", 1), ("contentHash", 1)],
        unique=True,
        name="idx_source_ingestion_contenthash_unique",
    )
    created.append(idx3)

    return created


async def poll_search_index_ready(
    collection: AsyncCollection,
    index_name: str,
    timeout_seconds: int = 180,
    poll_interval: float = 3.0,
) -> dict[str, Any]:
    """Polls list_search_indexes until the specified index reaches READY status."""
    start_time = time.time()
    last_status = "UNKNOWN"

    while time.time() - start_time < timeout_seconds:
        cursor = await collection.list_search_indexes(index_name)
        indexes = await cursor.to_list(length=10)

        for idx in indexes:
            if idx.get("name") == index_name:
                last_status = idx.get("status", "UNKNOWN")
                if last_status == "READY":
                    return idx

        await asyncio.sleep(poll_interval)

    raise TimeoutError(
        f"Search index '{index_name}' did not reach 'READY' status within {timeout_seconds}s (last status: {last_status})."
    )


async def ensure_indexes(
    db: Optional[AsyncDatabase] = None,
    timeout_seconds: int = 180,
) -> dict[str, Any]:
    """
    Ensures all regular and Atlas Search indexes exist on the 'chunks' collection.
    Idempotent: if indexes already exist with matching definitions, it does not re-create them.
    Fails fast if existing definitions mismatch expected dimensions or types.
    """
    settings = get_settings()
    client: Optional[AsyncMongoClient] = None

    if db is None:
        client = AsyncMongoClient(settings.MONGODB_URI, serverSelectionTimeoutMS=5000)
        db = client[settings.MONGODB_DB_NAME]

    collection = db[CHUNKS_COLLECTION]
    results: dict[str, Any] = {
        "regular_indexes": [],
        "legacy_indexes_removed": [],
        "search_indexes": {},
    }

    try:
        # 1. Drop legacy index if present
        legacy_removed = await drop_legacy_indexes(collection)
        results["legacy_indexes_removed"] = legacy_removed

        # 2. Ensure regular B-tree indexes
        reg_indexes = await ensure_regular_indexes(collection)
        results["regular_indexes"] = reg_indexes
        logger.info(f"Verified standard MongoDB indexes: {reg_indexes}")

        # 2. Inspect existing Atlas Search indexes
        existing_search_indexes: dict[str, dict[str, Any]] = {}
        try:
            cursor = await collection.list_search_indexes()
            raw_list = await cursor.to_list(length=50)
            for idx in raw_list:
                existing_search_indexes[idx.get("name")] = idx
        except Exception as e:
            logger.warning(f"Could not list search indexes (cluster may not support search or index API): {e}")

        # 3. Vector search index: chunks_vector
        expected_vec_def = get_expected_vector_index_definition(settings.EMBEDDING_DIMENSIONS)
        if VECTOR_INDEX_NAME in existing_search_indexes:
            existing_idx = existing_search_indexes[VECTOR_INDEX_NAME]
            existing_def = existing_idx.get("latestDefinition") or existing_idx.get("definition") or {}
            # Verify compatibility
            verify_vector_index_definition(existing_def, settings.EMBEDDING_DIMENSIONS)
            current_status = existing_idx.get("status")
            if current_status != "READY":
                logger.info(f"Index '{VECTOR_INDEX_NAME}' exists with status '{current_status}'. Waiting for READY...")
                ready_idx = await poll_search_index_ready(collection, VECTOR_INDEX_NAME, timeout_seconds=timeout_seconds)
                results["search_indexes"][VECTOR_INDEX_NAME] = ready_idx.get("status")
            else:
                logger.info(f"Index '{VECTOR_INDEX_NAME}' is already READY.")
                results["search_indexes"][VECTOR_INDEX_NAME] = "READY"
        else:
            logger.info(f"Creating Atlas Vector Search index '{VECTOR_INDEX_NAME}'...")
            vec_model = SearchIndexModel(
                definition=expected_vec_def,
                name=VECTOR_INDEX_NAME,
                type="vectorSearch",
            )
            await collection.create_search_index(model=vec_model)
            ready_idx = await poll_search_index_ready(collection, VECTOR_INDEX_NAME, timeout_seconds=timeout_seconds)
            results["search_indexes"][VECTOR_INDEX_NAME] = ready_idx.get("status")
            logger.info(f"Index '{VECTOR_INDEX_NAME}' created and reached status READY.")

        # 4. Full-text search index: chunks_text
        expected_text_def = get_expected_text_index_definition()
        if TEXT_INDEX_NAME in existing_search_indexes:
            existing_idx = existing_search_indexes[TEXT_INDEX_NAME]
            existing_def = existing_idx.get("latestDefinition") or existing_idx.get("definition") or {}
            verify_text_index_definition(existing_def)
            current_status = existing_idx.get("status")
            if current_status != "READY":
                logger.info(f"Index '{TEXT_INDEX_NAME}' exists with status '{current_status}'. Waiting for READY...")
                ready_idx = await poll_search_index_ready(collection, TEXT_INDEX_NAME, timeout_seconds=timeout_seconds)
                results["search_indexes"][TEXT_INDEX_NAME] = ready_idx.get("status")
            else:
                logger.info(f"Index '{TEXT_INDEX_NAME}' is already READY.")
                results["search_indexes"][TEXT_INDEX_NAME] = "READY"
        else:
            logger.info(f"Creating Atlas Search full-text index '{TEXT_INDEX_NAME}'...")
            text_model = SearchIndexModel(
                definition=expected_text_def,
                name=TEXT_INDEX_NAME,
                type="search",
            )
            await collection.create_search_index(model=text_model)
            ready_idx = await poll_search_index_ready(collection, TEXT_INDEX_NAME, timeout_seconds=timeout_seconds)
            results["search_indexes"][TEXT_INDEX_NAME] = ready_idx.get("status")
            logger.info(f"Index '{TEXT_INDEX_NAME}' created and reached status READY.")

        return results

    finally:
        if client:
            await client.close()


async def get_indexes_status(db: Optional[AsyncDatabase] = None) -> dict[str, Any]:
    """Retrieves current status of regular and Atlas Search indexes on chunks."""
    settings = get_settings()
    client: Optional[AsyncMongoClient] = None

    if db is None:
        client = AsyncMongoClient(settings.MONGODB_URI, serverSelectionTimeoutMS=5000)
        db = client[settings.MONGODB_DB_NAME]

    collection = db[CHUNKS_COLLECTION]
    status_report: dict[str, Any] = {
        "database": db.name,
        "collection": CHUNKS_COLLECTION,
        "regular_indexes": {},
        "legacy_index_removed": True,
        "search_indexes": {},
    }

    try:
        # Standard indexes
        cursor = await collection.list_indexes()
        async for idx in cursor:
            status_report["regular_indexes"][idx.get("name")] = idx.get("key")

        status_report["legacy_index_removed"] = "idx_source_contenthash_unique" not in status_report["regular_indexes"]

        # Atlas Search indexes
        try:
            s_cursor = await collection.list_search_indexes()
            raw_s = await s_cursor.to_list(length=50)
            for idx in raw_s:
                status_report["search_indexes"][idx.get("name")] = {
                    "type": idx.get("type"),
                    "status": idx.get("status"),
                    "queryable": idx.get("queryable", False),
                }
        except Exception as e:
            status_report["search_indexes"]["_error"] = str(e)

        return status_report

    finally:
        if client:
            await client.close()


def main() -> None:
    """CLI entrypoint for index management."""
    parser = argparse.ArgumentParser(description="Rag_Mcp Atlas Index Management CLI")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--ensure", action="store_true", help="Ensure all indexes are created and READY")
    group.add_argument("--status", action="store_true", help="Display current status of all indexes")
    parser.add_argument("--timeout", type=int, default=180, help="Timeout in seconds for polling READY status")

    args = parser.parse_args()
    setup_logging()

    if args.ensure:
        print(f"Ensuring indexes on collection '{CHUNKS_COLLECTION}'...")
        try:
            res = asyncio.run(ensure_indexes(timeout_seconds=args.timeout))
            print("Successfully ensured all indexes:")
            print(f"  Regular indexes: {', '.join(res['regular_indexes'])}")
            if res.get("legacy_indexes_removed"):
                print(f"  Legacy indexes removed: {', '.join(res['legacy_indexes_removed'])}")
            for name, st in res["search_indexes"].items():
                print(f"  Search index '{name}': {st}")
            sys.exit(0)
        except Exception as e:
            print(f"Error ensuring indexes: {e}", file=sys.stderr)
            sys.exit(1)

    elif args.status:
        try:
            status = asyncio.run(get_indexes_status())
            print(f"Database: {status['database']}, Collection: {status['collection']}")
            print("\nRegular B-Tree Indexes:")
            for name, key in status["regular_indexes"].items():
                print(f"  - {name}: {key}")
            if status.get("legacy_index_removed"):
                print("  Status: Legacy index 'idx_source_contenthash_unique' was removed.")
            else:
                print("  Status: Legacy index 'idx_source_contenthash_unique' is still present.")
            print("\nAtlas Search Indexes:")
            if not status["search_indexes"]:
                print("  (None found)")
            else:
                for name, info in status["search_indexes"].items():
                    if name.startswith("_"):
                        print(f"  Notice: {info}")
                    else:
                        print(f"  - {name} ({info.get('type')}): status={info.get('status')} queryable={info.get('queryable')}")
            sys.exit(0)
        except Exception as e:
            print(f"Error retrieving index status: {e}", file=sys.stderr)
            sys.exit(1)


if __name__ == "__main__":
    main()
