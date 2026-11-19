from unittest.mock import AsyncMock, MagicMock
from bson import ObjectId
import pytest

from app.core.config import get_settings
from app.rag.indexes import (
    CHUNKS_COLLECTION,
    VECTOR_INDEX_NAME,
    TEXT_INDEX_NAME,
    drop_legacy_indexes,
    ensure_indexes,
    ensure_regular_indexes,
    get_expected_text_index_definition,
    get_expected_vector_index_definition,
    get_indexes_status,
    verify_text_index_definition,
    verify_vector_index_definition,
)
from app.schemas.rag import ChunkDocument, ChunkMetadata
from tests.atlas_guard import check_live_atlas_availability


def test_chunk_document_schema():
    """Verify ChunkDocument contains all required fields with proper types."""
    ws_id = ObjectId()
    kb_id = ObjectId()
    src_id = ObjectId()

    chunk = ChunkDocument(
        workspaceId=ws_id,
        knowledgeBaseId=kb_id,
        sourceId=src_id,
        ingestionId="ing_test_123",
        chunkIndex=0,
        text="Sample extracted text block.",
        embedding=[0.1] * 384,
        embeddingModel="BAAI/bge-small-en-v1.5",
        contentHash="abc123hash",
        metadata=ChunkMetadata(
            url="https://example.com/page1",
            title="Page Title",
            heading="Section 1",
            page=1,
            sourceType="PDF",
        ),
    )

    mongo_doc = chunk.to_mongo()
    assert isinstance(mongo_doc["_id"], ObjectId)
    assert mongo_doc["workspaceId"] == ws_id
    assert mongo_doc["knowledgeBaseId"] == kb_id
    assert mongo_doc["sourceId"] == src_id
    assert mongo_doc["ingestionId"] == "ing_test_123"
    assert mongo_doc["chunkIndex"] == 0
    assert mongo_doc["text"] == "Sample extracted text block."
    assert len(mongo_doc["embedding"]) == 384
    assert mongo_doc["embeddingModel"] == "BAAI/bge-small-en-v1.5"
    assert mongo_doc["contentHash"] == "abc123hash"
    assert mongo_doc["metadata"]["url"] == "https://example.com/page1"
    assert mongo_doc["metadata"]["sourceType"] == "PDF"


def test_verify_vector_index_definition_success():
    """Validates matching definition passes verification."""
    defn = get_expected_vector_index_definition(384)
    verify_vector_index_definition(defn, 384)


def test_verify_vector_index_definition_mismatch():
    """Validates dimension or similarity mismatch raises RuntimeError."""
    defn = get_expected_vector_index_definition(384)

    # 1. Dimension mismatch
    with pytest.raises(RuntimeError) as exc_info:
        verify_vector_index_definition(defn, 768)
    assert "Embedding dimension mismatch" in str(exc_info.value)
    assert "numDimensions=384" in str(exc_info.value)

    # 2. Similarity mismatch
    defn_wrong_sim = get_expected_vector_index_definition(384)
    defn_wrong_sim["fields"][0]["similarity"] = "dotProduct"
    with pytest.raises(RuntimeError) as exc_info2:
        verify_vector_index_definition(defn_wrong_sim, 384)
    assert "Similarity metric mismatch" in str(exc_info2.value)


def test_verify_text_index_definition():
    """Validates text index fields and checks missing field exceptions."""
    defn = get_expected_text_index_definition()
    verify_text_index_definition(defn)

    # Missing text field
    broken_defn = {"mappings": {"fields": {}}}
    with pytest.raises(RuntimeError) as exc_info:
        verify_text_index_definition(broken_defn)
    assert "missing the 'text' field" in str(exc_info.value)


