"""
app/services/pptx_builder.py
============================
Renders a DeckSpec into a designed, fully editable .pptx file (python-pptx).

Design rules this renderer follows (so decks look intentional, not templated):
- 16:9 canvas (13.333 x 7.5 in), 0.7 in side margins, consistent title position.
- One dominant color per deck, one sharp accent, dark title/section/closing slides
  and light content slides ("sandwich" structure).
- One repeated motif: circles (number badges, big soft circles on dark slides).
- No accent lines under titles and no decorative stripes.
- Every slide carries a visual element (badges, cards, stat callouts, charts, tables).
- Text sizes: titles 28-46 pt, body 14-22 pt, captions 10-12 pt. Text that does not fit is
  shortened or split onto a continuation slide instead of being shrunk below the floor.
- Real slide titles live in title placeholders (outline view, accessibility, navigation).
- Charts and tables are native PowerPoint objects, speaker notes are real notes.
"""

from __future__ import annotations

import io
import re
import uuid
from typing import Dict, List, Optional, Tuple

from lxml import etree
from pptx import Presentation
from pptx.chart.data import CategoryChartData
from pptx.dml.color import RGBColor
from pptx.enum.chart import XL_CHART_TYPE, XL_LABEL_POSITION, XL_LEGEND_POSITION
from pptx.enum.shapes import MSO_CONNECTOR, MSO_SHAPE
from pptx.enum.text import MSO_ANCHOR, MSO_AUTO_SIZE, PP_ALIGN
from pptx.opc.constants import RELATIONSHIP_TYPE as RT
from pptx.oxml.ns import qn
from pptx.util import Emu, Inches, Pt

from app.core.logging import logger
from app.schemas.deck import DeckSpec, SlideSpec
from app.services.deck_themes import Theme, apply_palette, blend, contrast_ratio, pick_theme, readable_on

# --------------------------------------------------------------------------- geometry (inches)
SLIDE_W = 13.333
SLIDE_H = 7.5
MARGIN_X = 0.7
CONTENT_W = SLIDE_W - 2 * MARGIN_X
TITLE_Y = 0.5
TITLE_H = 1.1
BODY_TOP = 1.95
BODY_BOTTOM = 6.75
BODY_H = BODY_BOTTOM - BODY_TOP

MAX_BULLET_ROWS = 5
_A_NS = "http://schemas.openxmlformats.org/drawingml/2006/main"


# =========================================================================== low-level helpers
def _rgb(hex_color: str) -> RGBColor:
    return RGBColor.from_string(hex_color.lstrip("#").upper())


def _in(value: float) -> Emu:
    return Inches(value)


def _on(fill: str, t: Theme) -> str:
    """Readable text color for a given fill."""
    return readable_on(fill, "FFFFFF", fallback_dark=t.dark, minimum=4.5)


def _set_fill(shape, hex_color: Optional[str], alpha: Optional[float] = None) -> None:
    if hex_color is None:
        shape.fill.background()
        return
    shape.fill.solid()
    shape.fill.fore_color.rgb = _rgb(hex_color)
    if alpha is not None:
        clr = shape._element.spPr.find(qn("a:solidFill")).find(qn("a:srgbClr"))
        for old in clr.findall(qn("a:alpha")):
            clr.remove(old)
        alpha_el = etree.SubElement(clr, qn("a:alpha"))
        alpha_el.set("val", str(int(max(0.0, min(1.0, alpha)) * 100000)))


def _set_line(shape, hex_color: Optional[str], width_pt: float = 1.0) -> None:
    if hex_color is None:
        shape.line.fill.background()
    else:
        shape.line.color.rgb = _rgb(hex_color)
        shape.line.width = Pt(width_pt)


def _flat_style(shape) -> None:
    """Drop the theme's default shape effect so no unintended shadow appears in any renderer."""
    style = shape._element.find(qn("p:style"))
    if style is not None:
        effect_ref = style.find(qn("a:effectRef"))
        if effect_ref is not None:
            effect_ref.set("idx", "0")


def _soft_shadow(shape) -> None:
    """Subtle drop shadow (call after fill and line are set)."""
    sp_pr = shape._element.spPr
    _flat_style(shape)
    for old in sp_pr.findall(qn("a:effectLst")):
        sp_pr.remove(old)
    effect = etree.SubElement(sp_pr, qn("a:effectLst"))
    shdw = etree.SubElement(effect, qn("a:outerShdw"))
    shdw.set("blurRad", "88900")
    shdw.set("dist", "25400")
    shdw.set("dir", "5400000")
    shdw.set("algn", "t")
    shdw.set("rotWithShape", "0")
    clr = etree.SubElement(shdw, qn("a:srgbClr"))
    clr.set("val", "000000")
    etree.SubElement(clr, qn("a:alpha")).set("val", "14000")


def _no_shadow(shape) -> None:
    shape.shadow.inherit = False
    _flat_style(shape)


def _style_run(run, size: float, color: str, font: str, bold: bool = False, italic: bool = False,
               spacing: Optional[int] = None) -> None:
    run.font.size = Pt(size)
    run.font.bold = bold
    run.font.italic = italic
    run.font.name = font
    run.font.color.rgb = _rgb(color)
    rpr = run._r.get_or_add_rPr()
    # make sure east-asian / complex-script text uses the same family
    for tag in ("a:ea", "a:cs"):
        el = rpr.find(qn(tag))
        if el is None:
            el = etree.SubElement(rpr, qn(tag))
        el.set("typeface", font)
    if spacing is not None:
        rpr.set("spc", str(spacing))


def _frame(shape, anchor: MSO_ANCHOR = MSO_ANCHOR.TOP, margin: float = 0.0):
    tf = shape.text_frame
    tf.word_wrap = True
    tf.auto_size = MSO_AUTO_SIZE.NONE
    tf.vertical_anchor = anchor
    tf.margin_left = tf.margin_right = _in(margin)
    tf.margin_top = tf.margin_bottom = _in(margin)
    return tf


def _bullet_style(paragraph, color: str, char: str = "•", indent_in: float = 0.28) -> None:
    pPr = paragraph._p.get_or_add_pPr()
    pPr.set("marL", str(int(Inches(indent_in))))
    pPr.set("indent", str(-int(Inches(indent_in))))
    for tag in ("a:buClr", "a:buFont", "a:buChar", "a:buNone"):
        for old in pPr.findall(qn(tag)):
            pPr.remove(old)
    bu_clr = etree.SubElement(pPr, qn("a:buClr"))
    etree.SubElement(bu_clr, qn("a:srgbClr")).set("val", color)
    etree.SubElement(pPr, qn("a:buFont")).set("typeface", "Arial")
    etree.SubElement(pPr, qn("a:buChar")).set("char", char)


# =========================================================================== text measuring
_CHAR_W = {"Calibri": 0.50, "Cambria": 0.54, "Arial": 0.56}


