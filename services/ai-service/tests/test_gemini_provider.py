"""
Tests for the Gemini streaming provider's reliability behavior and for log redaction.
No network is used: a fake httpx transport plays the role of Google's API.
"""

from __future__ import annotations

import asyncio
import json
import time

import httpx
import pytest

from app.core.logging import sanitize_message
from app.llm.providers.gemini import GeminiLLMProvider
from app.rag.prompt_builder import ChatMessage

KEY = "AQ.test-secret-key-123"
PRIMARY = "gemini-3.8-flash"
FALLBACK_1 = "gemini-3.5-flash"
FALLBACK_2 = "gemini-flash-latest"


def sse_body(*texts: str) -> bytes:
    body = ""
    for i, text in enumerate(texts):
        obj = {
            "candidates": [{"content": {"parts": [{"text": text}]}}],
            "usageMetadata": {"promptTokenCount": 5, "candidatesTokenCount": i + 1, "totalTokenCount": 6 + i},
        }
        body += "data: " + json.dumps(obj) + "\n\n"
    return body.encode()


class StallingStream(httpx.AsyncByteStream):
    """Optionally sends some bytes, then goes silent for a long time."""

    def __init__(self, first: bytes = b"", stall_seconds: float = 30.0):
        self.first = first
        self.stall_seconds = stall_seconds

    async def __aiter__(self):
        if self.first:
            yield self.first
        await asyncio.sleep(self.stall_seconds)
        yield b""


class FakeGoogle:
    """Scripted responses per model; records every request."""

    def __init__(self, script: dict[str, list]):
        self.script = {model: list(steps) for model, steps in script.items()}
        self.calls: list[httpx.Request] = []

    def models_called(self) -> list[str]:
        return [r.url.path.split("/models/")[1].split(":")[0] for r in self.calls]

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.calls.append(request)
        model = request.url.path.split("/models/")[1].split(":")[0]
        steps = self.script.get(model, [])
        step = steps.pop(0) if len(steps) > 1 else (steps[0] if steps else ("status", 500))
        kind = step[0]
        if kind == "ok":
            return httpx.Response(200, content=sse_body(*step[1]))
        if kind == "status":
            return httpx.Response(step[1], json={"error": {"message": "scripted error"}}, headers={"retry-after": "0"})
        if kind == "stall":
            return httpx.Response(200, stream=StallingStream())
        if kind == "partial_then_stall":
            return httpx.Response(200, stream=StallingStream(first=sse_body(step[1])))
        if kind == "raw":
            return httpx.Response(200, content=step[1])
        raise AssertionError(f"unknown step {step}")


def make_provider(fake: FakeGoogle, **kwargs) -> GeminiLLMProvider:
    defaults = dict(first_token_timeout=0.3, stream_idle_timeout=0.3, total_timeout=30.0, retries_per_model=1)
    defaults.update(kwargs)
    return GeminiLLMProvider(api_key=KEY, transport=httpx.MockTransport(fake), **defaults)


async def collect(provider: GeminiLLMProvider, model: str = PRIMARY):
    chunks = []
    async for chunk in provider.stream_chat([ChatMessage(role="user", content="hi")], "system", model=model):
        chunks.append(chunk)
    return chunks


async def test_key_is_sent_in_header_never_in_url():
    fake = FakeGoogle({PRIMARY: [("ok", ["Hello", " world"])]})
    chunks = await collect(make_provider(fake))

    assert "".join(c.delta for c in chunks) == "Hello world"
    assert chunks[-1].usage is not None
    request = fake.calls[0]
    assert request.headers["x-goog-api-key"] == KEY
    assert "key=" not in str(request.url)
    assert KEY not in str(request.url)


async def test_transient_503_is_retried_on_same_model():
    fake = FakeGoogle({PRIMARY: [("status", 503), ("ok", ["Recovered"])]})
    chunks = await collect(make_provider(fake))

    assert "".join(c.delta for c in chunks) == "Recovered"
    assert fake.models_called() == [PRIMARY, PRIMARY]


async def test_falls_back_to_next_model_after_repeated_503():
    fake = FakeGoogle({PRIMARY: [("status", 503)], FALLBACK_1: [("ok", ["From fallback"])]})
    chunks = await collect(make_provider(fake))

    assert "".join(c.delta for c in chunks) == "From fallback"
    assert fake.models_called() == [PRIMARY, PRIMARY, FALLBACK_1]


