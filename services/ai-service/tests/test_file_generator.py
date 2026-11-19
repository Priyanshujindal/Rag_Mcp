"""
Unit tests for deterministic FileGenerator and generate_file endpoint.
"""

import base64
import pytest
from app.services.file_generator import FileGenerator
from app.api.files import sanitize_filename
from app.schemas.files import GenerateFileRequest, SlideItem


def test_sanitize_filename():
    assert sanitize_filename("my report", "pdf") == "my report.pdf"
    assert sanitize_filename("dirty/name*test?.docx", "docx") == "dirtynametest.docx"
    assert sanitize_filename("", "xlsx") == "generated_file.xlsx"


def test_pdf_generation():
    content = "# Chapter 1\n\nThis is a test paragraph.\n\n- Bullet 1\n- Bullet 2\n\n```python\nprint('hello')\n```"
    pdf_bytes = FileGenerator.generate_pdf("My PDF Title", content)
    assert isinstance(pdf_bytes, bytes)
    assert len(pdf_bytes) > 0
    assert pdf_bytes.startswith(b"%PDF")


def test_docx_generation():
    content = "# Introduction\n\nThis is word document content.\n- Key finding 1\n- Key finding 2"
    docx_bytes = FileGenerator.generate_docx("My Doc Title", content)
    assert isinstance(docx_bytes, bytes)
    assert len(docx_bytes) > 0
    assert docx_bytes.startswith(b"PK\x03\x04")


def test_pptx_generation():
    slides = [
        {"title": "Slide 1: Intro", "points": ["First point", "Second point"]},
        {"title": "Slide 2: Analysis", "points": ["Deep dive", "Metrics"]},
    ]
    pptx_bytes = FileGenerator.generate_pptx("AI Presentation", slides)
    assert isinstance(pptx_bytes, bytes)
    assert len(pptx_bytes) > 0
    assert pptx_bytes.startswith(b"PK\x03\x04")


def test_xlsx_generation():
    headers = ["ID", "Name", "Revenue", "Margin %"]
    rows = [
        [1, "Product A", 15000, 0.35],
        [2, "Product B", 24000, 0.42],
        [3, "Product C", 9800, 0.28],
    ]
    xlsx_bytes = FileGenerator.generate_xlsx("Financials", headers, rows, title="Q3 Performance")
    assert isinstance(xlsx_bytes, bytes)
    assert len(xlsx_bytes) > 0
    assert xlsx_bytes.startswith(b"PK\x03\x04")


def test_csv_generation():
    headers = ["City", "Population"]
    rows = [["New York", 8400000], ["Los Angeles", 3900000]]
    csv_bytes = FileGenerator.generate_csv(headers, rows)
    assert isinstance(csv_bytes, bytes)
    text = csv_bytes.decode("utf-8")
    assert "City,Population" in text
    assert "New York,8400000" in text


def test_code_generation():
    code = "def factorial(n):\n    return 1 if n <= 1 else n * factorial(n - 1)\n"
    code_bytes = FileGenerator.generate_code_or_text(code)
    assert isinstance(code_bytes, bytes)
    assert code_bytes.decode("utf-8") == code


# ---------------------------------------------------------------------------
# Direct FileGenerator tests that mirror the endpoint behaviour
# (These do NOT start any FastAPI lifespan or async event loop)
# ---------------------------------------------------------------------------

def test_endpoint_generate_pdf():
    """Mirrors POST /files/generate for pdf."""
    req = GenerateFileRequest(
        file_type="pdf",
        title="Doc Report",
        content="# Overview\nThis is a sample document.",
    )
    file_bytes = FileGenerator.generate_pdf(req.title or "Document", req.content or "")
    result_b64 = base64.b64encode(file_bytes).decode()
    assert len(result_b64) > 0
    assert file_bytes.startswith(b"%PDF")
    assert len(file_bytes) > 0


def test_endpoint_generate_pptx():
    """Mirrors POST /files/generate for pptx."""
    slides_data = [
        SlideItem(title="Welcome", points=["Point 1", "Point 2"]),
        SlideItem(title="Summary", points=["Revenue up", "All targets met"]),
    ]
    req = GenerateFileRequest(
        file_type="pptx",
        title="Q3 Review",
        slides=slides_data,
    )
    slides_dicts = [s.model_dump() for s in req.slides]
    file_bytes = FileGenerator.generate_pptx(req.title or "Presentation", slides_dicts)
    assert file_bytes.startswith(b"PK\x03\x04")
    assert len(slides_dicts) == 2


def test_endpoint_generate_xlsx():
    """Mirrors POST /files/generate for xlsx."""
    req = GenerateFileRequest(
        file_type="xlsx",
        title="Financials",
        headers=["Month", "Income"],
        rows=[["January", 5000], ["February", 5500]],
    )
    file_bytes = FileGenerator.generate_xlsx(
        req.title or "Sheet",
        req.headers or [],
        req.rows or [],
    )
    assert file_bytes.startswith(b"PK\x03\x04")
    assert len(file_bytes) > 0


def test_endpoint_generate_code():
    """Mirrors POST /files/generate for py."""
    req = GenerateFileRequest(
        file_type="py",
        title="BinarySearch",
        content="def search(arr, target): return 0",
        language="python",
    )
    file_bytes = FileGenerator.generate_code_or_text(req.content or "")
    decoded = file_bytes.decode("utf-8")
    assert "search(arr" in decoded
    assert sanitize_filename(req.title or "", "py").endswith(".py")


if __name__ == "__main__":
    print("Testing sanitize...", flush=True)
    test_sanitize_filename()
    print("Testing PDF...", flush=True)
    test_pdf_generation()
    print("Testing DOCX...", flush=True)
    test_docx_generation()
    print("Testing PPTX...", flush=True)
    test_pptx_generation()
    print("Testing XLSX...", flush=True)
    test_xlsx_generation()
    print("Testing CSV...", flush=True)
    test_csv_generation()
    print("Testing Code...", flush=True)
    test_code_generation()
    print("Testing Endpoint PDF...", flush=True)
    test_endpoint_generate_pdf()
    print("Testing Endpoint PPTX...", flush=True)
    test_endpoint_generate_pptx()
    print("Testing Endpoint XLSX...", flush=True)
    test_endpoint_generate_xlsx()
    print("Testing Endpoint Code...", flush=True)
    test_endpoint_generate_code()
    print("ALL 11 UNIT AND ENDPOINT TESTS PASSED SUCCESSFULLY!", flush=True)

