"""
app/api/query.py
================
POST /retrieve -- hybrid RAG retrieval endpoint (Stage 4).
POST /chat     -- RAG conversation completion with SSE streaming (Stage 5).

Requires:
  X-Internal-Key   -- constant-time verified against INTERNAL_API_KEY
  X-Workspace-Id   -- 24-hex ObjectId of the calling workspace (from Node API)
"""

from __future__ import annotations

import base64
from typing import AsyncGenerator
from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import StreamingResponse

from app.core.config import get_settings
from app.core.logging import logger
from app.core.tenant import TenantContext, require_workspace_id, verify_internal_key
from app.rag.prompt_builder import PromptBuilder, estimate_token_count, ChatMessage
from app.rag.retriever import Retriever
from app.rag.vector_store import get_vector_store
from app.schemas.chat import ChatRequest, TitleRequest, TitleResponse, ParseDocumentRequest
from app.schemas.retrieval import RetrieveRequest, RetrieveResponse
from app.services.web_search import WebSearchService, calculate_web_score
from app.llm.router import get_llm_provider
from app.llm.streaming import StreamUsage, format_sse
from app.ingestion.extractors.pdf import extract_pdf
from app.ingestion.extractors.csv import extract_csv
from app.ingestion.extractors.txt import extract_txt

router = APIRouter(tags=["Retrieval & Chat"])


def _get_retriever(
    request: Request,
    _key: str = Depends(verify_internal_key),
    _ws: ObjectId = Depends(require_workspace_id),
) -> Retriever:
    """Dependency: build a Retriever from the app-level MongoClient singleton."""
    settings = get_settings()
    client = getattr(request.app.state, "mongo_client", None)
    if client is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={"code": "SERVICE_UNAVAILABLE", "message": "Database client not ready"},
        )
    store = get_vector_store(client=client, db_name=settings.MONGODB_DB_NAME)
    return Retriever(vector_store=store)


@router.post(
    "/retrieve",
    response_model=RetrieveResponse,
    summary="Hybrid RAG retrieval",
    description=(
        "Embeds the query, runs hybrid search (vector + BM25) over the "
        "specified knowledge base, optionally reranks results, and returns "
        "a full debug payload with scores and numbered citations."
    ),
)
async def retrieve(
    body: RetrieveRequest,
    _key: str = Depends(verify_internal_key),
    ws_id: ObjectId = Depends(require_workspace_id),
    retriever: Retriever = Depends(_get_retriever),
) -> RetrieveResponse:
    """POST /retrieve - tenant isolation strictly scoped by ws_id."""
    workspace_id = ws_id
    kb_id = ObjectId(body.knowledgeBaseId)
    source_ids = [ObjectId(s) for s in body.source_ids] if body.source_ids else None

    logger.info(
        "Retrieve request",
        extra={
            "workspaceId": str(workspace_id),
            "knowledgeBaseId": str(kb_id),
            "strategy": body.strategy,
            "top_n": body.top_n,
            "top_k": body.top_k,
        },
    )

    try:
        response = await retriever.retrieve(
            workspace_id=workspace_id,
            kb_id=kb_id,
            query=body.query,
            top_n=body.top_n,
            top_k=body.top_k,
            min_score_threshold=body.min_score_threshold,
            strategy=body.strategy,
            vector_weight=body.vector_weight,
            text_weight=body.text_weight,
            source_ids=source_ids,
        )
    except Exception as exc:
        logger.exception(f"Retrieval failed: {exc}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={
                "code": "RETRIEVAL_ERROR",
                "message": "Retrieval pipeline encountered an unexpected error",
            },
        )

    return response