@pytest.mark.asyncio
async def test_ensure_regular_indexes():
    """Verify regular B-tree index creation creates all 3 indexes including the new unique compound index."""
    mock_collection = MagicMock()
    mock_collection.create_index = AsyncMock(side_effect=["idx1", "idx2", "idx3"])

    created = await ensure_regular_indexes(mock_collection)
    assert len(created) == 3
    assert mock_collection.create_index.call_count == 3

    # Check 3rd index definition: (sourceId, ingestionId, contentHash) unique
    third_call_args, third_call_kwargs = mock_collection.create_index.call_args_list[2]
    assert third_call_kwargs["name"] == "idx_source_ingestion_contenthash_unique"
    assert third_call_kwargs["unique"] is True
    assert third_call_args[0] == [("sourceId", 1), ("ingestionId", 1), ("contentHash", 1)]


@pytest.mark.asyncio
async def test_drop_legacy_indexes_idempotency():
    """Verify migration helper for legacy index is idempotent when index does not exist."""
    from pymongo.errors import OperationFailure

    mock_collection = MagicMock()
    # 1. First run when legacy index exists
    mock_collection.drop_index = AsyncMock(return_value=None)
    dropped = await drop_legacy_indexes(mock_collection)
    assert dropped == ["idx_source_contenthash_unique"]
    assert mock_collection.drop_index.call_count == 1

    # 2. Second run when legacy index does not exist (OperationFailure: index not found)
    mock_collection.drop_index = AsyncMock(side_effect=OperationFailure("index not found", code=27))
    dropped_again = await drop_legacy_indexes(mock_collection)
    assert dropped_again == []


@pytest.mark.asyncio
async def test_ensure_indexes_idempotency_noop():
    """
    Verify that calling ensure_indexes when indexes already exist with READY status
    is a complete no-op (create_search_index is never called).
    """
    mock_db = MagicMock()
    mock_collection = MagicMock()
    mock_db.__getitem__.return_value = mock_collection

    mock_collection.create_index = AsyncMock(return_value="index_ok")
    mock_collection.drop_index = AsyncMock(return_value=None)
    mock_collection.drop_index = AsyncMock(return_value=None)

    vec_def = get_expected_vector_index_definition(384)
    text_def = get_expected_text_index_definition()

    mock_cursor = MagicMock()
    mock_cursor.to_list = AsyncMock(
        return_value=[
            {
                "name": VECTOR_INDEX_NAME,
                "status": "READY",
                "type": "vectorSearch",
                "definition": vec_def,
            },
            {
                "name": TEXT_INDEX_NAME,
                "status": "READY",
                "type": "search",
                "definition": text_def,
            },
        ]
    )
    mock_collection.list_search_indexes = AsyncMock(return_value=mock_cursor)
    mock_collection.create_search_index = AsyncMock()

    # First call
    res1 = await ensure_indexes(db=mock_db)
    assert res1["search_indexes"][VECTOR_INDEX_NAME] == "READY"
    assert res1["search_indexes"][TEXT_INDEX_NAME] == "READY"
    assert mock_collection.create_search_index.call_count == 0

    # Second call (proves idempotency / no-op)
    res2 = await ensure_indexes(db=mock_db)
    assert res2["search_indexes"][VECTOR_INDEX_NAME] == "READY"
    assert res2["search_indexes"][TEXT_INDEX_NAME] == "READY"
    assert mock_collection.create_search_index.call_count == 0