def _char_width(font: str, bold: bool) -> float:
    base = _CHAR_W.get(font, 0.55)
    return base * (1.07 if bold else 1.0)


def _count_lines(text: str, width_in: float, size_pt: float, font: str, bold: bool) -> int:
    chars_per_line = max(1, int(width_in * 72.0 / (size_pt * _char_width(font, bold))))
    lines = 0
    for paragraph in text.split("\n"):
        words = paragraph.split()
        if not words:
            lines += 1
            continue
        n, cur = 1, 0
        for word in words:
            length = len(word)
            if cur == 0:
                cur = length
            elif cur + 1 + length <= chars_per_line:
                cur += 1 + length
            else:
                n += 1
                cur = length
            while cur > chars_per_line:
                n += 1
                cur -= chars_per_line
        lines += n
    return lines


def _text_height(text: str, width_in: float, size_pt: float, font: str, bold: bool,
                 spacing: float = 1.2) -> float:
    return _count_lines(text, width_in, size_pt, font, bold) * size_pt * spacing / 72.0


def _fit(text: str, width_in: float, height_in: float, max_pt: float, min_pt: float, font: str,
         bold: bool = False, spacing: float = 1.2) -> Tuple[str, float]:
    """Largest size in [min_pt, max_pt] that fits; if none, shorten the text at the floor size."""
    size = max_pt
    while size >= min_pt:
        if _text_height(text, width_in, size, font, bold, spacing) <= height_in:
            return text, size
        size -= 1
    words = text.split()
    while len(words) > 3:
        words = words[:-1]
        candidate = " ".join(words).rstrip(" ,;:-") + "…"
        if _text_height(candidate, width_in, min_pt, font, bold, spacing) <= height_in:
            return candidate, min_pt
    return text, min_pt


def _value_em(text: str) -> float:
    """Approximate width of big bold numbers/symbols in em (digits and % are wider than average text)."""
    em = 0.0
    for ch in text:
        if ch.isdigit():
            em += 0.62
        elif ch in "%\u2030":
            em += 1.0
        elif ch in ".,":
            em += 0.32
        elif ch == " ":
            em += 0.28
        elif ch.isupper():
            em += 0.74
        else:
            em += 0.64
    return em


def _fit_one_line(text: str, width_in: float, max_pt: float, min_pt: float, font: str, bold: bool = False) -> float:
    """Largest size (down to min_pt) at which `text` stays on ONE line within width_in."""
    size = max_pt
    while size > min_pt and _value_em(text) * size / 72.0 > width_in:
        size -= 1
    return size


def _split_lead(text: str) -> Tuple[str, str]:
    """'Lead phrase: detail' -> ('Lead phrase', 'detail'). Short leads only."""
    if ":" in text[:48]:
        lead, _, rest = text.partition(":")
        if 2 <= len(lead.strip()) <= 44 and rest.strip():
            return lead.strip(), rest.strip()
    return "", text


# =========================================================================== shape builders
class _Ctx:
    """Per-deck rendering context."""

    def __init__(self, prs, theme: Theme, deck_title: str):
        self.prs = prs
        self.t = theme
        self.deck_title = deck_title
        self.layout_title_only = prs.slide_layouts[5]
        self.layout_title_slide = prs.slide_layouts[0]
        self.total = 0


def _background(slide, hex_color: str) -> None:
    fill = slide.background.fill
    fill.solid()
    fill.fore_color.rgb = _rgb(hex_color)


def _text_box(slide, x, y, w, h, name: str, anchor=MSO_ANCHOR.TOP):
    box = slide.shapes.add_textbox(_in(x), _in(y), _in(w), _in(h))
    box.name = name
    return box, _frame(box, anchor)


def _write(tf, paragraphs: List[dict]) -> None:
    """paragraphs: dicts with text,size,color,font + optional bold,italic,align,space_after,bullet,spacing."""
    first = True
    for spec in paragraphs:
        p = tf.paragraphs[0] if first else tf.add_paragraph()
        first = False
        p.alignment = spec.get("align", PP_ALIGN.LEFT)
        p.line_spacing = spec.get("line_spacing", 1.05)
        p.space_after = Pt(spec.get("space_after", 0))
        p.space_before = Pt(0)
        run = p.add_run()
        run.text = spec["text"]
        _style_run(run, spec["size"], spec["color"], spec["font"], spec.get("bold", False),
                   spec.get("italic", False), spec.get("spacing"))
        if spec.get("bullet"):
            _bullet_style(p, spec["bullet"], indent_in=spec.get("indent", 0.28))


def _circle(slide, cx: float, cy: float, d: float, fill: Optional[str], name: str, text: str = "",
            text_color: str = "FFFFFF", size: float = 18, font: str = "Calibri", bold: bool = True,
            line: Optional[str] = None, line_w: float = 1.5, alpha: Optional[float] = None):
    shape = slide.shapes.add_shape(MSO_SHAPE.OVAL, _in(cx - d / 2), _in(cy - d / 2), _in(d), _in(d))
    shape.name = name
    _set_fill(shape, fill, alpha)
    _set_line(shape, line, line_w)
    _no_shadow(shape)
    if text:
        tf = _frame(shape, MSO_ANCHOR.MIDDLE)
        p = tf.paragraphs[0]
        p.alignment = PP_ALIGN.CENTER
        run = p.add_run()
        run.text = text
        _style_run(run, size, text_color, font, bold)
    return shape


def _card(slide, x, y, w, h, fill: str, name: str, radius: float = 0.04, shadow: bool = True):
    shape = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, _in(x), _in(y), _in(w), _in(h))
    shape.name = name
    shape.adjustments[0] = radius
    _set_fill(shape, fill)
    _set_line(shape, None)
    if shadow:
        _soft_shadow(shape)
    else:
        _no_shadow(shape)
    return shape


def _slide_title(ctx: _Ctx, slide, text: str, *, x=MARGIN_X, y=TITLE_Y, w=CONTENT_W, h=TITLE_H,
                 color: Optional[str] = None, max_pt: float = 36, min_pt: float = 28,
                 anchor=MSO_ANCHOR.MIDDLE, font: Optional[str] = None) -> None:
    """Fill the real title placeholder (keeps outline view and screen readers working)."""
    t = ctx.t
    heading_font = font or t.heading_font
    title = slide.shapes.title
    title.left, title.top, title.width, title.height = _in(x), _in(y), _in(w), _in(h)
    title.name = "Title"
    tf = _frame(title, anchor)
    fitted, size = _fit(text, w, h, max_pt, min_pt, heading_font, bold=True, spacing=1.1)
    p = tf.paragraphs[0]
    p.alignment = PP_ALIGN.LEFT
    p.line_spacing = 0.95
    run = p.add_run()
    run.text = fitted
    _style_run(run, size, color or t.heading_ink, heading_font, bold=True)


