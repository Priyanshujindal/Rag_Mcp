import io
import pymupdf
from app.ingestion.extractors.base import ExtractedDocument, ExtractedSection


def extract_pdf(content: bytes, filename: str = "") -> ExtractedDocument:
    """Extracts text page-by-page from PDF bytes using PyMuPDF."""
    if not content.startswith(b"%PDF-"):
        raise ValueError("Invalid PDF format: file missing %PDF- header")

    doc = pymupdf.open(stream=content, filetype="pdf")
    sections = []
    title = None

    # Try metadata title
    if doc.metadata and doc.metadata.get("title"):
        title = doc.metadata.get("title").strip()

    for page_idx in range(len(doc)):
        page = doc[page_idx]
        page_text = page.get_text("text").strip()
        if page_text:
            # If title wasn't in metadata and this is first page, take first line
            if not title:
                first_line = page_text.splitlines()[0].strip()
                if len(first_line) < 120:
                    title = first_line

            sections.append(
                ExtractedSection(
                    text=page_text,
                    page=page_idx + 1,
                    heading=f"Page {page_idx + 1}",
                )
            )

    doc.close()
    if not sections:
        raise ValueError("PDF document contains no extractable text.")

    return ExtractedDocument(
        title=title or filename or "Untitled PDF Document",
        source_type="PDF",
        sections=sections,
    )
