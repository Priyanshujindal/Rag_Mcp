import asyncio
import urllib.robotparser
from urllib.parse import urljoin, urlparse, urldefrag
from typing import List, Set, Tuple
from bs4 import BeautifulSoup

from app.core.logging import logger
from app.ingestion.crawler.sitemap import discover_sitemap_urls
from app.ingestion.crawler.ssrf_guard import safe_fetch_url

SKIP_EXTENSIONS = (
    ".png", ".jpg", ".jpeg", ".gif", ".svg", ".ico", ".webp",
    ".css", ".js", ".map", ".woff", ".woff2", ".ttf", ".eot",
    ".zip", ".tar", ".gz", ".tgz", ".bz2", ".xz", ".whl", ".exe",
    ".pdf", ".mp3", ".mp4", ".webm", ".avi", ".mov",
)

SKIP_PATH_FRAGMENTS = (
    "/_static/", "/_sources/", "/_images/", "/genindex", "/py-modindex",
    "/search.html", "/cdn-cgi/",
)


class WebCrawler:
    """
    Polite, concurrent, SSRF-safe web crawler with path-prefix scoping,
    robots.txt adherence, start-page link prioritization, and sitemap discovery.
    """

    def __init__(
        self,
        max_pages: int = 60,
        max_depth: int = 3,
        concurrency: int = 5,
        polite_delay_seconds: float = 0.05,
    ):
        self.max_pages = max_pages
        self.max_depth = max_depth
        self.concurrency = concurrency
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
            self.robot_parser.allow_all = True

    def _is_allowed(self, url: str) -> bool:
        if getattr(self.robot_parser, "allow_all", False):
            return True
        return self.robot_parser.can_fetch(self.user_agent, url)

    @staticmethod
    def _is_crawlable_url(url: str, allowed_netloc: str, path_prefix: str) -> bool:
        parsed = urlparse(url)
        if parsed.scheme not in ("http", "https"):
            return False
        if parsed.netloc.lower() != allowed_netloc:
            return False
        if path_prefix and not parsed.path.startswith(path_prefix):
            return False
        lower_path = parsed.path.lower()
        if any(lower_path.endswith(ext) for ext in SKIP_EXTENSIONS):
            return False
        if any(frag in lower_path for frag in SKIP_PATH_FRAGMENTS):
            return False
        return True

    @staticmethod
    def _extract_links(
        html_bytes: bytes,
        base_url: str,
        allowed_netloc: str,
        path_prefix: str,
    ) -> List[str]:
        links: List[str] = []
        seen: Set[str] = set()
        try:
            soup = BeautifulSoup(html_bytes, "html.parser")
            for a_tag in soup.find_all("a", href=True):
                href = a_tag["href"].strip()
                if not href or href.startswith(("#", "javascript:", "mailto:", "tel:")):
                    continue
                full_url = urljoin(base_url, href)
                clean_url, _ = urldefrag(full_url)
                if clean_url in seen:
                    continue
                if WebCrawler._is_crawlable_url(clean_url, allowed_netloc, path_prefix):
                    seen.add(clean_url)
                    links.append(clean_url)
        except Exception:
            pass
        return links

    async def crawl(self, start_url: str) -> List[Tuple[str, bytes]]:
        """
        Crawls starting from start_url up to max_pages and max_depth.
        Prioritizes links found on start_url first, then runs concurrent workers.
        """
        parsed_start = urlparse(start_url)
        allowed_netloc = parsed_start.netloc.lower()

        # Scope to directory prefix when start_url has a non-root path (e.g. /3/ -> /3/)
        raw_path = parsed_start.path or "/"
        if raw_path != "/" and not raw_path.endswith("/"):
            raw_path = raw_path.rsplit("/", 1)[0] + "/"
        path_prefix = "" if raw_path == "/" else raw_path

        await self._init_robots_txt(start_url)

        visited: Set[str] = set()
        results: List[Tuple[str, bytes]] = []
        queue: asyncio.Queue[Tuple[str, int]] = asyncio.Queue()

        clean_start, _ = urldefrag(start_url)
        visited.add(clean_start)

        # 1. Crawl start_url FIRST so its direct child links are prioritized over sitemap noise
        start_error = None
        try:
            start_content, start_final_url, _ = await safe_fetch_url(clean_start)
            visited.add(start_final_url)
            results.append((start_final_url, start_content))
            logger.info(f"Crawled (1/{self.max_pages}): {start_final_url}")

            if self.max_depth >= 1:
                for child_url in self._extract_links(
                    start_content, start_final_url, allowed_netloc, path_prefix
                ):
                    if child_url not in visited:
                        queue.put_nowait((child_url, 1))
        except Exception as e:
            start_error = e
            logger.warning(f"Failed to fetch start URL {clean_start}: {e}")

        # 2. Seed scoped sitemap URLs as supplemental candidates
        sitemap_urls = await discover_sitemap_urls(
            start_url, max_urls=self.max_pages, path_prefix=path_prefix
        )
        for s_url in sitemap_urls:
            s_clean, _ = urldefrag(s_url)
            if s_clean not in visited and self._is_crawlable_url(
                s_clean, allowed_netloc, path_prefix
            ):
                queue.put_nowait((s_clean, 1))

        # 3. Concurrent BFS workers
        lock = asyncio.Lock()

        async def worker() -> None:
            while True:
                async with lock:
                    if len(results) >= self.max_pages:
                        return
                try:
                    url, depth = queue.get_nowait()
                except asyncio.QueueEmpty:
                    return

                try:
                    if depth > self.max_depth:
                        continue
                    async with lock:
                        if url in visited or len(results) >= self.max_pages:
                            continue
                        visited.add(url)

                    if not self._is_allowed(url):
                        logger.info(f"Skipping {url} (disallowed by robots.txt)")
                        continue

                    await asyncio.sleep(self.polite_delay)
                    content, final_url, content_type = await safe_fetch_url(url)

                    # Only index HTML/text pages
                    if content_type and not any(
                        ct in content_type.lower()
                        for ct in ("text/html", "text/plain", "text/markdown", "application/xhtml")
                    ):
                        continue

                    async with lock:
                        if len(results) >= self.max_pages:
                            return
                        visited.add(final_url)
                        results.append((final_url, content))
                        logger.info(f"Crawled ({len(results)}/{self.max_pages}): {final_url}")

                    if depth < self.max_depth:
                        for child_url in self._extract_links(
                            content, final_url, allowed_netloc, path_prefix
                        ):
                            async with lock:
                                if child_url not in visited and queue.qsize() < self.max_pages * 4:
                                    queue.put_nowait((child_url, depth + 1))
                except Exception as e:
                    logger.warning(f"Failed to fetch {url}: {e}")
                finally:
                    queue.task_done()

        workers = [asyncio.create_task(worker()) for _ in range(self.concurrency)]
        await asyncio.gather(*workers)

        if not results and start_error is not None:
            raise start_error

        return results
