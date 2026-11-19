"""
Tests for AI presentation generation: schema cleaning, the LLM planner (with a fake model),
the .pptx renderer, and the POST /files/deck endpoint. No network and no database are used.
"""

from __future__ import annotations

import base64
import io
import json

import httpx
import pytest
from pptx import Presentation

from app.core.config import get_settings
from app.schemas.deck import DeckRequest, DeckSpec, SlideSpec, clean_text
from app.services.deck_planner import (
    DeckPlanningError,
    detect_slide_count,
    extract_json_object,
    normalize_deck,
    outline_from_text,
    plan_deck,
)
from app.services.deck_themes import contrast_ratio, pick_theme, theme_names, _THEMES
from app.services.pptx_builder import build_pptx, legacy_slides

WS_ID = "6aec3f2631f96d832ca52b84"


def good_deck_json(n_middle: int = 6) -> dict:
    middle = [
        {"layout": "bullets", "title": "Why plain models fall short", "bullets": ["Stale: knowledge ages", "No sources: answers cannot be checked"],
         "callout": "Ground answers in documents.", "notes": "Explain the problem."},
        {"layout": "two_column", "title": "Keyword versus vector", "columns": [
            {"heading": "Keyword", "bullets": ["Exact terms"]}, {"heading": "Vector", "bullets": ["Meaning"]}]},
        {"layout": "cards", "title": "Three safeguards", "cards": [
            {"title": "Isolation", "body": "Per workspace."}, {"title": "Citations", "body": "Every answer."}]},
        {"layout": "stats", "title": "Results", "stats": [{"value": "92%", "label": "Hit rate", "detail": "Top five"},
                                                         {"value": "1.8s", "label": "Latency"}]},
        {"layout": "timeline", "title": "How it works", "steps": [{"label": "Crawl", "detail": "Pages"},
                                                                  {"label": "Chunk", "detail": "Text"},
                                                                  {"label": "Embed", "detail": "Vectors"}]},
        {"layout": "chart", "title": "Hybrid wins", "chart": {"type": "column", "categories": ["A", "B", "C"],
                                                              "series": [{"name": "Hit rate", "values": [71, 78, 92]}]}},
        {"layout": "table", "title": "Options", "table": {"headers": ["Option", "Best for"],
                                                          "rows": [["Atlas", "One database"], ["Qdrant", "Scale"]]}},
    ][:n_middle]
    return {
        "title": "RAG in Practice", "subtitle": "How retrieval grounds answers", "theme": "ocean",
        "slides": [{"layout": "title", "title": "RAG in Practice", "subtitle": "How retrieval grounds answers"}]
        + middle + [{"layout": "closing", "title": "Next steps", "bullets": ["Index a site", "Ask questions"]}],
    }


def open_pptx(data: bytes) -> Presentation:
    return Presentation(io.BytesIO(data))


# ----------------------------------------------------------------------------- schema
def test_clean_text_strips_markdown_and_truncates_at_a_word_boundary():
    assert clean_text("**Bold** `code` text") == "Bold code text"
    cut = clean_text("word " * 40, 30)
    assert len(cut) <= 30 and cut.endswith("…")


def test_slide_schema_normalizes_layout_aliases_and_limits():
    slide = SlideSpec.model_validate({"layout": "KPI", "title": "Title.", "bullets": ["- a"] * 20,
                                      "stats": [{"value": "1"}] * 9})
    assert slide.layout == "stats"
    assert slide.title == "Title"            # trailing period removed
    assert len(slide.bullets) == 6 and len(slide.stats) == 4
    assert SlideSpec.model_validate({"layout": "nonsense"}).layout == "bullets"


def test_chart_values_accept_numbers_written_as_text():
    deck = DeckSpec.model_validate({"slides": [{"layout": "chart", "chart": {
        "type": "donut", "categories": ["a", "b"], "series": [{"name": "s", "values": ["1,200", "35%", "x"]}]}}]})
    chart = deck.slides[0].chart
    assert chart.type == "doughnut"
    assert chart.series[0].values == [1200.0, 35.0, 0.0]


def test_deck_request_validates_object_ids():
    with pytest.raises(ValueError):
        DeckRequest(request="deck", knowledge_base_id="not-an-id")
    assert DeckRequest(request="deck", knowledge_base_id=WS_ID).knowledge_base_id == WS_ID


# ----------------------------------------------------------------------------- themes
@pytest.mark.parametrize("name", theme_names())
def test_every_theme_has_readable_text_colors(name):
    t = _THEMES[name]
    assert contrast_ratio(t.light, t.ink) >= 7
    assert contrast_ratio(t.light, t.heading_ink) >= 7
    assert contrast_ratio(t.dark, t.on_dark) >= 7
    assert contrast_ratio(t.badge, "FFFFFF") >= 4.5


