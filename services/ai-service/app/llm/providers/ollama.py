"""
app/llm/providers/ollama.py
===========================
Ollama LLM Streaming Provider using httpx async client.
Supports local, self-hosted open models (e.g. llama3, mistral, qwen).
"""

from __future__ import annotations

import json
from typing import AsyncGenerator, List, Optional
import httpx

from app.core.logging import logger
from app.rag.prompt_builder import ChatMessage
from app.llm.providers.base import BaseLLMProvider, StreamChunk
from app.llm.streaming import StreamUsage


class OllamaLLMProvider(BaseLLMProvider):
    """
    Streaming provider for Ollama via /api/chat.
    """

    def __init__(
        self,
        base_url: str = "http://localhost:11434",
        default_model: str = "llama3.2:1b",
    ):
        self.base_url = base_url.rstrip("/")
        self.default_model = default_model

    async def stream_chat(
        self,
        messages: List[ChatMessage],
        system_prompt: str,
        model: Optional[str] = None,
        temperature: float = 0.7,
        max_tokens: int = 1024,
    ) -> AsyncGenerator[StreamChunk, None]:
        target_model = model or self.default_model
        # Strip optional "ollama/" prefix
        if target_model.startswith("ollama/"):
            target_model = target_model[len("ollama/"):]

        url = f"{self.base_url}/api/chat"

        payload_messages = []
        if system_prompt:
            payload_messages.append({"role": "system", "content": system_prompt})
        for msg in messages:
            payload_messages.append({"role": msg.role, "content": msg.content})

        payload = {
            "model": target_model,
            "messages": payload_messages,
            "stream": True,
            "options": {
                "temperature": temperature,
                "num_predict": max_tokens,
            },
        }

        timeout = httpx.Timeout(connect=10.0, read=60.0, write=10.0, pool=10.0)

        async with httpx.AsyncClient(timeout=timeout) as client:
            try:
                async with client.stream("POST", url, json=payload) as response:
                    if response.status_code != 200:
                        err_body = await response.aread()
                        logger.error(f"Ollama API error {response.status_code}: {err_body.decode('utf-8', errors='replace')}")
                        raise RuntimeError(f"Ollama streaming failed with status {response.status_code}")

                    async for line in response.aiter_lines():
                        if not line or not line.strip():
                            continue

                        try:
                            chunk_data = json.loads(line)
                        except json.JSONDecodeError:
                            continue

                        msg_obj = chunk_data.get("message", {})
                        delta_text = msg_obj.get("content", "") or ""
                        is_done = chunk_data.get("done", False)

                        usage = None
                        if is_done:
                            p_tok = chunk_data.get("prompt_eval_count", 0)
                            c_tok = chunk_data.get("eval_count", 0)
                            usage = StreamUsage(
                                prompt_tokens=p_tok,
                                completion_tokens=c_tok,
                                total_tokens=p_tok + c_tok,
                            )

                        if delta_text or usage or is_done:
                            yield StreamChunk(
                                delta=delta_text,
                                usage=usage,
                                finish_reason="stop" if is_done else None,
                            )

            except httpx.TimeoutException as exc:
                logger.error(f"Ollama connection timed out: {exc}")
                raise RuntimeError("Ollama connection timed out") from exc
            except httpx.NetworkError as exc:
                logger.error(f"Ollama network error: {exc}")
                raise RuntimeError(f"Ollama connection error: {exc}") from exc

