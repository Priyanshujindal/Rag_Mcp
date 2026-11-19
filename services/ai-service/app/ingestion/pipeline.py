import asyncio
import os
import uuid
from datetime import datetime, timezone
from typing import List, Optional
from bson import ObjectId
from pymongo.asynchronous.database import AsyncDatabase
from pymongo.errors import BulkWriteError

from app.core.config import get_settings
from app.core.logging import logger
from app.ingestion.chunking import RawChunk, chunk_document
from app.ingestion.crawler.crawler import WebCrawler
from app.ingestion.extractors import ExtractedDocument, extract_document
from app.rag.embeddings import get_embedding_provider
from app.schemas.rag import ChunkDocument


class QuotaExceededError(ValueError):
    """Raised when a workspace's maximum chunk allocation would be exceeded."""
    pass


async def check_workspace_quota(
    db: AsyncDatabase,
    workspace_id: ObjectId,
    additional_chunks: int,
    max_chunks_allowed: Optional[int] = None,
) -> int:
    """
    Enforces chunk quota per workspace BEFORE embeddings are computed.
    Counts existing chunks for the workspace in MongoDB and rejects if limit would be exceeded.
    """
    settings = get_settings()
    max_limit = max_chunks_allowed or settings.MAX_CHUNKS_PER_WORKSPACE

    current_count = await db.chunks.count_documents({"workspaceId": workspace_id})
    if current_count + additional_chunks > max_limit:
        raise QuotaExceededError(
            f"Workspace chunk quota exceeded: current={current_count}, adding={additional_chunks}, "
            f"maximum permitted={max_limit}."
        )
    return current_count


