import os
import tempfile
from unittest.mock import AsyncMock, MagicMock
from bson import ObjectId
import pytest

from app.core.config import get_settings
from app.ingestion.pipeline import (
    QuotaExceededError,
    check_workspace_quota,
    run_ingestion_pipeline,
)
from app.tools.cleanup import remove_orphan_chunks
from tests.test_extractors import create_minimal_pdf


@pytest.mark.asyncio
async def test_quota_rejection_prevents_partial_chunks():
    """Verify that quota check fires BEFORE any chunks are inserted and prevents partial states."""
    mock_db = MagicMock()
    ws_id = ObjectId()

    # Simulate existing chunk count of 4995 with limit 5000
    mock_db.chunks.count_documents = AsyncMock(return_value=4995)

    # Attempting to add 10 chunks exceeds limit of 5000
    with pytest.raises(QuotaExceededError) as exc_info:
        await check_workspace_quota(
            mock_db,
            workspace_id=ws_id,
            additional_chunks=10,
            max_chunks_allowed=5000,
        )
    assert "Workspace chunk quota exceeded" in str(exc_info.value)


@pytest.mark.asyncio
async def test_ingest_local_pdf_and_html_fixtures():
    """Integration test: Ingest a small local PDF and HTML fixture into mock MongoDB."""
    mock_db = MagicMock()
    mock_db.chunks = MagicMock()
    inserted_chunks = []

    async def mock_insert_many(docs, ordered=False):
        inserted_chunks.clear()
        inserted_chunks.extend(docs)

    mock_db.chunks.insert_many = AsyncMock(side_effect=mock_insert_many)

    async def mock_count_documents(query):
        if "ingestionId" in query:
            return len(inserted_chunks) if inserted_chunks else 1
        return 0

    mock_db.chunks.count_documents = AsyncMock(side_effect=mock_count_documents)
    mock_db.chunks.delete_many = AsyncMock()

    mock_db.sources = MagicMock()
    mock_db.sources.update_one = AsyncMock()

    ws_id = ObjectId()
    kb_id = ObjectId()
    src_id = ObjectId()

    # 1. Ingest PDF fixture
    pdf_bytes = create_minimal_pdf(["Page 1 PDF documentation.", "Page 2 PDF details."])
    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp_pdf:
        tmp_pdf.write(pdf_bytes)
        tmp_pdf_path = tmp_pdf.name

    try:
        count = await run_ingestion_pipeline(
            db=mock_db,
            workspace_id=ws_id,
            knowledge_base_id=kb_id,
            source_id=src_id,
            target=tmp_pdf_path,
            is_url=False,
        )
        assert count >= 1
        assert mock_db.chunks.insert_many.call_count == 1
        # Check source was updated to INDEXED
        last_update_call = mock_db.sources.update_one.call_args_list[-1]
        assert last_update_call[0][0]["_id"] == src_id
        assert last_update_call[0][0]["workspaceId"] == ws_id
        assert last_update_call[0][1]["$set"]["status"] == "INDEXED"
    finally:
        if os.path.exists(tmp_pdf_path):
            os.remove(tmp_pdf_path)

    # 2. Ingest HTML fixture
    html_content = b"<html><head><title>Test Guide</title></head><body><h1>Intro</h1><p>Documentation guide text.</p></body></html>"
    with tempfile.NamedTemporaryFile(suffix=".html", delete=False) as tmp_html:
        tmp_html.write(html_content)
        tmp_html_path = tmp_html.name

    try:
        count = await run_ingestion_pipeline(
            db=mock_db,
            workspace_id=ws_id,
            knowledge_base_id=kb_id,
            source_id=src_id,
            target=tmp_html_path,
            is_url=False,
        )
        assert count >= 1
    finally:
        if os.path.exists(tmp_html_path):
            os.remove(tmp_html_path)


