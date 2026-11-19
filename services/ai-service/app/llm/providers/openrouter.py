"""
app/llm/providers/openrouter.py
================================
OpenRouter LLM Provider using OpenAI-compatible API.
Supports free models via OpenRouter's unified API.
Base URL: https://openrouter.ai/api/v1
"""

from __future__ import annotations

import json
from typing import AsyncGenerator, List, Optional
import httpx

from app.core.logging import logger
from app.rag.prompt_builder import ChatMessage
from app.llm.providers.base import BaseLLMProvider, StreamChunk
from app.llm.streaming import StreamUsage


class OpenRouterLLMProvider(BaseLLMProvider):
    """
    Streaming provider for OpenRouter models via OpenAI-compatible API.
    """

    def __init__(
        self,
        api_key: str,
        default_model: str = "nvidia/nemotron-3-ultra-550b-a55b:free",
        base_url: str = "https://openrouter.ai/api/v1",
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

        # Convert to OpenAI format
        formatted_messages = []
        if system_prompt:
            formatted_messages.append({"role": "system", "content": system_prompt})

        for msg in messages:
            formatted_messages.append({"role": msg.role, "content": msg.content})

        payload = {
            "model": target_model,
            "messages": formatted_messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
            "stream": True,
        }

        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
            "HTTP-Referer": "https://rag-mcp.ai",  # Optional: for OpenRouter analytics
            "X-Title": "Rag_Mcp",  # Optional: for OpenRouter analytics
        }

        models_to_try = [target_model]
        if target_model != "openrouter/free":
            models_to_try.append("openrouter/free")

        timeout = httpx.Timeout(connect=10.0, read=180.0, write=10.0, pool=10.0)

        async with httpx.AsyncClient(timeout=timeout) as client:
            try:
                for current_model in models_to_try:
                    payload["model"] = current_model
                    async with client.stream("POST", url, json=payload, headers=headers) as response:
                        if response.status_code != 200:
                            err_body = await response.aread()
                            err_str = err_body.decode("utf-8", errors="replace")
                            try:
                                err_json = json.loads(err_str)
                                err_msg = err_json.get("error", {}).get("message") or err_str
                            except Exception:
                                err_msg = err_str

                            # If model not found or invalid on OpenRouter, try fallback if available
                            if (response.status_code in (400, 404) or "model" in err_msg.lower()) and len(models_to_try) > 1 and current_model != models_to_try[-1]:
                                logger.warning(
                                    f"Model '{current_model}' failed on OpenRouter ({response.status_code}: {err_msg}), retrying with '{models_to_try[-1]}'"
                                )
                                continue

                            logger.error(
                                f"OpenRouter API error {response.status_code}: {err_msg}"
                            )
                            raise RuntimeError(f"OpenRouter error ({response.status_code}): {err_msg}")

                        async for line in response.aiter_lines():
                            if not line or not line.startswith("data: "):
                                continue

                            raw_data = line[len("data: ") :].strip()
                            if not raw_data or raw_data == "[DONE]":
                                continue

                            try:
                                chunk_data = json.loads(raw_data)
                            except json.JSONDecodeError:
                                continue

                            # Extract delta from OpenAI format
                            choices = chunk_data.get("choices", [])
                            if not choices:
                                continue

                            first_choice = choices[0]
                            delta = first_choice.get("delta", {})
                            delta_text = delta.get("content", "")
                            finish_reason = first_choice.get("finish_reason")

                            # Extract usage if present
                            usage = None
                            usage_data = chunk_data.get("usage")
                            if usage_data:
                                usage = StreamUsage(
                                    prompt_tokens=usage_data.get("prompt_tokens", 0),
                                    completion_tokens=usage_data.get("completion_tokens", 0),
                                    total_tokens=usage_data.get("total_tokens", 0),
                                )

                            if delta_text or usage or finish_reason:
                                yield StreamChunk(
                                    delta=delta_text,
                                    usage=usage,
                                    finish_reason=finish_reason,
                                )
                        return  # Successfully streamed from provider
            except httpx.TimeoutException as exc:
                logger.error(f"OpenRouter API request timed out: {exc}")
                raise RuntimeError("OpenRouter API connection timed out") from exc
            except httpx.NetworkError as exc:
                logger.error(f"OpenRouter API network error: {exc}")
                raise RuntimeError(f"OpenRouter API network error: {exc}") from exc
