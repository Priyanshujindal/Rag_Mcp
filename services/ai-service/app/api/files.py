"""
app/api/files.py
================
File generation API endpoint.
Produces valid PDF, DOCX, PPTX, XLSX, CSV, and code/text files deterministically.
"""

from __future__ import annotations

import base64
import re
from typing import Dict, Any, Optional
from fastapi import APIRouter, Depends, HTTPException, status

from app.core.tenant import verify_internal_key
from app.schemas.files import GenerateFileRequest, GenerateFileResponse
from app.services.file_generator import FileGenerator

router = APIRouter(prefix="/files", tags=["File Generation"])

MIME_TYPES: Dict[str, str] = {
    "pdf": "application/pdf",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "csv": "text/csv",
    "txt": "text/plain",
    "md": "text/markdown",
    "py": "text/x-python",
    "js": "text/javascript",
    "jsx": "text/javascript",
    "ts": "text/typescript",
    "tsx": "text/typescript",
    "html": "text/html",
    "css": "text/css",
    "json": "application/json",
    "yaml": "text/yaml",
    "yml": "text/yaml",
    "sql": "application/sql",
    "java": "text/x-java-source",
    "cpp": "text/x-c",
    "c": "text/x-c",
    "go": "text/x-go",
    "rs": "text/x-rust",
    "sh": "application/x-sh",
}


def sanitize_filename(name: str, ext: str) -> str:
    """Sanitizes filename and ensures extension matches."""
    if not name:
        name = f"generated_file.{ext}"
    clean = re.sub(r'[\\/*?:"<>|]', "", name).strip()
    if not clean:
        clean = f"document.{ext}"
    if not clean.lower().endswith(f".{ext.lower()}"):
        clean = f"{clean}.{ext}"
    return clean


@router.post(
    "/generate",
    response_model=GenerateFileResponse,
    summary="Generate a downloadable document or code file",
)
async def generate_file(
    payload: GenerateFileRequest,
    _key: str = Depends(verify_internal_key),
) -> GenerateFileResponse:
    file_type = payload.file_type.lower().lstrip(".")
    title = payload.title or "Generated Document"
    filename = sanitize_filename(payload.filename or title.lower().replace(" ", "_"), file_type)
    mime_type = MIME_TYPES.get(file_type, "application/octet-stream")

    preview_data: Dict[str, Any] = {
        "fileType": file_type,
        "title": title,
    }

    try:
        if file_type == "pdf":
            content_text = payload.content or f"# {title}\n\nNo content provided."
            raw_bytes = FileGenerator.generate_pdf(title=title, content=content_text)
            preview_data["text"] = content_text[:2000]

        elif file_type == "docx":
            content_text = payload.content or f"# {title}\n\nNo content provided."
            raw_bytes = FileGenerator.generate_docx(title=title, content=content_text)
            preview_data["text"] = content_text[:2000]

        elif file_type == "pptx":
            slides_data = []
            if payload.slides:
                slides_data = [s.model_dump() for s in payload.slides]
            elif payload.content:
                # Parse markdown headings into slides if slides not explicitly provided
                current_slide = None
                for line in payload.content.split("\n"):
                    sline = line.strip()
                    if sline.startswith("# ") or sline.startswith("## "):
                        if current_slide:
                            slides_data.append(current_slide)
                        current_slide = {"title": sline.lstrip("# ").strip(), "points": []}
                    elif current_slide and (sline.startswith("- ") or sline.startswith("* ")):
                        current_slide["points"].append(sline[2:].strip())
                    elif current_slide and sline:
                        current_slide["points"].append(sline)
                if current_slide:
                    slides_data.append(current_slide)

            if not slides_data:
                slides_data = [{"title": title, "points": ["Overview", "Key Findings", "Summary"]}]

            raw_bytes = FileGenerator.generate_pptx(title=title, slides_data=slides_data)
            preview_data["slides"] = slides_data

        elif file_type == "xlsx":
            headers = payload.headers or ["Column 1", "Column 2"]
            rows = payload.rows or []
            sheet_name = payload.sheet_name or "Data"
            raw_bytes = FileGenerator.generate_xlsx(sheet_name=sheet_name, headers=headers, rows=rows, title=title)
            preview_data["headers"] = headers
            preview_data["rows"] = rows[:50]  # preview first 50 rows

        elif file_type == "csv":
            headers = payload.headers or []
            rows = payload.rows or []
            # Fallback if content was raw CSV text
            if not headers and not rows and payload.content:
                raw_bytes = FileGenerator.generate_code_or_text(payload.content)
                lines = [l.split(",") for l in payload.content.strip().split("\n")]
                if lines:
                    preview_data["headers"] = lines[0]
                    preview_data["rows"] = lines[1:50]
            else:
                raw_bytes = FileGenerator.generate_csv(headers=headers, rows=rows)
                preview_data["headers"] = headers
                preview_data["rows"] = rows[:50]

        else:
            # Code / Text / Config files
            content_text = payload.content or ""
            raw_bytes = FileGenerator.generate_code_or_text(content_text)
            preview_data["code"] = content_text
            preview_data["language"] = payload.language or file_type

    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"code": "FILE_GENERATION_FAILED", "message": f"Failed to generate {file_type} file: {str(e)}"},
        )

    b64_content = base64.b64encode(raw_bytes).decode("utf-8")

    return GenerateFileResponse(
        filename=filename,
        file_type=file_type,
        mime_type=mime_type,
        size_bytes=len(raw_bytes),
        content_base64=b64_content,
        preview_data=preview_data,
    )

