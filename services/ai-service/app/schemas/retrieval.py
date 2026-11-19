"""
app/schemas/retrieval.py
========================
Pydantic v2 request/response schemas for the /retrieve endpoint (Stage 4).
"""

from typing import Any, Literal, Optional
from bson import ObjectId
from pydantic import BaseModel, Field, field_validator


# ---------------------------------------------------------------------------
# Request
# ---------------------------------------------------------------------------

class RetrieveRequest(BaseModel):
    """Body for POST /retrieve."""

    knowledgeBaseId: str = Field(..., description="Knowledge base ObjectId (24-hex string)")
    query: str = Field(..., min_length=1, max_length=2000, description="User query text")
    top_n: int = Field(default=20, ge=1, le=100, description="Candidates to fetch before reranking")
    top_k: int = Field(default=5, ge=1, le=50, description="Final results to return")
    min_score_threshold: float = Field(
        default=0.0, ge=0.0, le=1.0,
        description="Minimum fusedScore to include in results (0 = no filtering)"
    )
    strategy: Literal["auto", "rankfusion", "manual"] = Field(
        default="auto",
        description="Hybrid strategy: auto | rankfusion | manual"
    )
    vector_weight: float = Field(default=0.6, ge=0.0, le=1.0)
    text_weight: float = Field(default=0.4, ge=0.0, le=1.0)
    source_ids: Optional[list[str]] = Field(
        default=None,
        description="Optional list of sourceId ObjectIds to restrict retrieval"
    )

    @field_validator("knowledgeBaseId")
    @classmethod
    def validate_kb_id(cls, v: str) -> str:
        if not ObjectId.is_valid(v):
            raise ValueError("knowledgeBaseId must be a valid 24-character hex ObjectId")
        return v

    @field_validator("source_ids", mode="before")
    @classmethod
    def validate_source_ids(cls, v: list[str] | None) -> list[str] | None:
        if v is None:
            return v
        for s in v:
            if not ObjectId.is_valid(s):
                raise ValueError(f"Each sourceId must be a valid 24-hex ObjectId; got: {s!r}")
        return v


# ---------------------------------------------------------------------------
# Citation
# ---------------------------------------------------------------------------

class Citation(BaseModel):
    """A numbered citation returned with retrieved chunks."""

    index: int = Field(..., description="1-based citation number [1], [2], ...")
    sourceId: str
    title: Optional[str] = None
    url: Optional[str] = None
    page: Optional[int] = None
    snippet: str = Field(..., description="First ~200 chars of the chunk text")


# ---------------------------------------------------------------------------
# Per-chunk result with scores
# ---------------------------------------------------------------------------

class RankedChunk(BaseModel):
    """A single retrieved chunk with all retrieval scores."""

    chunkId: str
    sourceId: str
    text: str
    vectorScore: float = 0.0
    textScore: float = 0.0
    vectorRank: Optional[int] = None
    textRank: Optional[int] = None
    fusedScore: float = 0.0
    rerankedScore: Optional[float] = None
    metadata: dict[str, Any] = Field(default_factory=dict)


# ---------------------------------------------------------------------------
# Response
# ---------------------------------------------------------------------------

class TimingInfo(BaseModel):
    """Per-step latency breakdown (milliseconds)."""

    embed_ms: float = 0.0
    vector_search_ms: float = 0.0
    text_search_ms: float = 0.0
    rerank_ms: float = 0.0
    total_ms: float = 0.0


class RetrieveResponse(BaseModel):
    """Full debug payload returned by POST /retrieve."""

    query: str
    strategy_used: str
    candidates: list[RankedChunk] = Field(
        description="All chunks before top_k slice and score threshold"
    )
    results: list[RankedChunk] = Field(
        description="Final top_k chunks after threshold + optional reranking"
    )
    citations: list[Citation]
    timings: TimingInfo