@router.post(
    "/chat",
    summary="RAG streaming chat completion",
    description=(
        "Retrieves context passages, constructs a prompt with strict untrusted data boundaries, "
        "and streams tokens, citations, and usage via Server-Sent Events (SSE)."
    ),
)
async def chat(
    body: ChatRequest,
    request: Request,
    _key: str = Depends(verify_internal_key),
    ws_id: ObjectId = Depends(require_workspace_id),
    retriever: Retriever = Depends(_get_retriever),
) -> StreamingResponse:
    """POST /chat (SSE stream)."""
    workspace_id = ws_id
    is_general = (body.mode == "general") or (not body.knowledgeBaseId)
    kb_id = ObjectId(body.knowledgeBaseId) if (body.knowledgeBaseId and not is_general) else None
    source_ids = [ObjectId(s) for s in body.source_ids] if (body.source_ids and not is_general) else None

    logger.info(
        "Chat request received",
        extra={
            "workspaceId": str(workspace_id),
            "knowledgeBaseId": str(kb_id) if kb_id else "NONE_GENERAL",
            "mode": "general" if is_general else "rag",
            "model": body.model,
            "message_len": len(body.message),
        },
    )

    retrieval_res = None
    if not is_general and kb_id:
        # 1. Retrieve context for RAG mode
        try:
            retrieval_res = await retriever.retrieve(
                workspace_id=workspace_id,
                kb_id=kb_id,
                query=body.message,
                top_n=body.top_k * 3,
                top_k=body.top_k,
                min_score_threshold=body.min_score_threshold,
                strategy=body.strategy,
                vector_weight=body.vector_weight,
                text_weight=body.text_weight,
                source_ids=source_ids,
            )
        except Exception as exc:
            logger.exception(f"Retrieval error in chat: {exc}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail={"code": "RETRIEVAL_ERROR", "message": "Failed to retrieve context for chat"},
            )

    # 2. Live Web Search if enabled
    web_results = []
    if body.web_search:
        try:
            search_service = WebSearchService()
            web_results = await search_service.search(body.message, max_results=5)
            logger.info(
                f"Live web search found {len(web_results)} results for query: {body.message[:50]}",
                extra={"web_search": True, "results_count": len(web_results)},
            )
        except Exception as exc:
            logger.warning(f"Live web search failed: {exc}")

    # 3. Build prompt (general conversation vs RAG grounded, incorporating live web facts & ad-hoc files)
    attached_docs = []
    if body.attached_documents:
        attached_docs.extend([d for d in body.attached_documents if d and d.get("content")])
    elif body.attached_document and body.attached_document.get("content"):
        attached_docs.append(body.attached_document)

    prompt_builder = PromptBuilder()
    built = prompt_builder.build_chat_prompt(
        query=body.message,
        history=body.history,
        retrieved_chunks=retrieval_res.results if retrieval_res else [],
        web_search_results=web_results,
        attached_documents=attached_docs,
        is_thinking=body.is_thinking,
        custom_prompt=body.custom_prompt,
        is_general=is_general,
    )

    # 4. Select LLM provider
    try:
        provider = get_llm_provider(model=body.model, provider=body.provider)
    except Exception as exc:
        logger.error(f"Failed to resolve LLM provider: {exc}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "PROVIDER_ERROR", "message": str(exc)},
        )

    # 5. SSE generator
    async def sse_event_stream() -> AsyncGenerator[str, None]:
        # Compose combined citations from attached docs + retrieval + live web search
        citations_payload = []
        for idx, doc in enumerate(attached_docs, start=1):
            doc_name = doc.get("name", f"Attached Document {idx}")
            doc_text = doc.get("content", "") or ""
            citations_payload.append({
                "index": idx,
                "title": f"📄 {doc_name} (Attached)",
                "url": "",
                "snippet": doc_text[:280].strip() + ("..." if len(doc_text) > 280 else ""),
                "score": 1.0,
            })

        start_kb_idx = len(citations_payload) + 1
        if retrieval_res and retrieval_res.citations:
            for idx, c in enumerate(retrieval_res.citations):
                c_dict = c.model_dump()
                c_dict["index"] = start_kb_idx + idx
                citations_payload.append(c_dict)

        start_web_idx = len(citations_payload) + 1
        for rank, w in enumerate(web_results):
            score = calculate_web_score(
                query=body.message,
                title=w.get("title", ""),
                snippet=w.get("snippet", ""),
                rank=rank,
            )
            citations_payload.append({
                "index": start_web_idx + rank,
                "title": w.get("title", "Web Source"),
                "url": w.get("url", ""),
                "snippet": w.get("snippet", ""),
                "score": score,
            })

        yield format_sse("citations", citations_payload)

        token_count = 0
        final_usage = None

        try:
            async for chunk in provider.stream_chat(
                messages=built.messages,
                system_prompt=built.system_prompt,
                model=body.model,
                temperature=body.temperature,
                max_tokens=body.max_tokens,
            ):
                if await request.is_disconnected():
                    logger.info("Client disconnected from /chat SSE stream")
                    return

                if chunk.delta:
                    token_count += 1
                    yield format_sse("token", {"delta": chunk.delta})

                if chunk.usage:
                    final_usage = chunk.usage

            # Fallback estimation for usage if provider did not report usageMetadata
            if not final_usage:
                prompt_toks = estimate_token_count(built.system_prompt) + sum(
                    estimate_token_count(m.content) for m in built.messages
                )
                final_usage = StreamUsage(
                    prompt_tokens=prompt_toks,
                    completion_tokens=token_count,
                    total_tokens=prompt_toks + token_count,
                )

            yield format_sse("usage", final_usage.model_dump())
            yield format_sse("done", {})

        except Exception as exc:
            logger.exception(f"Exception during LLM stream generation: {exc}")
            yield format_sse("error", {"code": "LLM_STREAM_ERROR", "message": str(exc)})
            yield format_sse("done", {})

    return StreamingResponse(
        sse_event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.post(
    "/generate-title",
    response_model=TitleResponse,
    summary="Generate concise conversation title",
    description="Analyzes the user's initial query and generates a concise, 3 to 5 word conversation title.",
)
async def generate_title(
    body: TitleRequest,
    _key: str = Depends(verify_internal_key),
    ws_id: ObjectId = Depends(require_workspace_id),
) -> TitleResponse:
    """POST /generate-title - AI powered conversation title generation."""
    prompt = (
        "Generate a clear, high-signal, specific conversation title (3 to 5 words) for a chat that begins with this user message:\n\n"
        f"\"{body.message.strip()}\"\n\n"
        "Strict rules:\n"
        "1. Return ONLY the title text. Do NOT include quotes, preambles like 'Title:', punctuation at the end, or emojis.\n"
        "2. Capitalize properly in Title Case.\n"
        "3. Maximum 5 words.\n"
        "4. Focus on the core topic or technology."
    )
    model_name = body.model or "gemini-3.8-flash"
    try:
        provider = get_llm_provider(model_name)
        full_text = ""
        async for chunk in provider.stream_chat(
            messages=[ChatMessage(role="user", content=prompt)],
            system_prompt="You are an expert conversation title generator. Output only the short title.",
            model=model_name,
            temperature=0.3,
            max_tokens=30,
        ):
            if chunk.delta:
                full_text += chunk.delta

        clean = full_text.strip().strip('"\'`').replace("\n", " ").strip()
        if clean.lower().startswith("title:"):
            clean = clean[6:].strip()

        if clean and len(clean) >= 2:
            return TitleResponse(title=clean[:60])
    except Exception as exc:
        logger.warning(f"AI title generation encountered an issue: {exc}")

    return TitleResponse(title="New Conversation")


@router.post(
    "/parse-document",
    summary="Parse ad-hoc document text",
    description="Extracts raw text from an attached PDF, TXT, or CSV file for ad-hoc chat analysis.",
)
async def parse_document(
    body: ParseDocumentRequest,
    _key: str = Depends(verify_internal_key),
    ws_id: ObjectId = Depends(require_workspace_id),
):
    """POST /parse-document - Extract text from ad-hoc uploaded document."""
    try:
        content = base64.b64decode(body.content_base64)
        filename = body.filename or "uploaded_document"
        ext = filename.lower().split(".")[-1] if "." in filename else ""

        text = ""
        pages = 1
        if ext == "pdf":
            doc = extract_pdf(content, filename=filename)
            text = "\n\n".join(s.text for s in doc.sections)
            pages = len(doc.sections)
        elif ext in ("csv", "tsv"):
            doc = extract_csv(content, filename=filename)
            text = "\n\n".join(s.text for s in doc.sections)
        else:
            doc = extract_txt(content, filename=filename)
            text = "\n\n".join(s.text for s in doc.sections)

        return {
            "filename": filename,
            "text": text,
            "characterCount": len(text),
            "pages": pages,
        }
    except Exception as exc:
        logger.exception(f"Document parsing failed: {exc}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "PARSE_ERROR", "message": str(exc)},
        )

