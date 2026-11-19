from unittest.mock import AsyncMock, MagicMock
from bson import ObjectId
import pytest
from httpx import AsyncClient

from app.core.config import get_settings
from app.core.tenant import require_tenant, TenantContext
from app.main import app


# Register a temporary test route using require_tenant to test tenant isolation
@app.get("/test/tenant-scope")
async def demo_tenant_scope(tenant: TenantContext = pytest.importorskip("fastapi").Depends(require_tenant)):
    return {
        "status": "ok",
        "workspaceId": str(tenant.workspace_id),
        "is_object_id": isinstance(tenant.workspace_id, ObjectId),
    }


async def test_health_endpoint_public(async_client: AsyncClient):
    """GET /health must succeed without any authentication header."""
    res = await async_client.get("/health")
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "ok"
    assert data["service"] == "Rag_Mcp-ai-service"
    assert "X-Request-Id" in res.headers


async def test_ready_endpoint_requires_internal_key(async_client: AsyncClient):
    """GET /ready without X-Internal-Key must return 401 with standard error envelope."""
    res = await async_client.get("/ready")
    assert res.status_code == 401
    data = res.json()
    assert "error" in data
    assert data["error"]["code"] == "UNAUTHORIZED"
    assert "X-Internal-Key" in data["error"]["message"]


async def test_ready_endpoint_rejects_invalid_internal_key(async_client: AsyncClient):
    """GET /ready with incorrect key must return 401."""
    res = await async_client.get("/ready", headers={"X-Internal-Key": "invalid_wrong_key_123456789"})
    assert res.status_code == 401
    data = res.json()
    assert data["error"]["code"] == "UNAUTHORIZED"
    assert data["error"]["message"] == "Invalid internal API key"


async def test_ready_endpoint_with_valid_key(async_client: AsyncClient):
    """GET /ready with valid key calls Mongo ping and returns ready status."""
    settings = get_settings()

    # Mock mongo_client ping
    mock_db = MagicMock()
    mock_db.command = AsyncMock(return_value={"ok": 1})
    mock_client = MagicMock()
    mock_client.__getitem__.return_value = mock_db
    app.state.mongo_client = mock_client

    res = await async_client.get("/ready", headers={"X-Internal-Key": settings.INTERNAL_API_KEY})
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "ready"
    assert data["database"] == "connected"


async def test_tenant_route_requires_internal_key(async_client: AsyncClient):
    """Tenant-scoped routes must reject missing internal key."""
    res = await async_client.get(
        "/test/tenant-scope",
        headers={"X-Workspace-Id": "507f1f77bcf86cd799439011"},
    )
    assert res.status_code == 401
    assert res.json()["error"]["code"] == "UNAUTHORIZED"


async def test_tenant_route_requires_workspace_id(async_client: AsyncClient):
    """Tenant-scoped routes must reject missing X-Workspace-Id."""
    settings = get_settings()
    res = await async_client.get(
        "/test/tenant-scope",
        headers={"X-Internal-Key": settings.INTERNAL_API_KEY},
    )
    assert res.status_code == 400
    assert res.json()["error"]["code"] == "MISSING_WORKSPACE_ID"


async def test_tenant_route_rejects_invalid_workspace_id(async_client: AsyncClient):
    """Tenant-scoped routes must reject invalid ObjectId format."""
    settings = get_settings()
    res = await async_client.get(
        "/test/tenant-scope",
        headers={
            "X-Internal-Key": settings.INTERNAL_API_KEY,
            "X-Workspace-Id": "invalid-not-24-hex-chars",
        },
    )
    assert res.status_code == 400
    assert res.json()["error"]["code"] == "INVALID_WORKSPACE_ID"


async def test_tenant_route_accepts_valid_workspace_id(async_client: AsyncClient):
    """Tenant-scoped routes accept valid 24-hex ObjectId and pass it to handler."""
    settings = get_settings()
    valid_id = "507f1f77bcf86cd799439011"
    res = await async_client.get(
        "/test/tenant-scope",
        headers={
            "X-Internal-Key": settings.INTERNAL_API_KEY,
            "X-Workspace-Id": valid_id,
        },
    )
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "ok"
    assert data["workspaceId"] == valid_id
    assert data["is_object_id"] is True
