import React from "react";
import SlideChart from "./slide-chart.jsx";
import { BODY_H, BODY_TOP, CONTENT_W, MARGIN_X, SLIDE_W, box, circleBox, fitOneLine, pt, sizeFor, splitLead } from "./geometry.js";

/** Slide title + footer shared by all light slides. */
function Frame({ title, deck, number, children }) {
  return (
    <div className="sdp-slide sdp-light">
      <h2 className="sdp-abs sdp-h sdp-heading sdp-middle" style={{ ...box(MARGIN_X, 0.5, CONTENT_W, 1.1), fontSize: pt(sizeFor(title, CONTENT_W, 1.1, 34, 26, true)) }}>{title}</h2>
      {children}
      <span className="sdp-abs sdp-b sdp-muted sdp-middle" style={{ ...box(MARGIN_X, 7.0, 8.5, 0.3), fontSize: pt(10) }}>{deck.title}</span>
      <span className="sdp-abs sdp-b sdp-muted sdp-middle sdp-right" style={{ ...box(SLIDE_W - MARGIN_X - 1, 7.0, 1, 0.3), fontSize: pt(10) }}>{number}</span>
    </div>
  );
}

/** Numbered rows with an optional key-takeaway panel. */
export function BulletsSlide({ slide, deck, number }) {
  const bullets = (slide.bullets || []).slice(0, 5);
  const n = Math.max(1, bullets.length);
  const hasPanel = Boolean(slide.callout);
  const rowsW = hasPanel ? 7.5 : CONTENT_W;
  const rowH = Math.min(1.12, (BODY_H - 0.22 * (n - 1)) / n);
  const textW = rowsW - 0.94;
  return (
    <Frame title={slide.title} deck={deck} number={number}>
      {bullets.map((b, i) => {
        const { lead, detail } = splitLead(b);
        const y = BODY_TOP + i * (rowH + 0.22);
        return (
          <React.Fragment key={b}>
            <div className="sdp-abs sdp-circle sdp-badge sdp-b sdp-bold" style={{ ...circleBox(MARGIN_X + 0.31, y + rowH / 2, 0.62), fontSize: pt(17) }}>{i + 1}</div>
            <div className="sdp-abs sdp-middle-col" style={box(MARGIN_X + 0.94, y, textW, rowH)}>
              {lead && <p className="sdp-b sdp-heading sdp-bold" style={{ fontSize: pt(sizeFor(lead, textW, rowH * 0.45, 20, 15, true)) }}>{lead}</p>}
              <p className="sdp-b sdp-ink" style={{ fontSize: pt(sizeFor(detail, textW, lead ? rowH * 0.55 : rowH, lead ? 16 : 20, 13)) }}>{detail}</p>
            </div>
          </React.Fragment>
        );
      })}
      {hasPanel && (
        <div className="sdp-abs sdp-card-dark sdp-middle-col" style={{ ...box(MARGIN_X + rowsW + 0.45, BODY_TOP, SLIDE_W - MARGIN_X - (MARGIN_X + rowsW + 0.45), BODY_H), padding: `calc(var(--in) * 0.4)` }}>
          <p className="sdp-b sdp-accent-text-dark sdp-bold sdp-label" style={{ fontSize: pt(12) }}>KEY TAKEAWAY</p>
          <p className="sdp-h sdp-on-dark sdp-bold" style={{ fontSize: pt(sizeFor(slide.callout, 3.1, 3.2, 26, 18, true)) }}>{slide.callout}</p>
        </div>
      )}
    </Frame>
  );
}

/** Two comparison cards. */
export function TwoColumnSlide({ slide, deck, number }) {
  const cols = (slide.columns || []).slice(0, 2);
  const cardW = (CONTENT_W - 0.45) / 2;
  return (
    <Frame title={slide.title} deck={deck} number={number}>
      {cols.map((col, i) => {
        const x = MARGIN_X + i * (cardW + 0.45);
        return (
          <React.Fragment key={col.heading || i}>
            <div className="sdp-abs sdp-card" style={box(x, BODY_TOP, cardW, 4.3)} />
            <div className={`sdp-abs sdp-circle sdp-b sdp-bold ${i === 0 ? "sdp-badge" : "sdp-accent-fill-light"}`} style={{ ...circleBox(x + 0.64, BODY_TOP + 0.64, 0.58), fontSize: pt(17) }}>{"AB"[i]}</div>
            <h3 className="sdp-abs sdp-h sdp-heading sdp-bold sdp-middle" style={{ ...box(x + 1.15, BODY_TOP + 0.3, cardW - 1.5, 0.7), fontSize: pt(sizeFor(col.heading, cardW - 1.5, 0.7, 24, 16, true)) }}>{col.heading}</h3>
            <ul className="sdp-abs sdp-b sdp-ink sdp-list" style={{ ...box(x + 0.4, BODY_TOP + 1.3, cardW - 0.8, 2.8), fontSize: pt(sizeFor((col.bullets || []).join(" "), cardW - 1.2, 2.8, 20, 14)) }}>
              {(col.bullets || []).map((b) => <li key={b}>{b}</li>)}
            </ul>
          </React.Fragment>
        );
      })}
    </Frame>
  );
}

