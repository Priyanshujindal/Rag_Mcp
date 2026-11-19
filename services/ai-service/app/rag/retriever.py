"""
app/rag/retriever.py
====================
High-level Retriever that orchestrates embedding, hybrid search,
optional reranking, and citation generation.

This module calls VectorStore methods only -- it never builds $vectorSearch
or $search pipeline stages itself.
"""

from __future__ import annotations

import time
from typing import Any, Optional

from bson import ObjectId

from app.core.config import get_settings
from app.core.logging import logger
from app.rag.embeddings import get_embedding_provider
from app.rag.vector_store import VectorStore
from app.schemas.retrieval import Citation, RankedChunk, RetrieveResponse, TimingInfo


class Retriever:
    """
    Orchestrates query embedding -> hybrid search -> optional reranking -> citations.

    Usage::

        retriever = Retriever(vector_store=store)
        response = await retriever.retrieve(
            workspace_id=ObjectId("..."),
            kb_id=ObjectId("..."),
            query="What is the refund policy?",
        )
    """

    def __init__(self, vector_store: VectorStore):
        self._store = vector_store
        self._settings = get_settings()
        self._reranker = None  # Lazy-loaded if RERANKER != "none"

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def retrieve(
        self,
        workspace_id: ObjectId,
        kb_id: ObjectId,
        query: str,
        top_n: int = 20,
        top_k: int = 5,
        min_score_threshold: float = 0.0,
        strategy: str = "auto",
        vector_weight: float = 0.6,
        text_weight: float = 0.4,
        source_ids: Optional[list[ObjectId]] = None,
    ) -> RetrieveResponse:
        """
        Full retrieval pipeline:
        1. Embed query
        2. Hybrid search (vector + text, via VectorStore)
        3. Optional cross-encoder reranking
        4. Apply min_score_threshold and top_k slice
        5. Build citations

        Returns a RetrieveResponse with timings, all candidates, final results,
        and numbered citations.
        """
        timings = TimingInfo()
        t_total = time.perf_counter()

        # ---- 1. Embed query ----
        t0 = time.perf_counter()
        provider = get_embedding_provider(self._settings)
        query_embedding = await provider.embed_query(query)
        timings.embed_ms = (time.perf_counter() - t0) * 1000

        # ---- 2. Hybrid search ----
        t0 = time.perf_counter()
        raw_docs = await self._store.hybrid_search(
            workspace_id=workspace_id,
            kb_id=kb_id,
            query_embedding=query_embedding,
            query_text=query,
            top_n=top_n,
            strategy=strategy,
            vector_weight=vector_weight,
            text_weight=text_weight,
            source_ids=source_ids,
        )
        # We log total hybrid time; individual vector/text timings are exposed
        # only when running manual RRF (would require hooking into the store).
        hybrid_ms = (time.perf_counter() - t0) * 1000
        # Assign both legs for now; Stage 5 can refine if needed
        timings.vector_search_ms = hybrid_ms * vector_weight
        timings.text_search_ms = hybrid_ms * text_weight

        # ---- 3. Convert raw docs to RankedChunk ----
        candidates = [_doc_to_ranked_chunk(doc) for doc in raw_docs]

        # ---- 4. Optional reranking ----
        t0 = time.perf_counter()
        strategy_used = strategy
        if self._settings.RERANKER != "none" and candidates:
            candidates = await self._rerank(query, candidates)
            strategy_used = f"{strategy}+rerank"
        timings.rerank_ms = (time.perf_counter() - t0) * 1000

        # ---- 5. Filter and slice ----
        filtered = [c for c in candidates if c.fusedScore >= min_score_threshold]
        results = filtered[:top_k]

        # Log when threshold filtering removes all candidates
        if candidates and not filtered:
            logger.warning(
                "All candidates filtered by min_score_threshold",
                extra={
                    "threshold": min_score_threshold,
                    "candidates": len(candidates),
                    "highest_score": max(c.fusedScore for c in candidates) if candidates else 0.0,
                },
            )

        # ---- 6. Build citations ----
        citations = _build_citations(results)

        timings.total_ms = (time.perf_counter() - t_total) * 1000

        logger.info(
            "Retrieval complete",
            extra={
                "query_len": len(query),
                "strategy": strategy_used,
                "candidates": len(candidates),
                "filtered": len(filtered),
                "results": len(results),
                "total_ms": round(timings.total_ms, 1),
            },
        )

        return RetrieveResponse(
            query=query,
            strategy_used=strategy_used,
            candidates=candidates,
            results=results,
            citations=citations,
            timings=timings,
        )

    # ------------------------------------------------------------------
    # Reranker (optional cross-encoder via fastembed)
    # ------------------------------------------------------------------

    async def _rerank(
        self, query: str, chunks: list[RankedChunk]
    ) -> list[RankedChunk]:
        """
        Cross-encoder reranking using fastembed's TextCrossEncoder.
        Falls back gracefully if the model is unavailable.
        """
        try:
            import asyncio
            from fastembed.rerank.cross_encoder import TextCrossEncoder

            if self._reranker is None:
                # Load lazily; runs in threadpool because it's CPU/ONNX bound
                def _load():
                    return TextCrossEncoder(
                        model_name="Xenova/ms-marco-MiniLM-L-6-v2"
                    )
                self._reranker = await asyncio.to_thread(_load)

            texts = [c.text for c in chunks]

            def _score():
                return list(
                    self._reranker.rerank(query=query, documents=texts)
                )

            scores = await asyncio.to_thread(_score)
            for chunk, score in zip(chunks, scores):
                chunk.rerankedScore = float(score)

            # Sort by rerankedScore descending
            chunks.sort(key=lambda c: c.rerankedScore or 0.0, reverse=True)
        except Exception as exc:
            logger.warning(f"Reranker failed, skipping: {exc}")

        return chunks


# ---------------------------------------------------------------------------
# Private helpers
# ---------------------------------------------------------------------------

def _doc_to_ranked_chunk(doc: dict[str, Any]) -> RankedChunk:
    """Convert a raw MongoDB document dict to a RankedChunk Pydantic model."""
    metadata = doc.get("metadata") or {}
    if hasattr(metadata, "model_dump"):
        metadata = metadata.model_dump()

    return RankedChunk(
        chunkId=str(doc.get("_id", "")),
        sourceId=str(doc.get("sourceId", "")),
        text=doc.get("text", ""),
        vectorScore=float(doc.get("vectorScore") or 0.0),
        textScore=float(doc.get("textScore") or 0.0),
        vectorRank=doc.get("vectorRank"),
        textRank=doc.get("textRank"),
        fusedScore=float(doc.get("fusedScore") or 0.0),
        rerankedScore=doc.get("rerankedScore"),
        metadata=metadata if isinstance(metadata, dict) else {},
    )


def _build_citations(results: list[RankedChunk]) -> list[Citation]:
    """Build numbered [1]..[K] citations from the final result list."""
    citations: list[Citation] = []
    for idx, chunk in enumerate(results, start=1):
        meta = chunk.metadata or {}
        citations.append(
            Citation(
                index=idx,
                sourceId=chunk.sourceId,
                title=meta.get("title"),
                url=meta.get("url"),
                page=meta.get("page"),
                snippet=chunk.text[:200].strip(),
            )
        )
    return citations
