"""
app/services/web_search.py
==========================
Model-agnostic live web search service.
Retrieves up-to-date facts from the live web for any query.
Supports:
  1. DuckDuckGo Search (Free, no API key required)
  2. Wikipedia API Search (Free encyclopedic / entity fact lookup)
  3. Optional Tavily / Brave API if configured
"""

from __future__ import annotations

import json
import re
import urllib.parse
from typing import List, Optional
import httpx
from bs4 import BeautifulSoup

from app.core.config import get_settings
from app.core.logging import logger


def _clean_ddg_url(raw_url: str) -> str:
    """Decodes DuckDuckGo redirection links to the actual destination URL."""
    if "uddg=" in raw_url:
        parsed = urllib.parse.urlparse(raw_url)
        qs = urllib.parse.parse_qs(parsed.query)
        if "uddg" in qs and qs["uddg"]:
            return qs["uddg"][0]
    if raw_url.startswith("//"):
        return f"https:{raw_url}"
    return raw_url


def _strip_html(text: str) -> str:
    """Strips HTML tags and unescapes entities."""
    clean = re.sub(r"<[^>]+>", "", text or "")
    return re.sub(r"\s+", " ", clean).strip()


_STOP_WORDS = {
    "a", "an", "the", "and", "or", "but", "if", "because", "as", "what",
    "which", "who", "whom", "this", "that", "these", "those", "am", "is",
    "are", "was", "were", "be", "been", "being", "have", "has", "had",
    "having", "do", "does", "did", "doing", "how", "many", "much", "why",
    "when", "where", "tell", "me", "about", "for", "with", "at", "by",
    "from", "to", "in", "on", "of", "off", "over", "under", "again",
    "can", "could", "will", "would", "shall", "should", "may", "might",
}


def calculate_web_score(
    query: str,
    title: str = "",
    snippet: str = "",
    rank: int = 0,
) -> float:
    """
    Computes a realistic relevance score (0.55 - 0.96) for a web search hit
    based on search engine rank position decay and keyword overlap with the query.

    :param query: The user's search query / prompt.
    :param title: The title of the web search result.
    :param snippet: The snippet text returned by the search engine.
    :param rank: Zero-indexed position in search results (0 = top hit).
    :return: A float score between 0.55 and 0.96 rounded to 2 decimal places.
    """
    # 1. Base decay according to rank position (0-indexed: 0 -> 0.94, 1 -> 0.89, etc.)
    base_rank_score = max(0.58, 0.94 - (rank * 0.05))

    # 2. Extract meaningful query terms
    clean_query = (query or "").lower()
    raw_tokens = re.findall(r"\b[a-z0-9_-]{2,}\b", clean_query)
    query_tokens = [tok for tok in raw_tokens if tok not in _STOP_WORDS]

    if not query_tokens:
        return round(base_rank_score, 2)

    title_lower = (title or "").lower()
    snippet_lower = (snippet or "").lower()

    # Title matches carry 1.0 weight; snippet matches carry 0.5 weight
    score_sum = 0.0
    for tok in query_tokens:
        if tok in title_lower:
            score_sum += 1.0
        elif tok in snippet_lower:
            score_sum += 0.5

    overlap_ratio = min(1.0, score_sum / len(query_tokens))

    # 3. Blend 60% rank decay + 40% lexical relevance
    final_score = (base_rank_score * 0.60) + (0.60 + overlap_ratio * 0.36) * 0.40

    return round(max(0.55, min(0.96, final_score)), 2)