def _footer(ctx: _Ctx, slide, number: int) -> None:
    t = ctx.t
    box, tf = _text_box(slide, MARGIN_X, 7.0, 8.5, 0.3, "Footer", MSO_ANCHOR.MIDDLE)
    _write(tf, [{"text": ctx.deck_title[:80], "size": 10, "color": t.muted, "font": t.body_font}])
    nbox, ntf = _text_box(slide, SLIDE_W - MARGIN_X - 1.0, 7.0, 1.0, 0.3, "Slide number", MSO_ANCHOR.MIDDLE)
    p = ntf.paragraphs[0]
    p.alignment = PP_ALIGN.RIGHT
    fld = etree.SubElement(p._p, qn("a:fld"))
    fld.set("id", "{" + str(uuid.uuid4()).upper() + "}")
    fld.set("type", "slidenum")
    rpr = etree.SubElement(fld, qn("a:rPr"))
    rpr.set("lang", "en-US")
    rpr.set("sz", "1000")
    solid = etree.SubElement(rpr, qn("a:solidFill"))
    etree.SubElement(solid, qn("a:srgbClr")).set("val", t.muted)
    etree.SubElement(rpr, qn("a:latin")).set("typeface", t.body_font)
    etree.SubElement(fld, qn("a:t")).text = str(number)


def _motif(slide, t: Theme) -> None:
    """Soft circles on the right of dark slides - the deck's visual signature."""
    _circle(slide, 11.4, 1.7, 7.0, blend(t.dark, t.secondary, 0.16), "Motif circle large")
    _circle(slide, 11.55, 3.9, 4.0, None, "Motif ring", line=blend(t.dark, t.secondary, 0.55), line_w=1.5)
    _circle(slide, 11.9, 5.7, 2.2, t.accent_on_dark, "Motif circle accent")


def _notes(slide, text: str) -> None:
    if text:
        slide.notes_slide.notes_text_frame.text = text


# =========================================================================== layouts
def _layout_title(ctx: _Ctx, spec: SlideSpec, deck: DeckSpec) -> None:
    t = ctx.t
    slide = ctx.prs.slides.add_slide(ctx.layout_title_slide)
    _background(slide, t.dark)
    _motif(slide, t)

    title = slide.shapes.title
    title.left, title.top, title.width, title.height = _in(0.9), _in(1.9), _in(6.8), _in(2.5)
    title.name = "Title"
    tf = _frame(title, MSO_ANCHOR.BOTTOM)
    fitted, size = _fit(spec.title or deck.title, 6.8, 2.5, 46, 32, t.heading_font, bold=True, spacing=1.1)
    p = tf.paragraphs[0]
    p.alignment = PP_ALIGN.LEFT
    p.line_spacing = 0.95
    run = p.add_run()
    run.text = fitted
    _style_run(run, size, t.on_dark, t.heading_font, bold=True)

    subtitle_text = spec.subtitle or deck.subtitle
    sub = slide.placeholders[1]
    sub.left, sub.top, sub.width, sub.height = _in(0.9), _in(4.6), _in(6.6), _in(1.3)
    sub.name = "Subtitle"
    stf = _frame(sub, MSO_ANCHOR.TOP)
    if subtitle_text:
        s_fit, s_size = _fit(subtitle_text, 6.6, 1.3, 22, 16, t.body_font, spacing=1.2)
        sp = stf.paragraphs[0]
        sp.alignment = PP_ALIGN.LEFT
        r = sp.add_run()
        r.text = s_fit
        _style_run(r, s_size, t.on_dark_muted, t.body_font)

    if deck.author:
        box, atf = _text_box(slide, 0.9, 6.5, 6.6, 0.4, "Author", MSO_ANCHOR.MIDDLE)
        _write(atf, [{"text": deck.author, "size": 14, "color": t.on_dark_muted, "font": t.body_font}])


def _layout_section(ctx: _Ctx, spec: SlideSpec, index: int) -> None:
    t = ctx.t
    slide = ctx.prs.slides.add_slide(ctx.layout_title_only)
    _background(slide, t.dark)
    _motif(slide, t)
    number = spec.number or f"{index:02d}"
    _circle(slide, 1.95, 3.75, 1.5, t.accent_on_dark, "Section number", number,
            _on(t.accent_on_dark, t), 40, t.heading_font)
    _slide_title(ctx, slide, spec.title, x=3.25, y=2.85, w=4.4, h=1.6, color=t.on_dark, max_pt=40, min_pt=28,
                 anchor=MSO_ANCHOR.MIDDLE)
    if spec.subtitle:
        box, tf = _text_box(slide, 3.25, 4.55, 4.4, 1.2, "Section subtitle")
        s_fit, s_size = _fit(spec.subtitle, 4.4, 1.2, 20, 16, t.body_font)
        _write(tf, [{"text": s_fit, "size": s_size, "color": t.on_dark_muted, "font": t.body_font}])


def _row_texts(text: str, t: Theme, width: float, height: float):
    """Paragraph specs for a numbered row: bold lead + detail, fitted to the box."""
    lead, detail = _split_lead(text)
    if lead:
        for lead_pt, det_pt in ((20, 16), (19, 15), (18, 15), (17, 14), (16, 14)):
            need = (_text_height(lead, width, lead_pt, t.body_font, True, 1.15)
                    + _text_height(detail, width, det_pt, t.body_font, False, 1.2) + 0.05)
            if need <= height:
                return [
                    {"text": lead, "size": lead_pt, "color": t.heading_ink, "font": t.body_font, "bold": True,
                     "space_after": 2},
                    {"text": detail, "size": det_pt, "color": t.ink, "font": t.body_font},
                ]
        short, size = _fit(detail, width, max(0.4, height - 0.45), 15, 14, t.body_font)
        return [
            {"text": lead, "size": 16, "color": t.heading_ink, "font": t.body_font, "bold": True, "space_after": 2},
            {"text": short, "size": size, "color": t.ink, "font": t.body_font},
        ]
    fitted, size = _fit(detail, width, height, 20, 14, t.body_font, spacing=1.2)
    return [{"text": fitted, "size": size, "color": t.ink, "font": t.body_font}]


