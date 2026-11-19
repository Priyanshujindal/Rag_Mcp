import React, { useLayoutEffect, useMemo, useRef, useState } from "react";
import PropTypes from "prop-types";
import { BulletsSlide, CardsSlide, ChartSlide, StatsSlide, TableSlide, TimelineSlide, TwoColumnSlide } from "./layouts-light.jsx";
import { ClosingSlide, QuoteSlide, SectionSlide, TitleSlide } from "./layouts-dark.jsx";
import { SLIDE_W } from "./geometry.js";
import "./slide-deck-preview.css";

const HEADING_STACKS = {
  Cambria: '"Cambria", "Caladea", Georgia, "Times New Roman", serif',
  Calibri: '"Calibri", "Carlito", "Segoe UI", Arial, sans-serif',
};
const stackFor = (name) => HEADING_STACKS[name] || `"${name}", Arial, sans-serif`;

/** Chart colors derived the same way as the generator (primary, accent, secondary, ...). */
function chartColors(theme) {
  const colors = theme.chartColors?.length ? theme.chartColors : [theme.primary, theme.accent, theme.secondary, theme.dark, theme.badge];
  return colors.map((c) => `#${c}`);
}

/** True when the slide has what its layout needs (otherwise the .pptx renderer falls back to bullets). */
function hasContentFor(slide) {
  switch (slide.layout) {
    case "two_column": return (slide.columns || []).length > 0;
    case "cards": return (slide.cards || []).length > 0;
    case "stats": return (slide.stats || []).length > 0;
    case "quote": return Boolean(slide.quote || slide.subtitle);
    case "table": return (slide.table?.headers || []).length > 0;
    case "chart": return (slide.chart?.categories || []).length > 0 && (slide.chart?.series || []).length > 0;
    case "timeline": return (slide.steps || []).length > 0;
    default: return true;
  }
}

/** Same idea as the renderer's fallback: turn whatever content exists into bullet points. */
function fallbackBullets(slide) {
  const points = [];
  (slide.columns || []).forEach((c) => (c.bullets || []).slice(0, 2).forEach((b) => points.push(c.heading ? `${c.heading}: ${b}` : b)));
  (slide.cards || []).forEach((c) => points.push(c.body ? `${c.title}: ${c.body}` : c.title));
  (slide.stats || []).forEach((st) => points.push(`${st.value} ${st.label}`.trim()));
  (slide.steps || []).forEach((st) => points.push(st.detail ? `${st.label}: ${st.detail}` : st.label));
  if (slide.quote) points.push(slide.quote);
  if (!points.length && slide.subtitle) points.push(slide.subtitle);
  return points.filter(Boolean).slice(0, 5);
}

function SlideBody({ slide: original, deck, theme, number, sectionNumber }) {
  let slide = original;
  let layout = slide.layout || "bullets";
  if (!hasContentFor(slide)) {
    slide = { ...slide, bullets: slide.bullets?.length ? slide.bullets : fallbackBullets(slide) };
    if (!slide.bullets.length) slide.bullets = [slide.title || "Overview"];
    layout = "bullets";
  }
  const common = { slide, deck, theme, number };
  switch (layout) {
    case "title": return <TitleSlide {...common} />;
    case "section": return <SectionSlide {...common} sectionNumber={sectionNumber} />;
    case "quote": return <QuoteSlide {...common} />;
    case "closing": return <ClosingSlide {...common} />;
    case "two_column": return <TwoColumnSlide {...common} />;
    case "cards": return <CardsSlide {...common} />;
    case "stats": return <StatsSlide {...common} />;
    case "timeline": return <TimelineSlide {...common} />;
    case "table": return <TableSlide {...common} />;
    case "chart": return <ChartSlide {...common} colors={chartColors(theme)} />;
    default: return <BulletsSlide {...common} />;
  }
}

/** One 16:9 slide that scales with its container (sets --in = pixels per inch). */
function SlideStage({ slide, deck, theme, number, sectionNumber, className = "" }) {
  const ref = useRef(null);
  const [unit, setUnit] = useState(60);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const update = () => setUnit(el.clientWidth / SLIDE_W);
    update();
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const vars = useMemo(
    () => ({
      "--in": `${unit}px`,
      "--sdp-dark": `#${theme.dark}`,
      "--sdp-light": `#${theme.light}`,
      "--sdp-primary": `#${theme.primary}`,
      "--sdp-secondary": `#${theme.secondary}`,
      "--sdp-accent": `#${theme.accent}`,
      "--sdp-accent-text": `#${theme.accentText}`,
      "--sdp-accent-dark": `#${theme.accentOnDark}`,
      "--sdp-badge": `#${theme.badge}`,
      "--sdp-ink": `#${theme.ink}`,
      "--sdp-heading": `#${theme.headingInk}`,
      "--sdp-muted": `#${theme.muted}`,
      "--sdp-card": `#${theme.card}`,
      "--sdp-on-dark": `#${theme.onDark}`,
      "--sdp-on-dark-muted": `#${theme.onDarkMuted}`,
      "--sdp-hfont": stackFor(theme.headingFont),
      "--sdp-bfont": stackFor(theme.bodyFont),
    }),
    [unit, theme]
  );

  return (
    <div ref={ref} className={`sdp-stage ${className}`} style={vars}>
      <SlideBody slide={slide} deck={deck} theme={theme} number={number} sectionNumber={sectionNumber} />
    </div>
  );
}

SlideStage.propTypes = {
  slide: PropTypes.object.isRequired,
  deck: PropTypes.object.isRequired,
  theme: PropTypes.object.isRequired,
  number: PropTypes.number.isRequired,
  sectionNumber: PropTypes.number,
  className: PropTypes.string,
};
SlideBody.propTypes = SlideStage.propTypes;

/**
 * Live preview of a generated presentation: the active slide plus a thumbnail strip.
 * @param {{ deck: object, theme: object, index: number, onSelect: (i: number) => void }} props
 */
export { SlideStage };
export default function SlideDeckPreview({ deck, theme, index, onSelect }) {
  const slides = useMemo(() => deck.slides || [], [deck.slides]);
  const sectionNumbers = useMemo(() => {
    let count = 0;
    return slides.map((s) => (s.layout === "section" ? ++count : 0));
  }, [slides]);
  const active = Math.min(Math.max(index, 0), slides.length - 1);
  const slide = slides[active];
  if (!slide) return null;

  return (
    <div className="sdp-root">
      <SlideStage slide={slide} deck={deck} theme={theme} number={active + 1} sectionNumber={sectionNumbers[active]} className="sdp-main" />
      <div className="sdp-thumbs" role="tablist" aria-label="Slides">
        {slides.map((s, i) => (
          <button
            key={i}
            type="button"
            role="tab"
            aria-selected={i === active}
            aria-label={`Go to slide ${i + 1}${s.title ? `: ${s.title}` : ""}`}
            className={`sdp-thumb ${i === active ? "is-active" : ""}`}
            onClick={() => onSelect(i)}
          >
            <SlideStage slide={s} deck={deck} theme={theme} number={i + 1} sectionNumber={sectionNumbers[i]} />
          </button>
        ))}
      </div>
    </div>
  );
}

SlideDeckPreview.propTypes = {
  deck: PropTypes.shape({ slides: PropTypes.array }).isRequired,
  theme: PropTypes.object.isRequired,
  index: PropTypes.number.isRequired,
  onSelect: PropTypes.func.isRequired,
};
