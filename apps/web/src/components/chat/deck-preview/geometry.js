/**
 * Geometry helpers for the slide preview.
 * Slides are laid out in inches on a 13.333 x 7.5 canvas, exactly like the generated .pptx.
 * The stage sets --in (pixels per inch) from its own width, so everything scales together.
 */

export const SLIDE_W = 13.333;
export const SLIDE_H = 7.5;
export const MARGIN_X = 0.7;
export const CONTENT_W = SLIDE_W - 2 * MARGIN_X;
export const BODY_TOP = 1.95;
export const BODY_H = 4.8;

/** CSS length for `n` inches. */
export const inch = (n) => `calc(var(--in) * ${n})`;

/** CSS font size for `n` points (1 pt = 1/72 inch). */
export const pt = (n) => `calc(var(--in) * ${(n / 72).toFixed(4)})`;

/** Absolute box style from inch coordinates. */
export const box = (x, y, w, h) => ({ left: inch(x), top: inch(y), width: inch(w), height: inch(h) });

/** Circle centered on (cx, cy) with diameter d (inches). */
export const circleBox = (cx, cy, d) => box(cx - d / 2, cy - d / 2, d, d);

/** Approximate width of big bold numbers in em, to keep stat values on one line. */
export function valueEm(text) {
  let em = 0;
  for (const ch of String(text || "")) {
    if (/\d/.test(ch)) em += 0.62;
    else if (ch === "%") em += 1.0;
    else if (ch === "." || ch === ",") em += 0.32;
    else if (ch === " ") em += 0.28;
    else if (ch === ch.toUpperCase() && ch !== ch.toLowerCase()) em += 0.74;
    else em += 0.64;
  }
  return em;
}

/** Largest size (pt, down to `min`) at which `text` fits on one line within `widthIn` inches. */
export function fitOneLine(text, widthIn, max = 60, min = 24) {
  let size = max;
  while (size > min && (valueEm(text) * size) / 72 > widthIn) size -= 1;
  return size;
}

/** Splits "Lead phrase: detail" into its parts (short leads only). */
export function splitLead(text) {
  const value = String(text || "");
  const idx = value.indexOf(":");
  if (idx > 1 && idx <= 44 && value.slice(idx + 1).trim()) {
    return { lead: value.slice(0, idx).trim(), detail: value.slice(idx + 1).trim() };
  }
  return { lead: "", detail: value };
}

/** Default font size that roughly fits `text` in a box, mirroring the renderer's shrink-to-fit idea. */
export function sizeFor(text, widthIn, heightIn, maxPt, minPt, bold = false) {
  const charW = (bold ? 0.55 : 0.5) / 72;
  let size = maxPt;
  while (size > minPt) {
    const perLine = Math.max(1, Math.floor(widthIn / (size * charW)));
    const lines = Math.ceil(String(text || "").length / perLine) || 1;
    if ((lines * size * 1.2) / 72 <= heightIn) break;
    size -= 1;
  }
  return size;
}