async def run_ingestion_pipeline(
    db: AsyncDatabase,
    workspace_id: ObjectId,
    knowledge_base_id: ObjectId,
    source_id: ObjectId,
    target: str,
    is_url: bool = False,
) -> int:
    """
    Executes the ingestion pipeline:
    1. Sets Source state to CRAWLING/INDEXING.
    2. Crawls URL or reads uploaded file.
    3. Chunks text recursively with heading tracking.
    4. Enforces workspace chunk quota BEFORE embedding.
    5. Computes dense embeddings with retries.
    6. Two-phase safe re-indexing:
       - Inserts chunks with new ingestionId.
       - Upon success, deletes old chunks for this source.
       - Upon failure, cleans up new ingestionId chunks and marks Source FAILED.
    """
    settings = get_settings()
    ingestion_id = uuid.uuid4().hex
    embedding_provider = get_embedding_provider(settings)

    # 1. Update source status to active processing with start timestamp
    start_time = datetime.now(timezone.utc)
    await db.sources.update_one(
        {"_id": source_id, "workspaceId": workspace_id},
        {
            "$set": {
                "status": "CRAWLING" if is_url else "PROCESSING",
                "indexingStartedAt": start_time,
                "indexingCompletedAt": None,
                "indexingDurationMs": None,
                "embeddingStatus": "PENDING",
                "embeddingsGenerated": 0,
                "updatedAt": start_time,
            }
        },
    )

    try:
        raw_chunks: List[RawChunk] = []
        extracted_text_pieces: List[str] = []

        if is_url:
            crawler = WebCrawler(
                max_pages=settings.CRAWL_MAX_PAGES,
                max_depth=settings.CRAWL_MAX_DEPTH,
            )
            crawled_pages = await crawler.crawl(target)
            if not crawled_pages:
                raise ValueError(f"No valid crawlable pages retrieved from {target}")

            for page_url, html_bytes in crawled_pages:
                doc = extract_document(
                    html_bytes,
                    filename="",
                    max_file_mb=settings.MAX_FILE_MB,
                    url=page_url,
                )
                for sec in doc.sections:
                    if sec.text:
                        extracted_text_pieces.append(sec.text)
                page_chunks = chunk_document(doc, url=page_url, source_type="URL")
                raw_chunks.extend(page_chunks)
        else:
            # File on disk
            if not os.path.exists(target):
                raise FileNotFoundError(f"File not found: {target}")

            with open(target, "rb") as f:
                content = f.read()

            filename = os.path.basename(target)
            doc = extract_document(
                content,
                filename=filename,
                max_file_mb=settings.MAX_FILE_MB,
            )
            for sec in doc.sections:
                if sec.text:
                    extracted_text_pieces.append(sec.text)
            raw_chunks = chunk_document(doc, url=None, source_type=doc.source_type)

        full_extracted_sample = "\n\n".join(extracted_text_pieces)
        total_extracted_chars = sum(len(p) for p in extracted_text_pieces)
        # Store preview up to 5,000 characters to avoid excessive document bloat
        extracted_preview = full_extracted_sample[:5000] if full_extracted_sample else ""

        # Cross-page / run deduplication across all chunks by content_hash,
        # keeping the FIRST occurrence and its metadata
        pages_crawled = len(crawled_pages) if is_url else 1
        chunks_before = len(raw_chunks)
        seen_hashes = set()
        deduped_chunks: List[RawChunk] = []
        for chunk in raw_chunks:
            if chunk.content_hash not in seen_hashes:
                seen_hashes.add(chunk.content_hash)
                deduped_chunks.append(chunk)

        duplicates_removed = chunks_before - len(deduped_chunks)
        chunks_after = len(deduped_chunks)

        # Re-number chunk_index sequentially after deduplication
        for idx, chunk in enumerate(deduped_chunks):
            chunk.chunk_index = idx

        logger.info(
            f"Chunk deduplication complete: {pages_crawled} pages crawled, "
            f"{chunks_before} chunks before, {duplicates_removed} duplicates removed, {chunks_after} chunks after.",
            extra={
                "pages_crawled": pages_crawled,
                "chunks_before": chunks_before,
                "duplicates_removed": duplicates_removed,
                "chunks_after": chunks_after,
            },
        )

        if not deduped_chunks:
            raise ValueError("No extractable chunks found in content.")

        raw_chunks = deduped_chunks

        # 2. Check quota BEFORE computing embeddings
        await check_workspace_quota(
            db,
            workspace_id=workspace_id,
            additional_chunks=len(raw_chunks),
            max_chunks_allowed=settings.MAX_CHUNKS_PER_WORKSPACE,
        )

        # Update embedding status to PROCESSING before computing vectors
        await db.sources.update_one(
            {"_id": source_id, "workspaceId": workspace_id},
            {
                "$set": {
                    "status": "INDEXING",
                    "embeddingStatus": "PROCESSING",
                    "extractedTextPreview": extracted_preview,
                    "extractedCharCount": total_extracted_chars,
                    "updatedAt": datetime.now(timezone.utc),
                }
            },
        )

        # 3. Compute embeddings
        chunk_texts = [c.text for c in raw_chunks]
        embeddings = await embedding_provider.embed_documents(chunk_texts)
        embeddings_count = len(embeddings)

        # 4. Prepare Chunk documents
        now = datetime.now(timezone.utc)
        chunk_docs: List[dict] = []
        for i, raw_chunk in enumerate(raw_chunks):
            doc = ChunkDocument(
                workspaceId=workspace_id,
                knowledgeBaseId=knowledge_base_id,
                sourceId=source_id,
                ingestionId=ingestion_id,
                chunkIndex=raw_chunk.chunk_index,
                text=raw_chunk.text,
                embedding=embeddings[i],
                embeddingModel=embedding_provider.model_name,
                contentHash=raw_chunk.content_hash,
                metadata=raw_chunk.metadata,
                createdAt=now,
            )
            chunk_docs.append(doc.to_mongo())

        # 5. Insert new chunks (unordered to allow non-conflicting inserts to proceed)
        try:
            await db.chunks.insert_many(chunk_docs, ordered=False)
        except BulkWriteError as bwe:
            write_errors = bwe.details.get("writeErrors", []) if bwe.details else []
            if write_errors and all(we.get("code") == 11000 for we in write_errors):
                dup_count = len(write_errors)
                logger.warning(
                    f"Ignored {dup_count} duplicate chunks (code 11000) during insert_many for source {source_id}",
                    extra={"sourceId": str(source_id), "duplicateChunksSkipped": dup_count},
                )
            else:
                raise

        # 6. Two-phase cleanup: delete previous chunks of this source
        await db.chunks.delete_many({
            "workspaceId": workspace_id,
            "sourceId": source_id,
            "ingestionId": {"$ne": ingestion_id},
        })

        # 7. Update source status to INDEXED
        # Set chunkCount from count_documents({workspaceId, sourceId, ingestionId})
        real_chunk_count = await db.chunks.count_documents({
            "workspaceId": workspace_id,
            "sourceId": source_id,
            "ingestionId": ingestion_id,
        })

        now = datetime.now(timezone.utc)
        duration_ms = int((now - start_time).total_seconds() * 1000)
        await db.sources.update_one(
            {"_id": source_id, "workspaceId": workspace_id},
            {
                "$set": {
                    "status": "INDEXED",
                    "chunkCount": real_chunk_count,
                    "extractedTextPreview": extracted_preview,
                    "extractedCharCount": total_extracted_chars,
                    "embeddingStatus": "COMPLETED",
                    "embeddingsGenerated": embeddings_count,
                    "indexingStartedAt": start_time,
                    "indexingCompletedAt": now,
                    "indexingDurationMs": duration_ms,
                    "error": None,
                    "lastIndexedAt": now,
                    "updatedAt": now,
                }
            },
        )
        logger.info(
            f"Successfully indexed source {source_id} ({real_chunk_count} chunks, {embeddings_count} embeddings, {duration_ms}ms)",
            extra={"sourceId": str(source_id), "chunkCount": real_chunk_count, "durationMs": duration_ms},
        )
        return real_chunk_count

    except Exception as e:
        # Log the full exception server-side without document contents or embeddings
        if isinstance(e, BulkWriteError):
            logger.error(
                f"Ingestion pipeline failed with BulkWriteError for source {source_id}: "
                f"{len(e.details.get('writeErrors', [])) if e.details else 0} write errors"
            )
            error_message = "Some chunks could not be saved (duplicate content)"
        else:
            logger.error(f"Ingestion pipeline failed for source {source_id}: {type(e).__name__}: {e}")
            error_message = str(e)

        stored_error = error_message[:500]

        # Clean up partial chunks created in this failed run
        await db.chunks.delete_many({
            "workspaceId": workspace_id,
            "sourceId": source_id,
            "ingestionId": ingestion_id,
        })

        # Mark source as FAILED
        now = datetime.now(timezone.utc)
        duration_ms = int((now - start_time).total_seconds() * 1000)

        await db.sources.update_one(
            {"_id": source_id, "workspaceId": workspace_id},
            {
                "$set": {
                    "status": "FAILED",
                    "embeddingStatus": "FAILED",
                    "indexingCompletedAt": now,
                    "indexingDurationMs": duration_ms,
                    "error": stored_error,
                    "updatedAt": now,
                }
            },
        )

        raise