def _layout_bullets(ctx: _Ctx, spec: SlideSpec, number: int) -> None:
    t = ctx.t
    slide = ctx.prs.slides.add_slide(ctx.layout_title_only)
    _background(slide, t.light)
    _slide_title(ctx, slide, spec.title)

    bullets = spec.bullets[:MAX_BULLET_ROWS] or [spec.subtitle or spec.title]
    n = len(bullets)
    has_panel = bool(spec.callout)
    rows_w = 7.5 if has_panel else CONTENT_W
    gap = 0.22
    row_h = min(1.12, (BODY_H - gap * (n - 1)) / n)
    badge_d = 0.62
    text_x = MARGIN_X + badge_d + 0.32
    text_w = rows_w - badge_d - 0.32

    for i, bullet in enumerate(bullets):
        y = BODY_TOP + i * (row_h + gap)
        _circle(slide, MARGIN_X + badge_d / 2, y + row_h / 2, badge_d, t.badge, f"Badge {i + 1}", str(i + 1),
                "FFFFFF", 18, t.body_font)
        box, tf = _text_box(slide, text_x, y, text_w, row_h, f"Row {i + 1}", MSO_ANCHOR.MIDDLE)
        _write(tf, _row_texts(bullet, t, text_w, row_h))

    if has_panel:
        px = MARGIN_X + rows_w + 0.45
        pw = SLIDE_W - MARGIN_X - px
        ph = BODY_H
        _card(slide, px, BODY_TOP, pw, ph, t.dark, "Key takeaway panel", radius=0.05)
        box, tf = _text_box(slide, px + 0.4, BODY_TOP + 0.4, pw - 0.8, ph - 0.8, "Key takeaway", MSO_ANCHOR.MIDDLE)
        c_fit, c_size = _fit(spec.callout, pw - 0.8, ph - 1.5, 28, 20, t.heading_font, bold=True, spacing=1.15)
        _write(tf, [
            {"text": "KEY TAKEAWAY", "size": 12, "color": t.accent_on_dark, "font": t.body_font, "bold": True,
             "space_after": 10, "spacing": 150},
            {"text": c_fit, "size": c_size, "color": t.on_dark, "font": t.heading_font, "bold": True,
             "line_spacing": 1.1},
        ])
    _footer(ctx, slide, number)


def _layout_two_column(ctx: _Ctx, spec: SlideSpec, number: int) -> None:
    t = ctx.t
    slide = ctx.prs.slides.add_slide(ctx.layout_title_only)
    _background(slide, t.light)
    _slide_title(ctx, slide, spec.title)
    columns = spec.columns[:2]
    gap = 0.45
    card_w = (CONTENT_W - gap) / 2
    body_w = card_w - 0.8
    head_block = 1.3
    avail_h = BODY_H - head_block - 0.35

    def block_height(col, size: int) -> float:
        return sum(_text_height(b, body_w - 0.3, size, t.body_font, False, 1.2) + 12 / 72.0
                   for b in (col.bullets or [""]))

    size = 22
    while size > 14 and max(block_height(c, size) for c in columns) > avail_h:
        size -= 1
    content_h = max(block_height(c, size) for c in columns)
    card_h = max(3.4, min(BODY_H, head_block + content_h + 0.55))

    for i, col in enumerate(columns):
        x = MARGIN_X + i * (card_w + gap)
        _card(slide, x, BODY_TOP, card_w, card_h, t.card, f"Column card {i + 1}")
        _circle(slide, x + 0.35 + 0.29, BODY_TOP + 0.35 + 0.29, 0.58, t.badge if i == 0 else t.accent,
                f"Column badge {i + 1}", "AB"[i], "FFFFFF" if i == 0 else _on(t.accent, t), 18, t.body_font)
        h_box, h_tf = _text_box(slide, x + 1.15, BODY_TOP + 0.3, card_w - 1.5, 0.7, f"Column heading {i + 1}",
                                MSO_ANCHOR.MIDDLE)
        h_fit, h_size = _fit(col.heading, card_w - 1.5, 0.7, 26, 18, t.heading_font, bold=True)
        _write(h_tf, [{"text": h_fit, "size": h_size, "color": t.heading_ink, "font": t.heading_font, "bold": True}])
        b_box, b_tf = _text_box(slide, x + 0.4, BODY_TOP + head_block, body_w, card_h - head_block - 0.3,
                                f"Column bullets {i + 1}")
        _write(b_tf, [{"text": b, "size": size, "color": t.ink, "font": t.body_font, "bullet": t.badge,
                       "space_after": 12} for b in col.bullets if b])
    _footer(ctx, slide, number)


def _layout_cards(ctx: _Ctx, spec: SlideSpec, number: int) -> None:
    t = ctx.t
    slide = ctx.prs.slides.add_slide(ctx.layout_title_only)
    _background(slide, t.light)
    _slide_title(ctx, slide, spec.title)
    cards = spec.cards[:4] or []
    n = max(1, len(cards))
    gap = 0.35
    card_w = (CONTENT_W - gap * (n - 1)) / n
    inner_w = card_w - 0.8
    max_h = BODY_H - 0.1
    head = 0.45 + 0.8 + 0.35          # top padding + badge + gap

    fitted = [_fit(c.title, inner_w, 1.0, 24, 18, t.heading_font, bold=True, spacing=1.12) for c in cards]
    title_h = max(_text_height(f[0], inner_w, f[1], t.heading_font, True, 1.12) for f in fitted) + 0.05
    avail_body = max_h - head - title_h - 0.2 - 0.4

    body_size = 20
    while body_size > 14 and max(_text_height(c.body, inner_w, body_size, t.body_font, False, 1.2)
                                 for c in cards) > avail_body:
        body_size -= 1
    body_texts = [_fit(c.body, inner_w, avail_body, body_size, body_size, t.body_font, spacing=1.2)[0] for c in cards]
    body_h = max(_text_height(b, inner_w, body_size, t.body_font, False, 1.2) for b in body_texts)
    card_h = max(3.7, min(max_h, head + title_h + 0.2 + body_h + 0.5))

    for i, card in enumerate(cards):
        x = MARGIN_X + i * (card_w + gap)
        _card(slide, x, BODY_TOP, card_w, card_h, t.card, f"Card {i + 1}")
        _circle(slide, x + 0.4 + 0.4, BODY_TOP + 0.45 + 0.4, 0.8, t.badge if i % 2 == 0 else t.accent,
                f"Card badge {i + 1}", str(i + 1), "FFFFFF" if i % 2 == 0 else _on(t.accent, t), 24, t.heading_font)
        tb, ttf = _text_box(slide, x + 0.4, BODY_TOP + head, inner_w, title_h, f"Card title {i + 1}", MSO_ANCHOR.TOP)
        _write(ttf, [{"text": fitted[i][0], "size": fitted[i][1], "color": t.heading_ink, "font": t.heading_font,
                      "bold": True}])
        body_top = BODY_TOP + head + title_h + 0.2
        bb, btf = _text_box(slide, x + 0.4, body_top, inner_w, card_h - (body_top - BODY_TOP) - 0.3,
                            f"Card body {i + 1}")
        _write(btf, [{"text": body_texts[i], "size": body_size, "color": t.ink, "font": t.body_font,
                      "line_spacing": 1.1}])
    _footer(ctx, slide, number)


