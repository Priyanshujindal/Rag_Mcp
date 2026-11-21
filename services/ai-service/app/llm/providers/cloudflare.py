"""
app/llm/providers/cloudflare.py
================================
Cloudflare Workers AI LLM Provider.
Supports streaming via OpenAI-compatible SSE responses.
Base URL: https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/run/{model}
"""

from __future__ import annotations

import json
from typing import AsyncGenerator, List, Optional
import httpx

from app.core.logging import logger
from app.rag.prompt_builder import ChatMessage
from app.llm.providers.base import BaseLLMProvider, StreamChunk
from app.llm.streaming import StreamUsage


# Curated set of best Cloudflare Workers AI text generation models
CLOUDFLARE_MODELS = [
    "@cf/meta/llama-3.3-70b-instruct-fp8-fast",    # Best quality, fast 70B
    "@cf/meta/llama-3.1-8b-instruct",              # Fast 8B baseline
    "@cf/mistralai/mistral-small-3.1-24b-instruct", # Mistral 24B
    "@cf/google/gemma-4-26b-a4b-it",               # Google Gemma 4 26B
    "@cf/qwen/qwen2.5-coder-32b-instruct",         # Qwen 32B Coder
    "@cf/openai/gpt-oss-120b",                     # GPT-OSS 120B (via CF)
    "@cf/cloudflare/clairic-flash",                # Cloudflare Clairic Flash
]


class CloudflareLLMProvider(BaseLLMProvider):
    """
    Streaming provider for Cloudflare Workers AI via OpenAI-compatible API.
    Handles streaming SSE deltas, non-streaming JSON fallback, and model fallback chain.
    """

    BASE = "https://api.cloudflare.com/client/v4/accounts"

    def __init__(
        self,
        api_token: str,
        account_id: str,
        default_model: str = "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
    ):
        self.api_key = api_token        # Alias used by router for change detection
        self.api_token = api_token
        self.account_id = account_id
        self.default_model = default_model

    def _url(self, model: str) -> str:
        return f"{self.BASE}/{self.account_id}/ai/run/{model}"

    async def stream_chat(
        self,
        messages: List[ChatMessage],
        system_prompt: str,
        model: Optional[str] = None,
        temperature: float = 0.7,
        max_tokens: int = 4096,
    ) -> AsyncGenerator[StreamChunk, None]:
        target_model = model or self.default_model

        headers = {
            "Authorization": f"Bearer {self.api_token}",
            "Content-Type": "application/json",
        }

        # Build messages list
        formatted = []
        if system_prompt:
            formatted.append({"role": "system", "content": system_prompt})
        for msg in messages:
            formatted.append({"role": msg.role, "content": msg.content})

        payload = {
            "messages": formatted,
            "max_tokens": max_tokens,
            "temperature": temperature,
            "stream": True,
        }

        # Fallback chain: start with target, then fall through curated list
        models_to_try = [target_model]
        for fb in CLOUDFLARE_MODELS:
            if fb != target_model:
                models_to_try.append(fb)

        timeout = httpx.Timeout(connect=15.0, read=120.0, write=15.0, pool=15.0)

        async with httpx.AsyncClient(timeout=timeout) as client:
            last_err = None
            for current_model in models_to_try:
                url = self._url(current_model)
                payload["stream"] = True
                try:
                    async with client.stream("POST", url, json=payload, headers=headers) as response:
                        if response.status_code != 200:
                            err_body = await response.aread()
                            err_str = err_body.decode("utf-8", errors="replace")
                            try:
                                err_json = json.loads(err_str)
                                err_msg = (
                                    err_json.get("errors", [{}])[0].get("message")
                                    or err_json.get("error", {}).get("message")
                                    or err_str
                                )
                            except Exception:
                                err_msg = err_str

                            if response.status_code in (400, 404, 429) and current_model != models_to_try[-1]:
                                logger.warning(
                                    f"CF model '{current_model}' failed ({response.status_code}: {err_msg[:80]}), "
                                    f"retrying with next model..."
                                )
                                last_err = err_msg
                                continue

                            logger.error(f"Cloudflare AI error {response.status_code}: {err_msg}")
                            raise RuntimeError(f"Cloudflare AI error ({response.status_code}): {err_msg}")

                        async for line in response.aiter_lines():
                            if not line:
                                continue
                            if line.startswith("data: "):
                                raw = line[6:].strip()
                            else:
                                raw = line.strip()

                            if not raw or raw == "[DONE]":
                                continue

                            try:
                                chunk = json.loads(raw)
                            except json.JSONDecodeError:
                                continue

                            # OpenAI-compatible delta format
                            choices = chunk.get("choices", [])
                            if choices:
                                delta = choices[0].get("delta", {})
                                content = delta.get("content") or ""
                                finish = choices[0].get("finish_reason")
                                if content:
                                    yield StreamChunk(delta=content)
                                if finish:
                                    yield StreamChunk(delta="", finish_reason=finish)
                            elif chunk.get("response"):
                                # Non-SSE inline response format
                                yield StreamChunk(delta=chunk["response"])

                        return  # Success

                except (httpx.TimeoutException, httpx.NetworkError) as net_exc:
                    last_err = net_exc
                    if current_model != models_to_try[-1]:
                        logger.warning(f"CF network error on {current_model}: {net_exc}, falling back...")
                        continue
                    raise RuntimeError(f"Cloudflare AI network error: {net_exc}") from net_exc

            if last_err:
                raise RuntimeError(f"Cloudflare AI failed after all fallbacks: {last_err}")
