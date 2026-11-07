import io
import pytest
import pymupdf

from app.ingestion.extractors import (
    detect_file_type_by_content,
    extract_csv,
    extract_document,
    extract_html,
    extract_pdf,
    extract_txt,
)


def create_minimal_pdf(pages_text: list[str]) -> bytes:
    """Helper to generate an in-memory PDF using PyMuPDF."""
    doc = pymupdf.open()
    for text in pages_text:
        page = doc.new_page()
        page.insert_text((50, 50), text)
    buf = io.BytesIO()
    doc.save(buf)
    doc.close()
    return buf.getvalue()


def test_pdf_extractor_preserves_pages():
    """Verify PDF extraction extracts page numbers and text."""
    pdf_bytes = create_minimal_pdf(["First page content", "Second page content"])
    doc = extract_pdf(pdf_bytes, filename="test.pdf")

    assert doc.source_type == "PDF"
    assert len(doc.sections) == 2
    assert doc.sections[0].page == 1
    assert "First page content" in doc.sections[0].text
    assert doc.sections[1].page == 2
    assert "Second page content" in doc.sections[1].text


def test_html_extractor_cleans_boilerplate():
    """Verify HTML extraction strips nav, footer, script, and extracts headings."""
    html_content = b"""
    <!DOCTYPE html>
    <html>
      <head>
        <title>Product Documentation</title>
        <script>alert("malicious script");</script>
        <style>body { color: red; }</style>
      </head>
      <body>
        <nav><a href="/home">Home Menu</a></nav>
        <header>Site Header Banner</header>
        <main>
          <h1>Getting Started</h1>
          <p>Welcome to our platform guide.</p>
          <h2>Configuration</h2>
          <p>Here is how to configure settings.</p>
        </main>
        <footer>Copyright 2026 Company</footer>
      </body>
    </html>
    """
    doc = extract_html(html_content, base_url="https://example.com/docs")
    assert doc.source_type == "HTML"
    assert doc.title == "Product Documentation"

    full_extracted = " ".join(s.text for s in doc.sections)
    # Nav, footer, script should be stripped
    assert "malicious script" not in full_extracted
    assert "Home Menu" not in full_extracted
    assert "Copyright 2026" not in full_extracted

    # Content and headings should be preserved
    assert "Welcome to our platform guide." in full_extracted
    assert any("Configuration" in s.heading for s in doc.sections)


def test_csv_extractor_adds_header_context():
    """Verify CSV rows include column header context per row."""
    csv_bytes = b"Name,Role,Department\nAlice,Engineer,Platform\nBob,Designer,UI\n"
    doc = extract_csv(csv_bytes, filename="team.csv")

    assert doc.source_type == "CSV"
    assert len(doc.sections) >= 1
    first_section = doc.sections[0].text
    assert "Name: Alice" in first_section
    assert "Role: Engineer" in first_section
    assert "Department: Platform" in first_section


def test_txt_extractor_plain_and_markdown():
    """Verify plain text and markdown extraction."""
    txt_bytes = b"# Overview\nIntroduction paragraph.\n\n# Details\nDetailed section."
    doc = extract_txt(txt_bytes, filename="notes.md")

    assert doc.source_type == "TXT"
    assert doc.title == "Overview"
    assert len(doc.sections) == 2
    assert doc.sections[0].heading == "Overview"
    assert doc.sections[1].heading == "Details"


def test_content_type_detection_magic_bytes():
    """Verify detection based on content inspection, not just filename."""
    pdf_bytes = b"%PDF-1.4 header and content"
    assert detect_file_type_by_content(pdf_bytes, filename="fake.txt") == "PDF"

    html_bytes = b"<!DOCTYPE html><html><body><h1>Hello</h1></body></html>"
    assert detect_file_type_by_content(html_bytes, filename="fake.pdf") == "HTML"


def test_max_file_size_enforcement():
    """Verify extract_document rejects files exceeding MAX_FILE_MB."""
    oversized = b"A" * (2 * 1024 * 1024)  # 2 MB
    with pytest.raises(ValueError) as exc:
        extract_document(oversized, filename="large.txt", max_file_mb=1)
    assert "exceeds maximum permitted limit" in str(exc.value)
