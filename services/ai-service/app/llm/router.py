"""
app/llm/router.py
=================
Dynamic router for LLM streaming providers based on model identifier and configuration.
"""

from __future__ import annotations

from typing import Optional

from app.core.config import get_settings
from app.llm.providers.base import BaseLLMProvider
from app.llm.providers.gemini import GeminiLLMProvider
from app.llm.providers.openai import OpenAILLMProvider
from app.llm.providers.ollama import OllamaLLMProvider
from app.llm.providers.openrouter import OpenRouterLLMProvider

_gemini_instance: Optional[GeminiLLMProvider] = None
_openai_instance: Optional[OpenAILLMProvider] = None
_ollama_instance: Optional[OllamaLLMProvider] = None
_openrouter_instance: Optional[OpenRouterLLMProvider] = None


def get_llm_provider(model: Optional[str] = None, provider: Optional[str] = None) -> BaseLLMProvider:
    """
    Selects and returns an LLM provider instance based on provider name, model prefix, or available credentials.
    """
    global _gemini_instance, _openai_instance, _ollama_instance, _openrouter_instance
    settings = get_settings()

    prov_lower = (provider or "").lower().strip()
    model_lower = (model or "").lower().strip()

    # OpenRouter explicit provider or OpenRouter models
    if prov_lower == "openrouter" or any(prefix in model_lower for prefix in ("nvidia/", "google/gemma", "cohere/", "recursivellm/", "openrouter/free")):
        if not settings.OPENROUTER_API_KEY:
            raise ValueError(f"OpenRouter requested ('{model}'), but OPENROUTER_API_KEY is not configured.")
        if _openrouter_instance is None:
            _openrouter_instance = OpenRouterLLMProvider(api_key=settings.OPENROUTER_API_KEY)
        return _openrouter_instance

    # Gemini explicit provider or Gemini models
    if prov_lower == "gemini" or model_lower.startswith("gemini"):
        if not settings.GEMINI_API_KEY:
            raise ValueError(f"Gemini requested ('{model}'), but GEMINI_API_KEY is not configured.")
        if _gemini_instance is None:
            _gemini_instance = GeminiLLMProvider(api_key=settings.GEMINI_API_KEY)
        return _gemini_instance

    # OpenAI models
    if any(model_lower.startswith(prefix) for prefix in ("gpt", "o1", "o3", "text-davinci")):
        if not settings.OPENAI_API_KEY:
            raise ValueError(f"Model '{model}' requested, but OPENAI_API_KEY is not configured.")
        if _openai_instance is None:
            _openai_instance = OpenAILLMProvider(api_key=settings.OPENAI_API_KEY)
        return _openai_instance

    # Ollama local models (kept for future, not exposed in UI)
    if (
        model_lower.startswith("ollama/")
        or any(m in model_lower for m in ("llama", "mistral", "qwen", "phi", "deepseek"))
    ):
        if _ollama_instance is None:
            _ollama_instance = OllamaLLMProvider(base_url=settings.OLLAMA_BASE_URL)
        return _ollama_instance

    # Default fallback: prefer Gemini, then OpenRouter, then OpenAI
    if settings.GEMINI_API_KEY:
        if _gemini_instance is None:
            _gemini_instance = GeminiLLMProvider(api_key=settings.GEMINI_API_KEY)
        return _gemini_instance

    if settings.OPENROUTER_API_KEY:
        if _openrouter_instance is None:
            _openrouter_instance = OpenRouterLLMProvider(api_key=settings.OPENROUTER_API_KEY)
        return _openrouter_instance

    if settings.OPENAI_API_KEY:
        if _openai_instance is None:
            _openai_instance = OpenAILLMProvider(api_key=settings.OPENAI_API_KEY)
        return _openai_instance

    # Local fallback (not exposed in UI for now)
    if _ollama_instance is None:
        _ollama_instance = OllamaLLMProvider(base_url=settings.OLLAMA_BASE_URL)
    return _ollama_instance


def reset_llm_providers() -> None:
    """Reset cached provider singletons (for tests)."""
    global _gemini_instance, _openai_instance, _ollama_instance, _openrouter_instance
    _gemini_instance = None
    _openai_instance = None
    _ollama_instance = None
    _openrouter_instance = None
