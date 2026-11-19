from app.ingestion.extractors.base import ExtractedDocument, ExtractedSection


def extract_txt(content: bytes, filename: str = "") -> ExtractedDocument:
    """Extracts plain text or markdown content, splitting by headings if available."""
    try:
        text = content.decode("utf-8")
    except UnicodeDecodeError:
        text = content.decode("latin-1", errors="replace")

    lines = text.splitlines()
    sections = []
    current_heading = "Content"
    current_lines = []
    title = None

    for line in lines:
        stripped = line.strip()
        # Detect Markdown headings: # Heading
        if stripped.startswith("#"):
            parts = stripped.lstrip("#").strip()
            if parts:
                if not title:
                    title = parts

                if current_lines:
                    block = "\n".join(current_lines).strip()
                    if block:
                        sections.append(ExtractedSection(text=block, heading=current_heading))
                    current_lines = []
                current_heading = parts
                continue

        current_lines.append(line)

    if current_lines:
        block = "\n".join(current_lines).strip()
        if block:
            sections.append(ExtractedSection(text=block, heading=current_heading))

    if not sections:
        raise ValueError("Text document is empty.")

    return ExtractedDocument(
        title=title or filename or "Plain Text Document",
        source_type="TXT",
        sections=sections,
    )

