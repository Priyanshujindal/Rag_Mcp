import io
import docx
from app.ingestion.extractors.base import ExtractedDocument, ExtractedSection


def extract_docx(content: bytes, filename: str = "") -> ExtractedDocument:
    """Extracts structured text and headings from DOCX bytes using python-docx."""
    try:
        doc = docx.Document(io.BytesIO(content))
    except Exception as e:
        raise ValueError(f"Failed to parse DOCX document: {e}")

    sections = []
    current_heading = "Introduction"
    current_lines = []
    title = None

    for para in doc.paragraphs:
        text = para.text.strip()
        if not text:
            continue

        style_name = para.style.name if para.style else ""
        if style_name.startswith("Title"):
            title = text
            continue

        if style_name.startswith("Heading"):
            if current_lines:
                sections.append(
                    ExtractedSection(
                        text="\n".join(current_lines),
                        heading=current_heading,
                    )
                )
                current_lines = []
            current_heading = text
        else:
            current_lines.append(text)

    # Process tables if any
    for table in doc.tables:
        table_rows = []
        for row in table.rows:
            row_cells = [cell.text.strip() for cell in row.cells if cell.text.strip()]
            if row_cells:
                table_rows.append(" | ".join(row_cells))
        if table_rows:
            current_lines.append("\n" + "\n".join(table_rows))

    if current_lines:
        sections.append(
            ExtractedSection(
                text="\n".join(current_lines),
                heading=current_heading,
            )
        )

    if not sections:
        raise ValueError("DOCX document contains no extractable text.")

    return ExtractedDocument(
        title=title or filename or "Untitled Document",
        source_type="DOCX",
        sections=sections,
    )