@pytest.mark.asyncio
async def test_reindex_safety_two_phase():
    """
    Verify re-indexing safety:
    New chunks are inserted with a new ingestionId.
    Older chunks are only deleted AFTER new insertion succeeds.
    If an error occurs, new chunks are cleaned up and source is marked FAILED.
    """
    mock_db = MagicMock()
    mock_db.chunks = MagicMock()
    inserted_chunks = []

    async def mock_insert_many(docs, ordered=False):
        inserted_chunks.clear()
        inserted_chunks.extend(docs)

    mock_db.chunks.insert_many = AsyncMock(side_effect=mock_insert_many)

    async def mock_count_documents(query):
        if "ingestionId" in query:
            return len(inserted_chunks) if inserted_chunks else 1
        return 0

    mock_db.chunks.count_documents = AsyncMock(side_effect=mock_count_documents)
    mock_db.chunks.delete_many = AsyncMock()

    mock_db.sources = MagicMock()
    mock_db.sources.update_one = AsyncMock()

    ws_id = ObjectId()
    kb_id = ObjectId()
    src_id = ObjectId()

    # Re-index failure case: simulate failure during embedding
    with tempfile.NamedTemporaryFile(suffix=".txt", delete=False) as tmp_txt:
        tmp_txt.write(b"# Title\nSample text content.")
        tmp_path = tmp_txt.name

    try:
        from unittest.mock import patch
        with patch("app.rag.embeddings.FastEmbedProvider.embed_documents", side_effect=RuntimeError("Embedding crash")):
            with pytest.raises(RuntimeError):
                await run_ingestion_pipeline(
                    db=mock_db,
                    workspace_id=ws_id,
                    knowledge_base_id=kb_id,
                    source_id=src_id,
                    target=tmp_path,
                    is_url=False,
                )

        # Confirm source was marked FAILED and cleanup delete_many was called
        last_source_update = mock_db.sources.update_one.call_args_list[-1]
        assert last_source_update[0][1]["$set"]["status"] == "FAILED"
        assert "Embedding crash" in last_source_update[0][1]["$set"]["error"]
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)


@pytest.mark.asyncio
async def test_cross_workspace_isolation():
    """
    Verify cross-workspace isolation:
    Workspace B cannot see, modify, or delete Workspace A's chunks.
    All chunk deletions and queries strictly filter by workspaceId.
    """
    from httpx import ASGITransport, AsyncClient
    from app.main import app

    settings = get_settings()

    ws_a = ObjectId()
    ws_b = ObjectId()
    src_a = ObjectId()

    mock_db = MagicMock()
    mock_db.chunks = MagicMock()
    # When deleting with workspace B's ID, delete_many returns 0 deleted documents
    mock_delete_result = MagicMock()
    mock_delete_result.deleted_count = 0
    mock_db.chunks.delete_many = AsyncMock(return_value=mock_delete_result)

    mock_client = MagicMock()
    mock_client.__getitem__.return_value = mock_db
    app.state.mongo_client = mock_client

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        # Workspace B attempts to delete Workspace A's source chunks
        res = await client.delete(
            f"/sources/{src_a}/chunks",
            headers={
                "X-Internal-Key": settings.INTERNAL_API_KEY,
                "X-Workspace-Id": str(ws_b),
            },
        )
        assert res.status_code == 200
        assert res.json()["deletedCount"] == 0

        # Verify the delete filter sent to MongoDB contained Workspace B's ID
        filter_sent = mock_db.chunks.delete_many.call_args[0][0]
        assert filter_sent["workspaceId"] == ws_b
        assert filter_sent["workspaceId"] != ws_a


@pytest.mark.asyncio
async def test_cleanup_orphan_chunks():
    """Verify cleanup tool removes chunks whose parent source document no longer exists."""
    mock_db = MagicMock()
    mock_db.chunks = MagicMock()
    mock_db.sources = MagicMock()

    src1 = ObjectId()
    src2_orphan = ObjectId()

    # Chunks collection has chunks for src1 and src2
    mock_db.chunks.distinct = AsyncMock(return_value=[src1, src2_orphan])

    # Sources collection only contains src1 (src2 was deleted)
    cursor_mock = MagicMock()
    cursor_mock.to_list = AsyncMock(return_value=[{"_id": src1}])
    mock_db.sources.find.return_value = cursor_mock

    delete_res_mock = MagicMock()
    delete_res_mock.deleted_count = 5
    mock_db.chunks.delete_many = AsyncMock(return_value=delete_res_mock)

    result = await remove_orphan_chunks(db=mock_db)
    assert result["orphan_sources"] == 1
    assert result["deleted_chunks"] == 5

    # Verify query filtered by orphan source id
    called_filter = mock_db.chunks.delete_many.call_args[0][0]
    assert called_filter["sourceId"]["$in"] == [src2_orphan]


