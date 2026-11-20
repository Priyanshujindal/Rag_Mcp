"""
app/llm/providers/groq.py
=========================
Groq LLM Provider using OpenAI-compatible high-speed streaming API.
Base URL: https://api.groq.com/openai/v1
"""

from __future__ import annotations

import json
from typing import AsyncGenerator, List, Optional
import httpx

from app.core.logging import logger
from app.rag.prompt_builder import ChatMessage
from app.llm.providers.base import BaseLLMProvider, StreamChunk
from app.llm.streaming import StreamUsage


class GroqLLMProvider(BaseLLMProvider):
    """
    Streaming provider for Groq ultra-fast LPU inference via OpenAI-compatible API.
    Supports reasoning tokens, dynamic fallback across Groq models, and usage tracking.
    """

    def __init__(
        self,
        api_key: str,
        default_model: str = "qwen/qwen3.8-27b",
        base_url: str = "https://api.groq.com/openai/v1",
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
        max_tokens: int = 4096,
    ) -> AsyncGenerator[StreamChunk, None]:
        target_model = model or self.default_model
        url = f"{self.base_url}/chat/completions"

        # Format messages for OpenAI compatibility
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
        }

        # Resilient fallback chain across available Groq models
        models_to_try = [target_model]
        for fallback in ("qwen/qwen3.8-27b", "openai/gpt-oss-120b", "openai/gpt-oss-20b"):
            if fallback not in models_to_try:
                models_to_try.append(fallback)

        timeout = httpx.Timeout(connect=15.0, read=180.0, write=15.0, pool=15.0)

        async with httpx.AsyncClient(timeout=timeout) as client:
            last_err = None
            for current_model in models_to_try:
                payload["model"] = current_model
                try:
                    async with client.stream("POST", url, json=payload, headers=headers) as response:
                        if response.status_code != 200:
                            err_body = await response.aread()
                            err_str = err_body.decode("utf-8", errors="replace")
                            try:
                                err_json = json.loads(err_str)
                                err_msg = err_json.get("error", {}).get("message") or err_str
                            except Exception:
                                err_msg = err_str

                            # If model decommissioned, rate limited or not found, try fallback
                            if (response.status_code in (400, 404, 429) or "model" in err_msg.lower()) and current_model != models_to_try[-1]:
                                logger.warning(
                                    f"Model '{current_model}' failed on Groq ({response.status_code}: {err_msg}), retrying with '{models_to_try[-1]}'"
                                )
                                continue

                            logger.error(f"Groq API error {response.status_code}: {err_msg}")
                            raise RuntimeError(f"Groq error ({response.status_code}): {err_msg}")

                        is_in_thinking = False
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

                            choices = chunk_data.get("choices", [])
                            if not choices:
                                continue

                            first_choice = choices[0]
                            delta = first_choice.get("delta", {})
                            reasoning_text = delta.get("reasoning", "") or delta.get("thought", "")
                            delta_text = delta.get("content", "")
                            finish_reason = first_choice.get("finish_reason")

                            # Handle reasoning / chain-of-thought blocks
                            if reasoning_text:
                                if not is_in_thinking:
                                    is_in_thinking = True
                                    yield StreamChunk(delta="<think>\n" + reasoning_text)
                                else:
                                    yield StreamChunk(delta=reasoning_text)

                            if delta_text:
                                if is_in_thinking:
                                    is_in_thinking = False
                                    yield StreamChunk(delta="\n</think>\n\n" + delta_text)
                                else:
                                    yield StreamChunk(delta=delta_text)

                            # Usage stats (supported by Groq in final chunks or x_groq)
                            usage = None
                            usage_data = chunk_data.get("usage") or chunk_data.get("x_groq", {}).get("usage")
                            if usage_data:
                                usage = StreamUsage(
                                    prompt_tokens=usage_data.get("prompt_tokens", 0),
                                    completion_tokens=usage_data.get("completion_tokens", 0),
                                    total_tokens=usage_data.get("total_tokens", 0),
                                )

                            if usage or finish_reason:
                                if is_in_thinking and finish_reason:
                                    is_in_thinking = False
                                    yield StreamChunk(delta="\n</think>\n\n")

                                yield StreamChunk(
                                    delta="",
                                    usage=usage,
                                    finish_reason=finish_reason,
                                )
                        return  # Successfully streamed
                except (httpx.TimeoutException, httpx.NetworkError) as net_exc:
                    last_err = net_exc
                    if current_model != models_to_try[-1]:
                        logger.warning(f"Groq network error on {current_model}: {net_exc}, falling back...")
                        continue
                    raise RuntimeError(f"Groq network error: {net_exc}") from net_exc

            if last_err:
                raise RuntimeError(f"Groq failed after fallbacks: {last_err}")
