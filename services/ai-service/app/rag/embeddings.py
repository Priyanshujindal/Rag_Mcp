import abc
import asyncio
import time
from typing import Any, List
import httpx
from pydantic import BaseModel

from app.core.config import Settings, get_settings
from app.core.logging import logger


class EmbeddingResult(BaseModel):
    embeddings: List[List[float]]
    model: str
    dimensions: int


class BaseEmbeddingProvider(abc.ABC):
    """Abstract base class for dense vector embedding providers."""

    def __init__(self, model_name: str, dimensions: int):
        self.model_name = model_name
        self.dimensions = dimensions

    @abc.abstractmethod
    async def embed_documents(self, texts: List[str], batch_size: int = 32) -> List[List[float]]:
        """Embed a list of document chunk texts into dense vectors."""
        pass

    @abc.abstractmethod
    async def embed_query(self, text: str) -> List[float]:
        """Embed a single search query text into a dense vector."""
        pass


class FastEmbedProvider(BaseEmbeddingProvider):
    """Local, offline embedding provider using FastEmbed (ONNX runtime)."""

    def __init__(self, model_name: str = "BAAI/bge-small-en-v1.5", dimensions: int = 384):
        super().__init__(model_name=model_name, dimensions=dimensions)
        from fastembed import TextEmbedding

        self._model = TextEmbedding(model_name=self.model_name)

    async def embed_documents(self, texts: List[str], batch_size: int = 32) -> List[List[float]]:
        if not texts:
            return []

        # Run CPU-bound ONNX model in threadpool to avoid blocking event loop
        def _embed() -> List[List[float]]:
            results: List[List[float]] = []
            for i in range(0, len(texts), batch_size):
                batch = texts[i : i + batch_size]
                batch_embeddings = list(self._model.embed(batch))
                for emb in batch_embeddings:
                    vec = emb.tolist() if hasattr(emb, "tolist") else list(emb)
                    results.append(vec)
            return results

        embeddings = await asyncio.to_thread(_embed)
        return embeddings

    async def embed_query(self, text: str) -> List[float]:
        if not text.strip():
            return [0.0] * self.dimensions

        def _embed() -> List[float]:
            emb = list(self._model.query_embed(text))[0]
            return emb.tolist() if hasattr(emb, "tolist") else list(emb)

        return await asyncio.to_thread(_embed)


class OpenAIEmbeddingProvider(BaseEmbeddingProvider):
    """Remote embedding provider using OpenAI API with retries and backoff."""

    def __init__(
        self,
        api_key: str,
        model_name: str = "text-embedding-3-small",
        dimensions: int = 1536,
        base_url: str = "https://api.openai.com/v1",
    ):
        super().__init__(model_name=model_name, dimensions=dimensions)
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")

    async def _request_with_retry(self, client: httpx.AsyncClient, input_data: Any) -> List[List[float]]:
        url = f"{self.base_url}/embeddings"
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }
        payload = {
            "model": self.model_name,
            "input": input_data,
        }

        max_retries = 3
        delay = 1.0

        for attempt in range(max_retries):
            try:
                res = await client.post(url, json=payload, headers=headers, timeout=30.0)
                if res.status_code == 200:
                    data = res.json()
                    # Preserve sorting by index
                    sorted_items = sorted(data["data"], key=lambda x: x["index"])
                    return [item["embedding"] for item in sorted_items]
                elif res.status_code in (429, 500, 502, 503, 504):
                    logger.warning(
                        f"OpenAI embedding transient error {res.status_code}. Retrying in {delay}s..."
                    )
                    await asyncio.sleep(delay)
                    delay *= 2
                else:
                    raise RuntimeError(f"OpenAI embedding error {res.status_code}: {res.text}")
            except (httpx.TimeoutException, httpx.NetworkError) as e:
                if attempt == max_retries - 1:
                    raise RuntimeError(f"OpenAI connection error: {e}")
                await asyncio.sleep(delay)
                delay *= 2

        raise RuntimeError("OpenAI embedding max retries exceeded")

    async def embed_documents(self, texts: List[str], batch_size: int = 32) -> List[List[float]]:
        if not texts:
            return []

        results: List[List[float]] = []
        async with httpx.AsyncClient() as client:
            for i in range(0, len(texts), batch_size):
                batch = texts[i : i + batch_size]
                batch_embeddings = await self._request_with_retry(client, batch)
                results.extend(batch_embeddings)
        return results

    async def embed_query(self, text: str) -> List[float]:
        if not text.strip():
            return [0.0] * self.dimensions

        async with httpx.AsyncClient() as client:
            res = await self._request_with_retry(client, text)
            return res[0]


