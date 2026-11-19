"""
app/services/deck_planner.py
============================
Turns a user's request (plus optional source material) into a validated DeckSpec.

Pipeline:
  1. Work out the target slide count and gather source material (pasted text, the
     previous answer, and/or passages retrieved from a knowledge base).
  2. Ask the LLM for ONE JSON object that follows the deck schema (a "designer brief").
  3. Parse it defensively (code fences, stray prose), validate it with Pydantic, and
     repair what can be repaired (missing title slide, too many slides, bad theme).
  4. If the model's JSON cannot be used, retry once with the parse error; if that also
     fails and we have source material, fall back to a deterministic outline.

The planner never invents the file contents silently: when there is nothing to base a
deck on and the model fails, it raises DeckPlanningError so the caller can say so.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Any, Callable, Dict, List, Optional, Tuple

from pydantic import ValidationError

from app.core.logging import logger
from app.schemas.deck import MAX_SLIDES, DeckRequest, DeckSpec, SlideSpec, clean_text
from app.services.deck_themes import theme_names

DEFAULT_SLIDES = 9
MIN_SLIDES = 3
MAX_MATERIAL_CHARS = 14000

_NUMBER_WORDS = {
    "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10,
    "eleven": 11, "twelve": 12, "thirteen": 13, "fourteen": 14, "fifteen": 15, "sixteen": 16,
    "seventeen": 17, "eighteen": 18, "nineteen": 19, "twenty": 20,
}


class DeckPlanningError(RuntimeError):
    """Raised when no usable deck could be produced."""


@dataclass
class PlanResult:
    deck: DeckSpec
    planner: str          # "llm" | "fallback" | "provided"
    model: Optional[str] = None
    grounded: bool = False


# --------------------------------------------------------------------------- request parsing
def detect_slide_count(text: str) -> Optional[int]:
    """'a 10-slide deck', '12 slides', 'ten slides' -> number (clamped to the allowed range)."""
    lowered = (text or "").lower()
    match = re.search(r"\b(\d{1,3})\s*[- ]?\s*(?:slides?|pages?)\b", lowered)
    if match:
        return max(MIN_SLIDES, min(MAX_SLIDES, int(match.group(1))))
    words = "|".join(_NUMBER_WORDS)
    match = re.search(rf"\b({words})\s*[- ]?\s*(?:slides?|pages?)\b", lowered)
    if match:
        return _NUMBER_WORDS[match.group(1)]
    return None


def target_slide_count(req: DeckRequest, material_chars: int) -> int:
    if req.slide_count:
        return max(MIN_SLIDES, min(MAX_SLIDES, req.slide_count))
    detected = detect_slide_count(req.request)
    if detected:
        return detected
    if material_chars > 6000:
        return 11
    if material_chars > 2500:
        return 10
    return DEFAULT_SLIDES


# --------------------------------------------------------------------------- prompt
_SCHEMA_GUIDE = """\
Return ONE JSON object and nothing else (no markdown fences, no commentary):

{
  "title": "Deck title (max 8 words)",
  "subtitle": "One line that says what the deck is about",
  "theme": "one of: %(themes)s",
  "slides": [
    {"layout": "title",      "title": "...", "subtitle": "...", "notes": "..."},
    {"layout": "section",    "title": "...", "subtitle": "...", "notes": "..."},
    {"layout": "bullets",    "title": "...", "bullets": ["Lead phrase: short detail", "..."], "callout": "optional key takeaway", "notes": "..."},
    {"layout": "two_column", "title": "...", "columns": [{"heading": "...", "bullets": ["..."]}, {"heading": "...", "bullets": ["..."]}], "notes": "..."},
    {"layout": "cards",      "title": "...", "cards": [{"title": "...", "body": "..."}], "notes": "..."},
    {"layout": "stats",      "title": "...", "stats": [{"value": "92%%", "label": "...", "detail": "..."}], "notes": "..."},
    {"layout": "timeline",   "title": "...", "steps": [{"label": "...", "detail": "..."}], "notes": "..."},
    {"layout": "table",      "title": "...", "table": {"headers": ["..."], "rows": [["..."]]}, "notes": "..."},
    {"layout": "chart",      "title": "...", "chart": {"type": "column|bar|line|pie|doughnut", "categories": ["..."], "series": [{"name": "...", "values": [1, 2]}], "unit": "%%", "caption": "..."}, "bullets": ["optional takeaways, max 3"], "notes": "..."},
    {"layout": "quote",      "title": "...", "quote": "...", "author": "...", "notes": "..."},
    {"layout": "closing",    "title": "...", "bullets": ["next step", "..."], "subtitle": "...", "notes": "..."}
  ]
}
"""

_RULES = """\
Design and writing rules:
- Think like a professional presentation designer. The first slide is layout "title"; the last is layout "closing".
- Slide titles are short headlines that state the point (max 8 words, no trailing period). Write
  "Hybrid search finds what keywords miss", not "Search methods".
