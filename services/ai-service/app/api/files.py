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
from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Request, status

from app.core.logging import logger
from app.core.tenant import require_workspace_id, verify_internal_key
from app.llm.router import get_llm_provider
from app.rag.prompt_builder import ChatMessage
from app.schemas.deck import DeckRequest
from app.schemas.files import GenerateFileRequest, GenerateFileResponse
from app.services.deck_planner import DeckPlanningError, plan_deck
from app.services.deck_themes import theme_to_dict
from app.services.file_generator import FileGenerator
from app.services.image_generator import ImageGenerator
from app.services.pptx_builder import build_pptx, expand_deck, legacy_slides, resolve_theme

router = APIRouter(prefix="/files", tags=["File Generation"])

MIME_TYPES: Dict[str, str] = {
    "pdf": "application/pdf",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "csv": "text/csv",
    "txt": "text/plain",
    "md": "text/markdown",
    "png": "image/png",
    "webp": "image/webp",
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
    "image": "image/webp",
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

        elif file_type == "md":
            content_text = payload.content or f"# {title}\n\nNo content provided."
            raw_bytes = FileGenerator.generate_markdown(title=title, content=content_text)
            clean_md = raw_bytes.decode("utf-8", errors="replace")
            preview_data["text"] = clean_md[:2000]
            preview_data["code"] = clean_md
            preview_data["language"] = "markdown"

        elif file_type in ("image", "png", "webp", "jpg", "jpeg"):
            prompt = payload.content or title
            raw_bytes, img_mime, img_meta = await ImageGenerator.generate_image(
                prompt=prompt,
                output_format="webp" if file_type in ("image", "webp") else "png",
            )
            mime_type = img_mime
            ext = "webp" if "webp" in img_mime else "png" if "png" in img_mime else "jpg" if "jpeg" in img_mime else "svg"
            filename = sanitize_filename(filename.rsplit(".", 1)[0], ext)
            preview_data["imageUrl"] = f"data:{img_mime};base64,{base64.b64encode(raw_bytes).decode('ascii')}"
            preview_data["prompt"] = prompt
            preview_data.update(img_meta)

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



# ---------------------------------------------------------------------------
# Presentations: plan (LLM) -> validate -> render a designed .pptx
# ---------------------------------------------------------------------------
_PLANNER_MAX_TOKENS = 8192


async def _knowledge_base_material(request: Request, key: str, ws_id: ObjectId, payload: DeckRequest) -> str:
    """Passages from the knowledge base that relate to the request. Never raises: no grounding is acceptable."""
    if not payload.knowledge_base_id:
        return ""
    try:
        from app.api.query import _get_retriever  # local import avoids a circular import at startup

        retriever = _get_retriever(request, key, ws_id)
        result = await retriever.retrieve(
            workspace_id=ws_id,
            kb_id=ObjectId(payload.knowledge_base_id),
            query=payload.request,
            top_n=30,
            top_k=10,
            source_ids=[ObjectId(s) for s in payload.source_ids] if payload.source_ids else None,
        )
        parts = []
        used = 0
        for index, chunk in enumerate(result.results, start=1):
            title = chunk.metadata.get("title") or chunk.metadata.get("url") or f"Source {index}"
            text = " ".join(chunk.text.split())
            piece = f"[{index}] {title}\n{text}"
            if used + len(piece) > 9000:
                break
            parts.append(piece)
            used += len(piece)
        return "\n\n".join(parts)
    except Exception as exc:
        logger.warning("Knowledge base lookup for the deck failed; continuing without it", extra={"detail": str(exc)[:200]})
        return ""


@router.post(
    "/deck",
    response_model=GenerateFileResponse,
    summary="Plan and generate a designed PowerPoint presentation",
    description=(
        "Plans a slide deck with the LLM (optionally grounded in the given source text and knowledge base), "
        "validates it, and renders a native, editable .pptx with themes, layouts, charts, tables and speaker notes."
    ),
)
async def generate_deck(
    payload: DeckRequest,
    request: Request,
    _key: str = Depends(verify_internal_key),
    ws_id: ObjectId = Depends(require_workspace_id),
) -> GenerateFileResponse:
    material_parts = []
    if payload.source_text and payload.source_text.strip():
        material_parts.append(payload.source_text.strip())
    kb_material = await _knowledge_base_material(request, _key, ws_id, payload)
    if kb_material:
        material_parts.append("Passages from the knowledge base:\n" + kb_material)
    material = "\n\n".join(material_parts)

    model_name = payload.model or "gemini-3.8-flash"

    async def call_llm(system_prompt: str, user_prompt: str) -> str:
        provider = get_llm_provider(model=model_name, provider=payload.provider)
        text = ""
        async for chunk in provider.stream_chat(
            messages=[ChatMessage(role="user", content=user_prompt)],
            system_prompt=system_prompt,
            model=model_name,
            temperature=0.5,
            max_tokens=_PLANNER_MAX_TOKENS,
        ):
            if chunk.delta:
                text += chunk.delta
        return text

    try:
        plan = await plan_deck(payload, material, call_llm, grounded=bool(kb_material), model=model_name)
    except DeckPlanningError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail={"code": "DECK_PLANNING_FAILED", "message": str(exc)},
        )

    deck = plan.deck
    theme = resolve_theme(deck, text_hint=f"{payload.request} {deck.title}")
    try:
        raw_bytes = build_pptx(deck, theme=theme)
    except Exception as exc:
        logger.exception("PPTX rendering failed")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"code": "FILE_GENERATION_FAILED", "message": f"Failed to render the presentation: {str(exc)[:200]}"},
        )

    base_name = payload.filename or re.sub(r"\s+", "_", deck.title.strip())[:60] or "presentation"
    filename = sanitize_filename(base_name, "pptx")
    preview_data: Dict[str, Any] = {
        "fileType": "pptx",
        "title": deck.title,
        "slides": legacy_slides(deck),
        # exactly the slides in the file (same order and count), so the web preview lines up 1:1
        "deck": expand_deck(deck).model_dump(exclude_none=True),
        "theme": theme_to_dict(theme),
        "slideCount": len(legacy_slides(deck)),
        "planner": plan.planner,
        "grounded": plan.grounded,
    }
    return GenerateFileResponse(
        filename=filename,
        file_type="pptx",
        mime_type=MIME_TYPES["pptx"],
        size_bytes=len(raw_bytes),
        content_base64=base64.b64encode(raw_bytes).decode("utf-8"),
        preview_data=preview_data,
    )