class GeminiEmbeddingProvider(BaseEmbeddingProvider):
    """Remote embedding provider using Google Gemini API with retries and backoff."""

    def __init__(
        self,
        api_key: str,
        model_name: str = "models/text-embedding-004",
        dimensions: int = 768,
    ):
        super().__init__(model_name=model_name, dimensions=dimensions)
        self.api_key = api_key

    async def _request_with_retry(self, client: httpx.AsyncClient, text: str) -> List[float]:
        # Google Generative Language REST API endpoint for embedContent
        # The API key goes in a header, never in the URL, so it cannot leak into logs.
        endpoint = f"https://generativelanguage.googleapis.com/v1beta/{self.model_name}:embedContent"
        headers = {"x-goog-api-key": self.api_key, "Content-Type": "application/json"}
        payload = {
            "content": {"parts": [{"text": text}]},
        }

        max_retries = 3
        delay = 1.0

        for attempt in range(max_retries):
            try:
                res = await client.post(endpoint, json=payload, headers=headers, timeout=30.0)
                if res.status_code == 200:
                    data = res.json()
                    return data["embedding"]["values"]
                elif res.status_code in (429, 500, 503):
                    await asyncio.sleep(delay)
                    delay *= 2
                else:
                    raise RuntimeError(f"Gemini embedding error {res.status_code}: {res.text}")
            except (httpx.TimeoutException, httpx.NetworkError) as e:
                if attempt == max_retries - 1:
                    raise RuntimeError(f"Gemini connection error: {e}")
                await asyncio.sleep(delay)
                delay *= 2

        raise RuntimeError("Gemini embedding max retries exceeded")

    async def embed_documents(self, texts: List[str], batch_size: int = 32) -> List[List[float]]:
        if not texts:
            return []

        results: List[List[float]] = []
        async with httpx.AsyncClient() as client:
            # Gemini v1beta embedContent embeds one text per request (batchEmbedContents also supported)
            for text in texts:
                emb = await self._request_with_retry(client, text)
                results.append(emb)
        return results

    async def embed_query(self, text: str) -> List[float]:
        if not text.strip():
            return [0.0] * self.dimensions
        async with httpx.AsyncClient() as client:
            return await self._request_with_retry(client, text)


_provider_instance: BaseEmbeddingProvider | None = None


def get_embedding_provider(settings: Settings | None = None) -> BaseEmbeddingProvider:
    """Returns singleton embedding provider instance according to settings."""
    global _provider_instance
    if _provider_instance is not None:
        return _provider_instance

    if settings is None:
        settings = get_settings()

    provider_type = settings.EMBEDDING_PROVIDER.lower()
    if provider_type == "fastembed":
        _provider_instance = FastEmbedProvider(
            model_name=settings.EMBEDDING_MODEL,
            dimensions=settings.EMBEDDING_DIMENSIONS,
        )
    elif provider_type == "openai":
        if not settings.OPENAI_API_KEY:
            raise ValueError("OPENAI_API_KEY is required for openai embedding provider")
        _provider_instance = OpenAIEmbeddingProvider(
            api_key=settings.OPENAI_API_KEY,
            model_name=settings.EMBEDDING_MODEL,
            dimensions=settings.EMBEDDING_DIMENSIONS,
        )
    elif provider_type == "gemini":
        if not settings.GEMINI_API_KEY:
            raise ValueError("GEMINI_API_KEY is required for gemini embedding provider")
        _provider_instance = GeminiEmbeddingProvider(
            api_key=settings.GEMINI_API_KEY,
            model_name=settings.EMBEDDING_MODEL,
            dimensions=settings.EMBEDDING_DIMENSIONS,
        )
    else:
        raise ValueError(f"Unknown embedding provider: {provider_type}")

    return _provider_instance

