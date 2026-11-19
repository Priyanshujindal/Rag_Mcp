import pytest
from pydantic import ValidationError

from app.core.config import Settings, verify_embedding_model


def test_config_loads_defaults():
    """Verify default configurations adhere to requirements."""
    settings = Settings(
        MONGODB_URI="mongodb://localhost:27017",
        INTERNAL_API_KEY="0123456789abcdef0123456789abcdef",
    )
    assert settings.MONGODB_DB_NAME == "Rag_Mcp"
    assert settings.MONGODB_TEST_DB_NAME == "Rag_Mcp_test"
    assert settings.EMBEDDING_PROVIDER == "fastembed"
    assert settings.EMBEDDING_MODEL == "BAAI/bge-small-en-v1.5"
    assert settings.EMBEDDING_DIMENSIONS == 384
    assert settings.HYBRID_STRATEGY == "auto"
    assert settings.RERANKER == "none"
    assert settings.CRAWL_MAX_PAGES == 50
    assert settings.CRAWL_MAX_DEPTH == 3
    assert settings.MAX_FILE_MB == 10
    assert settings.MAX_CHUNKS_PER_WORKSPACE == 5000
    assert settings.ESTIMATED_DB_CAPACITY_MB == 400


def test_safety_guard_rejects_test_db_without_test_suffix():
    """Verify safety guard refuses test database names that don't end in _test."""
    with pytest.raises(ValidationError) as exc_info:
        Settings(
            MONGODB_URI="mongodb://localhost:27017",
            INTERNAL_API_KEY="0123456789abcdef0123456789abcdef",
            MONGODB_TEST_DB_NAME="production_db",
        )
    assert "must end with '_test'" in str(exc_info.value)


def test_safety_guard_rejects_test_db_equal_to_main_db():
    """Verify safety guard refuses test database equal to main database."""
    with pytest.raises(ValidationError) as exc_info:
        Settings(
            MONGODB_URI="mongodb://localhost:27017",
            INTERNAL_API_KEY="0123456789abcdef0123456789abcdef",
            MONGODB_DB_NAME="Rag_Mcp_test",
            MONGODB_TEST_DB_NAME="Rag_Mcp_test",
        )
    assert "cannot be equal to MONGODB_DB_NAME" in str(exc_info.value)


def test_invalid_mongodb_uri_rejected():
    """Verify malformed MongoDB connection strings fail validation."""
    with pytest.raises(ValidationError) as exc_info:
        Settings(
            MONGODB_URI="postgres://user:pass@localhost:5432/db",
            INTERNAL_API_KEY="0123456789abcdef0123456789abcdef",
        )
    assert "must begin with mongodb://" in str(exc_info.value)


def test_short_internal_key_rejected():
    """Verify short internal keys fail validation."""
    with pytest.raises(ValidationError) as exc_info:
        Settings(
            MONGODB_URI="mongodb://localhost:27017",
            INTERNAL_API_KEY="short_key",
        )
    assert "INTERNAL_API_KEY" in str(exc_info.value)


def test_verify_embedding_model_success():
    """Verify default model embeddings match configured dimensions (384)."""
    settings = Settings(
        MONGODB_URI="mongodb://localhost:27017",
        INTERNAL_API_KEY="0123456789abcdef0123456789abcdef",
        EMBEDDING_PROVIDER="fastembed",
        EMBEDDING_MODEL="BAAI/bge-small-en-v1.5",
        EMBEDDING_DIMENSIONS=384,
    )
    # Should not raise
    verify_embedding_model(settings)


def test_verify_embedding_model_dimension_mismatch():
    """Verify runtime error is raised if configured dimensions do not match model output."""
    settings = Settings(
        MONGODB_URI="mongodb://localhost:27017",
        INTERNAL_API_KEY="0123456789abcdef0123456789abcdef",
        EMBEDDING_PROVIDER="fastembed",
        EMBEDDING_MODEL="BAAI/bge-small-en-v1.5",
        EMBEDDING_DIMENSIONS=768,  # Intentional mismatch (model produces 384)
    )
    with pytest.raises(RuntimeError) as exc_info:
        verify_embedding_model(settings)
    assert "dimension mismatch" in str(exc_info.value).lower()

