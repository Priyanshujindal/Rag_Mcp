"""
Script to backfill metadata for sources that were indexed before metadata fields were added.

This script:
1. Finds all sources with status=INDEXED but missing metadata fields
2. For each source, calculates metadata from existing chunks
3. Updates the source document with the backfilled metadata

Run with: python scripts/backfill_source_metadata.py
"""

import asyncio
from datetime import datetime, timezone
from bson import ObjectId
from pymongo import MongoClient
import os
from dotenv import load_dotenv

load_dotenv()

MONGO_URI = os.getenv("MONGO_URI", "mongodb://localhost:27017")
DATABASE_NAME = os.getenv("MONGO_DATABASE", "Rag_Mcp")


async def backfill_source_metadata():
    """Backfill metadata for sources that were indexed before metadata fields were added."""
    
    client = MongoClient(MONGO_URI)
    db = client[DATABASE_NAME]
    
    # Find all INDEXED sources missing metadata
    sources_to_backfill = list(db.sources.find({
        "status": "INDEXED",
        "$or": [
            {"embeddingStatus": {"$exists": False}},
            {"embeddingStatus": None},
            {"extractedTextPreview": {"$exists": False}},
            {"extractedTextPreview": None},
        ]
    }))
    
    print(f"Found {len(sources_to_backfill)} sources to backfill")
    
    for source in sources_to_backfill:
        source_id = source["_id"]
        print(f"\nProcessing source {source_id} ({source.get('name', 'Unnamed')})")
        
        # Get chunks for this source
        chunks = list(db.chunks.find({"sourceId": source_id}).limit(100))
        
        if not chunks:
            print(f"  Warning: No chunks found for source {source_id}")
            continue
        
        # Build extracted text preview from first few chunks
        chunk_texts = [chunk.get("text", "") for chunk in chunks[:20]]
        extracted_preview = "\n\n".join(chunk_texts)[:5000]
        total_chars = sum(len(chunk.get("text", "")) for chunk in chunks)
        
        # Check if chunks have embeddings
        has_embeddings = all("embedding" in chunk and chunk["embedding"] for chunk in chunks)
        embeddings_count = len(chunks) if has_embeddings else 0
        
        # Determine embedding status
        if has_embeddings:
            embedding_status = "COMPLETED"
        else:
            embedding_status = "PENDING"
        
        # Get actual chunk count from database
        actual_chunk_count = db.chunks.count_documents({"sourceId": source_id})
        
        # Update source with backfilled metadata
        update_fields = {
            "embeddingStatus": embedding_status,
            "embeddingsGenerated": embeddings_count,
            "extractedTextPreview": extracted_preview,
            "extractedCharCount": total_chars,
            "chunkCount": actual_chunk_count,
            "updatedAt": datetime.now(timezone.utc),
        }
        
        # Only set timestamps if they don't exist
        if not source.get("lastIndexedAt"):
            update_fields["lastIndexedAt"] = source.get("updatedAt") or datetime.now(timezone.utc)
        
        # Don't set indexingDurationMs or start/complete times for backfilled sources
        # since we don't have accurate timing data
        
        result = db.sources.update_one(
            {"_id": source_id},
            {"$set": update_fields}
        )
        
        print(f"  Updated source {source_id}")
        print(f"     - Embedding Status: {embedding_status}")
        print(f"     - Embeddings: {embeddings_count}/{actual_chunk_count}")
        print(f"     - Text Preview: {len(extracted_preview)} chars (of {total_chars} total)")
        print(f"     - Chunks: {actual_chunk_count}")
    
    client.close()
    print(f"\nBackfill complete! Updated {len(sources_to_backfill)} sources")


if __name__ == "__main__":
    asyncio.run(backfill_source_metadata())
