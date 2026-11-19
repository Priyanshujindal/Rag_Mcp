"""
app/schemas/deck.py
===================
Pydantic schemas for AI-generated presentations.

A "deck spec" is a plain JSON description of a presentation: a theme plus a list
of slides, each with a layout ("bullets", "stats", "chart", ...) and the content
that layout needs. The planner (LLM) produces it, the renderer turns it into a
real, editable .pptx file, and the web app can draw a live preview from it.

All text fields are cleaned and length-limited here so that no slide can be
rendered with an absurd amount of text, whatever the model returned.
"""

from __future__ import annotations

import re
from typing import Any, List, Literal, Optional

from bson import ObjectId
from pydantic import BaseModel, Field, field_validator

LayoutName = Literal[
    "title",
    "section",
    "bullets",
    "agenda",
    "two_column",
    "cards",
    "stats",
    "quote",
    "table",
    "chart",
    "timeline",
    "closing",
]
LAYOUT_NAMES = (
    "title", "section", "bullets", "agenda", "two_column", "cards",
    "stats", "quote", "table", "chart", "timeline", "closing",
)

ChartKind = Literal["column", "bar", "line", "pie", "doughnut"]

_HEX_RE = re.compile(r"^#?([0-9a-fA-F]{6})$")
_MD_JUNK_RE = re.compile(r"(\*\*|__|`|^#{1,6}\s+)")
_WS_RE = re.compile(r"\s+")

MAX_SLIDES = 30