/** 2-4 cards with number badges. */
export function CardsSlide({ slide, deck, number }) {
  const cards = (slide.cards || []).slice(0, 4);
  const n = Math.max(1, cards.length);
  const cardW = (CONTENT_W - 0.35 * (n - 1)) / n;
  return (
    <Frame title={slide.title} deck={deck} number={number}>
      {cards.map((c, i) => {
        const x = MARGIN_X + i * (cardW + 0.35);
        return (
          <React.Fragment key={c.title || i}>
            <div className="sdp-abs sdp-card" style={box(x, BODY_TOP, cardW, 4.3)} />
            <div className={`sdp-abs sdp-circle sdp-h sdp-bold ${i % 2 === 0 ? "sdp-badge" : "sdp-accent-fill-light"}`} style={{ ...circleBox(x + 0.8, BODY_TOP + 0.85, 0.8), fontSize: pt(22) }}>{i + 1}</div>
            <h3 className="sdp-abs sdp-h sdp-heading sdp-bold" style={{ ...box(x + 0.4, BODY_TOP + 1.6, cardW - 0.8, 1), fontSize: pt(sizeFor(c.title, cardW - 0.8, 1, 22, 16, true)) }}>{c.title}</h3>
            <p className="sdp-abs sdp-b sdp-ink" style={{ ...box(x + 0.4, BODY_TOP + 2.65, cardW - 0.8, 1.5), fontSize: pt(sizeFor(c.body, cardW - 0.8, 1.5, 17, 13)) }}>{c.body}</p>
          </React.Fragment>
        );
      })}
    </Frame>
  );
}

/** Big-number statistics. */
export function StatsSlide({ slide, deck, number }) {
  const stats = (slide.stats || []).slice(0, 4);
  const n = Math.max(1, stats.length);
  const cardW = (CONTENT_W - 0.35 * (n - 1)) / n;
  const top = BODY_TOP + (BODY_H - 4.2) / 2 - 0.1;
  return (
    <Frame title={slide.title} deck={deck} number={number}>
      {stats.map((s, i) => {
        const x = MARGIN_X + i * (cardW + 0.35);
        return (
          <React.Fragment key={s.label || i}>
            <div className="sdp-abs sdp-card" style={box(x, top, cardW, 4.2)} />
            <p className={`sdp-abs sdp-h sdp-bold sdp-middle ${i % 2 === 0 ? "sdp-badge-text" : "sdp-accent-text-light"}`} style={{ ...box(x + 0.35, top + 0.45, cardW - 0.7, 1.45), fontSize: pt(fitOneLine(s.value, cardW - 0.7)) }}>{s.value}</p>
            <p className="sdp-abs sdp-b sdp-heading sdp-bold" style={{ ...box(x + 0.35, top + 2.05, cardW - 0.7, 0.8), fontSize: pt(sizeFor(s.label, cardW - 0.7, 0.8, 20, 15, true)) }}>{s.label}</p>
            {s.detail && <p className="sdp-abs sdp-b sdp-muted" style={{ ...box(x + 0.35, top + 2.9, cardW - 0.7, 1.05), fontSize: pt(sizeFor(s.detail, cardW - 0.7, 1.05, 16, 12)) }}>{s.detail}</p>}
          </React.Fragment>
        );
      })}
    </Frame>
  );
}

