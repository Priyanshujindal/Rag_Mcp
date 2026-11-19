import pytest
from app.ingestion.chunking import chunk_document, split_text_preserving_code
from app.ingestion.extractors.base import ExtractedDocument, ExtractedSection


def test_split_preserves_code_blocks():
    """Verify that code blocks are kept intact and not split by paragraphs."""
    text = (
        "Here is some text before.\n\n"
        "```python\ndef calculate_total(items):\n    # Multi-line function\n    return sum(i.price for i in items)\n```\n\n"
        "Here is text after."
    )
    blocks = split_text_preserving_code(text)
    assert len(blocks) == 3
    assert blocks[0] == "Here is some text before."
    assert "def calculate_total" in blocks[1]
    assert blocks[1].startswith("```") and blocks[1].endswith("```")
    assert blocks[2] == "Here is text after."


def test_chunking_heading_path_and_deduplication():
    """Verify heading path is tracked and duplicate chunks within a source are eliminated."""
    doc = ExtractedDocument(
        title="API Reference",
        source_type="TXT",
        sections=[
            ExtractedSection(
                text="This is unique content about authentication credentials and tokens.",
                heading="Authentication",
            ),
            ExtractedSection(
                text="This is unique content about authentication credentials and tokens.",  # Exact duplicate
                heading="Authentication Duplicate",
            ),
            ExtractedSection(
                text="This is second unique section describing user endpoints and profiles in detail.",
                heading="Users",
            ),
        ],
    )

    chunks = chunk_document(doc)
    # The duplicate should be dropped by contentHash
    assert len(chunks) == 2
    assert "API Reference > Authentication" in chunks[0].metadata.heading
    assert "API Reference > Users" in chunks[1].metadata.heading
    assert chunks[0].content_hash != chunks[1].content_hash


def test_chunking_drops_near_empty_chunks():
    """Verify near-empty chunks with minimal characters or punctuation are discarded."""
    doc = ExtractedDocument(
        title="Empty Test",
        source_type="TXT",
        sections=[
            ExtractedSection(text="   \n\n  ...   ", heading="Trivial"),
            ExtractedSection(text="Valid substantial paragraph with meaningful documentation.", heading="Valid"),
        ],
    )
    chunks = chunk_document(doc)
    assert len(chunks) == 1
    assert "Valid substantial paragraph" in chunks[0].text