def _layout_stats(ctx: _Ctx, spec: SlideSpec, number: int) -> None:
    t = ctx.t
    slide = ctx.prs.slides.add_slide(ctx.layout_title_only)
    _background(slide, t.light)
    _slide_title(ctx, slide, spec.title)
    stats = spec.stats[:4]
    n = max(1, len(stats))
    gap = 0.35
    card_w = (CONTENT_W - gap * (n - 1)) / n
    card_h = min(BODY_H - 0.1, 4.2)
    top = BODY_TOP + (BODY_H - card_h) / 2 - 0.1
    for i, stat in enumerate(stats):
        x = MARGIN_X + i * (card_w + gap)
        _card(slide, x, top, card_w, card_h, t.card, f"Stat card {i + 1}")
        inner_w = card_w - 0.7
        vb, vtf = _text_box(slide, x + 0.35, top + 0.45, inner_w, 1.45, f"Stat value {i + 1}", MSO_ANCHOR.MIDDLE)
        v_fit, v_size = stat.value, _fit_one_line(stat.value, inner_w, 60, 24, t.heading_font, bold=True)
        v_color = t.badge if i % 2 == 0 else blend(t.accent, "000000", 0.28)
        _write(vtf, [{"text": v_fit, "size": v_size, "color": v_color, "font": t.heading_font, "bold": True}])
        lb, ltf = _text_box(slide, x + 0.35, top + 2.05, inner_w, 0.8, f"Stat label {i + 1}")
        l_fit, l_size = _fit(stat.label, inner_w, 0.8, 20, 16, t.body_font, bold=True)
        _write(ltf, [{"text": l_fit, "size": l_size, "color": t.heading_ink, "font": t.body_font, "bold": True}])
        if stat.detail:
            db, dtf = _text_box(slide, x + 0.35, top + 2.9, inner_w, card_h - 3.15, f"Stat detail {i + 1}")
            d_fit, d_size = _fit(stat.detail, inner_w, card_h - 3.15, 16, 14, t.body_font)
            _write(dtf, [{"text": d_fit, "size": d_size, "color": t.muted, "font": t.body_font}])
    _footer(ctx, slide, number)


def _layout_quote(ctx: _Ctx, spec: SlideSpec) -> None:
    t = ctx.t
    slide = ctx.prs.slides.add_slide(ctx.layout_title_only)
    _background(slide, t.dark)
    _slide_title(ctx, slide, spec.title, y=0.55, h=0.7, color=t.on_dark_muted, max_pt=22, min_pt=18,
                 anchor=MSO_ANCHOR.MIDDLE, font=t.body_font)
    _circle(slide, 1.65, 2.95, 1.15, t.accent_on_dark, "Quote mark", "\u201C", _on(t.accent_on_dark, t), 66, "Cambria")
    q_fit, q_size = _fit(spec.quote or spec.subtitle, 9.7, 3.2, 34, 22, t.heading_font, bold=False, spacing=1.25)
    box, tf = _text_box(slide, 2.85, 2.0, 9.7, 3.2, "Quote", MSO_ANCHOR.MIDDLE)
    _write(tf, [{"text": q_fit, "size": q_size, "color": t.on_dark, "font": t.heading_font, "italic": True,
                 "line_spacing": 1.15}])
    if spec.author:
        abox, atf = _text_box(slide, 2.85, 5.5, 9.7, 0.6, "Quote author", MSO_ANCHOR.MIDDLE)
        _write(atf, [{"text": "\u2014 " + spec.author, "size": 18, "color": t.accent_on_dark, "font": t.body_font,
                      "bold": True}])


def _col_weights(headers: List[str], rows: List[List[str]]) -> List[float]:
    cols = max(len(headers), max((len(r) for r in rows), default=0), 1)
    weights = []
    for c in range(cols):
        lengths = [len(headers[c]) if c < len(headers) else 4]
        lengths += [len(r[c]) for r in rows if c < len(r)]
        weights.append(max(6, min(34, max(lengths))))
    return weights


def _layout_table(ctx: _Ctx, spec: SlideSpec, number: int) -> None:
    t = ctx.t
    slide = ctx.prs.slides.add_slide(ctx.layout_title_only)
    _background(slide, t.light)
    _slide_title(ctx, slide, spec.title)
    table = spec.table
    headers = table.headers if table else []
    rows = table.rows if table else []
    cols = max(len(headers), max((len(r) for r in rows), default=0), 1)
    headers = (headers + [""] * cols)[:cols]
    rows = [(r + [""] * cols)[:cols] for r in rows]
    n_rows = len(rows) + 1
    if n_rows <= 5:
        font_size, max_row = 18, 0.95
    elif n_rows <= 7:
        font_size, max_row = 16, 0.78
    else:
        font_size, max_row = 14, 0.62
    row_h = min(max_row, (BODY_H - 0.3) / n_rows)
    weights = _col_weights(headers, rows)
    total_w = sum(weights)

    shape = slide.shapes.add_table(n_rows, cols, _in(MARGIN_X), _in(BODY_TOP), _in(CONTENT_W), _in(row_h * n_rows))
    shape.name = "Data table"
    tbl = shape.table
    for c in range(cols):
        tbl.columns[c].width = _in(CONTENT_W * weights[c] / total_w)
    for r in range(n_rows):
        tbl.rows[r].height = _in(row_h)

    def style_cell(cell, text: str, fill: str, color: str, bold: bool, align=PP_ALIGN.LEFT):
        cell.fill.solid()
        cell.fill.fore_color.rgb = _rgb(fill)
        cell.vertical_anchor = MSO_ANCHOR.MIDDLE
        cell.margin_left = cell.margin_right = _in(0.15)
        cell.margin_top = cell.margin_bottom = _in(0.05)
        tf = cell.text_frame
        tf.word_wrap = True
        p = tf.paragraphs[0]
        p.alignment = align
        run = p.add_run()
        run.text = text
        _style_run(run, font_size, color, t.body_font, bold)

    for c in range(cols):
        style_cell(tbl.cell(0, c), headers[c], t.badge, "FFFFFF", True)
    for r, row in enumerate(rows, start=1):
        fill = t.card if r % 2 == 1 else "FFFFFF"
        for c in range(cols):
            numeric = bool(re.fullmatch(r"[\s$€£+\-−]*[\d.,]+\s*[%kKmMbB]?", row[c] or ""))
            style_cell(tbl.cell(r, c), row[c], fill, t.ink, c == 0, PP_ALIGN.RIGHT if numeric else PP_ALIGN.LEFT)
    _footer(ctx, slide, number)


_CHART_TYPES = {
    "column": XL_CHART_TYPE.COLUMN_CLUSTERED,
    "bar": XL_CHART_TYPE.BAR_CLUSTERED,
    "line": XL_CHART_TYPE.LINE_MARKERS,
    "pie": XL_CHART_TYPE.PIE,
    "doughnut": XL_CHART_TYPE.DOUGHNUT,
}