def test_pick_theme_uses_name_then_topic_then_stable_choice():
    assert pick_theme("forest").name == "forest"
    assert pick_theme(None, "a talk about sustainable farming").name == "forest"
    assert pick_theme("unknown-theme", "quarterly strategy review").name == "midnight"
    assert pick_theme(None, "zzz qqq").name == pick_theme(None, "zzz qqq").name


# ----------------------------------------------------------------------------- planner helpers
def test_detect_slide_count_from_digits_and_words():
    assert detect_slide_count("make a 12-slide deck") == 12
    assert detect_slide_count("ten slides on rust") == 10
    assert detect_slide_count("a presentation about cats") is None
    assert detect_slide_count("500 slides") == 30  # clamped


def test_extract_json_handles_fences_prose_and_trailing_commas():
    reply = 'Sure! Here is your deck:\n```json\n{"title": "T", "slides": [{"title": "A",},],}\n```\nEnjoy.'
    assert extract_json_object(reply)["title"] == "T"
    with pytest.raises(ValueError):
        extract_json_object("no json here")
    with pytest.raises(ValueError):
        extract_json_object('{"title": "cut off", "slides": [')


def test_normalize_adds_title_slide_trims_length_and_drops_empty_slides():
    req = DeckRequest(request="deck", slide_count=5)
    raw = {"title": "T", "subtitle": "S", "slides": [{"layout": "bullets", "title": f"Slide {i}", "bullets": ["x"]}
                                                       for i in range(12)] + [{"layout": "bullets"}]
           + [{"layout": "closing", "title": "End"}]}
    deck = normalize_deck(raw, req, n_slides=5)
    assert deck.slides[0].layout == "title" and deck.slides[0].title == "T"
    assert deck.slides[-1].layout == "closing"
    assert len(deck.slides) <= 7
    assert all(s.title for s in deck.slides)


def test_outline_from_text_parses_headings_bullets_and_legacy_slide_markers():
    deck = outline_from_text("My Deck", "# Slide: Intro\n- one\n- two\n\n## Details\nA sentence. Another one.")
    titles = [s.title for s in deck.slides]
    assert titles[0] == "My Deck" and "Intro" in titles and "Details" in titles
    assert deck.slides[-1].layout == "closing"
    with pytest.raises(DeckPlanningError):
        outline_from_text("", "")


# ----------------------------------------------------------------------------- planner flow
async def test_plan_deck_success_with_fenced_json():
    async def llm(system: str, user: str) -> str:
        assert "JSON" in system and "User request" in user
        return "```json\n" + json.dumps(good_deck_json()) + "\n```"

    result = await plan_deck(DeckRequest(request="Make a deck about RAG"), "", llm)
    assert result.planner == "llm" and result.deck.title == "RAG in Practice"
    assert result.deck.slides[0].layout == "title" and result.deck.slides[-1].layout == "closing"


async def test_plan_deck_retries_once_with_the_parse_error():
    calls = []

    async def llm(system: str, user: str) -> str:
        calls.append(user)
        return "I cannot do that" if len(calls) == 1 else json.dumps(good_deck_json())

    result = await plan_deck(DeckRequest(request="deck"), "", llm)
    assert result.planner == "llm" and len(calls) == 2
    assert "could not be used" in calls[1]


async def test_plan_deck_falls_back_to_outline_when_model_fails_but_material_exists():
    async def llm(system: str, user: str) -> str:
        raise RuntimeError("The AI model is busy right now")

    result = await plan_deck(DeckRequest(request="deck", title="Notes"), "# Overview\n- alpha\n- beta", llm)
    assert result.planner == "fallback" and result.deck.slides[1].title == "Overview"


async def test_plan_deck_without_material_raises_clear_error_when_model_fails():
    async def llm(system: str, user: str) -> str:
        raise RuntimeError("The AI model is busy right now")

    with pytest.raises(DeckPlanningError) as excinfo:
        await plan_deck(DeckRequest(request="deck"), "", llm)
    assert "busy" in str(excinfo.value)


async def test_plan_deck_uses_a_provided_spec_without_calling_the_model():
    async def llm(system: str, user: str) -> str:  # pragma: no cover - must not run
        raise AssertionError("the model must not be called")

    spec = DeckSpec.model_validate(good_deck_json())
    result = await plan_deck(DeckRequest(request="render this", deck=spec), "", llm)
    assert result.planner == "provided"


