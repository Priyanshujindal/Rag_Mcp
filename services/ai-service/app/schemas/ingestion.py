from typing import Optional
from pydantic import BaseModel, Field, model_validator
from app.schemas.rag import PyObjectId


class IngestRequest(BaseModel):
    """Payload for POST /ingest endpoint."""
    knowledgeBaseId: PyObjectId = Field(..., description="Target knowledge base ObjectId")
    sourceId: PyObjectId = Field(..., description="Target source ObjectId")
    url: Optional[str] = Field(default=None, description="URL to crawl and ingest")
    filePath: Optional[str] = Field(default=None, description="Path to file on disk to ingest")

    @model_validator(mode="after")
    def validate_target(self) -> "IngestRequest":
        if not self.url and not self.filePath:
            raise ValueError("Either 'url' or 'filePath' must be provided.")
        if self.url and self.filePath:
            raise ValueError("Provide either 'url' or 'filePath', not both.")
        return self


class IngestResponse(BaseModel):
    status: str = "accepted"
    message: str
    sourceId: str


class DeleteResponse(BaseModel):
    deletedCount: int
    message: str


class UsageResponse(BaseModel):
    workspaceId: str
    chunkCount: int
    maxChunks: int
    estimatedStorageMb: float
    capacityMb: int
    usagePercent: float