def _style_chart(chart, spec_chart, t: Theme) -> None:
    kind = spec_chart.type
    colors = t.chart_colors()
    chart.font.size = Pt(13)
    chart.font.name = t.body_font
    chart.font.color.rgb = _rgb(t.ink)
    chart.has_title = False
    multi = len(spec_chart.series) > 1
    chart.has_legend = multi or kind in ("pie", "doughnut")
    if chart.has_legend:
        chart.legend.position = XL_LEGEND_POSITION.BOTTOM
        chart.legend.include_in_layout = False
        chart.legend.font.size = Pt(13)
        chart.legend.font.name = t.body_font
        chart.legend.font.color.rgb = _rgb(t.ink)

    plot = chart.plots[0]
    plot.has_data_labels = True
    labels = plot.data_labels
    labels.font.size = Pt(13)
    labels.font.name = t.body_font
    labels.font.bold = True
    labels.number_format = "General"
    labels.number_format_is_linked = False
    if kind in ("column", "bar"):
        plot.gap_width = 60
        labels.position = XL_LABEL_POSITION.OUTSIDE_END
        labels.font.color.rgb = _rgb(t.ink)
    elif kind == "line":
        labels.position = XL_LABEL_POSITION.ABOVE
        labels.font.color.rgb = _rgb(t.ink)
    elif kind == "pie":
        labels.position = XL_LABEL_POSITION.OUTSIDE_END
        labels.font.color.rgb = _rgb(t.ink)
    else:
        plot.has_data_labels = False   # a doughnut's values are shown in the legend / breakdown list

    if kind in ("pie", "doughnut"):
        series = plot.series[0]
        for idx in range(len(spec_chart.categories)):
            point = series.points[idx]
            point.format.fill.solid()
            point.format.fill.fore_color.rgb = _rgb(colors[idx % len(colors)])
    else:
        for idx, series in enumerate(plot.series):
            color = colors[idx % len(colors)]
            if kind == "line":
                series.format.line.color.rgb = _rgb(color)
                series.format.line.width = Pt(3)
                series.smooth = False
                series.marker.format.fill.solid()
                series.marker.format.fill.fore_color.rgb = _rgb(color)
                series.marker.format.line.color.rgb = _rgb(color)
            else:
                series.format.fill.solid()
                series.format.fill.fore_color.rgb = _rgb(color)
                series.invert_if_negative = False
        value_axis = chart.value_axis
        value_axis.has_major_gridlines = True
        value_axis.major_gridlines.format.line.color.rgb = _rgb(blend(t.ink, "FFFFFF", 0.85))
        value_axis.format.line.fill.background()
        value_axis.tick_labels.font.size = Pt(12)
        value_axis.tick_labels.font.color.rgb = _rgb(t.muted)
        cat_axis = chart.category_axis
        cat_axis.format.line.color.rgb = _rgb(blend(t.ink, "FFFFFF", 0.6))
        cat_axis.tick_labels.font.size = Pt(13)
        cat_axis.tick_labels.font.color.rgb = _rgb(t.ink)
        cat_axis.has_major_gridlines = False


def _layout_chart(ctx: _Ctx, spec: SlideSpec, number: int) -> None:
    t = ctx.t
    slide = ctx.prs.slides.add_slide(ctx.layout_title_only)
    _background(slide, t.light)
    _slide_title(ctx, slide, spec.title)
    cs = spec.chart
    data = CategoryChartData()
    categories = list(cs.categories)
    series_values = [(s_.name or "Value", (s_.values + [0.0] * len(categories))[: len(categories)])
                     for s_ in cs.series]
    if cs.type == "bar":
        # horizontal bars are drawn bottom-up; reverse so the first category reads at the top
        categories = categories[::-1]
        series_values = [(name, vals[::-1]) for name, vals in series_values]
    data.categories = categories
    for name, vals in series_values:
        data.add_series(name, vals)

    is_round = cs.type in ("pie", "doughnut")
    has_panel = bool(spec.bullets)
    show_breakdown = is_round and not has_panel     # category/value list next to a round chart
    if show_breakdown:
        chart_w = 6.4
    elif has_panel:
        chart_w = 7.6
    else:
        chart_w = CONTENT_W
    caption = cs.caption or (f"Values in {cs.unit}" if cs.unit else "")
    chart_h = BODY_H - (0.45 if caption else 0.0)
    frame = slide.shapes.add_chart(_CHART_TYPES[cs.type], _in(MARGIN_X), _in(BODY_TOP), _in(chart_w), _in(chart_h),
                                   data)
    frame.name = "Chart"
    _style_chart(frame.chart, cs, t)
    if show_breakdown:
        frame.chart.has_legend = False
        frame.chart.plots[0].has_data_labels = False

    if caption:
        cb, ctf = _text_box(slide, MARGIN_X, BODY_TOP + chart_h + 0.08, chart_w, 0.35, "Chart caption",
                            MSO_ANCHOR.MIDDLE)
        _write(ctf, [{"text": caption, "size": 12, "color": t.muted, "font": t.body_font}])

    if show_breakdown:
        px = MARGIN_X + chart_w + 0.5
        pw = SLIDE_W - MARGIN_X - px
        values = cs.series[0].values
        total = sum(v for v in values if v > 0) or 1.0
        colors = t.chart_colors()
        n = min(len(cs.categories), 8)
        row_h = min(0.8, (BODY_H - 0.4) / max(1, n))
        top = BODY_TOP + (BODY_H - row_h * n) / 2
        for i in range(n):
            y = top + i * row_h
            _circle(slide, px + 0.16, y + row_h / 2, 0.32, colors[i % len(colors)], f"Legend dot {i + 1}")
            value = values[i] if i < len(values) else 0
            share = f"{value / total * 100:.0f}%"
            raw = f"{value:g}{cs.unit}" if cs.unit and cs.unit != "%" else f"{value:g}"
            right = share if (cs.unit == "%" or abs(total - 100) < 0.5) else f"{raw} · {share}"
            lb, ltf = _text_box(slide, px + 0.55, y, pw - 0.55 - 1.9, row_h, f"Legend label {i + 1}",
                                MSO_ANCHOR.MIDDLE)
            l_fit, l_size = _fit(cs.categories[i], pw - 2.45, row_h, 20, 14, t.body_font, bold=True)
            _write(ltf, [{"text": l_fit, "size": l_size, "color": t.heading_ink, "font": t.body_font, "bold": True}])
            vb, vtf = _text_box(slide, px + pw - 1.9, y, 1.9, row_h, f"Legend value {i + 1}", MSO_ANCHOR.MIDDLE)
            _write(vtf, [{"text": right, "size": 18, "color": t.ink, "font": t.body_font, "align": PP_ALIGN.RIGHT}])

    if has_panel:
        px = MARGIN_X + chart_w + 0.4
        pw = SLIDE_W - MARGIN_X - px
        _card(slide, px, BODY_TOP, pw, BODY_H, t.card, "Takeaways card")
        hb, htf = _text_box(slide, px + 0.35, BODY_TOP + 0.3, pw - 0.7, 0.5, "Takeaways heading", MSO_ANCHOR.MIDDLE)
        _write(htf, [{"text": "WHAT IT SHOWS", "size": 12, "color": t.badge, "font": t.body_font, "bold": True,
                      "spacing": 150}])
        items = spec.bullets[:3]
        size = 18
        while size > 14 and sum(_text_height(b, pw - 1.0, size, t.body_font, False, 1.2) + 12 / 72.0
                                for b in items) > BODY_H - 1.3:
            size -= 1
        bb, btf = _text_box(slide, px + 0.35, BODY_TOP + 0.95, pw - 0.7, BODY_H - 1.3, "Takeaways")
        _write(btf, [{"text": b, "size": size, "color": t.ink, "font": t.body_font, "bullet": t.badge,
                      "space_after": 12} for b in items])
    _footer(ctx, slide, number)


