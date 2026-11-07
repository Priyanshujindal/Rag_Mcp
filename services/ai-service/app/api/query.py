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

from typing import AsyncGenerator
from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import StreamingResponse

from app.core.config import get_settings
from app.core.logging import logger
from app.core.tenant import TenantContext, require_workspace_id, verify_internal_key
from app.rag.prompt_builder import PromptBuilder, estimate_token_count
from app.rag.retriever import Retriever
from app.rag.vector_store import get_vector_store
from app.schemas.chat import ChatRequest
from app.schemas.retrieval import RetrieveRequest, RetrieveResponse
from app.llm.router import get_llm_provider
from app.llm.streaming import StreamUsage, format_sse

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
    kb_id = ObjectId(body.knowledgeBaseId)
    source_ids = [ObjectId(s) for s in body.source_ids] if body.source_ids else None

    logger.info(
        "Chat request received",
        extra={
            "workspaceId": str(workspace_id),
            "knowledgeBaseId": str(kb_id),
            "model": body.model,
            "message_len": len(body.message),
        },
    )

    # 1. Retrieve context
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

    # 2. Build prompt with delimiter neutralization and untrusted data rules
    prompt_builder = PromptBuilder()
    built = prompt_builder.build_chat_prompt(
        query=body.message,
        history=body.history,
        retrieved_chunks=retrieval_res.results,
        custom_prompt=body.custom_prompt,
    )

    # 3. Select LLM provider
    try:
        provider = get_llm_provider(body.model)
    except Exception as exc:
        logger.error(f"Failed to resolve LLM provider: {exc}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "PROVIDER_ERROR", "message": str(exc)},
        )

    # 4. SSE generator
    async def sse_event_stream() -> AsyncGenerator[str, None]:
        # Send citations first so client UI can render sources immediately
        citations_payload = [c.model_dump() for c in retrieval_res.citations]
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