def clean_text(value: Any, limit: int = 200) -> str:
    """Coerce to a single clean line of text (no markdown markers), cut at a word boundary."""
    if value is None:
        return ""
    text = str(value)
    text = _MD_JUNK_RE.sub("", text)
    text = _WS_RE.sub(" ", text).strip()
    if len(text) <= limit:
        return text
    cut = text[: limit - 1]
    if " " in cut[limit // 2:]:
        cut = cut[: cut.rfind(" ")]
    return cut.rstrip(" ,;:-") + "…"


def clean_list(value: Any, item_limit: int, max_items: int) -> List[str]:
    if value is None:
        return []
    if isinstance(value, str):
        value = [p for p in re.split(r"\n+", value) if p.strip()]
    if not isinstance(value, (list, tuple)):
        return []
    out: List[str] = []
    for item in value:
        text = clean_text(re.sub(r"^\s*(?:[-*•]|\d+[.)])\s+", "", str(item)), item_limit)
        if text:
            out.append(text)
        if len(out) >= max_items:
            break
    return out


class Card(BaseModel):
    title: str = ""
    body: str = ""

    @field_validator("title", mode="before")
    @classmethod
    def _title(cls, v: Any) -> str:
        return clean_text(v, 48)

    @field_validator("body", mode="before")
    @classmethod
    def _body(cls, v: Any) -> str:
        return clean_text(v, 170)


class Column(BaseModel):
    heading: str = ""
    bullets: List[str] = Field(default_factory=list)

    @field_validator("heading", mode="before")
    @classmethod
    def _heading(cls, v: Any) -> str:
        return clean_text(v, 40)

    @field_validator("bullets", mode="before")
    @classmethod
    def _bullets(cls, v: Any) -> List[str]:
        return clean_list(v, 110, 5)


class Stat(BaseModel):
    value: str = ""
    label: str = ""
    detail: str = ""

    @field_validator("value", mode="before")
    @classmethod
    def _value(cls, v: Any) -> str:
        return clean_text(v, 12)

    @field_validator("label", mode="before")
    @classmethod
    def _label(cls, v: Any) -> str:
        return clean_text(v, 40)

    @field_validator("detail", mode="before")
    @classmethod
    def _detail(cls, v: Any) -> str:
        return clean_text(v, 90)


class Step(BaseModel):
    label: str = ""
    detail: str = ""

    @field_validator("label", mode="before")
    @classmethod
    def _label(cls, v: Any) -> str:
        return clean_text(v, 32)

    @field_validator("detail", mode="before")
    @classmethod
    def _detail(cls, v: Any) -> str:
        return clean_text(v, 100)


class TableSpec(BaseModel):
    headers: List[str] = Field(default_factory=list)
    rows: List[List[str]] = Field(default_factory=list)

    @field_validator("headers", mode="before")
    @classmethod
    def _headers(cls, v: Any) -> List[str]:
        return clean_list(v, 28, 6)

    @field_validator("rows", mode="before")
    @classmethod
    def _rows(cls, v: Any) -> List[List[str]]:
        if not isinstance(v, (list, tuple)):
            return []
        rows: List[List[str]] = []
        for row in v:
            if isinstance(row, (list, tuple)):
                rows.append([clean_text(c, 40) for c in list(row)[:6]])
            if len(rows) >= 8:
                break
        return rows


class Series(BaseModel):
    name: str = ""
    values: List[float] = Field(default_factory=list)

    @field_validator("name", mode="before")
    @classmethod
    def _name(cls, v: Any) -> str:
        return clean_text(v, 30)

    @field_validator("values", mode="before")
    @classmethod
    def _values(cls, v: Any) -> List[float]:
        out: List[float] = []
        for item in list(v)[:12] if isinstance(v, (list, tuple)) else []:
            try:
                out.append(float(str(item).replace(",", "").replace("%", "").replace("$", "")))
            except ValueError:
                out.append(0.0)
        return out


class ChartSpec(BaseModel):
    type: ChartKind = "column"
    categories: List[str] = Field(default_factory=list)
    series: List[Series] = Field(default_factory=list)
    unit: str = ""
    caption: str = ""

    @field_validator("type", mode="before")
    @classmethod
    def _type(cls, v: Any) -> str:
        v = str(v or "column").lower().strip()
        aliases = {"bar chart": "bar", "column chart": "column", "line chart": "line", "pie chart": "pie",
                   "donut": "doughnut", "barh": "bar", "vertical": "column", "horizontal": "bar"}
        v = aliases.get(v, v)
        return v if v in ("column", "bar", "line", "pie", "doughnut") else "column"

    @field_validator("categories", mode="before")
    @classmethod
    def _categories(cls, v: Any) -> List[str]:
        return clean_list(v, 22, 12)

    @field_validator("series", mode="before")
    @classmethod
    def _series(cls, v: Any) -> Any:
        return list(v)[:4] if isinstance(v, (list, tuple)) else []

    @field_validator("unit", mode="before")
    @classmethod
    def _unit(cls, v: Any) -> str:
        return clean_text(v, 12)

    @field_validator("caption", mode="before")
    @classmethod
    def _caption(cls, v: Any) -> str:
        return clean_text(v, 120)


class PaletteSpec(BaseModel):
    """Optional custom palette (6-digit hex colors). Missing keys fall back to the chosen theme."""

    dark: Optional[str] = None
    primary: Optional[str] = None
    secondary: Optional[str] = None
    accent: Optional[str] = None

    @field_validator("dark", "primary", "secondary", "accent", mode="before")
    @classmethod
    def _hex(cls, v: Any) -> Optional[str]:
        if v is None:
            return None
        m = _HEX_RE.match(str(v).strip())
        return m.group(1).upper() if m else None


class SlideSpec(BaseModel):
    layout: LayoutName = "bullets"
    title: str = ""
    subtitle: str = ""
    number: str = ""
    bullets: List[str] = Field(default_factory=list)
    callout: str = ""
    columns: List[Column] = Field(default_factory=list)
    cards: List[Card] = Field(default_factory=list)
    stats: List[Stat] = Field(default_factory=list)
    quote: str = ""
    author: str = ""
    table: Optional[TableSpec] = None
    chart: Optional[ChartSpec] = None
    steps: List[Step] = Field(default_factory=list)
    notes: str = ""

    @field_validator("layout", mode="before")
    @classmethod
    def _layout(cls, v: Any) -> str:
        v = str(v or "bullets").lower().strip().replace("-", "_").replace(" ", "_")
        aliases = {
            "content": "bullets", "list": "bullets", "text": "bullets", "summary": "bullets",
            "comparison": "two_column", "compare": "two_column", "columns": "two_column",
            "two_columns": "two_column", "grid": "cards", "features": "cards", "pillars": "cards",
            "metrics": "stats", "kpi": "stats", "numbers": "stats", "big_numbers": "stats",
            "process": "timeline", "steps": "timeline", "roadmap": "timeline", "journey": "timeline",
            "divider": "section", "chapter": "section", "cover": "title", "intro": "title",
            "thank_you": "closing", "end": "closing", "next_steps": "closing", "conclusion": "closing",
            "graph": "chart", "data": "chart",
        }
        v = aliases.get(v, v)
        return v if v in LAYOUT_NAMES else "bullets"

    @field_validator("title", mode="before")
    @classmethod
    def _title(cls, v: Any) -> str:
        return clean_text(v, 80).rstrip(".")

    @field_validator("subtitle", mode="before")
    @classmethod
    def _subtitle(cls, v: Any) -> str:
        return clean_text(v, 140)

    @field_validator("number", mode="before")
    @classmethod
    def _number(cls, v: Any) -> str:
        return clean_text(v, 3)

    @field_validator("bullets", mode="before")
    @classmethod
    def _bullets(cls, v: Any) -> List[str]:
        return clean_list(v, 150, 6)

    @field_validator("callout", mode="before")
    @classmethod
    def _callout(cls, v: Any) -> str:
        return clean_text(v, 120)

    @field_validator("columns", mode="before")
    @classmethod
    def _columns(cls, v: Any) -> Any:
        return list(v)[:2] if isinstance(v, (list, tuple)) else []

    @field_validator("cards", mode="before")
    @classmethod
    def _cards(cls, v: Any) -> Any:
        return list(v)[:4] if isinstance(v, (list, tuple)) else []

    @field_validator("stats", mode="before")
    @classmethod
    def _stats(cls, v: Any) -> Any:
        return list(v)[:4] if isinstance(v, (list, tuple)) else []

    @field_validator("steps", mode="before")
    @classmethod
    def _steps(cls, v: Any) -> Any:
        return list(v)[:5] if isinstance(v, (list, tuple)) else []

    @field_validator("quote", mode="before")
    @classmethod
    def _quote(cls, v: Any) -> str:
        return clean_text(v, 220)

    @field_validator("author", mode="before")
    @classmethod
    def _author(cls, v: Any) -> str:
        return clean_text(v, 60)

    @field_validator("notes", mode="before")
    @classmethod
    def _notes(cls, v: Any) -> str:
        return _WS_RE.sub(" ", str(v or "")).strip()[:900]


class DeckSpec(BaseModel):
    title: str = "Presentation"
    subtitle: str = ""
    author: str = ""
    theme: Optional[str] = None
    palette: Optional[PaletteSpec] = None
    slides: List[SlideSpec] = Field(default_factory=list)

    @field_validator("title", mode="before")
    @classmethod
    def _title(cls, v: Any) -> str:
        return clean_text(v, 90).rstrip(".") or "Presentation"

    @field_validator("subtitle", mode="before")
    @classmethod
    def _subtitle(cls, v: Any) -> str:
        return clean_text(v, 140)

    @field_validator("author", mode="before")
    @classmethod
    def _author(cls, v: Any) -> str:
        return clean_text(v, 60)

    @field_validator("theme", mode="before")
    @classmethod
    def _theme(cls, v: Any) -> Optional[str]:
        return str(v).strip().lower() if v else None

    @field_validator("slides", mode="before")
    @classmethod
    def _slides(cls, v: Any) -> Any:
        return list(v)[:MAX_SLIDES] if isinstance(v, (list, tuple)) else []


class DeckRequest(BaseModel):
    """Payload for POST /files/deck."""

    model_config = {"populate_by_name": True}

    request: str = Field(..., min_length=1, max_length=4000, description="What the user asked for")
    source_text: Optional[str] = Field(default=None, max_length=60000, description="Material to base the deck on")
    title: Optional[str] = Field(default=None, max_length=120)
    filename: Optional[str] = Field(default=None, max_length=120, description="Only when the user named the file")
    knowledge_base_id: Optional[str] = Field(default=None, description="Ground the deck in this knowledge base")
    source_ids: Optional[List[str]] = None
    model: Optional[str] = None
    provider: Optional[str] = None
    slide_count: Optional[int] = Field(default=None, ge=3, le=MAX_SLIDES)
    theme: Optional[str] = Field(default=None, max_length=40)
    audience: Optional[str] = Field(default=None, max_length=120)
    tone: Optional[str] = Field(default=None, max_length=60)
    include_notes: bool = True
    deck: Optional[DeckSpec] = Field(default=None, description="Render this spec as-is (skips planning)")

    @field_validator("knowledge_base_id")
    @classmethod
    def _kb(cls, v: Optional[str]) -> Optional[str]:
        if not v:
            return None
        if not ObjectId.is_valid(v):
            raise ValueError("knowledge_base_id must be a valid 24-character hex ObjectId")
        return v

    @field_validator("source_ids")
    @classmethod
    def _sources(cls, v: Optional[List[str]]) -> Optional[List[str]]:
        if v is None:
            return v
        for s in v:
            if not ObjectId.is_valid(s):
                raise ValueError(f"Each source id must be a valid 24-hex ObjectId; got {s!r}")
        return v
