import hashlib
import re
from typing import List, Optional
from pydantic import BaseModel

from app.ingestion.extractors.base import ExtractedDocument, ExtractedSection
from app.schemas.rag import ChunkMetadata


class RawChunk(BaseModel):
    chunk_index: int
    text: str
    content_hash: str
    metadata: ChunkMetadata


def estimate_tokens(text: str) -> int:
    """Rough approximation of token count (~4 chars per token)."""
    return max(1, len(text) // 4)


def split_text_preserving_code(text: str) -> List[str]:
    """
    Splits text by paragraphs while keeping markdown code blocks (```...```) intact.
    """
    # Regex to capture fenced code blocks
    pattern = re.compile(r"(```[\s\S]*?```)")
    parts = pattern.split(text)

    blocks: List[str] = []
    for part in parts:
        if not part:
            continue
        if part.startswith("```") and part.endswith("```"):
            blocks.append(part)
        else:
            # Split regular text by double newline
            paras = part.split("\n\n")
            for p in paras:
                p_clean = p.strip()
                if p_clean:
                    blocks.append(p_clean)

    return blocks


def chunk_document(
    doc: ExtractedDocument,
    url: Optional[str] = None,
    source_type: Optional[str] = None,
    target_tokens: int = 600,
    overlap_tokens: int = 80,
) -> List[RawChunk]:
    """
    Recursively chunks an ExtractedDocument into overlapping chunks of ~500-800 tokens.
    Guarantees:
    - Never splits inside code blocks
    - Preserves heading path in metadata
    - Deduplicates chunks within a source via contentHash
    - Discards near-empty or trivial chunks
    """
    chunks: List[RawChunk] = []
    seen_hashes: set[str] = set()
    chunk_index = 0

    doc_title = doc.title or "Document"
    st = source_type or doc.source_type

    max_chars = target_tokens * 4
    overlap_chars = overlap_tokens * 4

    for section in doc.sections:
        heading_path = doc_title
        if section.heading and section.heading != doc_title:
            heading_path = f"{doc_title} > {section.heading}"

        blocks = split_text_preserving_code(section.text)
        current_chunk_parts: List[str] = []
        current_length = 0

        for block in blocks:
            block_len = len(block)

            # If adding this block exceeds max size and we already have content
            if current_length + block_len > max_chars and current_chunk_parts:
                chunk_text = "\n\n".join(current_chunk_parts).strip()
                c_hash = hashlib.sha256(chunk_text.encode("utf-8")).hexdigest()

                if len(chunk_text) >= 20 and c_hash not in seen_hashes:
                    seen_hashes.add(c_hash)
                    meta = ChunkMetadata(
                        url=url,
                        title=doc.title,
                        heading=heading_path,
                        page=section.page,
                        sourceType=st,
                    )
                    chunks.append(
                        RawChunk(
                            chunk_index=chunk_index,
                            text=chunk_text,
                            content_hash=c_hash,
                            metadata=meta,
                        )
                    )
                    chunk_index += 1

                # Calculate overlap: take end of previous chunk
                overlap_text = chunk_text[-overlap_chars:] if len(chunk_text) > overlap_chars else ""
                current_chunk_parts = [overlap_text] if overlap_text else []
                current_length = len(overlap_text)

            current_chunk_parts.append(block)
            current_length += block_len

        # Final remaining part in section
        if current_chunk_parts:
            chunk_text = "\n\n".join(current_chunk_parts).strip()
            # Drop near empty chunks
            clean_test = re.sub(r"[\s\W_]+", "", chunk_text)
            if len(clean_test) >= 15:
                c_hash = hashlib.sha256(chunk_text.encode("utf-8")).hexdigest()
                if c_hash not in seen_hashes:
                    seen_hashes.add(c_hash)
                    meta = ChunkMetadata(
                        url=url,
                        title=doc.title,
                        heading=heading_path,
                        page=section.page,
                        sourceType=st,
                    )
                    chunks.append(
                        RawChunk(
                            chunk_index=chunk_index,
                            text=chunk_text,
                            content_hash=c_hash,
                            metadata=meta,
                        )
                    )
                    chunk_index += 1

    return chunks