def _layout_timeline(ctx: _Ctx, spec: SlideSpec, number: int) -> None:
    t = ctx.t
    slide = ctx.prs.slides.add_slide(ctx.layout_title_only)
    _background(slide, t.light)
    _slide_title(ctx, slide, spec.title)
    steps = spec.steps[:5]
    n = max(1, len(steps))
    col_w = CONTENT_W / n
    circle_d = 1.0
    cy = BODY_TOP + 0.75
    if n > 1:
        x1 = MARGIN_X + circle_d / 2
        x2 = MARGIN_X + col_w * (n - 1) + circle_d / 2
        line = slide.shapes.add_connector(MSO_CONNECTOR.STRAIGHT, _in(x1), _in(cy), _in(x2), _in(cy))
        line.name = "Timeline connector"
        line.line.color.rgb = _rgb(blend(t.primary, "FFFFFF", 0.65))
        line.line.width = Pt(3)
    inner_w = col_w - 0.4
    for i, step in enumerate(steps):
        x = MARGIN_X + col_w * i
        last = i == n - 1 and n > 1
        _circle(slide, x + circle_d / 2, cy, circle_d, t.accent if last else t.badge, f"Step badge {i + 1}",
                str(i + 1), _on(t.accent, t) if last else "FFFFFF", 28, t.heading_font)
        label_y = cy + circle_d / 2 + 0.35
        l_fit, l_size = _fit(step.label, inner_w, 1.0, 26, 18, t.heading_font, bold=True, spacing=1.12)
        label_h = _text_height(l_fit, inner_w, l_size, t.heading_font, True, 1.12) + 0.05
        lb, ltf = _text_box(slide, x, label_y, inner_w, label_h, f"Step label {i + 1}", MSO_ANCHOR.TOP)
        _write(ltf, [{"text": l_fit, "size": l_size, "color": t.heading_ink, "font": t.heading_font, "bold": True}])
        detail_y = label_y + label_h + 0.18
        detail_h = BODY_BOTTOM - detail_y
        db, dtf = _text_box(slide, x, detail_y, inner_w, detail_h, f"Step detail {i + 1}")
        d_fit, d_size = _fit(step.detail, inner_w, detail_h, 20, 14, t.body_font)
        _write(dtf, [{"text": d_fit, "size": d_size, "color": t.ink, "font": t.body_font, "line_spacing": 1.1}])
    _footer(ctx, slide, number)


def _layout_closing(ctx: _Ctx, spec: SlideSpec, deck: DeckSpec) -> None:
    t = ctx.t
    slide = ctx.prs.slides.add_slide(ctx.layout_title_only)
    _background(slide, t.dark)
    _motif(slide, t)
    items = spec.bullets[:4]
    title_h = 1.5 if items else 2.0
    _slide_title(ctx, slide, spec.title or "Thank you", x=0.9, y=1.1 if items else 2.4, w=6.8, h=title_h,
                 color=t.on_dark, max_pt=44, min_pt=32, anchor=MSO_ANCHOR.BOTTOM)
    if spec.subtitle and not items:
        box, tf = _text_box(slide, 0.9, 4.55, 6.6, 1.2, "Closing subtitle")
        s_fit, s_size = _fit(spec.subtitle, 6.6, 1.2, 22, 16, t.body_font)
        _write(tf, [{"text": s_fit, "size": s_size, "color": t.on_dark_muted, "font": t.body_font}])
    if items:
        n = len(items)
        top = 2.95
        row_h = min(0.95, (6.6 - top) / n)
        for i, item in enumerate(items):
            y = top + i * row_h
            _circle(slide, 0.9 + 0.3, y + row_h / 2, 0.6, t.accent_on_dark, f"Next step badge {i + 1}", str(i + 1),
                    _on(t.accent_on_dark, t), 17, t.body_font)
            box, tf = _text_box(slide, 1.75, y, 5.9, row_h, f"Next step {i + 1}", MSO_ANCHOR.MIDDLE)
            fitted, size = _fit(item, 5.9, row_h, 20, 15, t.body_font, spacing=1.15)
            _write(tf, [{"text": fitted, "size": size, "color": t.on_dark, "font": t.body_font}])


# =========================================================================== deck assembly
def _theme_xml_patch(prs, t: Theme, deck_title: str) -> None:
    """Write the deck's palette and fonts into the PowerPoint theme so edits/new shapes stay on-brand."""
    try:
        theme_part = prs.slide_master.part.part_related_by(RT.THEME)
        root = etree.fromstring(theme_part.blob)
        ns = {"a": _A_NS}
        root.set("name", f"{deck_title[:40] or 'Deck'} theme")
        scheme = root.find(".//a:clrScheme", ns)
        if scheme is None:
            return
        scheme.set("name", t.name)
        palette = [
            ("dk1", t.ink), ("lt1", "FFFFFF"), ("dk2", t.dark), ("lt2", t.card),
            ("accent1", t.primary), ("accent2", t.accent), ("accent3", t.secondary),
            ("accent4", blend(t.primary, "FFFFFF", 0.4)), ("accent5", blend(t.accent, t.dark, 0.35)),
            ("accent6", blend(t.secondary, t.dark, 0.4)), ("hlink", t.primary), ("folHlink", t.secondary),
        ]
        for tag, color in palette:
            old = scheme.find(f"a:{tag}", ns)
            new = etree.Element(f"{{{_A_NS}}}{tag}")
            etree.SubElement(new, f"{{{_A_NS}}}srgbClr").set("val", color)
            if old is not None:
                scheme.replace(old, new)
            else:
                scheme.append(new)
        fonts = root.find(".//a:fontScheme", ns)
        if fonts is not None:
            fonts.set("name", f"{t.heading_font}-{t.body_font}")
            for tag, face in (("majorFont", t.heading_font), ("minorFont", t.body_font)):
                latin = fonts.find(f"a:{tag}/a:latin", ns)
                if latin is not None:
                    latin.set("typeface", face)
        theme_part._blob = etree.tostring(root, xml_declaration=True, encoding="UTF-8", standalone=True)
    except Exception as exc:  # the theme patch is cosmetic; never fail a deck because of it
        logger.warning("Could not apply theme colors to PPTX theme part", extra={"detail": str(exc)[:200]})


