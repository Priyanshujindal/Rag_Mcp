"""
tests/test_evaluation.py
========================
Tests for RAG benchmark evaluation (Hit Rate@k, MRR, Faithfulness, Relevance, and /evaluate).
"""

from __future__ import annotations

import os
from pathlib import Path
from unittest.mock import AsyncMock, patch
from bson import ObjectId
import pytest
from httpx import AsyncClient

from app.api.evaluate import (
    _compute_faithfulness_score,
    _compute_relevance_score,
    _is_chunk_relevant,
)
from app.schemas.retrieval import RankedChunk, RetrieveResponse, TimingInfo


def test_is_chunk_relevant_by_title_and_keyword():
    """Verify chunk relevance matching."""
    chunk = RankedChunk(
        chunkId="c1",
        sourceId="s1",
        text="Acme refund policy stipulates returns within 30 days.",
        metadata={"title": "Acme Return Policy"},
    )

    # 1. Matches by title
    assert _is_chunk_relevant(chunk, [], "Return Policy") is True
    # 2. Matches by keywords
    assert _is_chunk_relevant(chunk, ["refund", "returns"], None) is True
    # 3. Unrelated keywords
    assert _is_chunk_relevant(chunk, ["photosynthesis", "chlorophyll"], None) is False


def test_relevance_and_faithfulness_scores():
    """Verify heuristic overlap metrics."""
    chunk = RankedChunk(
        chunkId="c1",
        sourceId="s1",
        text="Photosynthesis uses sunlight and carbon dioxide to produce sugar and oxygen.",
        metadata={"title": "Biology"},
    )

    rel_score = _compute_relevance_score("How does photosynthesis use sunlight?", [chunk])
    assert rel_score > 0.5

    faith_score = _compute_faithfulness_score(
        "Plants synthesize sugar and oxygen from carbon dioxide.",
        [chunk],
    )
    assert faith_score > 0.5


@pytest.mark.asyncio
async def test_evaluate_endpoint_generates_report(async_client: AsyncClient):
    """Test POST /evaluate endpoint computes metrics and generates a report file."""
    from app.core.config import get_settings
    settings = get_settings()

    ws_id = str(ObjectId())
    kb_id = str(ObjectId())

    # Mock retrieve response with one relevant chunk
    mock_chunk = RankedChunk(
        chunkId=str(ObjectId()),
        sourceId=str(ObjectId()),
        text="Chlorophyll absorbs sunlight to synthesize glucose and oxygen.",
        metadata={"title": "Photosynthesis"},
    )
    mock_response = RetrieveResponse(
        query="What is photosynthesis?",
        strategy_used="auto",
        candidates=[],
        results=[mock_chunk],
        citations=[],
        timings=TimingInfo(),
    )

    with patch("app.api.evaluate.Retriever.retrieve", new_callable=AsyncMock) as mock_retrieve:
        mock_retrieve.return_value = mock_response

        headers = {
            "X-Internal-Key": settings.INTERNAL_API_KEY,
            "X-Workspace-Id": ws_id,
        }
        body = {
            "knowledgeBaseId": kb_id,
            "dataset_name": "qa-pairs.json",
            "top_k": 3,
        }

        resp = await async_client.post("/evaluate", headers=headers, json=body)
        assert resp.status_code == 200
        data = resp.json()

        assert "hit_rate_at_k" in data
        assert "mrr" in data
        assert "avg_faithfulness" in data
        assert "avg_relevance" in data
        assert data["total_queries"] >= 1
        assert "report_file" in data

        # Verify report file exists on disk
        report_file = Path(data["report_file"])
        assert report_file.exists(), f"Report file {report_file} was not written"