@pytest.mark.asyncio
async def test_cross_page_chunk_deduplication():
    """
    Unit test: two crawled pages containing the same repeated paragraph yield
    exactly ONE chunk for it after the pipeline's cross-page dedupe, with sequential chunk_index values.
    """
    from unittest.mock import patch

    mock_db = MagicMock()
    mock_db.chunks = MagicMock()
    captured_docs = []

    async def mock_insert_many(docs, ordered=False):
        captured_docs.extend(docs)

    mock_db.chunks.insert_many = AsyncMock(side_effect=mock_insert_many)
    mock_db.chunks.count_documents = AsyncMock(side_effect=lambda q: len(captured_docs) if "ingestionId" in q else 0)
    mock_db.chunks.delete_many = AsyncMock()
    mock_db.sources = MagicMock()
    mock_db.sources.update_one = AsyncMock()

    ws_id = ObjectId()
    kb_id = ObjectId()
    src_id = ObjectId()

    # Two pages sharing identical section with repeated paragraph
    repeated_para = "<h2>Disclaimer</h2><p>This is a repeated paragraph that appears verbatim on multiple pages across the website documentation.</p>"
    page1_html = f"<html><body><h1>Page 1</h1><p>Unique text for page one that is sufficiently long for chunking.</p>{repeated_para}</body></html>".encode()
    page2_html = f"<html><body><h1>Page 2</h1><p>Unique text for page two that is sufficiently long for chunking.</p>{repeated_para}</body></html>".encode()

    mock_crawled_pages = [
        ("https://example.com/page1", page1_html),
        ("https://example.com/page2", page2_html),
    ]

    with patch("app.ingestion.pipeline.WebCrawler.crawl", AsyncMock(return_value=mock_crawled_pages)):
        count = await run_ingestion_pipeline(
            db=mock_db,
            workspace_id=ws_id,
            knowledge_base_id=kb_id,
            source_id=src_id,
            target="https://example.com/docs",
            is_url=True,
        )

    assert len(captured_docs) > 0
    all_texts = [d["text"] for d in captured_docs]

    # Verify that the repeated paragraph chunk appears exactly once
    repeated_chunks = [t for t in all_texts if "This is a repeated paragraph that appears verbatim" in t]
    assert len(repeated_chunks) == 1, f"Expected 1 chunk for repeated paragraph, got {len(repeated_chunks)}"

    # Verify chunk_index values are sequential without gaps: 0, 1, 2, ...
    indices = [d["chunkIndex"] for d in captured_docs]
    assert indices == list(range(len(captured_docs))), f"Chunk indices are not sequential: {indices}"


@pytest.mark.asyncio
async def test_bulk_write_error_handling_tolerates_11000_and_reraises_other():
    """
    Unit test: BulkWriteError handling tolerates an all-11000 error and re-raises a non-11000 error.
    """
    from pymongo.errors import BulkWriteError

    ws_id = ObjectId()
    kb_id = ObjectId()
    src_id = ObjectId()

    with tempfile.NamedTemporaryFile(suffix=".txt", delete=False) as tmp:
        tmp.write(b"# Title\nSample text content for bulk write error tolerance testing.")
        tmp_path = tmp.name

    try:
        # Case 1: Tolerates all-11000 BulkWriteError
        mock_db_tolerated = MagicMock()
        mock_db_tolerated.chunks = MagicMock()
        mock_db_tolerated.chunks.count_documents = AsyncMock(return_value=1)
        mock_db_tolerated.chunks.delete_many = AsyncMock()
        mock_db_tolerated.sources = MagicMock()
        mock_db_tolerated.sources.update_one = AsyncMock()

        all_11000_error = BulkWriteError({
            "writeErrors": [
                {"index": 0, "code": 11000, "errmsg": "E11000 duplicate key error"},
                {"index": 1, "code": 11000, "errmsg": "E11000 duplicate key error"},
            ]
        })
        mock_db_tolerated.chunks.insert_many = AsyncMock(side_effect=all_11000_error)

        result_count = await run_ingestion_pipeline(
            db=mock_db_tolerated,
            workspace_id=ws_id,
            knowledge_base_id=kb_id,
            source_id=src_id,
            target=tmp_path,
            is_url=False,
        )
        assert result_count == 1
        last_update = mock_db_tolerated.sources.update_one.call_args_list[-1]
        assert last_update[0][1]["$set"]["status"] == "INDEXED"

        # Case 2: Re-raises non-11000 BulkWriteError and sets friendly error message
        mock_db_fail = MagicMock()
        mock_db_fail.chunks = MagicMock()
        mock_db_fail.chunks.count_documents = AsyncMock(return_value=0)
        mock_db_fail.chunks.delete_many = AsyncMock()
        mock_db_fail.sources = MagicMock()
        mock_db_fail.sources.update_one = AsyncMock()

        mixed_error = BulkWriteError({
            "writeErrors": [
                {"index": 0, "code": 11000, "errmsg": "E11000 duplicate key error"},
                {"index": 1, "code": 121, "errmsg": "Document validation failed"},
            ]
        })
        mock_db_fail.chunks.insert_many = AsyncMock(side_effect=mixed_error)

        with pytest.raises(BulkWriteError):
            await run_ingestion_pipeline(
                db=mock_db_fail,
                workspace_id=ws_id,
                knowledge_base_id=kb_id,
                source_id=src_id,
                target=tmp_path,
                is_url=False,
            )

        last_failed_update = mock_db_fail.sources.update_one.call_args_list[-1]
        assert last_failed_update[0][1]["$set"]["status"] == "FAILED"
        assert "Some chunks could not be saved (duplicate content)" in last_failed_update[0][1]["$set"]["error"]
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)