- Use a VARIETY of layouts. Never use the same layout three times in a row. Use "bullets" for at most
  about one third of the slides; prefer cards, two_column, stats, timeline, table or chart when the content fits them.
- Limits: bullets max 5 per slide, each max 14 words, written as "Lead phrase: short detail" (lead max 4 words).
  cards 2-4 (body max 25 words). stats 2-4 (value max 8 characters such as "92%%", "$1.2M", "3x"). timeline 3-5 steps.
  two_column exactly 2 columns with 2-4 bullets each. table max 6 columns and 7 rows, short cells.
- Add "section" slides only for decks of 10 or more slides.
- NEVER invent statistics, quotes, people, companies or sources. Use numbers only if they appear in the
  provided material or are certain, well-known facts. Without real data, do not use "stats", "chart" or "quote"
  layouts (use cards, bullets or timeline instead). If you must use illustrative numbers in a chart, say so in the chart caption.
- Speaker notes: 2-3 sentences per slide that tell the presenter what to say (omit "notes" if notes are not wanted).
- Write in the same language as the user's request.
- Pick the theme that fits the topic (technology: ocean/charcoal, finance: midnight, health: teal,
  sustainability: forest, marketing/startups: coral, culture/food: terracotta, lifestyle: berry).
"""


def build_prompts(req: DeckRequest, material: str, n_slides: int) -> Tuple[str, str]:
    themes = ", ".join(theme_names())
    system = (
        "You are an expert presentation designer and writer. You turn a request and source material into a "
        "complete slide deck described as JSON.\n\n"
        + _SCHEMA_GUIDE % {"themes": themes}
        + "\n"
        + _RULES.replace("%%", "%")
    )
    lines: List[str] = [f"User request:\n{req.request.strip()}", ""]
    lines.append(f"Target length: {n_slides} slides in total (including the title and closing slides).")
    if req.audience:
        lines.append(f"Audience: {req.audience}")
    if req.tone:
        lines.append(f"Tone: {req.tone}")
    if req.theme:
        lines.append(f"Preferred theme: {req.theme}")
    lines.append("Speaker notes: " + ("wanted on every slide." if req.include_notes else "not wanted; omit them."))
    if material.strip():
        lines += ["", "Source material (base the slides on this; do not add facts that are not supported by it "
                      "unless they are certain, well-known facts):", "<<<", material.strip(), ">>>"]
    else:
        lines += ["", "No source material was provided: use well-established general knowledge only, and do not "
                      "invent specific figures."]
    lines += ["", "Now return the JSON object."]
    return system, "\n".join(lines)


# --------------------------------------------------------------------------- JSON handling
def extract_json_object(text: str) -> Dict[str, Any]:
    """Pull the first balanced JSON object out of a model reply (handles fences and extra prose)."""
    cleaned = (text or "").strip()
    cleaned = re.sub(r"^```(?:json)?\s*|\s*```$", "", cleaned, flags=re.IGNORECASE).strip()
    start = cleaned.find("{")
    if start == -1:
        raise ValueError("no JSON object found in the model reply")
    depth, in_string, escape = 0, False, False
    for index in range(start, len(cleaned)):
        ch = cleaned[index]
        if in_string:
            if escape:
                escape = False
            elif ch == "\\":
                escape = True
            elif ch == '"':
                in_string = False
            continue
        if ch == '"':
            in_string = True
        elif ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                candidate = cleaned[start: index + 1]
                try:
                    return json.loads(candidate)
                except json.JSONDecodeError:
                    # trailing commas are the most common model slip
                    repaired = re.sub(r",\s*([}\]])", r"\1", candidate)
                    return json.loads(repaired)
    raise ValueError("the JSON object in the model reply is incomplete (it may have been cut off)")


def normalize_deck(raw: Dict[str, Any], req: DeckRequest, n_slides: int) -> DeckSpec:
    """Validate and repair a raw deck dict."""
    deck = DeckSpec.model_validate(raw)

    # drop slides that carry no content at all
    kept: List[SlideSpec] = []
    for slide in deck.slides:
        has_content = any([
            slide.title, slide.subtitle, slide.bullets, slide.columns, slide.cards, slide.stats,
            slide.quote, slide.table, slide.chart, slide.steps,
        ])
        if has_content:
            kept.append(slide)
    deck.slides = kept
    if len(deck.slides) < 2:
        raise ValueError("the deck has fewer than two usable slides")

    if deck.slides[0].layout != "title":
        deck.slides.insert(0, SlideSpec(layout="title", title=deck.title, subtitle=deck.subtitle))
    else:
        if not deck.slides[0].title:
            deck.slides[0].title = deck.title
        if not deck.slides[0].subtitle:
            deck.slides[0].subtitle = deck.subtitle

    # trim an over-long deck but keep the closing slide
    limit = min(MAX_SLIDES, n_slides + 2)
    if len(deck.slides) > limit:
        closing = deck.slides[-1] if deck.slides[-1].layout == "closing" else None
        body = deck.slides[: limit - 1] if closing else deck.slides[:limit]
        deck.slides = body + ([closing] if closing else [])

    if req.theme and not deck.theme:
        deck.theme = req.theme.strip().lower()
    if not req.include_notes:
        for slide in deck.slides:
            slide.notes = ""
    if req.title and not deck.title:
        deck.title = clean_text(req.title, 90)
    return deck


# --------------------------------------------------------------------------- deterministic fallback
def outline_from_text(title: str, text: str) -> DeckSpec:
    """Build a plain but valid deck from markdown-ish text (headings, bullets, paragraphs)."""
    sections: List[Tuple[str, List[str]]] = []
    current_title, current_points = "", []

    def flush() -> None:
        nonlocal current_title, current_points
        if current_title or current_points:
            sections.append((current_title, current_points))
        current_title, current_points = "", []

    deck_title = title
    for line in (text or "").splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        heading = re.match(r"^#{1,6}\s*(?:slide\s*\d*\s*[:\-]\s*)?(.+)$", stripped, flags=re.IGNORECASE)
        if heading:
            flush()
            current_title = clean_text(heading.group(1), 80)
            if not deck_title and len(sections) == 0 and stripped.startswith("# "):
                deck_title = current_title
            continue
        bullet = re.match(r"^(?:[-*•]|\d+[.)])\s+(.+)$", stripped)
        if bullet:
            current_points.append(clean_text(bullet.group(1), 150))
        else:
            for sentence in re.split(r"(?<=[.!?])\s+", stripped)[:3]:
                if sentence.strip():
                    current_points.append(clean_text(sentence, 150))
    flush()

    slides: List[SlideSpec] = [SlideSpec(layout="title", title=deck_title or "Presentation")]
    for index, (sec_title, points) in enumerate(sections):
        if sec_title and sec_title.lower() == (deck_title or "").lower() and not points:
            continue
        if not points and not sec_title:
            continue
        slide_title = sec_title or clean_text(points[0], 60)
        slides.append(SlideSpec(layout="bullets", title=slide_title, bullets=points[:5] or [slide_title]))
        if len(slides) >= MAX_SLIDES - 1:
            break
    if len(slides) < 2:
        raise DeckPlanningError("There was not enough source material to build a presentation.")
    slides.append(SlideSpec(layout="closing", title="Thank you"))
    return DeckSpec(title=deck_title or "Presentation", slides=slides)


# --------------------------------------------------------------------------- orchestration
LlmCall = Callable[[str, str], Any]   # async (system_prompt, user_prompt) -> str


async def plan_deck(req: DeckRequest, material: str, call_llm: LlmCall, grounded: bool = False,
                    model: Optional[str] = None) -> PlanResult:
    """Plan a deck with the LLM (one repair retry), falling back to an outline when material exists."""
    if req.deck is not None:
        return PlanResult(deck=normalize_deck(req.deck.model_dump(), req, len(req.deck.slides)),
                          planner="provided", model=None, grounded=grounded)

    material = (material or "")[:MAX_MATERIAL_CHARS]
    n_slides = target_slide_count(req, len(material))
    system, user = build_prompts(req, material, n_slides)

    last_error = ""
    reply = ""
    for attempt in (1, 2):
        prompt = user
        if attempt == 2:
            prompt = (
                f"{user}\n\nYour previous reply could not be used: {last_error}\n"
                "Return ONLY the complete, valid JSON object now. Keep it compact: fewer words per slide."
            )
        try:
            reply = await call_llm(system, prompt)
            raw = extract_json_object(reply)
            deck = normalize_deck(raw, req, n_slides)
            return PlanResult(deck=deck, planner="llm", model=model, grounded=grounded)
        except (ValueError, ValidationError) as exc:
            last_error = str(exc)[:300]
            logger.warning("Deck plan was not usable", extra={"attempt": attempt, "detail": last_error})
        except DeckPlanningError:
            raise
        except Exception as exc:  # provider failure (overload, timeout, bad key): no point retrying the parse
            logger.warning("Deck planning LLM call failed", extra={"detail": str(exc)[:300]})
            last_error = str(exc)[:300]
            break

    if material.strip():
        logger.info("Falling back to a deterministic outline for the deck")
        deck = outline_from_text(req.title or "", material)
        if req.theme:
            deck.theme = req.theme.strip().lower()
        return PlanResult(deck=deck, planner="fallback", model=model, grounded=grounded)
    raise DeckPlanningError(
        "The AI model could not produce a presentation right now. Please try again in a moment."
        if not last_error else f"The AI model could not produce a presentation: {last_error}"
    )
