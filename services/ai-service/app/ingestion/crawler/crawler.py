import asyncio
import urllib.robotparser
from urllib.parse import urljoin, urlparse, urldefrag
from typing import Dict, List, Set, Tuple
from bs4 import BeautifulSoup

from app.core.config import get_settings
from app.core.logging import logger
from app.ingestion.crawler.sitemap import discover_sitemap_urls
from app.ingestion.crawler.ssrf_guard import safe_fetch_url


class WebCrawler:
    """
    Polite, SSRF-safe web crawler with robots.txt adherence, sitemap discovery,
    and depth/concurrency limits.
    """

    def __init__(
        self,
        max_pages: int = 50,
        max_depth: int = 3,
        concurrency: int = 3,
        polite_delay_seconds: float = 0.2,
    ):
        self.max_pages = max_pages
        self.max_depth = max_depth
        self.semaphore = asyncio.Semaphore(concurrency)
        self.polite_delay = polite_delay_seconds
        self.robot_parser = urllib.robotparser.RobotFileParser()
        self.user_agent = "RagMcp-Crawler/1.0"

    async def _init_robots_txt(self, base_url: str) -> None:
        """Fetch and parse robots.txt for the domain."""
        parsed = urlparse(base_url)
        robots_url = f"{parsed.scheme}://{parsed.netloc}/robots.txt"
        try:
            content, _, _ = await safe_fetch_url(robots_url, timeout=5.0)
            text = content.decode("utf-8", errors="replace")
            self.robot_parser.parse(text.splitlines())
        except Exception:
            # If robots.txt does not exist or fails, default allow all
            self.robot_parser.allow_all = True

    def _is_allowed(self, url: str) -> bool:
        if getattr(self.robot_parser, "allow_all", False):
            return True
        return self.robot_parser.can_fetch(self.user_agent, url)

    async def crawl(self, start_url: str) -> List[Tuple[str, bytes]]:
        """
        Crawls starting from start_url up to max_pages and max_depth.
        Returns list of (url, html_bytes).
        """
        parsed_start = urlparse(start_url)
        allowed_netloc = parsed_start.netloc.lower()

        await self._init_robots_txt(start_url)

        visited: Set[str] = set()
        results: List[Tuple[str, bytes]] = []

        # Queue contains tuples of (url, depth)
        queue: asyncio.Queue[Tuple[str, int]] = asyncio.Queue()

        # Seed start URL
        clean_start, _ = urldefrag(start_url)
        queue.put_nowait((clean_start, 0))

        # Also seed discovered sitemap URLs at depth 1
        sitemap_urls = await discover_sitemap_urls(start_url, max_urls=self.max_pages)
        for s_url in sitemap_urls:
            s_clean, _ = urldefrag(s_url)
            if s_clean != clean_start:
                queue.put_nowait((s_clean, 1))

        while not queue.empty() and len(results) < self.max_pages:
            url, depth = await queue.get()

            if url in visited or depth > self.max_depth:
                continue

            visited.add(url)

            if not self._is_allowed(url):
                logger.info(f"Skipping {url} (disallowed by robots.txt)")
                continue

            async with self.semaphore:
                try:
                    await asyncio.sleep(self.polite_delay)
                    content, final_url, content_type = await safe_fetch_url(url)
                    results.append((final_url, content))
                    logger.info(f"Crawled ({len(results)}/{self.max_pages}): {final_url}")
                except Exception as e:
                    logger.warning(f"Failed to fetch {url}: {e}")
                    continue

            # Extract child links if still within depth
            if depth < self.max_depth and len(results) < self.max_pages:
                try:
                    soup = BeautifulSoup(content, "html.parser")
                    for a_tag in soup.find_all("a", href=True):
                        href = a_tag["href"].strip()
                        if not href or href.startswith(("#", "javascript:", "mailto:", "tel:")):
                            continue

                        full_url = urljoin(final_url, href)
                        clean_url, _ = urldefrag(full_url)
                        parsed_link = urlparse(clean_url)

                        # Strict same-domain enforcement
                        if parsed_link.netloc.lower() == allowed_netloc and parsed_link.scheme in ("http", "https"):
                            if clean_url not in visited:
                                queue.put_nowait((clean_url, depth + 1))
                except Exception:
                    pass

        return results

