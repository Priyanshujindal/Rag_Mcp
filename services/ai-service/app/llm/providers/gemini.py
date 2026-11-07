"""
app/llm/providers/gemini.py
===========================
Google Gemini LLM Streaming Provider using httpx async client.
"""

from __future__ import annotations

import json
from typing import AsyncGenerator, List, Optional
import httpx

from app.core.logging import logger
from app.rag.prompt_builder import ChatMessage
from app.llm.providers.base import BaseLLMProvider, StreamChunk
from app.llm.streaming import StreamUsage


class GeminiLLMProvider(BaseLLMProvider):
    """
    Streaming provider for Google Gemini models via Generative Language REST API.
    """

    def __init__(self, api_key: str, default_model: str = "gemini-1.5-flash"):
        self.api_key = api_key
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
        if target_model.startswith("models/"):
            target_model = target_model[len("models/"):]

        candidate_models = [target_model]
        if target_model in ("gemini-3.8-flash", "gemini-3.6-flash", "gemini-1.5-flash"):
            for alt in ("gemini-3.5-flash", "gemini-flash-latest"):
                if alt not in candidate_models:
                    candidate_models.append(alt)

        # Map ChatMessage roles ('user', 'assistant') to Gemini roles ('user', 'model')
        contents = []
        for msg in messages:
            role = "model" if msg.role == "assistant" else "user"
            contents.append({"role": role, "parts": [{"text": msg.content}]})

        payload = {
            "contents": contents,
            "generationConfig": {
                "temperature": temperature,
                "maxOutputTokens": max(max_tokens or 4096, 4096),
            },
        }
        if system_prompt:
            payload["systemInstruction"] = {"parts": [{"text": system_prompt}]}

        timeout = httpx.Timeout(connect=10.0, read=45.0, write=10.0, pool=10.0)

        async with httpx.AsyncClient(timeout=timeout) as client:
            last_err_msg = ""
            for current_model in candidate_models:
                url = (
                    f"https://generativelanguage.googleapis.com/v1beta/models/{current_model}:streamGenerateContent"
                    f"?alt=sse&key={self.api_key}"
                )
                try:
                    async with client.stream("POST", url, json=payload) as response:
                        if response.status_code != 200:
                            err_body = await response.aread()
                            err_text = err_body.decode("utf-8", errors="replace")
                            logger.warn(f"Gemini model {current_model} returned {response.status_code}: {err_text}")
                            last_err_msg = f"Gemini status {response.status_code}: {err_text}"
                            if response.status_code in (503, 429, 404) and current_model != candidate_models[-1]:
                                logger.info(f"Retrying with fallback model...")
                                continue
                            raise RuntimeError(last_err_msg)

                        received_any = False
                        async for line in response.aiter_lines():
                            if not line or not line.startswith("data: "):
                                continue

                            raw_data = line[len("data: "):].strip()
                            if not raw_data:
                                continue

                            try:
                                chunk_data = json.loads(raw_data)
                            except json.JSONDecodeError:
                                continue

                            # Extract generated text
                            candidates = chunk_data.get("candidates", [])
                            delta_text = ""
                            finish_reason = None
                            if candidates:
                                first_cand = candidates[0]
                                finish_reason = first_cand.get("finishReason")
                                content = first_cand.get("content", {})
                                parts = content.get("parts", [])
                                for part in parts:
                                    if "text" in part:
                                        delta_text += part["text"]

                            # Extract usage metadata if present
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

                            if delta_text or usage or finish_reason:
                                received_any = True
                                yield StreamChunk(
                                    delta=delta_text,
                                    usage=usage,
                                    finish_reason=finish_reason,
                                )

                        if received_any:
                            return
                except httpx.TimeoutException as exc:
                    logger.warn(f"Gemini model {current_model} timed out: {exc}")
                    if current_model != candidate_models[-1]:
                        continue
                    raise RuntimeError("Gemini API connection timed out") from exc
                except httpx.NetworkError as exc:
                    logger.warn(f"Gemini model {current_model} network error: {exc}")
                    if current_model != candidate_models[-1]:
                        continue
                    raise RuntimeError(f"Gemini API network error: {exc}") from exc

            if last_err_msg:
                raise RuntimeError(last_err_msg)

