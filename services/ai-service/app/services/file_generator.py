"""
app/services/file_generator.py
================================
Deterministic document and file generation service.
Generates valid, standards-compliant files:
  PDF  (.pdf)  via reportlab
  DOCX (.docx) via python-docx
  PPTX (.pptx) via python-pptx
  XLSX (.xlsx) via openpyxl
  CSV  (.csv)  via standard csv writer
  Code & Text  (.py .js .ts .html .css .json .yaml .sql .java .cpp .md .txt)
"""

from __future__ import annotations

import csv
import datetime
import io
import re
from typing import Any, Dict, List, Optional

# ── ReportLab ────────────────────────────────────────────────────────────────
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT, TA_JUSTIFY
from reportlab.lib.pagesizes import A4, letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import cm, mm
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    HRFlowable,
    KeepTogether,
    NextPageTemplate,
    PageBreak,
    PageTemplate,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

# ── python-docx ───────────────────────────────────────────────────────────────
from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.shared import Inches, Pt, RGBColor

# ── python-pptx ───────────────────────────────────────────────────────────────
from pptx import Presentation
from pptx.dml.color import RGBColor as PptxRGBColor
from pptx.util import Inches as PptxInches
from pptx.util import Pt as PptxPt

# ── openpyxl ─────────────────────────────────────────────────────────────────
import openpyxl
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter


# =============================================================================
# Shared markdown helpers
# =============================================================================

def _md_to_rl(text: str) -> str:
    """
    Convert inline markdown → ReportLab XML tags.
    Handles **bold**, *italic*, __bold__, _italic_, `code`, ~~strike~~.
    HTML-escapes & < > before substitution.
    """
    text = text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    # Bold
    text = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", text, flags=re.DOTALL)
    text = re.sub(r"__(.+?)__",     r"<b>\1</b>", text, flags=re.DOTALL)
    # Italic
    text = re.sub(r"(?<!\w)\*(.+?)\*(?!\w)", r"<i>\1</i>", text)
    text = re.sub(r"(?<!\w)_(.+?)_(?!\w)",   r"<i>\1</i>", text)
    # Inline code
    text = re.sub(r"`([^`]+)`",
                  r'<font name="Courier" size="9" color="#c7254e">\1</font>', text)
    # Strikethrough
    text = re.sub(r"~~(.+?)~~", r'<font color="#94a3b8">\1</font>', text)
    return text


def _strip_md_markers(text: str) -> str:
    """Strip markdown inline markers (for headings / DOCX / PPTX)."""
    text = re.sub(r"\*\*(.+?)\*\*", r"\1", text, flags=re.DOTALL)
    text = re.sub(r"__(.+?)__",     r"\1", text, flags=re.DOTALL)
    text = re.sub(r"(?<!\w)\*(.+?)\*(?!\w)", r"\1", text)
    text = re.sub(r"(?<!\w)_(.+?)_(?!\w)",   r"\1", text)
    text = re.sub(r"`([^`]+)`", r"\1", text)
    text = re.sub(r"~~(.+?)~~", r"\1", text)
    return text.strip()


# =============================================================================
# Markdown table helpers
# =============================================================================

def _is_table_row(line: str) -> bool:
    s = line.strip()
    return s.startswith("|") and s.endswith("|") and s.count("|") >= 2


def _is_separator_row(line: str) -> bool:
    s = line.strip()
    if not s.startswith("|"):
        return False
    cells = [c.strip() for c in s.strip("|").split("|")]
    return bool(cells) and all(re.match(r"^:?-+:?$", c) for c in cells if c)


def _parse_table_row(line: str) -> List[str]:
    return [c.strip() for c in line.strip().strip("|").split("|")]


def _get_col_alignment(sep_line: str) -> List[str]:
    cells = [c.strip() for c in sep_line.strip().strip("|").split("|")]
    result = []
    for c in cells:
        if c.startswith(":") and c.endswith(":"):
            result.append("center")
        elif c.endswith(":"):
            result.append("right")
        else:
            result.append("left")
    return result


# =============================================================================
# Callout-box detection  ( > [!NOTE] / > [!WARNING] / > [!TIP] / > [!IMPORTANT] )
# =============================================================================

_CALLOUT_STYLES = {
    "NOTE":      ("#3b82f6", "#eff6ff", "ℹ NOTE"),
    "TIP":       ("#10b981", "#f0fdf4", "✦ TIP"),
    "IMPORTANT": ("#8b5cf6", "#f5f3ff", "★ IMPORTANT"),
    "WARNING":   ("#f59e0b", "#fffbeb", "⚠ WARNING"),
    "CAUTION":   ("#ef4444", "#fef2f2", "✖ CAUTION"),
}