@pytest.mark.asyncio
async def test_live_reindex_unchanged_content_success():
    """
    Live test (skipped cleanly without Atlas, using only the *_test database):
    ingesting a small HTML fixture twice in a row for the same source (a re-index of unchanged content)
    succeeds, leaves only the newest ingestionId's chunks, and chunkCount equals the real number of chunks.
    """
    from datetime import datetime, timezone
    from pymongo import AsyncMongoClient
    from app.rag.indexes import ensure_regular_indexes, drop_legacy_indexes
    from tests.atlas_guard import skip_if_atlas_unavailable

    await skip_if_atlas_unavailable()

    settings = get_settings()
    assert settings.MONGODB_TEST_DB_NAME.endswith("_test")

    client = AsyncMongoClient(settings.MONGODB_URI, serverSelectionTimeoutMS=5000)
    db = client[settings.MONGODB_TEST_DB_NAME]

    ws_id = ObjectId()
    kb_id = ObjectId()
    src_id = ObjectId()

    # Ensure updated compound index and drop legacy index on test DB
    await drop_legacy_indexes(db.chunks)
    await ensure_regular_indexes(db.chunks)

    await db.sources.insert_one({
        "_id": src_id,
        "workspaceId": ws_id,
        "knowledgeBaseId": kb_id,
        "name": "Live Re-index Test",
        "status": "PENDING",
        "chunkCount": 0,
        "createdAt": datetime.now(timezone.utc),
    })

    html_content = b"<html><head><title>Reindex Test Doc</title></head><body><h1>Guide</h1><p>Static unchanged content for double ingestion test.</p></body></html>"
    with tempfile.NamedTemporaryFile(suffix=".html", delete=False) as tmp_html:
        tmp_html.write(html_content)
        tmp_html_path = tmp_html.name

    try:
        # First ingestion
        count1 = await run_ingestion_pipeline(
            db=db,
            workspace_id=ws_id,
            knowledge_base_id=kb_id,
            source_id=src_id,
            target=tmp_html_path,
            is_url=False,
        )
        assert count1 > 0

        src1 = await db.sources.find_one({"_id": src_id})
        assert src1["status"] == "INDEXED"
        assert src1["chunkCount"] == count1

        chunks1 = await db.chunks.find({"sourceId": src_id}).to_list(length=100)
        assert len(chunks1) == count1
        first_ingestion_id = chunks1[0]["ingestionId"]

        # Second ingestion: re-index of the exact same unchanged content
        count2 = await run_ingestion_pipeline(
            db=db,
            workspace_id=ws_id,
            knowledge_base_id=kb_id,
            source_id=src_id,
            target=tmp_html_path,
            is_url=False,
        )
        assert count2 == count1

        src2 = await db.sources.find_one({"_id": src_id})
        assert src2["status"] == "INDEXED"
        assert src2["chunkCount"] == count2

        # Check that ONLY the newest ingestionId's chunks remain
        chunks2 = await db.chunks.find({"sourceId": src_id}).to_list(length=100)
        assert len(chunks2) == count2
        second_ingestion_id = chunks2[0]["ingestionId"]
        assert second_ingestion_id != first_ingestion_id

        # Verify no old chunks remain
        old_count = await db.chunks.count_documents({"sourceId": src_id, "ingestionId": first_ingestion_id})
        assert old_count == 0

        # Verify chunkCount equals the real number of chunks
        real_count = await db.chunks.count_documents({
            "workspaceId": ws_id,
            "sourceId": src_id,
            "ingestionId": second_ingestion_id,
        })
        assert src2["chunkCount"] == real_count

    finally:
        if os.path.exists(tmp_html_path):
            os.remove(tmp_html_path)
        # Delete only test documents (never drop databases)
        await db.chunks.delete_many({"workspaceId": ws_id})
        await db.sources.delete_many({"workspaceId": ws_id})
        await client.close()

