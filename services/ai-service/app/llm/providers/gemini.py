"""
app/llm/providers/gemini.py
===========================
Google Gemini LLM streaming provider using an httpx async client.

Reliability rules (why this file looks the way it does):
- The API key is sent in the "x-goog-api-key" header, NEVER in the URL, so it
  cannot leak through HTTP client logs, proxies, or error messages.
- Temporary Google errors (503 "high demand", 429, 5xx) are retried once on the
  same model with a short backoff, then the next fallback model is tried.
- A model that accepts the request but sends nothing is abandoned after
  FIRST_TOKEN_TIMEOUT seconds instead of hanging for minutes.
- One total time budget (TOTAL_TIMEOUT) caps every attempt of a single request.
- Once any text has been streamed to the user we never switch to another model
  (that would mix two different answers); the stream fails with a clear error.
- Errors raised to the caller are short, friendly, and never contain the key.

Optional environment overrides (seconds): GEMINI_FIRST_TOKEN_TIMEOUT_SECONDS,
GEMINI_STREAM_IDLE_TIMEOUT_SECONDS, GEMINI_TOTAL_TIMEOUT_SECONDS,
GEMINI_RETRIES_PER_MODEL.
"""

from __future__ import annotations

import asyncio
import json
import os
import random
import time
from typing import AsyncGenerator, List, Optional

import httpx

from app.core.logging import logger
from app.rag.prompt_builder import ChatMessage
from app.llm.providers.base import BaseLLMProvider, StreamChunk
from app.llm.streaming import StreamUsage

GEMINI_MODELS_URL = "https://generativelanguage.googleapis.com/v1beta/models"

# HTTP statuses that are usually temporary on Google's side.
TRANSIENT_STATUSES = frozenset({429, 500, 502, 503, 504})
# HTTP statuses that mean our request or key is wrong; retrying cannot help.
FATAL_STATUSES = frozenset({400, 401, 403})

MIN_ATTEMPT_SECONDS = 3.0  # do not start a new attempt with less time than this
MAX_RETRY_AFTER_SECONDS = 5.0  # longest "Retry-After" we are willing to wait


def _env_float(name: str, default: float) -> float:
    try:
        value = float(os.getenv(name, ""))
        return value if value > 0 else default
    except ValueError:
        return default


def _env_int(name: str, default: int) -> int:
    try:
        value = int(os.getenv(name, ""))
        return value if value >= 0 else default
    except ValueError:
        return default


def _short(text: str, limit: int = 300) -> str:
    text = " ".join((text or "").split())
    return text if len(text) <= limit else text[:limit] + "..."


def _parse_retry_after(value: Optional[str]) -> Optional[float]:
    if not value:
        return None
    try:
        return max(0.0, float(value))
    except ValueError:
        return None


class _AttemptResult:
    """Mutable outcome of one request attempt (async generators cannot return values)."""

    def __init__(self) -> None:
        self.kind: str = "pending"  # ok | transient | timeout | network | not_found | fatal | empty | blocked
        self.status: Optional[int] = None
        self.detail: str = ""
        self.retry_after: Optional[float] = None
        self.yielded_text: bool = False
        self.block_reason: Optional[str] = None


_FRIENDLY = {
    "transient": "The AI model is busy right now (high demand on Google's side). Please try again in a moment.",
    "timeout": "The AI model took too long to respond. Please try again.",
    "network": "Could not reach the Gemini API. Please check the server's internet connection and try again.",
    "empty": "The AI model returned an empty response. Please try again.",
    "not_found": "The configured Gemini model was not found. Please check the model name.",
}


