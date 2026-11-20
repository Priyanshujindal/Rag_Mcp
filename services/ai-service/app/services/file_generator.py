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
        """Designed deck from simple {title, points} slides; falls back to the basic generator on any error."""
        try:
            from app.schemas.deck import DeckSpec, SlideSpec
            from app.services.pptx_builder import build_pptx

            clean_title = _strip_md_markers(title) or "Presentation"
            slides = [SlideSpec(layout="title", title=clean_title)]
            for sd in slides_data or []:
                points = [str(p) for p in (sd.get("points") or []) if str(p).strip()]
                slides.append(SlideSpec(layout="bullets", title=str(sd.get("title") or clean_title),
                                        bullets=points[:30] or [str(sd.get("title") or clean_title)]))
            return build_pptx(DeckSpec(title=clean_title, slides=slides), text_hint=clean_title)
        except Exception:  # never lose the file because of a styling problem
            return FileGenerator._generate_pptx_basic(title, slides_data)

    @staticmethod
    def _generate_pptx_basic(title: str, slides_data: List[Dict[str, Any]]) -> bytes:
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
    def _format_cell_value(val: Any) -> tuple[Any, Optional[str], bool, bool]:
        """
        Parses cell values to strip raw markdown formatting and extract numbers/currency.
        Returns (cleaned_value, excel_number_format, is_bold, is_numeric).
        """
        if val is None:
            return "", None, False, False
        if isinstance(val, (int, float)):
            return (val, "#,##0.00" if isinstance(val, float) else "#,##0", False, True)

        s = str(val).strip()
        is_bold = bool(re.search(r"(\*\*|__).+?(\*\*|__)", s))
        clean_s = _strip_md_markers(s)

        # Check currency e.g. $1,500.00, -$50, ($100), €500, £300
        curr_match = re.match(
            r"^([$€£¥])?\s*([+-]?)\s*([$€£¥])?\s*\(?([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]+)?|[0-9]+(?:\.[0-9]+)?)\)?\s*([$€£¥])?$",
            clean_s,
        )
        if curr_match:
            is_negative = ("(" in clean_s and ")" in clean_s) or ("-" in clean_s)
            num_str = curr_match.group(4).replace(",", "")
            try:
                num = float(num_str) if "." in num_str else int(num_str)
                if is_negative:
                    num = -abs(num)
                symbol = curr_match.group(1) or curr_match.group(3) or curr_match.group(5)
                if symbol:
                    fmt = f'"{symbol}"#,##0.00' if isinstance(num, float) else f'"{symbol}"#,##0'
                else:
                    fmt = "#,##0.00" if isinstance(num, float) else "#,##0"
                return num, fmt, is_bold, True
            except ValueError:
                pass

        # Check percentage e.g. 15.5%, -5%
        pct_match = re.match(r"^([+-]?[0-9]+(?:\.[0-9]+)?)\s*%$", clean_s)
        if pct_match:
            try:
                num = float(pct_match.group(1)) / 100.0
                return num, "0.0%" if "." in pct_match.group(1) else "0%", is_bold, True
            except ValueError:
                pass

        # Check plain number with optional commas e.g. 1,500 or 1500.50
        num_match = re.match(r"^([+-]?[0-9]{1,3}(?:,[0-9]{3})+(?:\.[0-9]+)?|[+-]?[0-9]+(?:\.[0-9]+)?)$", clean_s)
        if num_match:
            raw_num = num_match.group(1).replace(",", "")
            try:
                num = float(raw_num) if "." in raw_num else int(raw_num)
                fmt = "#,##0.00" if isinstance(num, float) else "#,##0"
                return num, fmt, is_bold, True
            except ValueError:
                pass

        return clean_s, None, is_bold, False

    @staticmethod
    def generate_xlsx(sheet_name: str, headers: List[str],
                      rows: List[List[Any]], title: str = "") -> bytes:
        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = (sheet_name or "Data")[:31]
        ws.views.sheetView[0].showGridLines = True

        clean_headers = [_strip_md_markers(str(h)) for h in headers]
        num_cols = max(len(clean_headers), 1)

        sr = 1
        # 1. Professional Title Banner
        if title:
            clean_title = _strip_md_markers(title)
            ws.merge_cells(start_row=1, start_column=1, end_row=1, end_column=num_cols)
            tc = ws.cell(row=1, column=1, value=clean_title)
            tc.font = Font(name="Calibri", size=15, bold=True, color="FFFFFF")
            tc.fill = PatternFill(start_color="1E293B", end_color="1E293B", fill_type="solid")  # Slate 800
            tc.alignment = Alignment(horizontal="left", vertical="center", indent=1)
            ws.row_dimensions[1].height = 36

            # Subtitle / metadata row
            ws.merge_cells(start_row=2, start_column=1, end_row=2, end_column=num_cols)
            today_str = datetime.date.today().strftime("%B %d, %Y")
            sub = ws.cell(row=2, column=1, value=f"Generated on {today_str} • Rag_Mcp AI Analytics")
            sub.font = Font(name="Calibri", size=9, italic=True, color="64748B")
            sub.fill = PatternFill(start_color="F8FAFC", end_color="F8FAFC", fill_type="solid")  # Slate 50
            sub.alignment = Alignment(horizontal="left", vertical="center", indent=1)
            ws.row_dimensions[2].height = 18

            # Buffer row
            ws.row_dimensions[3].height = 8
            sr = 4

        # 2. Table Column Headers
        header_font = Font(name="Calibri", size=11, bold=True, color="FFFFFF")
        header_fill = PatternFill(start_color="334155", end_color="334155", fill_type="solid")  # Slate 700
        header_border = Border(
            left=Side(style="thin", color="475569"),
            right=Side(style="thin", color="475569"),
            top=Side(style="medium", color="1E293B"),
            bottom=Side(style="medium", color="1E293B"),
        )
        ws.row_dimensions[sr].height = 28

        for ci, h in enumerate(clean_headers, start=1):
            cell = ws.cell(row=sr, column=ci, value=h)
            cell.font = header_font
            cell.fill = header_fill
            cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
            cell.border = header_border

        # Freeze panes so header row stays fixed while scrolling
        ws.freeze_panes = f"A{sr + 1}"

        # 3. Data Rows
        data_font = Font(name="Calibri", size=10, color="1E293B")
        bold_font = Font(name="Calibri", size=10, bold=True, color="0F172A")
        total_font = Font(name="Calibri", size=11, bold=True, color="0F172A")

        zebra_even = PatternFill(start_color="F8FAFC", end_color="F8FAFC", fill_type="solid")
        zebra_odd = PatternFill(start_color="FFFFFF", end_color="FFFFFF", fill_type="solid")
        total_fill = PatternFill(start_color="F1F5F9", end_color="F1F5F9", fill_type="solid")

        thin_border = Border(
            left=Side(style="thin", color="E2E8F0"),
            right=Side(style="thin", color="E2E8F0"),
            top=Side(style="thin", color="E2E8F0"),
            bottom=Side(style="thin", color="E2E8F0"),
        )
        total_border = Border(
            left=Side(style="thin", color="E2E8F0"),
            right=Side(style="thin", color="E2E8F0"),
            top=Side(style="thin", color="94A3B8"),
            bottom=Side(style="double", color="0F172A"),  # Classic accounting double-underline
        )

        for ri, row in enumerate(rows, start=sr + 1):
            # Check if this row is a total/summary row
            row_str = " ".join(str(cell_val or "").lower() for cell_val in row)
            first_cell_str = str(row[0] or "").lower() if row else ""
            is_total_row = (
                any(first_cell_str.strip().startswith(kw) for kw in ("total", "grand total", "subtotal", "sum", "overall", "average"))
                or (len(rows) > 1 and ri == sr + len(rows) and "total" in row_str)
            )

            fill_to_use = total_fill if is_total_row else (zebra_even if (ri % 2 == 0) else zebra_odd)
            border_to_use = total_border if is_total_row else thin_border
            ws.row_dimensions[ri].height = 24 if is_total_row else 20

            for ci, raw_val in enumerate(row, start=1):
                clean_val, num_fmt, is_bold_cell, is_numeric = FileGenerator._format_cell_value(raw_val)
                cell = ws.cell(row=ri, column=ci, value=clean_val)
                cell.fill = fill_to_use
                cell.border = border_to_use

                if is_total_row:
                    cell.font = total_font
                elif is_bold_cell:
                    cell.font = bold_font
                else:
                    cell.font = data_font

                if num_fmt:
                    cell.number_format = num_fmt

                if is_numeric:
                    cell.alignment = Alignment(horizontal="right", vertical="center")
                elif str(clean_val).strip().isdigit() or re.match(r"^\d{4}-\d{2}-\d{2}$", str(clean_val).strip()):
                    cell.alignment = Alignment(horizontal="center", vertical="center")
                else:
                    cell.alignment = Alignment(horizontal="left", vertical="center")

        # 4. Auto-fit column widths with breathing room
        for col in ws.columns:
            col_letter = get_column_letter(col[0].column)
            max_len = 0
            for c in col:
                if c.row < sr:
                    continue  # skip title banner for column width
                val_str = str(c.value or "")
                if c.number_format and ('"$"#' in c.number_format or "$" in c.number_format):
                    val_str = "$" + val_str
                max_len = max(max_len, len(val_str))
            ws.column_dimensions[col_letter].width = min(max(max_len + 4, 13), 50)

        buf = io.BytesIO()
        wb.save(buf)
        return buf.getvalue()

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
    # Markdown
    # =========================================================================

    @staticmethod
    def generate_markdown(title: str, content: str) -> bytes:
        """
        Cleans and formats a professional Markdown (.md) document.
        - Strips outer code fences if present (```markdown ... ```)
        - Cleans conversation preambles and postambles
        - Ensures top-level # Title exists
        - Normalizes spacing and returns clean UTF-8 encoded bytes
        """
        raw = (content or "").strip()

        # 1. Strip common LLM preamble at the top
        lines = raw.split("\n")
        start = 0
        preamble_re = re.compile(
            r"^(here('s| is)|sure[,!]|okay[,!]|certainly|below is|the following is|i have created|this markdown)",
            re.IGNORECASE,
        )
        while start < len(lines):
            line_str = lines[start].strip()
            if not line_str:
                start += 1
                continue
            if preamble_re.match(line_str) and not line_str.startswith("#"):
                start += 1
                continue
            break

        cleaned_text = "\n".join(lines[start:]).strip()

        # 2. Check if text is enclosed in a markdown code fence
        fence_match = re.match(r"^```(?:markdown|md)?\s*\n([\s\S]*?)\n```\s*$", cleaned_text, flags=re.IGNORECASE)
        if fence_match:
            cleaned_text = fence_match.group(1).strip()
        else:
            inner_fence = re.search(r"```(?:markdown|md)\s*\n([\s\S]*?)\n```", cleaned_text, flags=re.IGNORECASE)
            if inner_fence:
                cleaned_text = inner_fence.group(1).strip()

        # 3. Strip common trailing remarks if at end
        trailing_lines = cleaned_text.split("\n")
        end = len(trailing_lines)
        trailing_re = re.compile(
            r"^(hope this (helps|is useful)|let me know if|feel free to|if you (have|need))",
            re.IGNORECASE,
        )
        while end > 0:
            last_line = trailing_lines[end - 1].strip()
            if not last_line:
                end -= 1
                continue
            if trailing_re.match(last_line) and not last_line.startswith("#"):
                end -= 1
                continue
            break

        final_text = "\n".join(trailing_lines[:end]).strip()

        if title and not re.match(r"^#\s+", final_text):
            clean_title = _strip_md_markers(title)
            final_text = f"# {clean_title}\n\n{final_text}"

        final_text = re.sub(r"\n{3,}", "\n\n", final_text) + "\n"
        return final_text.encode("utf-8")

    # =========================================================================
    # Code / Text
    # =========================================================================

    @staticmethod
    def generate_code_or_text(content: str, encoding: str = "utf-8") -> bytes:
        return content.encode(encoding)