class WebSearchService:
    """
    Asynchronous web search service supporting free DuckDuckGo & Wikipedia lookups.
    """

    def __init__(self, timeout: float = 6.0):
        self.timeout = timeout
        self.user_agent = (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/124.0.0.0 Safari/537.36"
        )

    async def search(self, query: str, max_results: int = 5) -> List[dict]:
        """
        Executes web search for query, returning a list of dicts with title, url, snippet.
        Tolerates network failures gracefully without raising exceptions.
        """
        query_clean = (query or "").strip()
        if not query_clean:
            return []

        settings = get_settings()

        # 1. If Tavily API Key is configured, use it
        tavily_key = getattr(settings, "TAVILY_API_KEY", "") or ""
        if tavily_key.strip():
            try:
                results = await self._search_tavily(query_clean, tavily_key, max_results)
                if results:
                    return results
            except Exception as exc:
                logger.warning(f"Tavily search failed: {exc}, falling back to free search")

        # 2. Try DuckDuckGo Lite / HTML Search
        try:
            ddg_results = await self._search_ddg(query_clean, max_results)
            if ddg_results:
                return ddg_results
        except Exception as exc:
            logger.warning(f"DuckDuckGo search failed: {exc}")

        # 3. Fallback to Wikipedia Entity Search (very reliable for entities, statistics, facts)
        try:
            wiki_results = await self._search_wikipedia(query_clean, max_results)
            if wiki_results:
                return wiki_results
        except Exception as exc:
            logger.warning(f"Wikipedia search failed: {exc}")

        return []

    async def _search_ddg(self, query: str, max_results: int = 5) -> List[dict]:
        """Scrapes DuckDuckGo HTML search results."""
        headers = {
            "User-Agent": self.user_agent,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.5",
        }
        data = {"q": query, "b": ""}

        async with httpx.AsyncClient(timeout=self.timeout, follow_redirects=True) as client:
            resp = await client.post("https://html.duckduckgo.com/html/", data=data, headers=headers)
            if resp.status_code != 200:
                logger.debug(f"DuckDuckGo returned status {resp.status_code}")
                return []

            soup = BeautifulSoup(resp.text, "html.parser")
            results = []

            for result_div in soup.select(".result"):
                if len(results) >= max_results:
                    break

                title_a = result_div.select_one(".result__title a")
                snippet_td = result_div.select_one(".result__snippet")

                if not title_a:
                    continue

                raw_title = title_a.get_text(strip=True)
                raw_href = title_a.get("href", "")
                snippet_text = snippet_td.get_text(strip=True) if snippet_td else ""

                if not raw_title or not raw_href or "duckduckgo.com/feedback.html" in raw_href:
                    continue

                clean_url = _clean_ddg_url(raw_href)

                results.append({
                    "title": raw_title,
                    "url": clean_url,
                    "snippet": snippet_text,
                })

            return results

    async def _search_wikipedia(self, query: str, max_results: int = 3) -> List[dict]:
        """Queries Wikipedia Search API for entity and topic facts."""
        encoded_query = urllib.parse.quote(query)
        url = (
            f"https://en.wikipedia.org/w/api.php?action=query&list=search"
            f"&srsearch={encoded_query}&utf8=&format=json"
        )
        headers = {"User-Agent": self.user_agent}

        async with httpx.AsyncClient(timeout=self.timeout) as client:
            resp = await client.get(url, headers=headers)
            if resp.status_code != 200:
                return []

            data = resp.json()
            search_items = data.get("query", {}).get("search", [])
            results = []

            for item in search_items[:max_results]:
                title = item.get("title", "")
                raw_snippet = item.get("snippet", "")
                clean_snippet = _strip_html(raw_snippet)
                article_url = f"https://en.wikipedia.org/wiki/{urllib.parse.quote(title.replace(' ', '_'))}"

                if title and clean_snippet:
                    results.append({
                        "title": f"{title} - Wikipedia",
                        "url": article_url,
                        "snippet": clean_snippet,
                    })

            return results

    async def _search_tavily(self, query: str, api_key: str, max_results: int = 5) -> List[dict]:
        """Queries Tavily AI search API if configured."""
        payload = {
            "api_key": api_key,
            "query": query,
            "search_depth": "basic",
            "max_results": max_results,
        }
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            resp = await client.post("https://api.tavily.com/search", json=payload)
            if resp.status_code != 200:
                return []
            data = resp.json()
            results = []
            for item in data.get("results", []):
                results.append({
                    "title": item.get("title", ""),
                    "url": item.get("url", ""),
                    "snippet": item.get("content", ""),
                })
            return results

