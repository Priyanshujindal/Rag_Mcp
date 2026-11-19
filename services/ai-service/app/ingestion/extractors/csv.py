import csv
import io
from app.ingestion.extractors.base import ExtractedDocument, ExtractedSection


def extract_csv(content: bytes, filename: str = "") -> ExtractedDocument:
    """Extracts CSV records formatted with column header context per row."""
    try:
        text_data = content.decode("utf-8", errors="replace")
    except Exception as e:
        raise ValueError(f"Failed to decode CSV content: {e}")

    stream = io.StringIO(text_data)
    reader = csv.reader(stream)

    try:
        header = next(reader, None)
    except Exception as e:
        raise ValueError(f"CSV read error: {e}")

    if not header:
        raise ValueError("CSV document is empty or missing headers.")

    cleaned_headers = [h.strip() or f"Column_{i+1}" for i, h in enumerate(header)]
    sections = []
    rows_per_section = 10
    current_rows = []
    row_count = 0

    for row in reader:
        if not any(cell.strip() for cell in row):
            continue
        row_count += 1
        # Build contextual string: Col1: Val1 | Col2: Val2
        row_parts = []
        for i, val in enumerate(row):
            h_name = cleaned_headers[i] if i < len(cleaned_headers) else f"Column_{i+1}"
            v_str = val.strip()
            if v_str:
                row_parts.append(f"{h_name}: {v_str}")

        if row_parts:
            current_rows.append(f"Record {row_count}: " + " | ".join(row_parts))

        if len(current_rows) >= rows_per_section:
            sections.append(
                ExtractedSection(
                    text="\n".join(current_rows),
                    heading=f"Rows {row_count - len(current_rows) + 1}-{row_count}",
                )
            )
            current_rows = []

    if current_rows:
        sections.append(
            ExtractedSection(
                text="\n".join(current_rows),
                heading=f"Rows {row_count - len(current_rows) + 1}-{row_count}",
            )
        )

    if not sections:
        raise ValueError("CSV contains no data rows.")

    return ExtractedDocument(
        title=filename or "CSV Data Export",
        source_type="CSV",
        sections=sections,
    )

