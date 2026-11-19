import React from "react";
import { box, circleBox, inch, pt, sizeFor, MARGIN_X } from "./geometry.js";

/** Soft circles on the right of dark slides - the deck's visual signature. */
export function Motif() {
  return (
    <>
      <div className="sdp-abs sdp-circle sdp-motif-large" style={circleBox(11.4, 1.7, 7)} />
      <div className="sdp-abs sdp-circle sdp-motif-ring" style={circleBox(11.55, 3.9, 4)} />
      <div className="sdp-abs sdp-circle sdp-motif-accent" style={circleBox(11.9, 5.7, 2.2)} />
    </>
  );
}

/** Text color that stays readable on the accent circles of dark slides. */
const onAccentDark = (theme) => (theme.accentOnDark === theme.accent ? theme.accentText : theme.dark);

/**
 * Title slide.
 * @param {{ slide: object, deck: object }} props
 */
export function TitleSlide({ slide, deck }) {
  const title = slide.title || deck.title;
  const subtitle = slide.subtitle || deck.subtitle;
  return (
    <div className="sdp-slide sdp-dark">
      <Motif />
      <h2 className="sdp-abs sdp-h sdp-on-dark sdp-bottom" style={{ ...box(0.9, 1.9, 6.8, 2.5), fontSize: pt(sizeFor(title, 6.8, 2.5, 46, 30, true)) }}>
        {title}
      </h2>
      {subtitle && (
        <p className="sdp-abs sdp-b sdp-on-dark-muted" style={{ ...box(0.9, 4.6, 6.6, 1.3), fontSize: pt(sizeFor(subtitle, 6.6, 1.3, 22, 15)) }}>
          {subtitle}
        </p>
      )}
      {deck.author && (
        <p className="sdp-abs sdp-b sdp-on-dark-muted sdp-middle" style={{ ...box(0.9, 6.5, 6.6, 0.4), fontSize: pt(14) }}>
          {deck.author}
        </p>
      )}
    </div>
  );
}

/** Section divider. */
export function SectionSlide({ slide, theme, sectionNumber }) {
  return (
    <div className="sdp-slide sdp-dark">
      <Motif />
      <div className="sdp-abs sdp-circle sdp-accent-fill sdp-h" style={{ ...circleBox(1.95, 3.75, 1.5), fontSize: pt(40), color: onAccentDark(theme) }}>
        {slide.number || String(sectionNumber).padStart(2, "0")}
      </div>
      <h2 className="sdp-abs sdp-h sdp-on-dark sdp-middle" style={{ ...box(3.25, 2.85, 4.4, 1.6), fontSize: pt(sizeFor(slide.title, 4.4, 1.6, 40, 26, true)) }}>
        {slide.title}
      </h2>
      {slide.subtitle && (
        <p className="sdp-abs sdp-b sdp-on-dark-muted" style={{ ...box(3.25, 4.55, 4.4, 1.2), fontSize: pt(18) }}>{slide.subtitle}</p>
      )}
    </div>
  );
}

/** Pull quote. */
export function QuoteSlide({ slide, theme }) {
  const text = slide.quote || slide.subtitle || "";
  return (
    <div className="sdp-slide sdp-dark">
      <h2 className="sdp-abs sdp-b sdp-on-dark-muted sdp-middle" style={{ ...box(MARGIN_X, 0.55, 11.9, 0.7), fontSize: pt(20) }}>{slide.title}</h2>
      <div className="sdp-abs sdp-circle sdp-accent-fill sdp-h" style={{ ...circleBox(1.65, 2.95, 1.15), fontSize: pt(60), color: onAccentDark(theme) }}>&ldquo;</div>
      <p className="sdp-abs sdp-h sdp-on-dark sdp-middle sdp-italic" style={{ ...box(2.85, 2, 9.7, 3.2), fontSize: pt(sizeFor(text, 9.7, 3.2, 32, 20)) }}>{text}</p>
      {slide.author && (
        <p className="sdp-abs sdp-b sdp-accent-text-dark sdp-bold sdp-middle" style={{ ...box(2.85, 5.5, 9.7, 0.6), fontSize: pt(18) }}>
          &mdash; {slide.author}
        </p>
      )}
    </div>
  );
}

/** Closing / next steps slide. */
export function ClosingSlide({ slide, theme }) {
  const items = (slide.bullets || []).slice(0, 4);
  const rowH = Math.min(0.95, (6.6 - 2.95) / Math.max(1, items.length));
  return (
    <div className="sdp-slide sdp-dark">
      <Motif />
      <h2 className="sdp-abs sdp-h sdp-on-dark sdp-bottom" style={{ ...box(0.9, items.length ? 1.1 : 2.4, 6.8, items.length ? 1.5 : 2), fontSize: pt(sizeFor(slide.title || "Thank you", 6.8, 1.5, 44, 30, true)) }}>
        {slide.title || "Thank you"}
      </h2>
      {slide.subtitle && !items.length && (
        <p className="sdp-abs sdp-b sdp-on-dark-muted" style={{ ...box(0.9, 4.55, 6.6, 1.2), fontSize: pt(20) }}>{slide.subtitle}</p>
      )}
      {items.map((item, i) => (
        <React.Fragment key={item}>
          <div className="sdp-abs sdp-circle sdp-accent-fill sdp-b sdp-bold" style={{ ...circleBox(1.2, 2.95 + i * rowH + rowH / 2, 0.6), fontSize: pt(16), color: onAccentDark(theme) }}>{i + 1}</div>
          <p className="sdp-abs sdp-b sdp-on-dark sdp-middle" style={{ ...box(1.75, 2.95 + i * rowH, 5.9, rowH), fontSize: pt(sizeFor(item, 5.9, rowH, 20, 14)) }}>{item}</p>
        </React.Fragment>
      ))}
    </div>
  );
}

export { inch };
