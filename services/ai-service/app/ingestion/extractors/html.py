from bs4 import BeautifulSoup
from app.ingestion.extractors.base import ExtractedDocument, ExtractedSection


def extract_html(content: bytes, filename: str = "", base_url: str = "") -> ExtractedDocument:
    """
    Cleans HTML content, removing boilerplate (nav, footer, script, style)
    and extracts text organized by semantic headings.
    """
    try:
        html_text = content.decode("utf-8", errors="replace")
    except Exception as e:
        raise ValueError(f"Failed to decode HTML content: {e}")

    soup = BeautifulSoup(html_text, "html.parser")

    # Remove non-content elements
    for tag in soup(
        ["script", "style", "nav", "footer", "header", "aside", "noscript", "svg", "iframe", "form"]
    ):
        tag.decompose()

    # Extract title
    title = None
    if soup.title and soup.title.string:
        title = soup.title.string.strip()
    elif soup.h1:
        title = soup.h1.get_text().strip()

    sections = []
    current_heading = title or "Overview"
    current_text_blocks = []

    # Walk body elements
    body = soup.body or soup
    heading_tags = {"h1", "h2", "h3", "h4", "h5", "h6"}

    for elem in body.descendants:
        if elem.name in heading_tags:
            h_text = elem.get_text().strip()
            if h_text:
                if current_text_blocks:
                    joined = "\n\n".join(current_text_blocks).strip()
                    if len(joined) > 20:
                        sections.append(ExtractedSection(text=joined, heading=current_heading))
                    current_text_blocks = []
                current_heading = h_text
        elif elem.name in ("p", "li", "td", "pre", "blockquote", "article", "section"):
            txt = elem.get_text(separator=" ", strip=True)
            # Avoid duplicate nesting by checking if we already captured parent
            if txt and txt not in current_text_blocks and len(txt) > 5:
                current_text_blocks.append(txt)

    if current_text_blocks:
        joined = "\n\n".join(current_text_blocks).strip()
        if len(joined) > 20:
            sections.append(ExtractedSection(text=joined, heading=current_heading))

    # Fallback if no structured blocks found
    if not sections:
        fallback_text = body.get_text(separator="\n", strip=True)
        if fallback_text and len(fallback_text) > 20:
            sections.append(ExtractedSection(text=fallback_text, heading=title or "Content"))

    if not sections:
        raise ValueError("HTML content has no extractable readable text.")

    return ExtractedDocument(
        title=title or filename or base_url or "Web Document",
        source_type="HTML",
        sections=sections,
    )

