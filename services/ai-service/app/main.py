import inspect
import uuid
from contextlib import asynccontextmanager
from typing import Any, AsyncGenerator

from fastapi import Depends, FastAPI, HTTPException, Request, Response, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pymongo import AsyncMongoClient

from app.core.config import get_settings, verify_embedding_model
from app.core.logging import logger, request_id_ctx, setup_logging
from app.core.tenant import verify_internal_key
from app.api.ingest import router as ingest_router
from app.api.query import router as query_router
from app.api.evaluate import router as evaluate_router
from app.api.files import router as files_router


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """
    Application lifespan manager.
    - Sets up structured logging
    - Validates configuration and embedding model dimensions at startup
    - Creates a single shared AsyncMongoClient
    - Closes client cleanly on shutdown
    """
    settings = get_settings()
    setup_logging()
    logger.info("Initializing Rag_Mcp AI service", extra={"provider": settings.EMBEDDING_PROVIDER})

    # Validate embedding model dimensions against config
    try:
        verify_embedding_model(settings)
        logger.info(
            "Embedding model verified successfully",
            extra={
                "model": settings.EMBEDDING_MODEL,
                "dimensions": settings.EMBEDDING_DIMENSIONS,
            },
        )
    except Exception as e:
        logger.error(f"Startup embedding verification failed: {e}")
        raise

    # Initialize PyMongo AsyncMongoClient
    app.state.mongo_client = AsyncMongoClient(
        settings.MONGODB_URI,
        serverSelectionTimeoutMS=3000,
        connectTimeoutMS=3000,
    )
    logger.info("PyMongo AsyncMongoClient initialized")

    try:
        yield
    finally:
        logger.info("Shutting down Rag_Mcp AI service...")
        if hasattr(app.state, "mongo_client") and app.state.mongo_client:
            close_res = app.state.mongo_client.close()
            if inspect.isawaitable(close_res):
                await close_res
            logger.info("MongoDB client connections closed")


app = FastAPI(
    title="Rag_Mcp AI Service",
    description="Internal RAG, crawling, embedding, and retrieval service",
    version="0.1.0",
    lifespan=lifespan,
    docs_url=None,  # Disabled for internal service security
    redoc_url=None,
)


@app.middleware("http")
async def request_id_and_logging_middleware(request: Request, call_next: Any) -> Response:
    """Assigns unique request id, populates context, and logs request execution."""
    req_id = request.headers.get("X-Request-Id") or str(uuid.uuid4())
    token = request_id_ctx.set(req_id)
    try:
        response: Response = await call_next(request)
        response.headers["X-Request-Id"] = req_id
        return response
    finally:
        request_id_ctx.reset(token)


# -----------------------------------------------------------------------------
# Consistent Error Envelope Handlers
# -----------------------------------------------------------------------------

@app.exception_handler(HTTPException)
async def http_exception_handler(_request: Request, exc: HTTPException) -> JSONResponse:
    """Format HTTPExceptions into the standard error envelope."""
    if isinstance(exc.detail, dict) and "code" in exc.detail:
        payload = {
            "error": {
                "code": exc.detail.get("code", f"HTTP_{exc.status_code}"),
                "message": exc.detail.get("message", "Request failed"),
            }
        }
        if "details" in exc.detail:
            payload["error"]["details"] = exc.detail["details"]
    else:
        payload = {
            "error": {
                "code": f"HTTP_{exc.status_code}",
                "message": str(exc.detail),
            }
        }

    return JSONResponse(status_code=exc.status_code, content=payload)


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(_request: Request, exc: RequestValidationError) -> JSONResponse:
    """Format Pydantic request validation errors into the standard error envelope."""
    details = [
        {"loc": list(err.get("loc", [])), "msg": err.get("msg", ""), "type": err.get("type", "")}
        for err in exc.errors()
    ]
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content={
            "error": {
                "code": "VALIDATION_ERROR",
                "message": "Invalid request parameters or payload",
                "details": details,
            }
        },
    )


@app.exception_handler(Exception)
async def generic_exception_handler(_request: Request, exc: Exception) -> JSONResponse:
    """Catch-all unhandled exception handler to avoid leaking stack traces or internal secrets."""
    logger.exception(f"Unhandled server error: {exc}")
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={
            "error": {
                "code": "INTERNAL_SERVER_ERROR",
                "message": "An unexpected server error occurred",
            }
        },
    )


# -----------------------------------------------------------------------------
# Core Health & Readiness Endpoints
# -----------------------------------------------------------------------------

@app.get("/health", tags=["System"])
async def health_check() -> dict[str, str]:
    """
    Public liveness probe. No authentication required.
    Used by orchestrators to confirm the process is alive.
    """
    return {"status": "ok", "service": "Rag_Mcp-ai-service"}


@app.get("/ready", tags=["System"])
async def readiness_check(
    request: Request,
    _key: str = Depends(verify_internal_key),
) -> dict[str, str]:
    """
    Internal readiness probe. Requires X-Internal-Key.
    Pings MongoDB to confirm database connectivity.
    """
    settings = get_settings()
    client: AsyncMongoClient = getattr(request.app.state, "mongo_client", None)

    if not client:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={"code": "SERVICE_UNAVAILABLE", "message": "Database client not initialized"},
        )

    try:
        # Ping the configured main database
        await client[settings.MONGODB_DB_NAME].command("ping")
        return {"status": "ready", "database": "connected"}
    except Exception as e:
        logger.error(f"MongoDB readiness ping failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={"code": "DATABASE_UNAVAILABLE", "message": "MongoDB ping check failed"},
        )


app.include_router(ingest_router)
app.include_router(query_router)
app.include_router(evaluate_router)
app.include_router(files_router)

