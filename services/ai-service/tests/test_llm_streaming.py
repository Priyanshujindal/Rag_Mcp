"""
tests/test_llm_streaming.py
===========================
Tests for LLM streaming providers, SSE formatting, router, and /chat endpoint.
"""

from __future__ import annotations

import json
from unittest.mock import AsyncMock, MagicMock, patch
from bson import ObjectId
import pytest
from httpx import AsyncClient

from app.llm.providers.base import BaseLLMProvider, StreamChunk
from app.llm.providers.gemini import GeminiLLMProvider
from app.llm.providers.openai import OpenAILLMProvider
from app.llm.providers.ollama import OllamaLLMProvider
from app.llm.router import get_llm_provider, reset_llm_providers
from app.llm.streaming import StreamUsage, format_sse
from app.rag.prompt_builder import ChatMessage
from app.schemas.retrieval import Citation, RankedChunk, RetrieveResponse, TimingInfo


def test_format_sse():
    """Verify SSE line formatting according to W3C spec."""
    evt = format_sse("token", {"delta": "Hello world"})
    assert evt == 'event: token\ndata: {"delta": "Hello world"}\n\n'

    done_evt = format_sse("done", {})
    assert done_evt == "event: done\ndata: {}\n\n"


def test_router_selects_by_model_prefix():
    """Verify model routing rules by prefix and fallback."""
    reset_llm_providers()

    with patch("app.llm.router.get_settings") as mock_settings:
        mock_settings.return_value.GEMINI_API_KEY = "test-gemini-key"
        mock_settings.return_value.OPENAI_API_KEY = "test-openai-key"
        mock_settings.return_value.OLLAMA_BASE_URL = "http://localhost:11434"

        # 1. Gemini
        p1 = get_llm_provider("gemini-1.5-flash")
        assert isinstance(p1, GeminiLLMProvider)

        # 2. OpenAI
        p2 = get_llm_provider("gpt-4o")
        assert isinstance(p2, OpenAILLMProvider)

        # 3. Ollama
        p3 = get_llm_provider("llama3.2")
        assert isinstance(p3, OllamaLLMProvider)


@pytest.mark.asyncio
async def test_mock_stream_chat_events():
    """Test standard event sequence from a streaming provider."""
    class MockProvider(BaseLLMProvider):
        async def stream_chat(self, messages, system_prompt, model=None, temperature=0.7, max_tokens=1024):
            yield StreamChunk(delta="Hello ")
            yield StreamChunk(delta="there!")
            yield StreamChunk(
                delta="",
                usage=StreamUsage(prompt_tokens=10, completion_tokens=2, total_tokens=12),
                finish_reason="stop",
            )

    provider = MockProvider()
    chunks = [c async for c in provider.stream_chat([], "system")]
    assert len(chunks) == 3
    assert chunks[0].delta == "Hello "
    assert chunks[1].delta == "there!"
    assert chunks[2].usage.total_tokens == 12


@pytest.mark.asyncio
async def test_chat_endpoint_streams_sse_events(async_client: AsyncClient):
    """
    Test POST /chat endpoint receives:
      - citations event
      - token events
      - usage event
      - done event
    """
    from app.core.config import get_settings
    settings = get_settings()

    ws_id = str(ObjectId())
    kb_id = str(ObjectId())

    # Mock the retriever so we don't need real Atlas data
    mock_response = RetrieveResponse(
        query="What is photosynthesis?",
        strategy_used="auto",
        candidates=[],
        results=[
            RankedChunk(
                chunkId=str(ObjectId()),
                sourceId=str(ObjectId()),
                text="Photosynthesis produces glucose from sunlight.",
                fusedScore=0.9,
                metadata={"title": "Biology 101"},
            )
        ],
        citations=[
            Citation(
                index=1,
                sourceId="src_1",
                title="Biology 101",
                url="https://example.com/bio",
                page=1,
                snippet="Photosynthesis produces glucose...",
            )
        ],
        timings=TimingInfo(),
    )

    class FakeProvider(BaseLLMProvider):
        async def stream_chat(self, messages, system_prompt, model=None, temperature=0.7, max_tokens=1024):
            yield StreamChunk(delta="Photosynthesis ")
            yield StreamChunk(delta="converts light.")
            yield StreamChunk(
                usage=StreamUsage(prompt_tokens=25, completion_tokens=4, total_tokens=29),
                finish_reason="stop",
            )

    with patch("app.api.query.Retriever.retrieve", new_callable=AsyncMock) as mock_retrieve, \
         patch("app.api.query.get_llm_provider", return_value=FakeProvider()):

        mock_retrieve.return_value = mock_response

        headers = {
            "X-Internal-Key": settings.INTERNAL_API_KEY,
            "X-Workspace-Id": ws_id,
        }
        body = {
            "knowledgeBaseId": kb_id,
            "message": "What is photosynthesis?",
            "model": "gemini-1.5-flash",
        }

        resp = await async_client.post("/chat", headers=headers, json=body)
        assert resp.status_code == 200
        assert "text/event-stream" in resp.headers["content-type"]

        content = resp.text
        assert "event: citations" in content
        assert "event: token" in content
        assert "event: usage" in content
        assert "event: done" in content
        assert "Biology 101" in content
        assert "Photosynthesis" in content
