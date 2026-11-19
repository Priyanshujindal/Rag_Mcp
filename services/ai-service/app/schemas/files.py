from typing import List, Dict, Any, Optional
from pydantic import BaseModel, Field


class SlideItem(BaseModel):
    title: str = Field(..., description="Slide title")
    points: List[str] = Field(default_factory=list, description="Bullet points for the slide")


class GenerateFileRequest(BaseModel):
    file_type: str = Field(..., description="File extension or type (pdf, docx, pptx, xlsx, csv, py, js, etc.)")
    title: Optional[str] = Field(None, description="Document or presentation title")
    filename: Optional[str] = Field(None, description="Suggested filename")
    content: Optional[str] = Field(None, description="Markdown, text, or source code content")
    slides: Optional[List[SlideItem]] = Field(None, description="Slide decks for PPTX")
    headers: Optional[List[str]] = Field(None, description="Column headers for XLSX/CSV")
    rows: Optional[List[List[Any]]] = Field(None, description="Table rows for XLSX/CSV")
    sheet_name: Optional[str] = Field("Data", description="Sheet name for XLSX")
    language: Optional[str] = Field(None, description="Programming language for syntax highlighting preview")


class GenerateFileResponse(BaseModel):
    filename: str
    file_type: str
    mime_type: str
    size_bytes: int
    content_base64: str
    preview_data: Optional[Dict[str, Any]] = None

