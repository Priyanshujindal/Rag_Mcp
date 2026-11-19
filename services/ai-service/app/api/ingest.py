from bson import ObjectId
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, status
from pymongo.asynchronous.database import AsyncDatabase

from app.core.config import get_settings
from app.core.logging import logger
from app.core.tenant import parse_object_id, require_tenant, TenantContext
from app.ingestion.pipeline import run_ingestion_pipeline
from app.schemas.ingestion import (
    DeleteResponse,
    IngestRequest,
    IngestResponse,
    UsageResponse,
)

router = APIRouter(tags=["Ingestion"])


def get_db(request: Request) -> AsyncDatabase:
    """Retrieves AsyncDatabase from application state."""
    settings = get_settings()
    client = getattr(request.app.state, "mongo_client", None)
    if not client:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={"code": "SERVICE_UNAVAILABLE", "message": "Database client unavailable"},
        )
    return client[settings.MONGODB_DB_NAME]


@router.post("/ingest", status_code=status.HTTP_202_ACCEPTED, response_model=IngestResponse)
async def ingest_source(
    payload: IngestRequest,
    background_tasks: BackgroundTasks,
    request: Request,
    tenant: TenantContext = Depends(require_tenant),
):
    """
    Triggers an asynchronous ingestion job for a file or website URL.
    Returns 202 Accepted immediately. Execution runs via background worker.
    """
    db = get_db(request)
    target = payload.url or payload.filePath
    is_url = bool(payload.url)

    logger.info(
        f"Queuing ingestion for source {payload.sourceId}",
        extra={
            "workspaceId": str(tenant.workspace_id),
            "sourceId": str(payload.sourceId),
            "target": target if not is_url else payload.url[:60],
        },
    )

    # Marked seam: background task execution (can be swapped for Redis / Celery worker later)
    background_tasks.add_task(
        run_ingestion_pipeline,
        db=db,
        workspace_id=tenant.workspace_id,
        knowledge_base_id=payload.knowledgeBaseId,
        source_id=payload.sourceId,
        target=target,
        is_url=is_url,
    )

    return IngestResponse(
        status="accepted",
        message="Ingestion pipeline job accepted and running in background.",
        sourceId=str(payload.sourceId),
    )


@router.delete("/sources/{sourceId}/chunks", response_model=DeleteResponse)
async def delete_source_chunks(
    sourceId: str,
    request: Request,
    tenant: TenantContext = Depends(require_tenant),
):
    """Deletes all chunks belonging to a specific source within the tenant workspace."""
    db = get_db(request)
    src_oid = parse_object_id(sourceId, "sourceId")

    result = await db.chunks.delete_many({
        "workspaceId": tenant.workspace_id,
        "sourceId": src_oid,
    })

    logger.info(
        f"Deleted {result.deleted_count} chunks for source {sourceId}",
        extra={"workspaceId": str(tenant.workspace_id), "sourceId": sourceId},
    )

    return DeleteResponse(
        deletedCount=result.deleted_count,
        message=f"Deleted {result.deleted_count} chunks for source {sourceId}.",
    )


@router.delete("/knowledge-bases/{knowledgeBaseId}/chunks", response_model=DeleteResponse)
async def delete_knowledge_base_chunks(
    knowledgeBaseId: str,
    request: Request,
    tenant: TenantContext = Depends(require_tenant),
):
    """Deletes all chunks belonging to a specific knowledge base within the tenant workspace."""
    db = get_db(request)
    kb_oid = parse_object_id(knowledgeBaseId, "knowledgeBaseId")

    result = await db.chunks.delete_many({
        "workspaceId": tenant.workspace_id,
        "knowledgeBaseId": kb_oid,
    })

    logger.info(
        f"Deleted {result.deleted_count} chunks for knowledge base {knowledgeBaseId}",
        extra={"workspaceId": str(tenant.workspace_id), "knowledgeBaseId": knowledgeBaseId},
    )

    return DeleteResponse(
        deletedCount=result.deleted_count,
        message=f"Deleted {result.deleted_count} chunks for knowledge base {knowledgeBaseId}.",
    )


@router.get("/usage", response_model=UsageResponse)
async def get_workspace_usage(
    request: Request,
    tenant: TenantContext = Depends(require_tenant),
):
    """
    Returns chunk count, estimated storage size in MB, and quota utilization.
    Logs warning if usage exceeds 80% of capacity budget.
    """
    db = get_db(request)
    settings = get_settings()

    count = await db.chunks.count_documents({"workspaceId": tenant.workspace_id})
    # Estimate ~4KB per chunk (dense vector + text + metadata)
    estimated_mb = round(count * 0.004, 3)
    capacity_mb = settings.ESTIMATED_DB_CAPACITY_MB
    usage_percent = round((estimated_mb / capacity_mb) * 100, 2) if capacity_mb > 0 else 0.0

    if usage_percent > 80.0:
        logger.warning(
            f"Workspace {tenant.workspace_id} storage exceeds 80% of capacity budget ({usage_percent}%)",
            extra={
                "workspaceId": str(tenant.workspace_id),
                "estimatedMb": estimated_mb,
                "capacityMb": capacity_mb,
            },
        )

    return UsageResponse(
        workspaceId=str(tenant.workspace_id),
        chunkCount=count,
        maxChunks=settings.MAX_CHUNKS_PER_WORKSPACE,
        estimatedStorageMb=estimated_mb,
        capacityMb=capacity_mb,
        usagePercent=usage_percent,
    )

