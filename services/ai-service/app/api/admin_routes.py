"""
Admin endpoint to backfill metadata for legacy sources.
Add to app/api/routes.py or create a new admin routes file.
"""

from fastapi import APIRouter, Depends
from datetime import datetime, timezone
from app.db.connection import get_database
from app.core.logging import logger

router = APIRouter(prefix="/admin", tags=["admin"])


@router.post("/backfill-metadata")
async def backfill_source_metadata(db=Depends(get_database)):
    """
    Backfill metadata for sources that were indexed before metadata fields were added.
    
    This endpoint:
    1. Finds all INDEXED sources missing embeddingStatus or extractedTextPreview
    2. Analyzes their chunks to determine embedding status
    3. Generates text preview from chunk content
    4. Updates the source documents with calculated metadata
    """
    
    logger.info("Starting metadata backfill process")
    
    # Find sources needing backfill
    sources = await db.sources.find({
        "status": "INDEXED",
        "$or": [
            {"embeddingStatus": None},
            {"embeddingStatus": {"$exists": False}},
            {"extractedTextPreview": None},
            {"extractedTextPreview": {"$exists": False}},
        ]
    }).to_list(length=None)
    
    if not sources:
        return {"message": "No sources need backfilling", "updated": 0}
    
    updated_count = 0
    results = []
    
    for source in sources:
        source_id = source["_id"]
        
        # Get chunks for this source
        chunks = await db.chunks.find({"sourceId": source_id}).limit(50).to_list(length=50)
        
        if not chunks:
            logger.warning(f"Source {source_id} has no chunks, skipping")
            continue
        
        # Build text preview from chunks
        chunk_texts = [c.get("text", "") for c in chunks[:20] if c.get("text")]
        preview_text = "\n\n".join(chunk_texts)[:5000]
        
        # Calculate character count estimate
        sample_chars = sum(len(c.get("text", "")) for c in chunks)
        total_chunk_count = await db.chunks.count_documents({"sourceId": source_id})
        estimated_chars = int(sample_chars * (total_chunk_count / len(chunks)))
        
        # Check embedding status
        has_embeddings = all(c.get("embedding") is not None for c in chunks)
        embedding_status = "COMPLETED" if has_embeddings else "PENDING"
        embeddings_count = total_chunk_count if has_embeddings else 0
        
        # Update source
        await db.sources.update_one(
            {"_id": source_id},
            {
                "$set": {
                    "embeddingStatus": embedding_status,
                    "embeddingsGenerated": embeddings_count,
                    "extractedTextPreview": preview_text,
                    "extractedCharCount": estimated_chars,
                    "chunkCount": total_chunk_count,
                    "updatedAt": datetime.now(timezone.utc),
                }
            }
        )
        
        updated_count += 1
        results.append({
            "sourceId": str(source_id),
            "name": source.get("name"),
            "embeddingStatus": embedding_status,
            "chunks": total_chunk_count,
            "embeddings": embeddings_count,
        })
        
        logger.info(f"Backfilled metadata for source {source_id}: {embedding_status}, {total_chunk_count} chunks")
    
    return {
        "message": f"Successfully backfilled {updated_count} sources",
        "updated": updated_count,
        "sources": results
    }