async def test_stalled_model_is_abandoned_quickly_not_after_minutes():
    fake = FakeGoogle({PRIMARY: [("status", 503)], FALLBACK_1: [("stall",)], FALLBACK_2: [("ok", ["Third time"])]})
    started = time.monotonic()
    chunks = await collect(make_provider(fake))
    elapsed = time.monotonic() - started

    assert "".join(c.delta for c in chunks) == "Third time"
    assert elapsed < 5.0  # the old code waited up to 180 s per stalled model


async def test_all_models_busy_gives_friendly_error_without_secrets():
    fake = FakeGoogle({PRIMARY: [("status", 503)], FALLBACK_1: [("status", 503)], FALLBACK_2: [("status", 503)]})
    with pytest.raises(RuntimeError) as excinfo:
        await collect(make_provider(fake))

    message = str(excinfo.value)
    assert "busy" in message.lower()
    assert KEY not in message
    assert "http" not in message.lower()


async def test_all_models_stalling_gives_timeout_message():
    fake = FakeGoogle({PRIMARY: [("stall",)], FALLBACK_1: [("stall",)], FALLBACK_2: [("stall",)]})
    started = time.monotonic()
    with pytest.raises(RuntimeError) as excinfo:
        await collect(make_provider(fake))

    assert "too long" in str(excinfo.value).lower()
    assert time.monotonic() - started < 5.0


async def test_no_model_switch_after_partial_output():
    fake = FakeGoogle({PRIMARY: [("partial_then_stall", "Half an ans")], FALLBACK_1: [("ok", ["Other answer"])]})
    received: list[str] = []
    with pytest.raises(RuntimeError) as excinfo:
        async for chunk in make_provider(fake).stream_chat(
            [ChatMessage(role="user", content="hi")], "system", model=PRIMARY
        ):
            received.append(chunk.delta)

    assert "".join(received) == "Half an ans"
    assert "interrupted" in str(excinfo.value).lower()
    assert fake.models_called() == [PRIMARY]  # never mixed in a second model's answer


async def test_bad_key_fails_fast_without_retries_and_without_leaking_it():
    fake = FakeGoogle({PRIMARY: [("status", 403)]})
    with pytest.raises(RuntimeError) as excinfo:
        await collect(make_provider(fake))

    assert "GEMINI_API_KEY" in str(excinfo.value)
    assert KEY not in str(excinfo.value)
    assert fake.models_called() == [PRIMARY]


async def test_unknown_model_404_skips_to_next_model():
    fake = FakeGoogle({PRIMARY: [("status", 404)], FALLBACK_1: [("ok", ["Found one"])]})
    chunks = await collect(make_provider(fake))

    assert "".join(c.delta for c in chunks) == "Found one"
    assert fake.models_called() == [PRIMARY, FALLBACK_1]


async def test_blocked_prompt_gives_clear_message():
    body = ("data: " + json.dumps({"promptFeedback": {"blockReason": "SAFETY"}}) + "\n\n").encode()
    fake = FakeGoogle({PRIMARY: [("raw", body)]})
    with pytest.raises(RuntimeError) as excinfo:
        await collect(make_provider(fake))

    assert "declined" in str(excinfo.value).lower()
    assert fake.models_called() == [PRIMARY]


def test_log_sanitizer_masks_api_keys_and_tokens():
    line = (
        "HTTP Request: POST https://generativelanguage.googleapis.com/v1beta/models/x:streamGenerateContent"
        "?alt=sse&key=AQ.test-secret-key-123 \"HTTP/1.1 503 Service Unavailable\""
    )
    cleaned = sanitize_message(line)
    assert "AQ.test-secret-key-123" not in cleaned
    assert "key=***" in cleaned

    assert "abc.def-ghi" not in sanitize_message("Authorization: Bearer abc.def-ghi")
    assert "x-goog-api-key: ***" in sanitize_message("x-goog-api-key: SECRETVALUE123")
    assert "p@ss" not in sanitize_message("mongodb+srv://user:p@ss@cluster0.example.mongodb.net/")
    assert sanitize_message("plain message without secrets") == "plain message without secrets"