class GeminiLLMProvider(BaseLLMProvider):
    """
    Streaming provider for Google Gemini models via the Generative Language REST API.
    """

    def __init__(
        self,
        api_key: str,
        default_model: str = "gemini-1.5-flash",
        *,
        first_token_timeout: Optional[float] = None,
        stream_idle_timeout: Optional[float] = None,
        total_timeout: Optional[float] = None,
        retries_per_model: Optional[int] = None,
        transport: Optional[httpx.AsyncBaseTransport] = None,
    ):
        self.api_key = api_key
        self.default_model = default_model
        self.first_token_timeout = first_token_timeout or _env_float("GEMINI_FIRST_TOKEN_TIMEOUT_SECONDS", 25.0)
        self.stream_idle_timeout = stream_idle_timeout or _env_float("GEMINI_STREAM_IDLE_TIMEOUT_SECONDS", 60.0)
        self.total_timeout = total_timeout or _env_float("GEMINI_TOTAL_TIMEOUT_SECONDS", 90.0)
        self.retries_per_model = (
            retries_per_model if retries_per_model is not None else _env_int("GEMINI_RETRIES_PER_MODEL", 1)
        )
        self._transport = transport  # tests inject a fake transport here

    # ------------------------------------------------------------------ helpers
    @staticmethod
    def _candidate_models(target_model: str) -> List[str]:
        candidates = [target_model]
        if target_model in ("gemini-3.8-flash", "gemini-3.6-flash", "gemini-1.5-flash"):
            for alt in ("gemini-3.5-flash", "gemini-flash-latest"):
                if alt not in candidates:
                    candidates.append(alt)
        return candidates

    @staticmethod
    def _build_payload(
        messages: List[ChatMessage], system_prompt: str, temperature: float, max_tokens: int
    ) -> dict:
        # Map ChatMessage roles ('user', 'assistant') to Gemini roles ('user', 'model')
        contents = []
        for msg in messages:
            role = "model" if msg.role == "assistant" else "user"
            contents.append({"role": role, "parts": [{"text": msg.content}]})

        payload: dict = {
            "contents": contents,
            "generationConfig": {
                "temperature": temperature,
                "maxOutputTokens": max_tokens or 4096,
            },
        }
        if system_prompt:
            payload["systemInstruction"] = {"parts": [{"text": system_prompt}]}
        return payload

    async def _attempt(
        self,
        client: httpx.AsyncClient,
        model: str,
        payload: dict,
        first_token_timeout: float,
        result: _AttemptResult,
    ) -> AsyncGenerator[StreamChunk, None]:
        """One request to one model. Yields chunks and records the outcome in `result`."""
        url = f"{GEMINI_MODELS_URL}/{model}:streamGenerateContent?alt=sse"
        headers = {"x-goog-api-key": self.api_key, "Content-Type": "application/json"}
        loop = asyncio.get_running_loop()

        try:
            async with client.stream("POST", url, json=payload, headers=headers) as response:
                if response.status_code != 200:
                    body = (await response.aread()).decode("utf-8", errors="replace")
                    result.status = response.status_code
                    result.detail = _short(body)
                    result.retry_after = _parse_retry_after(response.headers.get("retry-after"))
                    if response.status_code in TRANSIENT_STATUSES:
                        result.kind = "transient"
                    elif response.status_code == 404:
                        result.kind = "not_found"
                    elif response.status_code in FATAL_STATUSES:
                        result.kind = "fatal"
                    else:
                        result.kind = "fatal"
                    return

                lines = response.aiter_lines().__aiter__()
                first_token_deadline = loop.time() + first_token_timeout

                while True:
                    if result.yielded_text:
                        wait = self.stream_idle_timeout
                    else:
                        wait = first_token_deadline - loop.time()
                        if wait <= 0:
                            result.kind = "timeout"
                            return
                    try:
                        line = await asyncio.wait_for(lines.__anext__(), timeout=wait)
                    except StopAsyncIteration:
                        break
                    except asyncio.TimeoutError:
                        result.kind = "timeout"
                        return

                    if not line or not line.startswith("data: "):
                        continue
                    raw_data = line[len("data: "):].strip()
                    if not raw_data:
                        continue
                    try:
                        chunk_data = json.loads(raw_data)
                    except json.JSONDecodeError:
                        continue

                    feedback = chunk_data.get("promptFeedback") or {}
                    if feedback.get("blockReason"):
                        result.block_reason = str(feedback["blockReason"])

                    candidates = chunk_data.get("candidates", [])
                    delta_text = ""
                    finish_reason = None
                    if candidates:
                        first_cand = candidates[0]
                        finish_reason = first_cand.get("finishReason")
                        content = first_cand.get("content", {})
                        for part in content.get("parts", []):
                            if "text" in part:
                                delta_text += part["text"]

                    usage = None
                    usage_meta = chunk_data.get("usageMetadata")
                    if usage_meta:
                        p_tok = usage_meta.get("promptTokenCount", 0)
                        c_tok = usage_meta.get("candidatesTokenCount", 0)
                        t_tok = usage_meta.get("totalTokenCount", p_tok + c_tok)
                        usage = StreamUsage(
                            prompt_tokens=p_tok,
                            completion_tokens=c_tok,
                            total_tokens=t_tok,
                        )

                    if delta_text:
                        result.yielded_text = True
                    if delta_text or usage or finish_reason:
                        yield StreamChunk(delta=delta_text, usage=usage, finish_reason=finish_reason)

                if result.yielded_text:
                    result.kind = "ok"
                elif result.block_reason:
                    result.kind = "blocked"
                else:
                    result.kind = "empty"
        except httpx.TimeoutException:
            result.kind = "timeout"
        except httpx.TransportError as exc:
            result.kind = "network"
            result.detail = _short(type(exc).__name__)

    # ------------------------------------------------------------------ public
    async def stream_chat(
        self,
        messages: List[ChatMessage],
        system_prompt: str,
        model: Optional[str] = None,
        temperature: float = 0.7,
        max_tokens: int = 1024,
    ) -> AsyncGenerator[StreamChunk, None]:
        target_model = model or self.default_model
        if target_model.startswith("models/"):
            target_model = target_model[len("models/"):]

        candidate_models = self._candidate_models(target_model)
        payload = self._build_payload(messages, system_prompt, temperature, max_tokens)

        started = time.monotonic()
        last_kind = "transient"
        timeout = httpx.Timeout(connect=10.0, read=self.stream_idle_timeout, write=10.0, pool=10.0)

        async with httpx.AsyncClient(timeout=timeout, transport=self._transport) as client:
            for current_model in candidate_models:
                attempts_left = 1 + max(0, self.retries_per_model)
                out_of_time = False

                while attempts_left > 0:
                    attempts_left -= 1
                    remaining = self.total_timeout - (time.monotonic() - started)
                    if remaining < MIN_ATTEMPT_SECONDS:
                        out_of_time = True
                        break

                    result = _AttemptResult()
                    async for chunk in self._attempt(
                        client, current_model, payload, min(self.first_token_timeout, remaining), result
                    ):
                        yield chunk

                    if result.kind == "ok":
                        return

                    if result.yielded_text:
                        # Part of an answer was already sent; switching models would mix answers.
                        logger.warning(
                            "Gemini stream interrupted after partial output",
                            extra={"model": current_model, "kind": result.kind},
                        )
                        raise RuntimeError("The AI response was interrupted. Please try again.")

                    logger.warning(
                        "Gemini request did not succeed",
                        extra={
                            "model": current_model,
                            "kind": result.kind,
                            "http_status": result.status,
                            "attempts_left": attempts_left,
                            "detail": result.detail,
                        },
                    )

                    if result.kind == "fatal":
                        if result.status in (401, 403):
                            raise RuntimeError(
                                f"The Gemini API key was rejected (HTTP {result.status}). Please check GEMINI_API_KEY."
                            )
                        raise RuntimeError(
                            f"The Gemini API rejected the request (HTTP {result.status}). {_short(result.detail, 160)}"
                        )
                    if result.kind == "blocked":
                        raise RuntimeError(
                            f"The AI model declined to answer this request ({result.block_reason})."
                        )

                    last_kind = result.kind

                    if result.kind == "transient" and attempts_left > 0:
                        wait = result.retry_after
                        if wait is None:
                            wait = 1.5 + random.random()
                        if wait <= MAX_RETRY_AFTER_SECONDS:
                            left = self.total_timeout - (time.monotonic() - started)
                            await asyncio.sleep(min(wait, max(0.0, left - MIN_ATTEMPT_SECONDS)))
                            continue
                    # timeout / network / empty / not_found / exhausted retries: try the next model
                    break

                if out_of_time:
                    break

                if last_kind != "transient" and current_model != candidate_models[-1]:
                    logger.info("Trying fallback Gemini model", extra={"failed_model": current_model})

        raise RuntimeError(_FRIENDLY.get(last_kind, _FRIENDLY["transient"]))