_CALLOUT_RE = re.compile(r"^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*(.*)", re.IGNORECASE)


# =============================================================================
# PDF page canvas (header + footer on every page)
# =============================================================================

class _DocCanvas:
    """Mixin called by BaseDocTemplate for header/footer drawing."""

    def __init__(self, doc_title: str):
        self._doc_title = doc_title

    def _draw_header_footer(self, canvas_obj, doc):
        canvas_obj.saveState()

        pw = doc.pagesize[0]
        # Only draw header on non-cover pages
        if canvas_obj.getPageNumber() > 1:
            # Header line
            canvas_obj.setStrokeColor(colors.HexColor("#e2e8f0"))
            canvas_obj.setLineWidth(0.5)
            canvas_obj.line(doc.leftMargin, doc.pagesize[1] - 36,
                            pw - doc.rightMargin, doc.pagesize[1] - 36)
            canvas_obj.setFont("Helvetica", 8)
            canvas_obj.setFillColor(colors.HexColor("#94a3b8"))
            canvas_obj.drawString(doc.leftMargin, doc.pagesize[1] - 28, self._doc_title[:60])

        # Footer line
        canvas_obj.setStrokeColor(colors.HexColor("#e2e8f0"))
        canvas_obj.setLineWidth(0.5)
        canvas_obj.line(doc.leftMargin, 42, pw - doc.rightMargin, 42)

        canvas_obj.setFont("Helvetica", 8)
        canvas_obj.setFillColor(colors.HexColor("#94a3b8"))
        canvas_obj.drawString(doc.leftMargin, 30, "Rag_Mcp · AI Document Generator")
        canvas_obj.drawRightString(pw - doc.rightMargin, 30,
                                   f"Page {canvas_obj.getPageNumber()}")
        canvas_obj.restoreState()


# =============================================================================
# Main generator
# =============================================================================

