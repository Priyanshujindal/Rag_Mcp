"""
app/schemas/chat.py
===================
Pydantic v2 schemas for the RAG streaming chat endpoint (/chat).
"""

from __future__ import annotations

from typing import List, Literal, Optional
from bson import ObjectId
from pydantic import BaseModel, Field, field_validator

from app.rag.prompt_builder import ChatMessage


class ChatRequest(BaseModel):
    """Payload for POST /chat (SSE)."""
    model_config = {"populate_by_name": True}

    knowledgeBaseId: Optional[str] = Field(default=None, description="Optional Knowledge base 24-hex ObjectId for RAG")
    mode: Literal["rag", "general"] = Field(default="rag", description="Chat mode: 'rag' or 'general'")
    message: str = Field(..., min_length=1, max_length=4000, description="Latest user message")
    conversationId: Optional[str] = Field(default=None, description="Optional conversation tracking ID")
    history: List[ChatMessage] = Field(default_factory=list, description="Prior conversation turns")
    provider: Optional[str] = Field(default=None, description="Requested LLM provider name (e.g. 'gemini', 'openrouter')")
    model: Optional[str] = Field(default=None, description="Requested LLM model name")
    web_search: bool = Field(default=False, alias="webSearch", description="Enable global live web search for up-to-date facts")
    is_thinking: bool = Field(default=False, alias="isThinking", description="Enable deeper reasoning / thinking process")
    attached_document: Optional[dict] = Field(default=None, alias="attachedDocument", description="Direct ad-hoc document context { name, content, type, size }")
    attached_documents: Optional[List[dict]] = Field(default=None, alias="attachedDocuments", description="Multiple ad-hoc documents [{ name, content, type, size }]")
    tools: Optional[List[dict]] = Field(default=None, description="Available MCP tools for agentic function calling")
    custom_prompt: Optional[str] = Field(default=None, description="Custom bot persona/instructions")
    temperature: float = Field(default=0.7, ge=0.0, le=2.0)
    max_tokens: int = Field(default=4096, ge=1, le=8192)
    top_k: int = Field(default=5, ge=1, le=20)
    strategy: Literal["auto", "rankfusion", "manual"] = Field(default="auto")
    min_score_threshold: float = Field(default=0.0, ge=0.0, le=1.0)
    vector_weight: float = Field(default=0.6, ge=0.0, le=1.0)
    text_weight: float = Field(default=0.4, ge=0.0, le=1.0)
    source_ids: Optional[List[str]] = Field(default=None)

    @field_validator("knowledgeBaseId")
    @classmethod
    def validate_kb_id(cls, v: Optional[str]) -> Optional[str]:
        if v is None or v == "":
            return None
        if not ObjectId.is_valid(v):
            raise ValueError("knowledgeBaseId must be a valid 24-character hex ObjectId")
        return v

    @field_validator("source_ids", mode="before")
    @classmethod
    def validate_source_ids(cls, v: Optional[List[str]]) -> Optional[List[str]]:
        if v is None:
            return v
        for s in v:
            if not ObjectId.is_valid(s):
                raise ValueError(f"Each sourceId must be a valid 24-hex ObjectId; got: {s!r}")
        return v


class TitleRequest(BaseModel):
    """Payload for POST /generate-title."""

    message: str = Field(..., min_length=1, max_length=4000, description="User prompt to generate title from")
    model: Optional[str] = Field(default="gemini-3.8-flash", description="Requested LLM model name")


class TitleResponse(BaseModel):
    """Response from POST /generate-title."""

    title: str = Field(..., description="Generated concise conversation title")


class ParseDocumentRequest(BaseModel):
    """Payload for POST /parse-document."""

    filename: str = Field(..., description="Uploaded file name")
    content_base64: str = Field(..., description="Base64-encoded document content")
    mime_type: Optional[str] = Field(default=None, description="MIME type if known")