@pytest.mark.asyncio
async def test_ensure_indexes_creates_when_missing():
    """Verify that ensure_indexes creates missing search indexes and polls until READY."""
    mock_db = MagicMock()
    mock_collection = MagicMock()
    mock_db.__getitem__.return_value = mock_collection

    mock_collection.create_index = AsyncMock(return_value="index_ok")
    mock_collection.drop_index = AsyncMock(return_value=None)

    empty_cursor = MagicMock()
    empty_cursor.to_list = AsyncMock(return_value=[])

    ready_cursor_vec = MagicMock()
    ready_cursor_vec.to_list = AsyncMock(return_value=[{"name": VECTOR_INDEX_NAME, "status": "READY"}])

    ready_cursor_text = MagicMock()
    ready_cursor_text.to_list = AsyncMock(return_value=[{"name": TEXT_INDEX_NAME, "status": "READY"}])

    async def list_search_indexes_side_effect(name=None):
        if name == VECTOR_INDEX_NAME:
            return ready_cursor_vec
        elif name == TEXT_INDEX_NAME:
            return ready_cursor_text
        return empty_cursor

    mock_collection.list_search_indexes = AsyncMock(side_effect=list_search_indexes_side_effect)
    mock_collection.create_search_index = AsyncMock(return_value="created_ok")

    res = await ensure_indexes(db=mock_db)
    assert mock_collection.create_search_index.call_count == 2
    assert res["search_indexes"][VECTOR_INDEX_NAME] == "READY"
    assert res["search_indexes"][TEXT_INDEX_NAME] == "READY"


@pytest.mark.asyncio
async def test_get_indexes_status_mock():
    """Verify get_indexes_status compiles report properly."""
    mock_db = MagicMock()
    mock_db.name = "Rag_Mcp_test"
    mock_collection = MagicMock()
    mock_db.__getitem__.return_value = mock_collection

    class AsyncIter:
        def __init__(self, items):
            self.items = items

        def __aiter__(self):
            self.iter = iter(self.items)
            return self

        async def __anext__(self):
            try:
                return next(self.iter)
            except StopIteration:
                raise StopAsyncIteration

    mock_collection.list_indexes = AsyncMock(
        return_value=AsyncIter([
            {"name": "_id_", "key": {"_id": 1}},
            {"name": "idx_workspace_kb_source", "key": {"workspaceId": 1}},
        ])
    )

    mock_s_cursor = MagicMock()
    mock_s_cursor.to_list = AsyncMock(
        return_value=[
            {"name": VECTOR_INDEX_NAME, "type": "vectorSearch", "status": "READY", "queryable": True},
            {"name": TEXT_INDEX_NAME, "type": "search", "status": "READY", "queryable": True},
        ]
    )
    mock_collection.list_search_indexes = AsyncMock(return_value=mock_s_cursor)

    status = await get_indexes_status(db=mock_db)
    assert status["database"] == "Rag_Mcp_test"
    assert status["collection"] == CHUNKS_COLLECTION
    assert "_id_" in status["regular_indexes"]
    assert "idx_workspace_kb_source" in status["regular_indexes"]
    assert status["search_indexes"][VECTOR_INDEX_NAME]["status"] == "READY"
    assert status["search_indexes"][TEXT_INDEX_NAME]["status"] == "READY"


@pytest.mark.asyncio
async def test_live_atlas_indexes_safety():
    """
    Live test against Atlas: verifies indexes on Rag_Mcp_test.
    Skips gracefully if Atlas is not reachable, or fails hard if REQUIRE_LIVE_TESTS=true.
    """
    probe = await check_live_atlas_availability()
    if not probe.get("available"):
        pytest.skip(f"Live Atlas unreachable: {probe.get('reason')}")

    from pymongo import AsyncMongoClient

    settings = get_settings()
    assert settings.MONGODB_TEST_DB_NAME.endswith("_test")

    client = AsyncMongoClient(settings.MONGODB_URI)
    try:
        test_db = client[settings.MONGODB_TEST_DB_NAME]
        test_col = test_db[CHUNKS_COLLECTION]
        
        # Test drop legacy index idempotency and regular B-tree indexes creation idempotency on test database
        await drop_legacy_indexes(test_col)
        reg_created1 = await ensure_regular_indexes(test_col)
        assert len(reg_created1) == 3

        reg_created2 = await ensure_regular_indexes(test_col)
        assert len(reg_created2) == 3

        # Verify search indexes query API works on live Atlas
        s_cursor = await test_col.list_search_indexes()
        s_indexes = await s_cursor.to_list(length=10)
        assert isinstance(s_indexes, list)
    finally:
        await client.close()
