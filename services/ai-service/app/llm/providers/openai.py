"""
app/llm/providers/openai.py
===========================
OpenAI LLM Streaming Provider using httpx async client.
Supports standard OpenAI and OpenAI-compatible endpoints.
"""

from __future__ import annotations

import json
from typing import AsyncGenerator, List, Optional
import httpx

from app.core.logging import logger
from app.rag.prompt_builder import ChatMessage
from app.llm.providers.base import BaseLLMProvider, StreamChunk
from app.llm.streaming import StreamUsage


class OpenAILLMProvider(BaseLLMProvider):
    """
    Streaming provider for OpenAI models via Chat Completions REST API.
    """

    def __init__(
        self,
        api_key: str,
        default_model: str = "gpt-4o-mini",
        base_url: str = "https://api.openai.com/v1",
    ):
        self.api_key = api_key
        self.default_model = default_model
        self.base_url = base_url.rstrip("/")

    async def stream_chat(
        self,
        messages: List[ChatMessage],
        system_prompt: str,
        model: Optional[str] = None,
        temperature: float = 0.7,
        max_tokens: int = 1024,
    ) -> AsyncGenerator[StreamChunk, None]:
        target_model = model or self.default_model
        url = f"{self.base_url}/chat/completions"

        # Construct message payload with system instruction
        payload_messages = []
        if system_prompt:
            payload_messages.append({"role": "system", "content": system_prompt})
        for msg in messages:
            payload_messages.append({"role": msg.role, "content": msg.content})

        payload = {
            "model": target_model,
            "messages": payload_messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
            "stream": True,
            "stream_options": {"include_usage": True},
        }

        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

        timeout = httpx.Timeout(connect=10.0, read=45.0, write=10.0, pool=10.0)

        async with httpx.AsyncClient(timeout=timeout) as client:
            try:
                async with client.stream("POST", url, json=payload, headers=headers) as response:
                    if response.status_code != 200:
                        err_body = await response.aread()
                        logger.error(f"OpenAI API error {response.status_code}: {err_body.decode('utf-8', errors='replace')}")
                        raise RuntimeError(f"OpenAI streaming failed with status {response.status_code}")

                    async for line in response.aiter_lines():
                        if not line or not line.startswith("data: "):
                            continue

                        raw_data = line[len("data: "):].strip()
                        if not raw_data or raw_data == "[DONE]":
                            continue

                        try:
                            chunk_data = json.loads(raw_data)
                        except json.JSONDecodeError:
                            continue

                        delta_text = ""
                        finish_reason = None
                        choices = chunk_data.get("choices", [])
                        if choices:
                            choice = choices[0]
                            delta_text = choice.get("delta", {}).get("content", "") or ""
                            finish_reason = choice.get("finish_reason")

                        usage = None
                        raw_usage = chunk_data.get("usage")
                        if raw_usage:
                            p_tok = raw_usage.get("prompt_tokens", 0)
                            c_tok = raw_usage.get("completion_tokens", 0)
                            t_tok = raw_usage.get("total_tokens", p_tok + c_tok)
                            usage = StreamUsage(
                                prompt_tokens=p_tok,
                                completion_tokens=c_tok,
                                total_tokens=t_tok,
                            )

                        if delta_text or usage or finish_reason:
                            yield StreamChunk(
                                delta=delta_text,
                                usage=usage,
                                finish_reason=finish_reason,
                            )

            except httpx.TimeoutException as exc:
                logger.error(f"OpenAI API request timed out: {exc}")
                raise RuntimeError("OpenAI API connection timed out") from exc
            except httpx.NetworkError as exc:
                logger.error(f"OpenAI API network error: {exc}")
                raise RuntimeError(f"OpenAI API network error: {exc}") from exc

