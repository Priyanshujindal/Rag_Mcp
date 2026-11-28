from bs4 import BeautifulSoup, Tag
from app.ingestion.extractors.base import ExtractedDocument, ExtractedSection


def extract_html(content: bytes, filename: str = "", base_url: str = "") -> ExtractedDocument:
    """
    Cleans HTML content, focusing on main documentation containers, removing
    boilerplate (nav, footer, script, style, sidebars), and extracting non-duplicated
    text organized by semantic headings.
    """
    try:
        html_text = content.decode("utf-8", errors="replace")
    except Exception as e:
        raise ValueError(f"Failed to decode HTML content: {e}")

    soup = BeautifulSoup(html_text, "html.parser")

    # Extract title before decomposing tags
    title = None
    if soup.title and soup.title.string:
        title = soup.title.string.strip()
    elif soup.h1:
        title = soup.h1.get_text(" ", strip=True)

    # Prefer main documentation container BEFORE removing site-wide header/footer
    matched_main = soup.select_one("main, [role='main'], .document, article, .markdown-body")
    main_container = matched_main or soup.body or soup

    # Remove non-content elements & navigation sidebars
    tags_to_remove = ["script", "style", "nav", "aside", "noscript", "svg", "iframe", "form"]
    if matched_main is None:
        tags_to_remove.extend(["header", "footer"])
    for tag in main_container(tags_to_remove):
        tag.decompose()

    for sidebar in main_container.select(".sphinxsidebar, .sidebar, [role='navigation'], .toc"):
        sidebar.decompose()

    sections = []
    current_heading = title or "Overview"
    current_text_blocks = []
    seen_blocks = set()

    heading_tags = {"h1", "h2", "h3", "h4", "h5", "h6"}
    leaf_block_tags = {"p", "li", "td", "th", "pre", "blockquote", "dt", "dd"}

    for elem in main_container.descendants:
        if not isinstance(elem, Tag):
            continue

        if elem.name in heading_tags:
            h_text = elem.get_text(" ", strip=True).rstrip("¶#")
            if h_text:
                if current_text_blocks:
                    joined = "\n\n".join(current_text_blocks).strip()
                    if len(joined) > 20:
                        sections.append(ExtractedSection(text=joined, heading=current_heading))
                    current_text_blocks = []
                current_heading = h_text
        elif elem.name in leaf_block_tags:
            # Skip nested blocks (e.g. <p> inside <li> or <blockquote>) to avoid duplication
            if elem.find_parent(leaf_block_tags) is not None:
                continue

            if elem.name == "pre":
                txt = elem.get_text("\n", strip=True)
            else:
                txt = elem.get_text(separator=" ", strip=True)

            if txt and len(txt) > 5 and txt not in seen_blocks:
                seen_blocks.add(txt)
                current_text_blocks.append(txt)

    if current_text_blocks:
        joined = "\n\n".join(current_text_blocks).strip()
        if len(joined) > 20:
            sections.append(ExtractedSection(text=joined, heading=current_heading))

    # Fallback if no structured blocks found
    if not sections:
        fallback_text = main_container.get_text(separator="\n", strip=True)
        if fallback_text and len(fallback_text) > 20:
            sections.append(ExtractedSection(text=fallback_text, heading=title or "Content"))

    if not sections:
        raise ValueError("HTML content has no extractable readable text.")

    return ExtractedDocument(
        title=title or filename or base_url or "Web Document",
        source_type="HTML",
        sections=sections,
    )