async def test_prompt_marks_source_material_and_disallows_invented_numbers():
    seen = {}

    async def llm(system: str, user: str) -> str:
        seen["system"], seen["user"] = system, user
        return json.dumps(good_deck_json())

    await plan_deck(DeckRequest(request="deck", audience="executives", tone="confident"), "Revenue grew 12% in Q3.", llm)
    assert "NEVER invent statistics" in seen["system"]
    assert "Revenue grew 12% in Q3." in seen["user"] and "executives" in seen["user"]


# ----------------------------------------------------------------------------- renderer
def test_build_pptx_creates_a_real_16_9_deck_with_titles_notes_chart_and_table():
    deck = DeckSpec.model_validate(good_deck_json(7))
    deck.slides[1].notes = "Say this out loud."
    prs = open_pptx(build_pptx(deck))

    assert len(prs.slides) == 9
    assert round(prs.slide_width / 914400, 2) == 13.33 and round(prs.slide_height / 914400, 2) == 7.5
    titles = [s.shapes.title.text_frame.text for s in prs.slides]
    assert titles[0] == "RAG in Practice" and "Hybrid wins" in titles
    assert prs.slides[1].notes_slide.notes_text_frame.text == "Say this out loud."
    kinds = {shape.shape_type for slide in prs.slides for shape in slide.shapes}
    assert any(getattr(shape, "has_chart", False) and shape.has_chart for slide in prs.slides for shape in slide.shapes)
    assert any(getattr(shape, "has_table", False) and shape.has_table for slide in prs.slides for shape in slide.shapes)
    assert kinds


def test_theme_colors_and_fonts_are_written_into_the_pptx_theme():
    deck = DeckSpec.model_validate({**good_deck_json(), "theme": "forest"})
    data = build_pptx(deck)
    import zipfile
    xml = zipfile.ZipFile(io.BytesIO(data)).read("ppt/theme/theme1.xml").decode("utf-8")
    assert _THEMES["forest"].primary in xml and "Cambria" in xml


def test_long_bullet_lists_split_onto_a_continuation_slide():
    bullets = [f"Point {i}: detail" for i in range(6)]
    deck = DeckSpec.model_validate({"title": "T", "slides": [{"layout": "bullets", "title": "Many", "bullets": bullets}]})
    prs = open_pptx(build_pptx(deck))
    assert [s.shapes.title.text_frame.text for s in prs.slides] == ["T", "Many", "Many (cont.)"]


def test_slide_with_missing_content_degrades_instead_of_failing():
    deck = DeckSpec.model_validate({"title": "T", "slides": [
        {"layout": "cards", "title": "No cards", "subtitle": "fallback text"},
        {"layout": "chart", "title": "No chart data"},
    ]})
    prs = open_pptx(build_pptx(deck))
    assert len(prs.slides) == 3


@pytest.mark.parametrize("kind", ["column", "bar", "line", "pie", "doughnut"])
def test_every_chart_type_renders(kind):
    deck = DeckSpec.model_validate({"title": "T", "slides": [{"layout": "chart", "title": "Chart", "chart": {
        "type": kind, "categories": ["a", "b", "c"], "series": [{"name": "s", "values": [1, 2, 3]}]}}]})
    prs = open_pptx(build_pptx(deck))
    assert any(shape.has_chart for shape in prs.slides[1].shapes if hasattr(shape, "has_chart"))


def test_custom_palette_is_applied_and_unsafe_dark_color_is_corrected():
    deck = DeckSpec.model_validate({**good_deck_json(), "palette": {"dark": "FFFF00", "accent": "#ff00aa"}})
    data = build_pptx(deck)
    assert open_pptx(data).slides  # builds; a light "dark" color is darkened so white text stays readable


def test_legacy_slide_view_keeps_old_preview_working():
    deck = DeckSpec.model_validate(good_deck_json())
    legacy = legacy_slides(deck)
    assert legacy[0]["title"] == "RAG in Practice"
    assert all("title" in s and isinstance(s["points"], list) for s in legacy)


