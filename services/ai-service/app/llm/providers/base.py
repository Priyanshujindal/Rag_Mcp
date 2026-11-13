"""
app/llm/providers/base.py
=========================
Abstract base interface for LLM streaming providers.
"""

from __future__ import annotations

import abc
from typing import Any, AsyncGenerator, Dict, List, Optional
from pydantic import BaseModel

from app.rag.prompt_builder import ChatMessage
from app.llm.streaming import StreamUsage


class StreamChunk(BaseModel):
    """Normalized chunk from an LLM stream."""
    delta: str = ""
    usage: Optional[StreamUsage] = None
    finish_reason: Optional[str] = None


class BaseLLMProvider(abc.ABC):
    """
    Abstract interface for streaming LLM generation.
    """

    @abc.abstractmethod
    async def stream_chat(
        self,
        messages: List[ChatMessage],
        system_prompt: str,
        model: str,
        temperature: float = 0.7,
        max_tokens: int = 1024,
    ) -> AsyncGenerator[StreamChunk, None]:
        """
        Yields normalized StreamChunk objects as tokens or usage arrives.
        Must handle client disconnects and wrap errors appropriately.
        """
        yield StreamChunk()

