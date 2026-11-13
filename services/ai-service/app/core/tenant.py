import secrets
from bson import ObjectId
from bson.errors import InvalidId
from fastapi import Header, HTTPException, status
from pydantic import BaseModel, ConfigDict

from app.core.config import get_settings


class TenantContext(BaseModel):
    """Encapsulates authenticated internal tenant context."""
    model_config = ConfigDict(arbitrary_types_allowed=True)

    workspace_id: ObjectId


def verify_internal_key(
    x_internal_key: str = Header(None, alias="X-Internal-Key", description="Internal service secret header"),
) -> str:
    """
    Verifies that the incoming request contains a valid X-Internal-Key.
    Uses secrets.compare_digest for constant-time comparison to prevent timing attacks.
    """
    if not x_internal_key:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={
                "code": "UNAUTHORIZED",
                "message": "Missing required header: X-Internal-Key",
            },
        )

    settings = get_settings()
    if not secrets.compare_digest(x_internal_key, settings.INTERNAL_API_KEY):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={
                "code": "UNAUTHORIZED",
                "message": "Invalid internal API key",
            },
        )

    return x_internal_key


def require_workspace_id(
    x_workspace_id: str = Header(None, alias="X-Workspace-Id", description="24-character hex ObjectId of workspace"),
) -> ObjectId:
    """
    Validates that the incoming request specifies a valid 24-hex ObjectId in X-Workspace-Id.
    Every query and write in the service strictly scopes by this workspaceId.
    """
    if not x_workspace_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "code": "MISSING_WORKSPACE_ID",
                "message": "Missing required header: X-Workspace-Id",
            },
        )

    try:
        if len(x_workspace_id) != 24:
            raise ValueError("Must be 24 hex characters")
        return ObjectId(x_workspace_id)
    except (InvalidId, ValueError):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "code": "INVALID_WORKSPACE_ID",
                "message": "X-Workspace-Id must be a valid 24-character hexadecimal ObjectId",
            },
        )


def require_tenant(
    _key: str = Header(None, alias="X-Internal-Key"),
    _ws: str = Header(None, alias="X-Workspace-Id"),
) -> TenantContext:
    """
    Combined dependency requiring both valid internal authentication and a valid workspace scope.
    """
    verify_internal_key(_key)
    ws_id = require_workspace_id(_ws)
    return TenantContext(workspace_id=ws_id)


def parse_object_id(val: str, field_name: str = "id") -> ObjectId:
    """Helper to parse and validate 24-hex ObjectIds in query params or route paths."""
    try:
        if len(val) != 24:
            raise ValueError()
        return ObjectId(val)
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "code": f"INVALID_{field_name.upper()}",
                "message": f"'{field_name}' must be a valid 24-character hexadecimal ObjectId",
            },
        )
