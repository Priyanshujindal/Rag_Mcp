import os
os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["HF_HUB_DISABLE_SYMLINKS_WARNING"] = "1"

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from typing import AsyncGenerator

from app.core.config import get_settings
from app.main import app


@pytest.fixture(autouse=True)
def test_environment_safety() -> None:
    """
    Enforce Atlas database test safety rules:
    - Tests MUST use a test database ending in '_test'
    - Test database name MUST NOT equal main database name
    - Never drops databases
    """
    settings = get_settings()

    test_db = settings.MONGODB_TEST_DB_NAME
    main_db = settings.MONGODB_DB_NAME

    if not test_db.endswith("_test"):
        pytest.fail(
            f"SAFETY VIOLATION: MONGODB_TEST_DB_NAME ('{test_db}') does not end with '_test'. Tests aborted."
        )

    if test_db == main_db:
        pytest.fail(
            f"SAFETY VIOLATION: MONGODB_TEST_DB_NAME ('{test_db}') equals MONGODB_DB_NAME ('{main_db}'). Tests aborted."
        )


@pytest_asyncio.fixture
async def async_client() -> AsyncGenerator[AsyncClient, None]:
    """
    Test HTTP client for FastAPI ASGI application.

    Uses the app's lifespan context so that app.state.mongo_client is properly
    initialised before requests are made.  httpx 0.28.x no longer runs the
    ASGI lifespan automatically via ASGITransport, so we must do it manually.
    """
    async with app.router.lifespan_context(app):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://testserver") as client:
            yield client
