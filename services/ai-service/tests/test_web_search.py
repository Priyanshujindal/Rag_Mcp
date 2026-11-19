import pytest
from unittest.mock import AsyncMock, patch
from app.services.web_search import WebSearchService, _clean_ddg_url, _strip_html, calculate_web_score
from app.rag.prompt_builder import PromptBuilder
from app.schemas.chat import ChatRequest


def test_clean_ddg_url():
    raw = "//duckduckgo.com/l/?uddg=https%3A%2F%2Fen.wikipedia.org%2Fwiki%2FMrBeast&rut=123"
    assert _clean_ddg_url(raw) == "https://en.wikipedia.org/wiki/MrBeast"
    assert _clean_ddg_url("//example.com") == "https://example.com"
    assert _clean_ddg_url("https://normal.com") == "https://normal.com"


def test_strip_html():
    raw = "Jimmy Donaldson, better known as <span class=\"searchmatch\">MrBeast</span>, has <b>330M</b> subscribers."
    assert _strip_html(raw) == "Jimmy Donaldson, better known as MrBeast, has 330M subscribers."


def test_chat_request_accepts_web_search_field():
    # Accepts camelCase
    r1 = ChatRequest(message="How many subscribers does MrBeast have?", webSearch=True)
    assert r1.web_search is True

    # Accepts snake_case
    r2 = ChatRequest(message="How many subscribers does MrBeast have?", web_search=False)
    assert r2.web_search is False


def test_prompt_builder_includes_live_web_context():
    pb = PromptBuilder()
    web_results = [
        {
            "title": "MrBeast - Wikipedia",
            "url": "https://en.wikipedia.org/wiki/MrBeast",
            "snippet": "As of 2026, MrBeast has over 330 million subscribers on YouTube.",
        }
    ]

    # In General Mode
    prompt = pb.build_chat_prompt(
        query="How many subscribers does MrBeast have?",
        history=[],
        retrieved_chunks=[],
        web_search_results=web_results,
        is_general=True,
    )

    assert len(prompt.messages) == 1
    user_msg = prompt.messages[0].content
    assert "<live_web_context>" in user_msg
    assert "MrBeast - Wikipedia" in user_msg
    assert "330 million subscribers" in user_msg
    assert "Cite web sources using bracketed index numbers like [1], [2]" in user_msg


def test_calculate_web_score_dynamic_and_differentiated():
    query = "how many subscriber does the mr beast have"

    results = [
        {"title": "MrBeast | Live subscribers", "snippet": "Live count of MrBeast's subscribers"},
        {"title": "MrBeast YouTube Stats: Subscribers, Views & Earnings | vidIQ", "snippet": "vidIQ breakdown of channel"},
        {"title": "List of most-subscribed YouTube channels - Wikipedia", "snippet": "A list of most subscribed channels"},
        {"title": "MrBeast - Wikipedia", "snippet": "Jimmy Donaldson known as MrBeast"},
        {"title": "Social Blade YouTube Stats", "snippet": "General YouTube statistics tracker"},
    ]

    scores = [
        calculate_web_score(
            query=query,
            title=item["title"],
            snippet=item["snippet"],
            rank=i,
        )
        for i, item in enumerate(results)
    ]

    # Scores must NOT all be identical (e.g. not all 0.95)
    unique_scores = set(scores)
    assert len(unique_scores) >= 3, f"Expected varied scores, got: {scores}"

    # Top hit has highest relevance
    assert scores[0] >= 0.90
    # Later hits have lower scores
    assert scores[-1] < scores[0]

    # All scores within reasonable range [0.55, 0.96]
    for s in scores:
        assert 0.55 <= s <= 0.96