def _expand_slides(deck: DeckSpec) -> List[SlideSpec]:
    """Make sure the deck starts with a title slide and that long bullet lists are split, not squeezed."""
    slides = [s.model_copy(deep=True) for s in deck.slides]
    if not slides or slides[0].layout != "title":
        slides.insert(0, SlideSpec(layout="title", title=deck.title, subtitle=deck.subtitle))
    expanded: List[SlideSpec] = []
    for s in slides:
        if s.layout in ("bullets", "agenda") and len(s.bullets) > MAX_BULLET_ROWS:
            first = s.model_copy(deep=True)
            rest = s.model_copy(deep=True)
            first.bullets = s.bullets[:MAX_BULLET_ROWS]
            rest.bullets = s.bullets[MAX_BULLET_ROWS:]
            rest.callout = ""
            rest.title = (s.title + " (cont.)")[:80]
            rest.notes = ""
            expanded.extend([first, rest])
        else:
            expanded.append(s)
    return expanded[:32]


def expand_deck(deck: DeckSpec) -> DeckSpec:
    """The deck exactly as it will be rendered (title slide ensured, long bullet lists split)."""
    expanded = deck.model_copy(deep=True)
    expanded.slides = _expand_slides(deck)
    return expanded


def resolve_theme(deck: DeckSpec, text_hint: str = "") -> Theme:
    base = pick_theme(deck.theme, text_hint or deck.title)
    if deck.palette:
        return apply_palette(base, deck.palette.dark, deck.palette.primary, deck.palette.secondary, deck.palette.accent)
    return base


def build_pptx(deck: DeckSpec, theme: Optional[Theme] = None, text_hint: str = "") -> bytes:
    """Render a deck spec into .pptx bytes."""
    t = theme or resolve_theme(deck, text_hint)
    prs = Presentation()
    prs.slide_width = _in(SLIDE_W)
    prs.slide_height = _in(SLIDE_H)
    ctx = _Ctx(prs, t, deck.title)

    slides = _expand_slides(deck)
    ctx.total = len(slides)
    section_counter = 0

    for number, spec in enumerate(slides, start=1):
        try:
            layout = spec.layout
            if layout == "title":
                _layout_title(ctx, spec, deck)
            elif layout == "section":
                section_counter += 1
                _layout_section(ctx, spec, section_counter)
            elif layout in ("bullets", "agenda"):
                _layout_bullets(ctx, spec, number)
            elif layout == "two_column" and len(spec.columns) >= 1:
                _layout_two_column(ctx, spec, number)
            elif layout == "cards" and spec.cards:
                _layout_cards(ctx, spec, number)
            elif layout == "stats" and spec.stats:
                _layout_stats(ctx, spec, number)
            elif layout == "quote" and (spec.quote or spec.subtitle):
                _layout_quote(ctx, spec)
            elif layout == "table" and spec.table and spec.table.headers:
                _layout_table(ctx, spec, number)
            elif layout == "chart" and spec.chart and spec.chart.categories and spec.chart.series:
                _layout_chart(ctx, spec, number)
            elif layout == "timeline" and spec.steps:
                _layout_timeline(ctx, spec, number)
            elif layout == "closing":
                _layout_closing(ctx, spec, deck)
            else:
                # a layout whose content is missing degrades to a plain, still-designed bullet slide
                spec = spec.model_copy(deep=True)
                spec.bullets = spec.bullets or _fallback_points(spec)
                _layout_bullets(ctx, spec, number)
        except Exception as exc:
            logger.warning(
                "Slide layout failed; using plain layout",
                extra={"layout": spec.layout, "detail": str(exc)[:200]},
            )
            # remove a half-built slide, then draw a safe one
            _drop_partial_slide(prs, number)
            safe = spec.model_copy(deep=True)
            safe.bullets = safe.bullets or _fallback_points(safe)
            _layout_bullets(ctx, safe, number)
        _notes(prs.slides[len(prs.slides) - 1], spec.notes)

    props = prs.core_properties
    props.title = deck.title
    props.author = deck.author or "Rag_Mcp"
    props.subject = deck.subtitle
    props.keywords = "presentation"

    _theme_xml_patch(prs, t, deck.title)

    buffer = io.BytesIO()
    prs.save(buffer)
    return buffer.getvalue()


def _drop_partial_slide(prs, expected_number: int) -> None:
    """If a layout raised after adding its slide, remove that slide so numbering stays correct."""
    sld_id_lst = prs.slides._sldIdLst
    while len(prs.slides) >= expected_number:
        sld_id = sld_id_lst[-1]
        prs.part.drop_rel(sld_id.rId)
        sld_id_lst.remove(sld_id)


def _fallback_points(spec: SlideSpec) -> List[str]:
    points: List[str] = []
    for col in spec.columns:
        points.extend([f"{col.heading}: {b}" if col.heading else b for b in col.bullets[:2]])
    points.extend([f"{c.title}: {c.body}" if c.body else c.title for c in spec.cards])
    points.extend([f"{s.value} {s.label}".strip() for s in spec.stats])
    points.extend([f"{s.label}: {s.detail}" if s.detail else s.label for s in spec.steps])
    if spec.quote:
        points.append(spec.quote)
    if spec.table and spec.table.rows:
        points.extend([" · ".join(r) for r in spec.table.rows[:4]])
    if not points and spec.subtitle:
        points.append(spec.subtitle)
    return [p for p in points if p][:MAX_BULLET_ROWS] or [spec.title or "Overview"]


def legacy_slides(deck: DeckSpec) -> List[Dict[str, object]]:
    """Plain {title, points} view of the deck (what the older preview UI understands)."""
    out: List[Dict[str, object]] = []
    for s in _expand_slides(deck):
        if s.layout == "title":
            points = [p for p in (s.subtitle or deck.subtitle,) if p]
        elif s.layout in ("bullets", "agenda", "closing"):
            points = list(s.bullets) + ([s.callout] if s.callout else [])
            if s.layout == "closing" and s.subtitle:
                points.insert(0, s.subtitle)
        elif s.layout == "section":
            points = [s.subtitle] if s.subtitle else []
        else:
            points = _fallback_points(s)
        out.append({"title": s.title or deck.title, "points": points})
    return out
