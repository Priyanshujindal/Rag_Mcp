import io
import zipfile
from typing import List, Optional
from pydantic import BaseModel, Field


class ExtractedSection(BaseModel):
    """A semantic section or page extracted from a document."""
    text: str = Field(..., min_length=1)
    heading: Optional[str] = None
    page: Optional[int] = None


class ExtractedDocument(BaseModel):
    """Standardized representation of parsed document content."""
    title: Optional[str] = None
    source_type: str  # PDF, DOCX, TXT, CSV, HTML
    sections: List[ExtractedSection] = Field(default_factory=list)


def detect_file_type_by_content(content: bytes, filename: str = "") -> str:
    """
    Determines file type by verifying content / magic bytes, not only extension.
    Returns: 'PDF', 'DOCX', 'HTML', 'CSV', or 'TXT'.
    Raises ValueError if content does not match allowed types or is corrupt.
    """
    if not content:
        raise ValueError("File is empty (0 bytes).")

    # 1. PDF: Must begin with %PDF-
    if content.startswith(b"%PDF-"):
        return "PDF"

    # 2. DOCX: ZIP file containing word/document.xml
    if content.startswith(b"PK\x03\x04"):
        try:
            with zipfile.ZipFile(io.BytesIO(content)) as zf:
                namelist = zf.namelist()
                if any("word/document.xml" in name for name in namelist):
                    return "DOCX"
        except zipfile.BadZipFile:
            pass

    # 3. HTML: Contains HTML opening/closing tags or doctype
    lower_sample = content[:4096].lower()
    if (
        b"<!doctype html" in lower_sample
        or b"<html" in lower_sample
        or b"<head" in lower_sample
        or b"<body" in lower_sample
        or b"<div" in lower_sample
    ):
        return "HTML"

    # 4. Try decoding as UTF-8 text (CSV vs TXT)
    try:
        text_sample = content[:8192].decode("utf-8", errors="replace")
    except Exception:
        raise ValueError("Unsupported binary file format.")

    # 5. Check if CSV
    if filename.lower().endswith(".csv") or ("," in text_sample and "\n" in text_sample):
        lines = [line.strip() for line in text_sample.splitlines() if line.strip()]
        if len(lines) >= 2:
            first_commas = lines[0].count(",")
            second_commas = lines[1].count(",")
            if first_commas > 0 and first_commas == second_commas:
                return "CSV"

    return "TXT"

