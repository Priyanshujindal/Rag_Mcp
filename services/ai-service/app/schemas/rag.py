from datetime import datetime, timezone
from typing import Any, Optional
from bson import ObjectId
from pydantic import BaseModel, ConfigDict, Field
from pydantic_core import core_schema


class PyObjectId(ObjectId):
    """Custom Pydantic v2 type for BSON ObjectId."""
    @classmethod
    def __get_pydantic_core_schema__(cls, _source_type: Any, _handler: Any) -> core_schema.CoreSchema:
        def validate(v: Any) -> ObjectId:
            if isinstance(v, ObjectId):
                return v
            if isinstance(v, str) and ObjectId.is_valid(v):
                return ObjectId(v)
            raise ValueError("Invalid ObjectId format")

        return core_schema.json_or_python_schema(
            json_schema=core_schema.str_schema(),
            python_schema=core_schema.with_info_plain_validator_function(
                lambda v, _info: validate(v)
            ),
            serialization=core_schema.plain_serializer_function_ser_schema(
                lambda x: str(x), when_used="json"
            ),
        )


class ChunkMetadata(BaseModel):
    """Metadata associated with an extracted chunk."""
    model_config = ConfigDict(extra="ignore")

    url: Optional[str] = None
    title: Optional[str] = None
    heading: Optional[str] = None
    page: Optional[int] = None
    sourceType: Optional[str] = None  # URL | PDF | DOCX | TXT | CSV


class ChunkDocument(BaseModel):
    """
    Schema for a chunk stored in the 'chunks' collection in MongoDB Atlas.
    Shared by all workspaces; strict tenant isolation is enforced via workspaceId.
    """
    model_config = ConfigDict(populate_by_name=True)

    id: Optional[PyObjectId] = Field(default=None, alias="_id")
    workspaceId: PyObjectId = Field(..., description="Workspace / tenant ObjectId")
    knowledgeBaseId: PyObjectId = Field(..., description="Knowledge base ObjectId")
    sourceId: PyObjectId = Field(..., description="Parent source ObjectId")
    ingestionId: str = Field(..., description="Unique run ID of the ingestion job")
    chunkIndex: int = Field(..., ge=0, description="Sequential index within document")
    text: str = Field(..., min_length=1, description="Extracted clean chunk text")
    embedding: list[float] = Field(..., description="Dense vector embedding")
    embeddingModel: str = Field(..., description="Model identifier used for embedding")
    contentHash: str = Field(..., description="SHA-256 hash of chunk text for deduplication")
    metadata: ChunkMetadata = Field(default_factory=ChunkMetadata)
    createdAt: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    def to_mongo(self) -> dict[str, Any]:
        """Convert chunk model to MongoDB document dictionary."""
        data = self.model_dump(by_alias=True, exclude_none=True)
        if data.get("_id") is None:
            data["_id"] = ObjectId()
        return data
