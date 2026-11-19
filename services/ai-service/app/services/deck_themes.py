"""
app/services/deck_themes.py
===========================
Color themes for generated presentations.

Each theme is a small palette (dark / primary / secondary / accent) plus a font pair.
Everything else (card tints, muted text, chart colors) is derived from it, and text
colors are always chosen for readable contrast against the surface they sit on.

Fonts are limited to ones that ship with Microsoft Office and render with the same
widths everywhere (Cambria, Calibri, Arial), so text that fits here fits in PowerPoint.
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from typing import Dict, List, Optional


def _rgb(hex_color: str) -> tuple[int, int, int]:
    h = hex_color.lstrip("#")
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)


def _hex(rgb: tuple[float, float, float]) -> str:
    r, g, b = (max(0, min(255, int(round(c)))) for c in rgb)
    return f"{r:02X}{g:02X}{b:02X}"


def blend(color_a: str, color_b: str, amount: float) -> str:
    """Mix color_a toward color_b. amount=0 -> a, amount=1 -> b."""
    ra, ga, ba = _rgb(color_a)
    rb, gb, bb = _rgb(color_b)
    return _hex((ra + (rb - ra) * amount, ga + (gb - ga) * amount, ba + (bb - ba) * amount))


def luminance(hex_color: str) -> float:
    def channel(c: int) -> float:
        s = c / 255.0
        return s / 12.92 if s <= 0.03928 else ((s + 0.055) / 1.055) ** 2.4

    r, g, b = _rgb(hex_color)
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)


def contrast_ratio(color_a: str, color_b: str) -> float:
    la, lb = luminance(color_a), luminance(color_b)
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)


def readable_on(background: str, preferred: str, fallback_dark: str = "1B1B1F", fallback_light: str = "FFFFFF",
                minimum: float = 4.5) -> str:
    """Return `preferred` if it is readable on `background`, otherwise black or white."""
    if contrast_ratio(background, preferred) >= minimum:
        return preferred
    return fallback_light if luminance(background) < 0.4 else fallback_dark


@dataclass(frozen=True)
class Theme:
    name: str
    dark: str        # background of title / section / closing slides
    primary: str     # main brand color (headings, shapes)
    secondary: str   # supporting color
    accent: str      # sharp accent (numbers, highlights)
    heading_font: str
    body_font: str
    light: str = "FFFFFF"   # background of content slides

    # ---- derived colors -------------------------------------------------
    @property
    def ink(self) -> str:
        """Body text color on light surfaces."""
        return readable_on(self.light, blend(self.dark, "000000", 0.35), minimum=7.0)

    @property
    def heading_ink(self) -> str:
        """Slide-title color on light surfaces."""
        return readable_on(self.light, self.primary if luminance(self.primary) < 0.3 else self.dark, minimum=7.0)

    @property
    def muted(self) -> str:
        """Secondary text on light surfaces (captions, footers)."""
        return readable_on(self.light, blend(self.ink, self.light, 0.35), minimum=4.5)

    @property
    def card(self) -> str:
        """Subtle tinted surface for cards on light slides."""
        return blend(self.primary, self.light, 0.92)

    @property
    def card_strong(self) -> str:
        return blend(self.primary, self.light, 0.84)

    @property
    def on_dark(self) -> str:
        return "FFFFFF"

    @property
    def on_dark_muted(self) -> str:
        return readable_on(self.dark, blend(self.secondary, "FFFFFF", 0.55), minimum=4.5)

    @property
    def badge(self) -> str:
        """Fill for number circles on light slides (always strong enough for white text)."""
        return self.primary if contrast_ratio(self.primary, "FFFFFF") >= 4.5 else self.dark

    @property
    def accent_on_dark(self) -> str:
        return self.accent if contrast_ratio(self.dark, self.accent) >= 3.0 else self.secondary

    @property
    def accent_text(self) -> str:
        """Text color for accent-filled shapes."""
        return readable_on(self.accent, "FFFFFF", fallback_dark=self.dark, minimum=4.5)

    def chart_colors(self) -> List[str]:
        colors = [self.primary, self.accent, self.secondary, blend(self.dark, "FFFFFF", 0.35),
                  blend(self.primary, "FFFFFF", 0.45), blend(self.accent, self.dark, 0.35)]
        # keep each color distinguishable on white
        return [c if contrast_ratio("FFFFFF", c) >= 1.6 else blend(c, "000000", 0.25) for c in colors]


_THEMES: Dict[str, Theme] = {
    # Editorial serif headings + clean sans body
    "midnight": Theme("midnight", dark="1E2761", primary="1E2761", secondary="8FB3F2", accent="F5B841",
                      heading_font="Cambria", body_font="Calibri"),
    "forest": Theme("forest", dark="1F4A22", primary="2C5F2D", secondary="97BC62", accent="E9A23B",
                    heading_font="Cambria", body_font="Calibri"),
    "terracotta": Theme("terracotta", dark="4A2118", primary="B85042", secondary="A7BEAE", accent="E0A458",
                        heading_font="Cambria", body_font="Calibri"),
    "berry": Theme("berry", dark="3B1426", primary="6D2E46", secondary="D49A9C", accent="E9C46A",
                   heading_font="Cambria", body_font="Calibri"),
    # Modern sans throughout
    "ocean": Theme("ocean", dark="0F2F4A", primary="065A82", secondary="5BB5D5", accent="2EC4B6",
                   heading_font="Calibri", body_font="Calibri"),
    "teal": Theme("teal", dark="013B44", primary="028090", secondary="5CD6C0", accent="F4D35E",
                  heading_font="Calibri", body_font="Calibri"),
    "coral": Theme("coral", dark="2F3C7E", primary="2F3C7E", secondary="F9C5C7", accent="F96167",
                   heading_font="Calibri", body_font="Calibri"),
    "charcoal": Theme("charcoal", dark="212B33", primary="36454F", secondary="9DB2BF", accent="F29F05",
                      heading_font="Calibri", body_font="Calibri"),
}

DEFAULT_THEME = "ocean"

# Words in the request that hint at a fitting theme (checked in order).
_TOPIC_HINTS: List[tuple[str, tuple[str, ...]]] = [
    ("forest", ("sustainab", "environment", "climate", "green", "nature", "agricultur", "farm", "eco", "forest", "wildlife", "organic")),
    ("teal", ("health", "medical", "medicine", "clinic", "wellness", "biotech", "hospital", "patient", "pharma")),
    ("coral", ("marketing", "brand", "social media", "campaign", "creative", "startup", "pitch", "product launch", "sales")),
    ("terracotta", ("food", "restaurant", "travel", "culture", "history", "art", "design", "architecture", "hospitality")),
    ("berry", ("fashion", "beauty", "lifestyle", "event", "wedding", "luxury")),
    ("midnight", ("finance", "bank", "invest", "strategy", "executive", "board", "quarter", "annual", "legal", "consult", "enterprise")),
    ("charcoal", ("security", "engineering", "architecture review", "devops", "infrastructure", "cyber", "audit", "compliance")),
    ("ocean", ("technology", "software", "ai ", "artificial intelligence", "machine learning", "data", "cloud", "saas", "digital", "api", "analytics")),
]


def _hint_matches(word: str, text: str) -> bool:
    """Short keywords must match as whole words ('art' must not match 'quarterly'); longer ones as word starts."""
    word = word.strip()
    pattern = rf"\b{re.escape(word)}\b" if len(word) <= 4 else rf"\b{re.escape(word)}"
    return re.search(pattern, text) is not None


def theme_names() -> List[str]:
    return list(_THEMES.keys())


def pick_theme(requested: Optional[str], text_hint: str = "") -> Theme:
    """Choose a theme: an explicit valid name wins, then topic keywords, then a stable default."""
    name = (requested or "").strip().lower()
    if name in _THEMES:
        return _THEMES[name]
    hint = f" {text_hint.lower()} "
    for theme_name, words in _TOPIC_HINTS:
        if any(_hint_matches(w, hint) for w in words):
            return _THEMES[theme_name]
    if hint.strip():
        # no keyword match: stable choice per topic so the same request always looks the same
        digest = int(hashlib.sha256(hint.strip().encode("utf-8")).hexdigest(), 16)
        return list(_THEMES.values())[digest % len(_THEMES)]
    return _THEMES[DEFAULT_THEME]


def apply_palette(base: Theme, dark: Optional[str] = None, primary: Optional[str] = None,
                  secondary: Optional[str] = None, accent: Optional[str] = None) -> Theme:
    """Overlay a custom palette (valid 6-digit hex values) onto a base theme."""
    new_dark = dark or base.dark
    new_primary = primary or base.primary
    # a custom dark background must be dark enough for white text
    if contrast_ratio(new_dark, "FFFFFF") < 4.5:
        new_dark = blend(new_dark, "000000", 0.55)
    return Theme(
        name=base.name,
        dark=new_dark,
        primary=new_primary,
        secondary=secondary or base.secondary,
        accent=accent or base.accent,
        heading_font=base.heading_font,
        body_font=base.body_font,
        light=base.light,
    )


def theme_to_dict(theme: Theme) -> Dict[str, str]:
    """Flat color/font description the web preview uses to draw slides like the .pptx."""
    return {
        "name": theme.name,
        "dark": theme.dark,
        "light": theme.light,
        "primary": theme.primary,
        "secondary": theme.secondary,
        "accent": theme.accent,
        "badge": theme.badge,
        "ink": theme.ink,
        "headingInk": theme.heading_ink,
        "muted": theme.muted,
        "card": theme.card,
        "onDark": theme.on_dark,
        "onDarkMuted": theme.on_dark_muted,
        "accentOnDark": theme.accent_on_dark,
        "accentText": theme.accent_text,
        "headingFont": theme.heading_font,
        "bodyFont": theme.body_font,
        "chartColors": theme.chart_colors(),
    }