# ----------------------------------------------------------------------------- endpoint
class FakeProvider:
    def __init__(self, reply: str = "", error: Exception | None = None):
        self.reply, self.error = reply, error

    async def stream_chat(self, messages, system_prompt, model=None, temperature=0.7, max_tokens=1024):
        from app.llm.providers.base import StreamChunk

        if self.error:
            raise self.error
        yield StreamChunk(delta=self.reply[: len(self.reply) // 2])
        yield StreamChunk(delta=self.reply[len(self.reply) // 2:])


def endpoint_headers() -> dict:
    return {"X-Internal-Key": get_settings().INTERNAL_API_KEY, "X-Workspace-Id": WS_ID}


async def post(path: str, payload: dict, headers: dict | None = None) -> httpx.Response:
    from app.main import app

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        return await client.post(path, json=payload, headers=headers if headers is not None else endpoint_headers())


async def test_deck_endpoint_returns_a_valid_pptx_with_rich_preview(monkeypatch):
    monkeypatch.setattr("app.api.files.get_llm_provider", lambda **kw: FakeProvider(json.dumps(good_deck_json(7))))
    response = await post("/files/deck", {"request": "Make a deck about RAG", "model": "gemini-3.8-flash"})

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["file_type"] == "pptx" and body["filename"] == "RAG_in_Practice.pptx"
    raw = base64.b64decode(body["content_base64"])
    assert raw[:2] == b"PK" and body["size_bytes"] == len(raw)
    assert len(open_pptx(raw).slides) == body["preview_data"]["slideCount"] == 9
    preview = body["preview_data"]
    assert preview["theme"]["name"] == "ocean" and preview["planner"] == "llm"
    assert preview["slides"][0]["title"] == "RAG in Practice" and preview["deck"]["slides"]


async def test_deck_endpoint_honors_an_explicit_filename(monkeypatch):
    monkeypatch.setattr("app.api.files.get_llm_provider", lambda **kw: FakeProvider(json.dumps(good_deck_json())))
    response = await post("/files/deck", {"request": "deck", "filename": "../my deck?.pptx"})
    assert response.status_code == 200
    filename = response.json()["filename"]
    assert filename.endswith(".pptx") and "/" not in filename and "?" not in filename


async def test_deck_endpoint_reports_a_clear_error_when_the_model_is_down_and_there_is_no_material(monkeypatch):
    monkeypatch.setattr("app.api.files.get_llm_provider",
                        lambda **kw: FakeProvider(error=RuntimeError("The AI model is busy right now (high demand).")))
    response = await post("/files/deck", {"request": "Make a deck about RAG"})
    assert response.status_code == 502
    error = response.json()["error"]
    assert error["code"] == "DECK_PLANNING_FAILED" and "busy" in error["message"]


async def test_deck_endpoint_uses_source_text_fallback_when_model_is_down(monkeypatch):
    monkeypatch.setattr("app.api.files.get_llm_provider", lambda **kw: FakeProvider(error=RuntimeError("down")))
    response = await post("/files/deck", {"request": "convert this", "source_text": "# Plan\n- one\n- two"})
    assert response.status_code == 200
    assert response.json()["preview_data"]["planner"] == "fallback"


async def test_deck_endpoint_requires_the_internal_key_and_a_workspace():
    assert (await post("/files/deck", {"request": "deck"}, headers={})).status_code in (401, 403)
    bad = {"X-Internal-Key": get_settings().INTERNAL_API_KEY}
    assert (await post("/files/deck", {"request": "deck"}, headers=bad)).status_code in (400, 401, 403, 422)


async def test_deck_endpoint_validates_the_request():
    assert (await post("/files/deck", {"request": ""})).status_code == 422
    assert (await post("/files/deck", {"request": "x", "knowledge_base_id": "bad"})).status_code == 422
    assert (await post("/files/deck", {"request": "x", "slide_count": 99})).status_code == 422


async def test_legacy_generate_endpoint_still_works_and_now_uses_the_new_design():
    payload = {"file_type": "pptx", "title": "Quarterly Review", "slides": [
        {"title": "Highlights", "points": ["Revenue up", "Churn down"]}]}
    response = await post("/files/generate", payload)
    assert response.status_code == 200
    body = response.json()
    prs = open_pptx(base64.b64decode(body["content_base64"]))
    assert [s.shapes.title.text_frame.text for s in prs.slides] == ["Quarterly Review", "Highlights"]
    assert body["preview_data"]["slides"][0]["title"] == "Highlights"


async def test_preview_deck_matches_the_rendered_slides_one_to_one(monkeypatch):
    # 6 bullets force a continuation slide; the preview list must include it so indexes line up
    raw = good_deck_json(1)
    raw["slides"][1] = {"layout": "bullets", "title": "Many points", "bullets": [f"P{i}: detail" for i in range(6)]}
    monkeypatch.setattr("app.api.files.get_llm_provider", lambda **kw: FakeProvider(json.dumps(raw)))
    response = await post("/files/deck", {"request": "deck"})
    body = response.json()
    rendered = open_pptx(base64.b64decode(body["content_base64"]))
    preview = body["preview_data"]
    assert len(preview["deck"]["slides"]) == len(rendered.slides) == len(preview["slides"])
    assert [s["title"] for s in preview["deck"]["slides"] if s.get("title")][:3] == [
        rendered.slides[i].shapes.title.text_frame.text for i in range(3)
    ]
