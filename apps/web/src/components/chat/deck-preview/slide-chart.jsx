import React from "react";

/**
 * Small SVG chart for the slide preview (column, bar, line, pie, doughnut).
 * @param {{ chart: object, colors: string[], ink: string, muted: string }} props
 */
export default function SlideChart({ chart, colors, ink, muted }) {
  const categories = chart.categories || [];
  const series = chart.series || [];
  if (!categories.length || !series.length) return null;
  const kind = chart.type || "column";
  const color = (i) => colors[i % colors.length];

  if (kind === "pie" || kind === "doughnut") {
    const values = (series[0].values || []).slice(0, categories.length).map((v) => Math.max(0, Number(v) || 0));
    const total = values.reduce((a, b) => a + b, 0) || 1;
    const isPie = kind === "pie";
    // doughnut: ring radius with circumference 100; pie: half radius (circumference 50) with a thick stroke
    const r = isPie ? 7.9577 : 15.9155;
    const scale = isPie ? 0.5 : 1;
    let offset = 0;
    return (
      <svg viewBox="0 0 42 42" className="sdp-chart-svg" role="img" aria-label="Chart">
        {values.map((v, i) => {
          const share = (v / total) * 100;
          const el = (
            <circle
              key={categories[i] || i}
              cx="21"
              cy="21"
              r={r}
              fill="none"
              stroke={color(i)}
              strokeWidth={isPie ? 15.9 : 8}
              strokeDasharray={`${share * scale} ${(100 - share) * scale}`}
              strokeDashoffset={(25 - offset) * scale}
            />
          );
          offset += share;
          return el;
        })}
      </svg>
    );
  }

  const all = series.flatMap((s) => s.values || []);
  const max = Math.max(1, ...all.map((v) => Number(v) || 0));
  const n = categories.length;

  if (kind === "line") {
    const W = 100;
    const H = 56;
    const x = (i) => 8 + (i * (W - 16)) / Math.max(1, n - 1);
    const y = (v) => H - 8 - ((Number(v) || 0) / max) * (H - 18);
    return (
      <svg viewBox={`0 0 ${W} ${H}`} className="sdp-chart-svg" role="img" aria-label="Line chart">
        {[0, 0.5, 1].map((g) => (
          <line key={g} x1="6" x2={W - 4} y1={y(max * g)} y2={y(max * g)} stroke={muted} strokeOpacity="0.25" strokeWidth="0.3" />
        ))}
        {series.map((s, si) => (
          <g key={s.name || si}>
            <polyline
              fill="none"
              stroke={color(si)}
              strokeWidth="1.1"
              points={(s.values || []).slice(0, n).map((v, i) => `${x(i)},${y(v)}`).join(" ")}
            />
            {(s.values || []).slice(0, n).map((v, i) => (
              <circle key={i} cx={x(i)} cy={y(v)} r="1.2" fill={color(si)} />
            ))}
          </g>
        ))}
        {categories.map((c, i) => (
          <text key={c} x={x(i)} y={H - 1.5} fontSize="3" textAnchor="middle" fill={ink}>{c}</text>
        ))}
      </svg>
    );
  }

  if (kind === "bar") {
    const rowH = 56 / n;
    return (
      <svg viewBox="0 0 100 56" className="sdp-chart-svg" role="img" aria-label="Bar chart">
        {categories.map((c, i) => {
          const v = Number(series[0].values?.[i]) || 0;
          const w = (v / max) * 60;
          return (
            <g key={c}>
              <text x="24" y={i * rowH + rowH / 2 + 1} fontSize="3" textAnchor="end" fill={ink}>{c}</text>
              <rect x="26" y={i * rowH + rowH * 0.2} width={w} height={rowH * 0.6} fill={color(0)} />
              <text x={26 + w + 1.2} y={i * rowH + rowH / 2 + 1} fontSize="3" fill={ink}>{v}</text>
            </g>
          );
        })}
      </svg>
    );
  }

  // column
  const groupW = 84 / n;
  const barW = (groupW * 0.7) / series.length;
  return (
    <svg viewBox="0 0 100 56" className="sdp-chart-svg" role="img" aria-label="Column chart">
      <line x1="8" x2="98" y1="46" y2="46" stroke={muted} strokeOpacity="0.5" strokeWidth="0.3" />
      {categories.map((c, i) => (
        <g key={c}>
          {series.map((s, si) => {
            const v = Number(s.values?.[i]) || 0;
            const h = (v / max) * 34;
            const bx = 10 + i * groupW + groupW * 0.15 + si * barW;
            return (
              <g key={s.name || si}>
                <rect x={bx} y={46 - h} width={barW * 0.95} height={h} fill={color(si)} />
                <text x={bx + (barW * 0.95) / 2} y={46 - h - 1.5} fontSize="3" textAnchor="middle" fill={ink}>{v}</text>
              </g>
            );
          })}
          <text x={10 + i * groupW + groupW / 2} y="52" fontSize="3" textAnchor="middle" fill={ink}>{c}</text>
        </g>
      ))}
    </svg>
  );
}
