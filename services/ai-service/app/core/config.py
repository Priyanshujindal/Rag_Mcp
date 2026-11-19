import os
from pathlib import Path
from typing import Literal
from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# Disable HuggingFace network calls if offline or model already cached
if "HF_HUB_OFFLINE" not in os.environ and "HF_TOKEN" not in os.environ:
    os.environ["HF_HUB_DISABLE_SYMLINKS_WARNING"] = "1"


# Locate repo root by walking up from this file: services/ai-service/app/core/config.py -> repo root is 4 levels up
REPO_ROOT = Path(__file__).resolve().parents[4]
ENV_FILE_PATH = REPO_ROOT / ".env"


class Settings(BaseSettings):
    """
    Application settings loaded from the repo-root .env file and environment variables.
    Fails fast with clear, secret-free error messages.
    """
    model_config = SettingsConfigDict(
        env_file=str(ENV_FILE_PATH) if ENV_FILE_PATH.exists() else None,
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # MongoDB Atlas
    MONGODB_URI: str = Field(..., description="MongoDB connection string")
    MONGODB_DB_NAME: str = Field(default="Rag_Mcp", description="Application database name")
    MONGODB_TEST_DB_NAME: str = Field(default="Rag_Mcp_test", description="Test database name")
    REQUIRE_LIVE_TESTS: bool = Field(default=False, description="Whether live tests must run or skip cleanly")

    # Security
    INTERNAL_API_KEY: str = Field(..., min_length=16, description="Shared secret for internal Node API calls")

    # Embeddings
    EMBEDDING_PROVIDER: Literal["fastembed", "gemini", "openai"] = Field(
        default="fastembed", description="Embedding provider"
    )
    EMBEDDING_MODEL: str = Field(default="BAAI/bge-small-en-v1.5", description="Embedding model identifier")
    EMBEDDING_DIMENSIONS: int = Field(default=384, description="Vector dimensions; must match model")

    # Retrieval
    HYBRID_STRATEGY: Literal["auto", "rankfusion", "manual"] = Field(
        default="auto", description="Hybrid search strategy"
    )
    RERANKER: Literal["none", "cross-encoder"] = Field(default="none", description="Reranker model")

    # Ingestion & Crawler
    CRAWL_MAX_PAGES: int = Field(default=50, ge=1, description="Max pages per crawl")
    CRAWL_MAX_DEPTH: int = Field(default=3, ge=1, description="Max link depth")
    MAX_FILE_MB: int = Field(default=10, ge=1, description="Max file size in MB")
    MAX_CHUNKS_PER_WORKSPACE: int = Field(default=5000, ge=1, description="Max chunks per workspace")
    ESTIMATED_DB_CAPACITY_MB: int = Field(default=400, ge=1, description="Estimated DB storage budget in MB")

    # External Provider Keys
    GEMINI_API_KEY: str = Field(default="", description="Google Gemini API key")
    OPENAI_API_KEY: str = Field(default="", description="OpenAI API key")
    OPENROUTER_API_KEY: str = Field(default="", description="OpenRouter API key")
    OLLAMA_BASE_URL: str = Field(default="http://localhost:11434", description="Ollama server endpoint")

    # Server settings
    HOST: str = Field(default="0.0.0.0")
    PORT: int = Field(default=8001)

    @field_validator("MONGODB_URI")
    @classmethod
    def validate_mongodb_uri(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("MONGODB_URI must not be empty")
        if not (v.startswith("mongodb://") or v.startswith("mongodb+srv://")):
            raise ValueError("MONGODB_URI must begin with mongodb:// or mongodb+srv://")
        return v.strip()

    @field_validator("INTERNAL_API_KEY")
    @classmethod
    def validate_internal_key(cls, v: str) -> str:
        if not v or len(v.strip()) < 16:
            raise ValueError("INTERNAL_API_KEY must be at least 16 characters long")
        return v.strip()

    @model_validator(mode="after")
    def validate_database_safety(self) -> "Settings":
        """
        Atlas safety check:
        Test database name must end with '_test' and differ from main database name.
        """
        if not self.MONGODB_TEST_DB_NAME.endswith("_test"):
            raise ValueError(
                f"MONGODB_TEST_DB_NAME ('{self.MONGODB_TEST_DB_NAME}') must end with '_test' for safety."
            )
        if self.MONGODB_TEST_DB_NAME == self.MONGODB_DB_NAME:
            raise ValueError(
                f"MONGODB_TEST_DB_NAME cannot be equal to MONGODB_DB_NAME ('{self.MONGODB_DB_NAME}')."
            )
        return self


_settings: Settings | None = None


def get_settings() -> Settings:
    """Singleton getter for application settings."""
    global _settings
    if _settings is None:
        _settings = Settings()
    return _settings


def reset_settings() -> None:
    """Reset cached settings (useful in test suites)."""
    global _settings
    _settings = None


def verify_embedding_model(settings: Settings) -> None:
    """
    At startup, embed a test string and verify the vector length equals EMBEDDING_DIMENSIONS.
    Fails fast if there is a mismatch.
    """
    if settings.EMBEDDING_PROVIDER == "fastembed":
        from fastembed import TextEmbedding

        model = TextEmbedding(model_name=settings.EMBEDDING_MODEL)
        embeddings = list(model.embed(["Rag_Mcp startup embedding dimension check"]))
        dim = len(embeddings[0])
        if dim != settings.EMBEDDING_DIMENSIONS:
            raise RuntimeError(
                f"Embedding dimension mismatch: model '{settings.EMBEDDING_MODEL}' produced {dim} dimensions, "
                f"but EMBEDDING_DIMENSIONS is configured as {settings.EMBEDDING_DIMENSIONS}."
            )
    elif settings.EMBEDDING_PROVIDER == "openai":
        # In startup verification, if API key is missing, raise clear error
        if not settings.OPENAI_API_KEY:
            raise RuntimeError("OPENAI_API_KEY is required when EMBEDDING_PROVIDER is 'openai'")
    elif settings.EMBEDDING_PROVIDER == "gemini":
        if not settings.GEMINI_API_KEY:
            raise RuntimeError("GEMINI_API_KEY is required when EMBEDDING_PROVIDER is 'gemini'")

