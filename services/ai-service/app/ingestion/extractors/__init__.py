from app.ingestion.extractors.base import (
    ExtractedDocument,
    ExtractedSection,
    detect_file_type_by_content,
)
from app.ingestion.extractors.csv import extract_csv
from app.ingestion.extractors.docx import extract_docx
from app.ingestion.extractors.html import extract_html
from app.ingestion.extractors.pdf import extract_pdf
from app.ingestion.extractors.txt import extract_txt


def extract_document(
    content: bytes,
    filename: str = "",
    max_file_mb: int = 10,
    url: str = "",
) -> ExtractedDocument:
    """
    Validates file size limit, detects content type using magic bytes,
    and extracts text with structural metadata.
    """
    if len(content) > max_file_mb * 1024 * 1024:
        raise ValueError(
            f"File size ({len(content) / (1024 * 1024):.2f} MB) exceeds maximum permitted limit of {max_file_mb} MB"
        )

    file_type = detect_file_type_by_content(content, filename=filename)

    if file_type == "PDF":
        return extract_pdf(content, filename=filename)
    elif file_type == "DOCX":
        return extract_docx(content, filename=filename)
    elif file_type == "HTML":
        return extract_html(content, filename=filename, base_url=url)
    elif file_type == "CSV":
        return extract_csv(content, filename=filename)
    elif file_type == "TXT":
        return extract_txt(content, filename=filename)
    else:
        raise ValueError(f"Unsupported file format: {file_type}")


__all__ = [
    "ExtractedDocument",
    "ExtractedSection",
    "detect_file_type_by_content",
    "extract_document",
    "extract_csv",
    "extract_docx",
    "extract_html",
    "extract_pdf",
    "extract_txt",
]