class FileGenerator:
    """Deterministic multi-format document generator."""

    # =========================================================================
    # PDF
    # =========================================================================

    @staticmethod
    def generate_pdf(
        title: str,
        content: str,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> bytes:
        """
        Generates a professional, well-formatted PDF from markdown content.

        Features:
        • Cover page with centred title + date
        • Running header (title) on body pages
        • Footer with separator line and page number
        • H1 / H2 / H3 / H4 heading hierarchy with proper spacing
        • Bullet & sub-bullet lists with smart indent
        • Ordered (numbered) lists
        • Code blocks with language badge and monospace styling
        • Inline bold / italic / code / strikethrough
        • Markdown tables with smart column widths and alternating rows
        • Blockquotes with indigo left border
        • GitHub-style callout boxes (NOTE / TIP / WARNING / CAUTION / IMPORTANT)
        • Horizontal rules
        • KeepTogether on headings + their first paragraph
        """
        buf = io.BytesIO()

        # Page geometry (letter, 1 in margins, extra top/bottom for header/footer)
        L_MARGIN = R_MARGIN = 58       # pt  ≈ 0.8 in
        T_MARGIN = 72                   # extra room for header
        B_MARGIN = 60                   # extra room for footer
        PAGE_W   = letter[0] - L_MARGIN - R_MARGIN   # usable width

        # ── Colour tokens ─────────────────────────────────────────────────────
        C = {
            "indigo":    colors.HexColor("#4f46e5"),
            "dark":      colors.HexColor("#0f172a"),
            "mid":       colors.HexColor("#1e293b"),
            "body":      colors.HexColor("#374151"),
            "muted":     colors.HexColor("#64748b"),
            "light":     colors.HexColor("#f8fafc"),
            "code_bg":   colors.HexColor("#f1f5f9"),
            "code_fg":   colors.HexColor("#0f172a"),
            "hr":        colors.HexColor("#e2e8f0"),
            "tbl_hbg":   colors.HexColor("#4f46e5"),
            "tbl_alt":   colors.HexColor("#f8faff"),
            "tbl_brd":   colors.HexColor("#cbd5e1"),
            "tbl_grid":  colors.HexColor("#e2e8f0"),
        }

        # ── Typography ────────────────────────────────────────────────────────
        def S(name, **kw) -> ParagraphStyle:
            return ParagraphStyle(name, **kw)

        cover_title = S("CoverTitle",
            fontName="Helvetica-Bold", fontSize=32, leading=40,
            textColor=C["dark"], alignment=TA_CENTER, spaceAfter=12)
        cover_sub = S("CoverSub",
            fontName="Helvetica", fontSize=13, leading=18,
            textColor=C["muted"], alignment=TA_CENTER, spaceAfter=4)

        h1 = S("H1", fontName="Helvetica-Bold", fontSize=18, leading=24,
                textColor=C["mid"], spaceBefore=22, spaceAfter=4)
        h2 = S("H2", fontName="Helvetica-Bold", fontSize=14, leading=20,
                textColor=C["mid"], spaceBefore=16, spaceAfter=4)
        h3 = S("H3", fontName="Helvetica-Bold", fontSize=12, leading=16,
                textColor=C["muted"], spaceBefore=12, spaceAfter=3)
        h4 = S("H4", fontName="Helvetica-BoldOblique", fontSize=10.5, leading=14,
                textColor=C["muted"], spaceBefore=10, spaceAfter=2)

        body = S("Body", fontName="Helvetica", fontSize=10.5, leading=16.5,
                 textColor=C["body"], spaceAfter=6, alignment=TA_LEFT)
        body_j = S("BodyJ", parent=body, alignment=TA_JUSTIFY)

        bullet = S("Bullet", parent=body, leftIndent=20, firstLineIndent=0, spaceAfter=4)
        sub_bullet = S("SubBullet", parent=body,
                       leftIndent=38, firstLineIndent=0, spaceAfter=3, fontSize=10)
        sub2_bullet = S("Sub2Bullet", parent=body,
                        leftIndent=56, firstLineIndent=0, spaceAfter=2, fontSize=9.5)
        numbered = S("Numbered", parent=body, leftIndent=26, firstLineIndent=-16, spaceAfter=4)

        code_label = S("CodeLabel",
            fontName="Helvetica-Oblique", fontSize=7.5, leading=10,
            textColor=C["muted"], spaceAfter=0)
        code_block = S("CodeBlock",
            fontName="Courier", fontSize=8.5, leading=12.5,
            textColor=C["code_fg"], backColor=C["code_bg"],
            borderPadding=(10, 12, 10, 12),
            spaceBefore=0, spaceAfter=12,
            leftIndent=0, rightIndent=0)

        quote_inner = S("QuoteInner", parent=body,
                        textColor=C["muted"], fontName="Helvetica-Oblique",
                        spaceBefore=0, spaceAfter=0,
                        leftIndent=0, rightIndent=0)

        tbl_hdr = S("TblHdr", fontName="Helvetica-Bold", fontSize=9.5,
                    leading=13, textColor=colors.white, alignment=TA_CENTER)
        tbl_cell = S("TblCell", fontName="Helvetica", fontSize=9,
                     leading=13, textColor=C["body"], alignment=TA_LEFT)

        callout_title_base = S("CalloutTitle",
            fontName="Helvetica-Bold", fontSize=9, leading=12, spaceAfter=2)
        callout_body_base = S("CalloutBody",
            fontName="Helvetica", fontSize=9.5, leading=14, spaceAfter=0)

        story: List = []

        # ── Cover page ────────────────────────────────────────────────────────
        clean_title = _strip_md_markers(title.strip()) or "Generated Document"
        today = datetime.date.today().strftime("%B %d, %Y")

        story.append(Spacer(1, 110))
        story.append(Paragraph(clean_title, cover_title))
        story.append(HRFlowable(width="60%", thickness=2, color=C["indigo"],
                                hAlign="CENTER", spaceAfter=14))
        story.append(Paragraph("Generated by Rag_Mcp · AI Document Generator", cover_sub))
        story.append(Paragraph(today, cover_sub))
        story.append(PageBreak())

        # ── Line-by-line parser ───────────────────────────────────────────────
        lines = content.split("\n")
        in_code   = False
        code_buf: List[str] = []
        code_lang = ""
        tbl_buf: List[str] = []
        num_ctr   = [0]       # numbered-list counter (reset on blank line)
        h1_seen   = [False]   # track whether first H1 was already emitted
        pending_keep: List = []  # items to wrap in KeepTogether

        def flush_pending():
            """Emit any KeepTogether group."""
            if pending_keep:
                story.append(KeepTogether(pending_keep.copy()))
                pending_keep.clear()

        def emit(flowable):
            story.append(flowable)

        def flush_code():
            if not code_buf:
                return
            safe_lines = []
            for cl in code_buf:
                cl = cl.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
                # Preserve leading spaces with non-breaking spaces
                stripped_l = cl.lstrip()
                indent_n = len(cl) - len(stripped_l)
                cl = "\u00a0" * indent_n + stripped_l
                safe_lines.append(cl)
            label_text = code_lang if code_lang else "code"
            block = [
                Paragraph(label_text, code_label),
                Paragraph("<br/>".join(safe_lines) or "\u00a0", code_block),
            ]
            flush_pending()
            story.extend(block)
            code_buf.clear()

        def flush_table():
            if not tbl_buf:
                return

            data_lines = [l for l in tbl_buf if not _is_separator_row(l)]
            sep_lines  = [l for l in tbl_buf if _is_separator_row(l)]
            if not data_lines:
                tbl_buf.clear(); return

            parsed = [_parse_table_row(l) for l in data_lines]
            n_cols = max(len(r) for r in parsed)
            for r in parsed:
                while len(r) < n_cols:
                    r.append("")

            aligns = _get_col_alignment(sep_lines[0]) if sep_lines else ["left"] * n_cols
            while len(aligns) < n_cols:
                aligns.append("left")

            # ── Smart column widths: weight by max cell content length ────────
            col_max = [0] * n_cols
            for row in parsed:
                for ci, cell in enumerate(row):
                    col_max[ci] = max(col_max[ci], len(_strip_md_markers(cell)))
            total_chars = sum(col_max) or 1
            # Minimum 8% per column, distribute rest proportionally
            MIN_W = PAGE_W * 0.08
            base = [max(MIN_W, PAGE_W * (w / total_chars)) for w in col_max]
            # Re-normalise to exactly PAGE_W
            scale = PAGE_W / sum(base)
            col_widths = [w * scale for w in base]

            rl_a = {"left": TA_LEFT, "center": TA_CENTER, "right": TA_RIGHT}
            tbl_data = []
            for ri, row in enumerate(parsed):
                cells = []
                for ci, ct in enumerate(row):
                    if ri == 0:
                        p = Paragraph(_md_to_rl(ct), tbl_hdr)
                    else:
                        st = ParagraphStyle(
                            f"TC_{ri}_{ci}", parent=tbl_cell,
                            alignment=rl_a.get(aligns[ci], TA_LEFT))
                        p = Paragraph(_md_to_rl(ct), st)
                    cells.append(p)
                tbl_data.append(cells)

            ts = [
                # Header
                ("BACKGROUND",    (0, 0), (-1,  0), C["tbl_hbg"]),
                ("TEXTCOLOR",     (0, 0), (-1,  0), colors.white),
                ("FONTNAME",      (0, 0), (-1,  0), "Helvetica-Bold"),
                ("FONTSIZE",      (0, 0), (-1,  0), 9.5),
                ("ALIGN",         (0, 0), (-1,  0), "CENTER"),
                ("VALIGN",        (0, 0), (-1,  0), "MIDDLE"),
                ("TOPPADDING",    (0, 0), (-1,  0), 8),
                ("BOTTOMPADDING", (0, 0), (-1,  0), 8),
                ("LINEBELOW",     (0, 0), (-1,  0), 1.5, C["tbl_brd"]),
                # Data
                ("FONTNAME",      (0, 1), (-1, -1), "Helvetica"),
                ("FONTSIZE",      (0, 1), (-1, -1), 9),
                ("VALIGN",        (0, 1), (-1, -1), "TOP"),
                ("TOPPADDING",    (0, 1), (-1, -1), 6),
                ("BOTTOMPADDING", (0, 1), (-1, -1), 6),
                # Global
                ("LEFTPADDING",   (0, 0), (-1, -1), 8),
                ("RIGHTPADDING",  (0, 0), (-1, -1), 8),
                ("BOX",           (0, 0), (-1, -1), 1,   C["tbl_brd"]),
                ("INNERGRID",     (0, 0), (-1, -1), 0.4, C["tbl_grid"]),
            ]
            # Alternating rows
            for ri in range(1, len(tbl_data)):
                if ri % 2 == 0:
                    ts.append(("BACKGROUND", (0, ri), (-1, ri), C["tbl_alt"]))
            # Per-column alignment
            for ci, al in enumerate(aligns):
                rl = {"left": "LEFT", "center": "CENTER", "right": "RIGHT"}.get(al, "LEFT")
                ts.append(("ALIGN", (ci, 1), (ci, -1), rl))

            tbl = Table(tbl_data, colWidths=col_widths, repeatRows=1)
            tbl.setStyle(TableStyle(ts))
            flush_pending()
            emit(Spacer(1, 8))
            emit(tbl)
            emit(Spacer(1, 12))
            tbl_buf.clear()

        def make_callout(kind: str, first_line: str, body_lines: List[str]) -> List:
            """Build a styled callout / admonition box."""
            border_hex, bg_hex, label = _CALLOUT_STYLES.get(
                kind.upper(), ("#64748b", "#f8fafc", kind.upper()))
            border_c = colors.HexColor(border_hex)
            bg_c     = colors.HexColor(bg_hex)

            title_st = ParagraphStyle("_ct", parent=callout_title_base,
                                      textColor=border_c)
            body_st  = ParagraphStyle("_cb", parent=callout_body_base,
                                      textColor=C["body"])

            inner = []
            inner.append(Paragraph(label, title_st))
            if first_line.strip():
                inner.append(Paragraph(_md_to_rl(first_line.strip()), body_st))
            for bl in body_lines:
                s = bl.strip()
                if s.startswith("> "):
                    s = s[2:]
                if s:
                    inner.append(Paragraph(_md_to_rl(s), body_st))

            tbl = Table([[inner]], colWidths=[PAGE_W])
            tbl.setStyle(TableStyle([
                ("LEFTPADDING",   (0, 0), (-1, -1), 14),
                ("RIGHTPADDING",  (0, 0), (-1, -1), 10),
                ("TOPPADDING",    (0, 0), (-1, -1), 8),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
                ("LINEBEFORE",    (0, 0), (0,  -1), 4, border_c),
                ("BACKGROUND",    (0, 0), (-1, -1), bg_c),
                ("BOX",           (0, 0), (-1, -1), 0.5, colors.HexColor(border_hex + "60"
                                                           if len(border_hex) == 7 else border_hex)),
            ]))
            return [tbl, Spacer(1, 6)]

        # Accumulate callout lines
        in_callout       = False
        callout_kind     = ""
        callout_first    = ""
        callout_body_acc: List[str] = []

        def flush_callout():
            nonlocal in_callout, callout_kind, callout_first
            if not in_callout:
                return
            block = make_callout(callout_kind, callout_first, callout_body_acc)
            flush_pending()
            story.extend(block)
            in_callout = False
            callout_kind = callout_first = ""
            callout_body_acc.clear()

        for idx, line in enumerate(lines):
            stripped = line.strip()

            # ── Code fence ────────────────────────────────────────────────────
            if stripped.startswith("```"):
                flush_callout()
                flush_table()
                if in_code:
                    flush_code()
                    in_code = False
                    code_lang = ""
                else:
                    in_code = True
                    code_lang = stripped[3:].strip()
                continue

            if in_code:
                code_buf.append(line.rstrip())
                continue

            # ── Table rows ────────────────────────────────────────────────────
            if _is_table_row(stripped):
                flush_callout()
                tbl_buf.append(stripped)
                continue
            elif tbl_buf:
                flush_table()

            # ── Blank line ────────────────────────────────────────────────────
            if not stripped:
                if in_callout:
                    # blank line ends a callout
                    flush_callout()
                else:
                    flush_pending()
                    emit(Spacer(1, 6))
                num_ctr[0] = 0
                continue

            # ── Blockquote / callout detection ────────────────────────────────
            if stripped.startswith("> "):
                inner_text = stripped[2:].strip()
                callout_m  = _CALLOUT_RE.match(inner_text)

                if callout_m:
                    # Starting a new callout — flush any previous
                    flush_callout()
                    callout_kind  = callout_m.group(1).upper()
                    callout_first = callout_m.group(2)
                    in_callout    = True
                elif in_callout:
                    # Continuation line of the current callout
                    callout_body_acc.append(stripped)
                else:
                    # Regular blockquote (not a callout)
                    q_tbl = Table(
                        [[Paragraph(_md_to_rl(inner_text), quote_inner)]],
                        colWidths=[PAGE_W])
                    q_tbl.setStyle(TableStyle([
                        ("LEFTPADDING",   (0, 0), (-1, -1), 14),
                        ("RIGHTPADDING",  (0, 0), (-1, -1), 10),
                        ("TOPPADDING",    (0, 0), (-1, -1), 6),
                        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
                        ("LINEBEFORE",    (0, 0), (0,  -1), 4, C["indigo"]),
                        ("BACKGROUND",    (0, 0), (-1, -1), colors.HexColor("#f8faff")),
                    ]))
                    flush_pending()
                    emit(q_tbl)
                    emit(Spacer(1, 4))
                continue

            # Non-blockquote line → flush any open callout
            flush_callout()

            # ── Horizontal rule ───────────────────────────────────────────────
            if re.match(r"^[-*_]{3,}$", stripped):
                flush_pending()
                emit(HRFlowable(width="100%", thickness=0.75, color=C["hr"],
                                spaceAfter=10, spaceBefore=10))
                continue

            # ── H1 ────────────────────────────────────────────────────────────
            if re.match(r"^# [^#]", stripped):
                flush_pending()
                h_text = _md_to_rl(stripped[2:].strip())
                pending_keep.append(Paragraph(h_text, h1))
                pending_keep.append(HRFlowable(
                    width="100%", thickness=1, color=C["hr"], spaceAfter=6))
                h1_seen[0] = True
                num_ctr[0] = 0
                continue

            # ── H2 ────────────────────────────────────────────────────────────
            if re.match(r"^## [^#]", stripped):
                flush_pending()
                pending_keep.append(Paragraph(_md_to_rl(stripped[3:].strip()), h2))
                num_ctr[0] = 0
                continue

            # ── H3 ────────────────────────────────────────────────────────────
            if re.match(r"^### [^#]", stripped):
                flush_pending()
                pending_keep.append(Paragraph(_md_to_rl(stripped[4:].strip()), h3))
                num_ctr[0] = 0
                continue

            # ── H4 / deeper ───────────────────────────────────────────────────
            if re.match(r"^#{4,}\s", stripped):
                flush_pending()
                h_text = re.sub(r"^#{4,}\s+", "", stripped)
                pending_keep.append(Paragraph(_md_to_rl(h_text), h4))
                num_ctr[0] = 0
                continue

            # At this point we have a content element. If pending_keep has items
            # (a heading waiting for its first paragraph), attach this paragraph
            # and then flush the whole KeepTogether block.
            if pending_keep:
                # Only keep the first body paragraph together with its heading
                pending_keep.append(Paragraph(_md_to_rl(stripped), body))
                flush_pending()
                num_ctr[0] = 0
                continue

            # ── Numbered list ─────────────────────────────────────────────────
            if re.match(r"^\d+\.\s", stripped):
                num_ctr[0] += 1
                n_text = _md_to_rl(re.sub(r"^\d+\.\s+", "", stripped))
                emit(Paragraph(f"<b>{num_ctr[0]}.</b>\u00a0\u00a0{n_text}", numbered))
                continue

            # ── Bullet list ───────────────────────────────────────────────────
            if stripped.startswith(("- ", "* ", "• ")):
                indent_len = len(line) - len(line.lstrip())
                b_text = _md_to_rl(re.sub(r"^[-*•]\s+", "", stripped))
                num_ctr[0] = 0
                if indent_len >= 4:
                    emit(Paragraph(f"▸\u00a0\u00a0{b_text}", sub2_bullet))
                elif indent_len >= 2:
                    emit(Paragraph(f"◦\u00a0\u00a0{b_text}", sub_bullet))
                else:
                    emit(Paragraph(f"•\u00a0\u00a0{b_text}", bullet))
                continue

            # ── Normal paragraph ──────────────────────────────────────────────
            num_ctr[0] = 0
            emit(Paragraph(_md_to_rl(stripped), body_j))

        # Flush remaining buffers
        if in_code and code_buf:
            flush_code()
        if tbl_buf:
            flush_table()
        if in_callout:
            flush_callout()
        flush_pending()

        # ── Build PDF with custom canvas for header+footer ────────────────────
        doc = SimpleDocTemplate(
            buf,
            pagesize=letter,
            leftMargin=L_MARGIN, rightMargin=R_MARGIN,
            topMargin=T_MARGIN,  bottomMargin=B_MARGIN,
        )

        dc = _DocCanvas(clean_title)

        def _first_page(cv, d):
            # Cover page — indigo band at top, light band at bottom, then footer
            cv.saveState()
            pw = d.pagesize[0]
            # Indigo gradient band at top
            cv.setFillColor(colors.HexColor("#4f46e5"))
            cv.rect(0, d.pagesize[1] - 110, pw, 110, fill=1, stroke=0)
            # Light band at bottom
            cv.setFillColor(colors.HexColor("#f8fafc"))
            cv.rect(0, 0, pw, 60, fill=1, stroke=0)
            cv.restoreState()
            dc._draw_header_footer(cv, d)

        def _later_page(cv, d):
            dc._draw_header_footer(cv, d)

        doc.build(story, onFirstPage=_first_page, onLaterPages=_later_page)
        return buf.getvalue()

    # =========================================================================
    # DOCX
    # =========================================================================

    @staticmethod
    def generate_docx(title: str, content: str) -> bytes:
        """Generates a styled Microsoft Word document with proper inline formatting."""
        doc = Document()

        for section in doc.sections:
            section.top_margin    = Inches(1.0)
            section.bottom_margin = Inches(1.0)
            section.left_margin   = Inches(1.1)
            section.right_margin  = Inches(1.1)

        clean_title = _strip_md_markers(title.strip()) or "Generated Document"
        title_para = doc.add_heading(clean_title, level=0)
        title_para.alignment = WD_ALIGN_PARAGRAPH.LEFT
        for run in title_para.runs:
            run.font.color.rgb = RGBColor(15, 23, 42)

        def _apply_inline_md(paragraph, text: str):
            pattern = re.compile(
                r"(\*\*|__)(.*?)\1"
                r"|(\*|_)(.*?)\3"
                r"|`([^`]+)`"
                r"|~~(.*?)~~"
            )
            last = 0
            for m in pattern.finditer(text):
                if m.start() > last:
                    paragraph.add_run(text[last:m.start()])
                if m.group(1):
                    r = paragraph.add_run(m.group(2)); r.bold = True
                elif m.group(3):
                    r = paragraph.add_run(m.group(4)); r.italic = True
                elif m.group(5):
                    r = paragraph.add_run(m.group(5))
                    r.font.name = "Courier New"; r.font.size = Pt(9)
                    r.font.color.rgb = RGBColor(30, 41, 59)
                elif m.group(6):
                    r = paragraph.add_run(m.group(6))
                    r.font.color.rgb = RGBColor(148, 163, 184)
                last = m.end()
            if last < len(text):
                paragraph.add_run(text[last:])

        def _add_docx_table(raw_lines: List[str]):
            data_lines = [l for l in raw_lines if not _is_separator_row(l)]
            if not data_lines:
                return
            parsed = [_parse_table_row(l) for l in data_lines]
            n_cols = max(len(r) for r in parsed)
            for r in parsed:
                while len(r) < n_cols: r.append("")
            tbl = doc.add_table(rows=len(parsed), cols=n_cols)
            tbl.style = "Table Grid"
            for ri, rd in enumerate(parsed):
                for ci, ct in enumerate(rd):
                    cell = tbl.rows[ri].cells[ci]
                    p = cell.paragraphs[0]; p.clear()
                    if ri == 0:
                        run = p.add_run(_strip_md_markers(ct))
                        run.bold = True
                        run.font.color.rgb = RGBColor(255, 255, 255)
                        from docx.oxml.ns import qn as _qn
                        from docx.oxml import OxmlElement as _OE
                        tc = cell._tc; tcp = tc.get_or_add_tcPr()
                        shd = _OE("w:shd")
                        shd.set(_qn("w:val"), "clear")
                        shd.set(_qn("w:color"), "auto")
                        shd.set(_qn("w:fill"), "4F46E5")
                        tcp.append(shd)
                    else:
                        _apply_inline_md(p, ct)
            doc.add_paragraph()

        lines = content.split("\n")
        in_code = False; code_lines: List[str] = []; tbl_lines: List[str] = []

        for line in lines:
            stripped = line.strip()
            if stripped.startswith("```"):
                if tbl_lines: _add_docx_table(tbl_lines); tbl_lines = []
                if in_code:
                    cp = doc.add_paragraph()
                    for cl in code_lines:
                        r = cp.add_run(cl + "\n")
                        r.font.name = "Courier New"; r.font.size = Pt(9)
                        r.font.color.rgb = RGBColor(30, 41, 59)
                    cp.paragraph_format.left_indent = Inches(0.4)
                    code_lines = []; in_code = False
                else:
                    in_code = True
                continue
            if in_code: code_lines.append(line.rstrip()); continue
            if _is_table_row(stripped): tbl_lines.append(stripped); continue
            elif tbl_lines: _add_docx_table(tbl_lines); tbl_lines = []
            if not stripped: doc.add_paragraph(); continue
            if stripped.startswith(("### ", "#### ")):
                doc.add_heading(_strip_md_markers(stripped.lstrip("#").strip()), level=3)
            elif stripped.startswith("## "):
                doc.add_heading(_strip_md_markers(stripped[3:]), level=2)
            elif stripped.startswith("# "):
                doc.add_heading(_strip_md_markers(stripped[2:]), level=1)
            elif stripped.startswith(("- ", "* ", "• ")):
                p = doc.add_paragraph(style="List Bullet")
                _apply_inline_md(p, re.sub(r"^[-*•]\s+", "", stripped))
            elif re.match(r"^\d+\.\s", stripped):
                p = doc.add_paragraph(style="List Number")
                _apply_inline_md(p, re.sub(r"^\d+\.\s+", "", stripped))
            elif stripped.startswith("> "):
                p = doc.add_paragraph()
                p.paragraph_format.left_indent = Inches(0.5)
                run = p.add_run(stripped[2:].strip())
                run.italic = True; run.font.color.rgb = RGBColor(100, 116, 139)
            else:
                p = doc.add_paragraph(); _apply_inline_md(p, stripped)

        if tbl_lines: _add_docx_table(tbl_lines)
        if in_code and code_lines: doc.add_paragraph("\n".join(code_lines))

        buffer = io.BytesIO(); doc.save(buffer); return buffer.getvalue()

    # =========================================================================
    # PPTX
    # =========================================================================

    @staticmethod
    def generate_pptx(title: str, slides_data: List[Dict[str, Any]]) -> bytes:
        prs = Presentation()
        prs.slide_width  = PptxInches(13.333)
        prs.slide_height = PptxInches(7.5)
        ts = prs.slides.add_slide(prs.slide_layouts[0])
        ts.shapes.title.text = _strip_md_markers(title) or "Presentation"
        ts.placeholders[1].text = "Generated by Rag_Mcp AI Platform"
        for si, sd in enumerate(slides_data, start=2):
            sl = prs.slides.add_slide(prs.slide_layouts[1])
            sl.shapes.title.text = _strip_md_markers(sd.get("title", f"Section {si-1}"))
            tf = sl.shapes.placeholders[1].text_frame
            tf.word_wrap = True
            pts = sd.get("points") or sd.get("content") or []
            if isinstance(pts, str):
                pts = [p.strip() for p in pts.split("\n") if p.strip()]
            for pi, pt in enumerate(pts):
                cp = _strip_md_markers(pt.lstrip("-*•0123456789. "))
                if pi == 0: tf.text = cp
                else:
                    p = tf.add_paragraph(); p.text = cp; p.level = 0
        buf = io.BytesIO(); prs.save(buf); return buf.getvalue()

    # =========================================================================
    # XLSX
    # =========================================================================

    @staticmethod
    def generate_xlsx(sheet_name: str, headers: List[str],
                      rows: List[List[Any]], title: str = "") -> bytes:
        wb = openpyxl.Workbook(); ws = wb.active
        ws.title = (sheet_name or "Sheet1")[:31]
        hf = Font(name="Calibri", size=11, bold=True, color="FFFFFF")
        hfill = PatternFill(start_color="4F46E5", end_color="4F46E5", fill_type="solid")
        thin  = Border(
            left=Side(style="thin", color="CBD5E1"), right=Side(style="thin", color="CBD5E1"),
            top=Side(style="thin",  color="CBD5E1"), bottom=Side(style="thin", color="CBD5E1"))
        sr = 1
        if title:
            ws.merge_cells(start_row=1, start_column=1, end_row=1,
                           end_column=max(len(headers), 1))
            tc = ws.cell(row=1, column=1, value=_strip_md_markers(title))
            tc.font = Font(name="Calibri", size=14, bold=True, color="0F172A"); sr = 3
        for ci, h in enumerate(headers, start=1):
            cell = ws.cell(row=sr, column=ci, value=_strip_md_markers(str(h)))
            cell.font = hf; cell.fill = hfill
            cell.alignment = Alignment(horizontal="center", vertical="center")
            cell.border = thin
        for ri, row in enumerate(rows, start=sr+1):
            for ci, v in enumerate(row, start=1):
                cell = ws.cell(row=ri, column=ci, value=v)
                cell.border = thin
                cell.alignment = Alignment(
                    horizontal="right" if isinstance(v, (int, float)) else "left")
        for col in ws.columns:
            mx = max(len(str(c.value or "")) for c in col)
            ws.column_dimensions[get_column_letter(col[0].column)].width = max(mx+3, 12)
        buf = io.BytesIO(); wb.save(buf); return buf.getvalue()

    # =========================================================================
    # CSV
    # =========================================================================

    @staticmethod
    def generate_csv(headers: List[str], rows: List[List[Any]]) -> bytes:
        out = io.StringIO()
        w = csv.writer(out, quoting=csv.QUOTE_MINIMAL)
        if headers: w.writerow(headers)
        for r in rows: w.writerow(r)
        return out.getvalue().encode("utf-8")

    # =========================================================================
    # Code / Text
    # =========================================================================

    @staticmethod
    def generate_code_or_text(content: str, encoding: str = "utf-8") -> bytes:
        return content.encode(encoding)
