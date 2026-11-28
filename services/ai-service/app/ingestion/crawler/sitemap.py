import xml.etree.ElementTree as ET
from urllib.parse import urlparse
from typing import List, Set
from app.core.logging import logger
from app.ingestion.crawler.ssrf_guard import safe_fetch_url


async def discover_sitemap_urls(
    base_url: str,
    max_urls: int = 100,
    path_prefix: str = "",
) -> List[str]:
    """
    Attempts to discover and parse sitemap.xml or sitemap indexes from base_url.
    Filters discovered URLs by same-domain and optional path_prefix.
    """
    parsed = urlparse(base_url)
    sitemap_url = f"{parsed.scheme}://{parsed.netloc}/sitemap.xml"
    urls: Set[str] = set()

    def _matches(u: str) -> bool:
        p = urlparse(u)
        if p.netloc.lower() != parsed.netloc.lower():
            return False
        if path_prefix and not p.path.startswith(path_prefix):
            return False
        return True

    try:
        content, _, _ = await safe_fetch_url(sitemap_url, timeout=5.0)
    except Exception as e:
        logger.debug(f"Sitemap discovery failed for {sitemap_url}: {e}")
        return []

    try:
        root = ET.fromstring(content)
    except Exception as e:
        logger.debug(f"Failed to parse XML sitemap from {sitemap_url}: {e}")
        return []

    tag_name = root.tag.split("}")[-1] if "}" in root.tag else root.tag

    if tag_name == "sitemapindex":
        for sitemap_elem in root:
            for child in sitemap_elem:
                if child.tag.endswith("loc") and child.text:
                    sub_url = child.text.strip()
                    try:
                        sub_content, _, _ = await safe_fetch_url(sub_url, timeout=5.0)
                        sub_root = ET.fromstring(sub_content)
                        for url_elem in sub_root:
                            for c in url_elem:
                                if c.tag.endswith("loc") and c.text:
                                    u = c.text.strip()
                                    if _matches(u):
                                        urls.add(u)
                                        if len(urls) >= max_urls:
                                            return list(urls)
                    except Exception:
                        continue

    elif tag_name == "urlset":
        for url_elem in root:
            for child in url_elem:
                if child.tag.endswith("loc") and child.text:
                    u = child.text.strip()
                    if _matches(u):
                        urls.add(u)
                        if len(urls) >= max_urls:
                            return list(urls)

    return list(urls)
