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
from app.llm.providers.groq import GroqLLMProvider
from app.llm.providers.cloudflare import CloudflareLLMProvider

_gemini_instance: Optional[GeminiLLMProvider] = None
_openai_instance: Optional[OpenAILLMProvider] = None
_ollama_instance: Optional[OllamaLLMProvider] = None
_openrouter_instance: Optional[OpenRouterLLMProvider] = None
_groq_instance: Optional[GroqLLMProvider] = None
_cloudflare_instance: Optional[CloudflareLLMProvider] = None


def get_llm_provider(model: Optional[str] = None, provider: Optional[str] = None) -> BaseLLMProvider:
    """
    Selects and returns an LLM provider instance based on provider name, model prefix, or available credentials.
    """
    global _gemini_instance, _openai_instance, _ollama_instance, _openrouter_instance, _groq_instance, _cloudflare_instance
    settings = get_settings()

    prov_lower = (provider or "").lower().strip()
    model_lower = (model or "").lower().strip()

    # Cloudflare explicit provider or @cf/ model prefix
    if prov_lower == "cloudflare" or model_lower.startswith("@cf/"):
        if not settings.CLOUDFLARE_API_TOKEN or not settings.CLOUDFLARE_ACCOUNT_ID:
            from app.core.config import reset_settings
            reset_settings()
            settings = get_settings()

        if not settings.CLOUDFLARE_API_TOKEN or not settings.CLOUDFLARE_ACCOUNT_ID:
            raise ValueError(
                f"Cloudflare requested ('{model}'), but CLOUDFLARE_API_TOKEN or CLOUDFLARE_ACCOUNT_ID is not configured."
            )
        if (
            _cloudflare_instance is None
            or _cloudflare_instance.api_token != settings.CLOUDFLARE_API_TOKEN
            or _cloudflare_instance.account_id != settings.CLOUDFLARE_ACCOUNT_ID
        ):
            _cloudflare_instance = CloudflareLLMProvider(
                api_token=settings.CLOUDFLARE_API_TOKEN,
                account_id=settings.CLOUDFLARE_ACCOUNT_ID,
            )
        return _cloudflare_instance

    # Groq explicit provider or Groq models
    if prov_lower == "groq" or any(prefix in model_lower for prefix in ("qwen/", "openai/gpt-oss", "allam", "groq/")):
        if not settings.GROQ_API_KEY:
            from app.core.config import reset_settings
            reset_settings()
            settings = get_settings()

        if not settings.GROQ_API_KEY:
            raise ValueError(f"Groq requested ('{model}'), but GROQ_API_KEY is not configured.")
        if _groq_instance is None or _groq_instance.api_key != settings.GROQ_API_KEY:
            _groq_instance = GroqLLMProvider(api_key=settings.GROQ_API_KEY)
        return _groq_instance

    # OpenRouter explicit provider or OpenRouter models
    if prov_lower == "openrouter" or any(prefix in model_lower for prefix in ("nvidia/", "google/gemma", "cohere/", "recursivellm/", "openrouter/free")):
        if not settings.OPENROUTER_API_KEY:
            from app.core.config import reset_settings
            reset_settings()
            settings = get_settings()

        if not settings.OPENROUTER_API_KEY:
            raise ValueError(f"OpenRouter requested ('{model}'), but OPENROUTER_API_KEY is not configured.")
        if _openrouter_instance is None or _openrouter_instance.api_key != settings.OPENROUTER_API_KEY:
            _openrouter_instance = OpenRouterLLMProvider(api_key=settings.OPENROUTER_API_KEY)
        return _openrouter_instance

    # Gemini explicit provider or Gemini models
    if prov_lower == "gemini" or model_lower.startswith("gemini"):
        if not settings.GEMINI_API_KEY:
            from app.core.config import reset_settings
            reset_settings()
            settings = get_settings()

        if not settings.GEMINI_API_KEY:
            raise ValueError(f"Gemini requested ('{model}'), but GEMINI_API_KEY is not configured.")
        if _gemini_instance is None or _gemini_instance.api_key != settings.GEMINI_API_KEY:
            _gemini_instance = GeminiLLMProvider(api_key=settings.GEMINI_API_KEY)
        return _gemini_instance

    # OpenAI models
    if any(model_lower.startswith(prefix) for prefix in ("gpt", "o1", "o3", "text-davinci")):
        if not settings.OPENAI_API_KEY:
            from app.core.config import reset_settings
            reset_settings()
            settings = get_settings()

        if not settings.OPENAI_API_KEY:
            raise ValueError(f"Model '{model}' requested, but OPENAI_API_KEY is not configured.")
        if _openai_instance is None or _openai_instance.api_key != settings.OPENAI_API_KEY:
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

    # Default fallback: prefer Gemini, then Cloudflare, then Groq, then OpenRouter, then OpenAI
    if settings.GEMINI_API_KEY:
        if _gemini_instance is None:
            _gemini_instance = GeminiLLMProvider(api_key=settings.GEMINI_API_KEY)
        return _gemini_instance

    if settings.CLOUDFLARE_API_TOKEN and settings.CLOUDFLARE_ACCOUNT_ID:
        if _cloudflare_instance is None:
            _cloudflare_instance = CloudflareLLMProvider(
                api_token=settings.CLOUDFLARE_API_TOKEN,
                account_id=settings.CLOUDFLARE_ACCOUNT_ID,
            )
        return _cloudflare_instance

    if settings.GROQ_API_KEY:
        if _groq_instance is None:
            _groq_instance = GroqLLMProvider(api_key=settings.GROQ_API_KEY)
        return _groq_instance

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
    global _gemini_instance, _openai_instance, _ollama_instance, _openrouter_instance, _groq_instance, _cloudflare_instance
    _gemini_instance = None
    _openai_instance = None
    _ollama_instance = None
    _openrouter_instance = None
    _groq_instance = None
    _cloudflare_instance = None