/** Horizontal process steps. */
export function TimelineSlide({ slide, deck, number }) {
  const steps = (slide.steps || []).slice(0, 5);
  const n = Math.max(1, steps.length);
  const colW = CONTENT_W / n;
  const cy = BODY_TOP + 0.75;
  return (
    <Frame title={slide.title} deck={deck} number={number}>
      {n > 1 && <div className="sdp-abs sdp-line" style={box(MARGIN_X + 0.5, cy - 0.02, colW * (n - 1), 0.04)} />}
      {steps.map((s, i) => {
        const x = MARGIN_X + i * colW;
        const last = i === n - 1 && n > 1;
        return (
          <React.Fragment key={s.label || i}>
            <div className={`sdp-abs sdp-circle sdp-h sdp-bold ${last ? "sdp-accent-fill-light" : "sdp-badge"}`} style={{ ...circleBox(x + 0.5, cy, 1), fontSize: pt(26) }}>{i + 1}</div>
            <h3 className="sdp-abs sdp-h sdp-heading sdp-bold" style={{ ...box(x, cy + 0.85, colW - 0.4, 0.9), fontSize: pt(sizeFor(s.label, colW - 0.4, 0.9, 24, 16, true)) }}>{s.label}</h3>
            <p className="sdp-abs sdp-b sdp-ink" style={{ ...box(x, cy + 1.85, colW - 0.4, 2.2), fontSize: pt(sizeFor(s.detail, colW - 0.4, 2.2, 18, 13)) }}>{s.detail}</p>
          </React.Fragment>
        );
      })}
    </Frame>
  );
}

/** Native-style table. */
export function TableSlide({ slide, deck, number }) {
  const headers = slide.table?.headers || [];
  const rows = slide.table?.rows || [];
  const size = rows.length + 1 <= 5 ? 17 : rows.length + 1 <= 7 ? 15 : 13;
  return (
    <Frame title={slide.title} deck={deck} number={number}>
      <div className="sdp-abs" style={box(MARGIN_X, BODY_TOP, CONTENT_W, BODY_H)}>
        <table className="sdp-table" style={{ fontSize: pt(size) }}>
          <thead><tr>{headers.map((h) => <th key={h}>{h}</th>)}</tr></thead>
          <tbody>
            {rows.map((r, ri) => (
              <tr key={ri}>{r.map((c, ci) => <td key={ci} className={ci === 0 ? "sdp-bold" : ""}>{c}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
    </Frame>
  );
}

/** Chart with takeaways, or a category breakdown for round charts. */
export function ChartSlide({ slide, deck, number, theme, colors }) {
  const chart = slide.chart || {};
  const round = chart.type === "pie" || chart.type === "doughnut";
  const bullets = (slide.bullets || []).slice(0, 3);
  const hasPanel = bullets.length > 0;
  const chartW = round && !hasPanel ? 6.4 : hasPanel ? 7.6 : CONTENT_W;
  const values = chart.series?.[0]?.values || [];
  const total = values.reduce((a, b) => a + Math.max(0, Number(b) || 0), 0) || 1;
  const caption = chart.caption || (chart.unit ? `Values in ${chart.unit}` : "");
  return (
    <Frame title={slide.title} deck={deck} number={number}>
      <div className="sdp-abs" style={box(MARGIN_X, BODY_TOP, chartW, BODY_H - (caption ? 0.45 : 0))}>
        <SlideChart chart={chart} colors={colors} ink={`#${theme.ink}`} muted={`#${theme.muted}`} />
      </div>
      {caption && <p className="sdp-abs sdp-b sdp-muted" style={{ ...box(MARGIN_X, BODY_TOP + BODY_H - 0.35, chartW, 0.35), fontSize: pt(12) }}>{caption}</p>}
      {round && !hasPanel && (chart.categories || []).slice(0, 8).map((c, i) => (
        <div key={c} className="sdp-abs sdp-legend-row" style={box(MARGIN_X + chartW + 0.5, BODY_TOP + 0.4 + i * 0.6, 4.4, 0.6)}>
          <span className="sdp-dot" style={{ background: colors[i % colors.length] }} />
          <span className="sdp-b sdp-heading sdp-bold sdp-grow" style={{ fontSize: pt(17) }}>{c}</span>
          <span className="sdp-b sdp-ink" style={{ fontSize: pt(17) }}>{Math.round(((Number(values[i]) || 0) / total) * 100)}%</span>
        </div>
      ))}
      {hasPanel && (
        <div className="sdp-abs sdp-card" style={{ ...box(MARGIN_X + chartW + 0.4, BODY_TOP, SLIDE_W - MARGIN_X - (MARGIN_X + chartW + 0.4), BODY_H), padding: `calc(var(--in) * 0.35)` }}>
          <p className="sdp-b sdp-badge-text sdp-bold sdp-label" style={{ fontSize: pt(12) }}>WHAT IT SHOWS</p>
          <ul className="sdp-b sdp-ink sdp-list" style={{ fontSize: pt(16) }}>{bullets.map((b) => <li key={b}>{b}</li>)}</ul>
        </div>
      )}
    </Frame>
  );
}
