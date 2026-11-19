import React, { useState, useEffect } from "react";
import { MessageSquare, Cpu, DollarSign, Clock, AlertCircle, RefreshCw } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { mockUsageMetrics } from "@/lib/mock/data";
import { getMockUsageMetrics } from "@/lib/api";
import "./usage.css";

function MetricCard({ icon: Icon, label, value, sub, color = "var(--accent)" }) {
  return (
    <div className="metric-card">
      <div className="usage-metric-header">
        <div
          className="usage-metric-icon"
          style={{ "--metric-color": color, "--metric-bg": `${color}22` }}
        >
          <Icon size={14} />
        </div>
        <span className="metric-label">{label}</span>
      </div>
      <div className="metric-value">{value}</div>
      {sub && <div className="metric-sub">{sub}</div>}
    </div>
  );
}

function BarChart({ data, valueKey, label, color = "var(--accent)", formatValue }) {
  const max = Math.max(...data.map((d) => d[valueKey]));

  return (
    <div className="chart-wrapper">
      <div className="chart-title">{label}</div>
      <div className="bar-chart">
        {data.map((d, i) => {
          const pct = max > 0 ? (d[valueKey] / max) * 100 : 0;
          return (
            <div key={i} className="bar-col" title={`${d.date}: ${formatValue ? formatValue(d[valueKey]) : d[valueKey]}`}>
              <div
                className="bar-fill"
                style={{
                  "--bar-height": `${Math.max(pct, 2)}%`,
                  "--bar-color": color,
                }}
              />
              <span className="bar-label">{d.date.replace("Oct ", "")}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function UsagePage() {
  const [metrics, setMetrics] = useState(mockUsageMetrics);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    getMockUsageMetrics()
      .then((data) => {
        if (Array.isArray(data) && data.length > 0) {
          setMetrics(data);
        }
      })
      .catch((err) => {
        setError(err.message || "Failed to load usage data");
      });
  }, []);

  const totals = metrics.reduce(
    (acc, d) => ({
      messages: acc.messages + (d.messages || 0),
      tokens: acc.tokens + (d.tokens || 0),
      costUsd: acc.costUsd + (d.costUsd || 0),
    }),
    { messages: 0, tokens: 0, costUsd: 0 }
  );

  const avgLatency = metrics.length > 0
    ? Math.round(metrics.reduce((s, d) => s + (d.avgLatencyMs || 0), 0) / metrics.length)
    : 0;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Usage & Limits</h1>
          <p className="page-desc">Monitor your token consumption, costs, and latency over the last 7 days.</p>
        </div>
        <span className="usage-date-range">Oct 25 — Oct 31, 2026</span>
      </div>

      {/* Error state */}
      {error && (
        <div className="empty-state">
          <div className="empty-state-icon empty-state-icon-danger">
            <AlertCircle size={24} />
          </div>
          <div className="empty-state-title">Failed to load usage data</div>
          <div className="empty-state-desc">{error}</div>
          <button
            type="button"
            className="btn btn-secondary btn-with-icon empty-state-cta"
            onClick={() => { setError(null); setLoading(false); }}
          >
            <RefreshCw size={14} /> Retry
          </button>
        </div>
      )}

      {/* Loading state */}
      {!error && loading && (
        <div>
          <div className="metrics-grid">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="metric-card">
                <Skeleton height={14} width="50%" />
                <Skeleton height={28} width="70%" style={{ marginTop: 8 }} />
              </div>
            ))}
          </div>
          <div className="usage-charts-grid" style={{ marginTop: 20 }}>
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="chart-wrapper">
                <Skeleton height={180} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Normal display */}
      {!error && !loading && (
        <>
          {/* Metrics */}
          <div className="metrics-grid">
            <MetricCard
              icon={MessageSquare}
              label="Total Messages"
              value={totals.messages.toLocaleString()}
              sub="+12% vs last week"
              color="var(--accent)"
            />
            <MetricCard
              icon={Cpu}
              label="Total Tokens"
              value={`${(totals.tokens / 1_000_000).toFixed(2)}M`}
              sub="Input + Output"
              color="var(--info)"
            />
            <MetricCard
              icon={DollarSign}
              label="Est. Cost"
              value={`$${totals.costUsd.toFixed(2)}`}
              sub="Based on list pricing"
              color="var(--success)"
            />
            <MetricCard
              icon={Clock}
              label="Avg Latency"
              value={`${avgLatency}ms`}
              sub="Time to first token"
              color="var(--warning)"
            />
          </div>

          {/* Charts */}
          <div className="usage-charts-grid">
            <BarChart
              data={metrics}
              valueKey="messages"
              label="Daily Messages"
              color="var(--accent)"
            />
            <BarChart
              data={metrics}
              valueKey="tokens"
              label="Daily Tokens"
              color="var(--info)"
              formatValue={(v) => `${(v / 1000).toFixed(0)}k`}
            />
            <BarChart
              data={metrics}
              valueKey="costUsd"
              label="Daily Cost ($)"
              color="var(--success)"
              formatValue={(v) => `$${v.toFixed(2)}`}
            />
            <BarChart
              data={metrics}
              valueKey="avgLatencyMs"
              label="Avg Latency (ms)"
              color="var(--warning)"
            />
          </div>

          {/* Rate limits */}
          <div className="usage-limits-card">
            <div className="usage-limits-title">
              Rate Limits
            </div>
            {[
              { label: "Requests / min", used: 42, limit: 120, unit: "req/min" },
              { label: "Tokens / day",   used: 790000, limit: 2000000, unit: "tokens" },
              { label: "Crawl pages / day", used: 84, limit: 500, unit: "pages" },
            ].map((r) => {
              const pct = (r.used / r.limit) * 100;
              return (
                <div key={r.label} className="usage-limit-item">
                  <div className="usage-limit-header">
                    <span>{r.label}</span>
                    <span className="usage-limit-mono">
                      {r.used.toLocaleString()} / {r.limit.toLocaleString()} {r.unit}
                    </span>
                  </div>
                  <div className="progress-track">
                    <div
                      className="progress-fill usage-progress-fill"
                      style={{
                        "--pct": `${pct}%`,
                        "--fill-color": pct > 80 ? "var(--danger)" : pct > 60 ? "var(--warning)" : "var(--accent)",
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
