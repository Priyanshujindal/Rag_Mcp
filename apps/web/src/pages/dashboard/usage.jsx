import React, { useState, useEffect } from "react";
import {
  MessageSquare,
  Cpu,
  DollarSign,
  Clock,
  AlertCircle,
  RefreshCw,
  Shield,
  HardDrive,
  Globe,
  Wrench,
  FileText,
  Bot,
  Layers,
  ChevronRight,
  Filter,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Info,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  getUsageOverview,
  getUsageAnalytics,
  getUsageHistory,
  getMockUsageMetrics,
} from "@/lib/api";
import "./usage.css";

function formatTokens(num) {
  if (num === null || num === undefined) return "0";
  const n = Number(num);
  if (isNaN(n) || n === 0) return "0";
  if (n >= 1000000) return `${(n / 1000000).toFixed(2)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return n.toLocaleString();
}

function getStatusBadge(status) {
  switch (status) {
    case "exceeded":
      return <span className="usage-badge-danger">Limit Reached</span>;
    case "near_limit":
      return <span className="usage-badge-warning">Near Limit</span>;
    case "approaching":
      return <span className="usage-badge-warning">Approaching</span>;
    default:
      return <span className="usage-badge-normal">Normal</span>;
  }
}

function getProgressColor(status, pct) {
  if (status === "exceeded" || pct >= 100) return "#ef4444";
  if (status === "near_limit" || pct >= 90) return "#f59e0b";
  if (status === "approaching" || pct >= 70) return "#eab308";
  return "#6366f1";
}

function BarChart({ data, valueKey, label, color = "#6366f1", formatValue }) {
  if (!Array.isArray(data) || data.length === 0) {
    return (
      <div style={{ padding: "40px 20px", textAlign: "center", color: "var(--text-muted)", fontSize: "13px" }}>
        No chart activity recorded for this period yet.
      </div>
    );
  }
  const max = Math.max(...data.map((d) => Number(d?.[valueKey]) || 0), 1);

  return (
    <div className="usage-chart-card">
      <div className="usage-chart-header">
        <span className="usage-chart-title">{label}</span>
      </div>
      <div className="bar-chart-container">
        {data.map((d, i) => {
          const val = Number(d?.[valueKey]) || 0;
          const pct = max > 0 ? (val / max) * 100 : 0;
          const rawDate = d && d.date != null ? String(d.date) : `D${i + 1}`;
          const shortDate = rawDate.includes(" ")
            ? rawDate.split(" ")[1]
            : rawDate.includes("-")
            ? rawDate.split("-").slice(-2).join("/")
            : rawDate.slice(-2);
          return (
            <div key={i} className="bar-col" title={`${rawDate}: ${formatValue ? formatValue(val) : val}`}>
              <div
                className="bar-fill"
                style={{
                  height: `${Math.max(pct, 3)}%`,
                  backgroundColor: color,
                }}
              />
              <span className="bar-label">{shortDate}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function UsagePage() {
  const [activeTab, setActiveTab] = useState("overview");
  const [period, setPeriod] = useState("month");
  const [overview, setOverview] = useState(null);
  const [analytics, setAnalytics] = useState(null);
  const [history, setHistory] = useState(null);
  const [historyCategory, setHistoryCategory] = useState("all");
  const [historyPage, setHistoryPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [ovRes, anRes] = await Promise.all([
        getUsageOverview({ period }).catch(() => null),
        getUsageAnalytics({ days: period === "30d" ? 30 : 7 }).catch(() => null),
      ]);

      if (ovRes) {
        setOverview(ovRes);
      } else {
        // Fallback to legacy structure
        const legacy = await getMockUsageMetrics();
        setOverview({
          plan: legacy.plan || {
            name: "Developer Plan (Local)",
            description: "Application-configured limits for local development.",
            isBillingActive: false,
          },
          metrics: legacy.metrics || {},
          warnings: legacy.warnings || [],
          storageDetails: {},
        });
      }

      if (anRes) {
        setAnalytics(anRes);
      }
    } catch (err) {
      setError(err.message || "Failed to load usage data");
    } finally {
      setLoading(false);
    }
  };

  const fetchHistory = async () => {
    try {
      const res = await getUsageHistory({
        category: historyCategory !== "all" ? historyCategory : undefined,
        page: historyPage,
        limit: 25,
      });
      setHistory(res);
    } catch (err) {
      console.warn("Could not load usage history:", err);
    }
  };

  useEffect(() => {
    fetchData();
  }, [period]);

  useEffect(() => {
    if (activeTab === "history") {
      fetchHistory();
    }
  }, [activeTab, historyCategory, historyPage]);

  const metrics = overview?.metrics || {};
  const warnings = overview?.warnings || [];
  const plan = overview?.plan || {
    name: "Developer Plan (Local)",
    description: "Application-configured limits for local development.",
    isBillingActive: false,
  };
  const dailyMetrics = analytics?.dailyMetrics || [];

  return (
    <div className="usage-container">
      {/* Page Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Usage & Limits</h1>
          <p className="page-desc">
            Monitor real-time resource consumption, track AI token usage, and manage workspace quotas.
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <select
            className="input"
            style={{ width: "auto", fontSize: "13px", padding: "6px 12px" }}
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
          >
            <option value="today">Today</option>
            <option value="7d">Last 7 Days</option>
            <option value="30d">Last 30 Days</option>
            <option value="month">Current Month</option>
          </select>
          <button type="button" className="btn btn-secondary btn-icon" onClick={fetchData} title="Refresh metrics">
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      {/* Plan Banner */}
      <div className="usage-plan-banner">
        <div>
          <div className="usage-plan-title">
            <Shield size={18} style={{ color: "var(--primary, #6366f1)" }} />
            <span>{plan.name}</span>
            <Badge variant="neutral">Local Development</Badge>
          </div>
          <div className="usage-plan-desc">{plan.description}</div>
        </div>
        <div className="usage-plan-meta">
          <div>
            <strong>Billing Status:</strong> Local Only (No Paid Charges)
          </div>
          {plan.period?.resetAt && (
            <div>
              <strong>Monthly Reset:</strong> {new Date(plan.period.resetAt).toLocaleDateString()}
            </div>
          )}
        </div>
      </div>

      {/* Active Warning Alerts */}
      {warnings.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {warnings.map((w, idx) => (
            <div key={idx} className={`usage-warning-box ${w.level === "danger" ? "danger" : ""}`}>
              <AlertTriangle size={18} style={{ flexShrink: 0, marginTop: "2px" }} />
              <div>
                <strong>{w.label}:</strong> {w.message}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Navigation Tabs */}
      <div className="usage-tab-bar">
        {[
          { id: "overview", label: "Overview", icon: Layers },
          { id: "ai", label: "AI & Tokens", icon: Cpu },
          { id: "api", label: "Public API", icon: Globe },
          { id: "storage", label: "Storage & Docs", icon: HardDrive },
          { id: "mcp", label: "MCP & Tools", icon: Wrench },
          { id: "limits", label: "Limits & Quotas", icon: Shield },
          { id: "history", label: "Usage History", icon: Clock },
        ].map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              type="button"
              className={`usage-tab-btn ${activeTab === tab.id ? "active" : ""}`}
              onClick={() => setActiveTab(tab.id)}
            >
              <Icon size={14} /> {tab.label}
            </button>
          );
        })}
      </div>

      {/* Loading Skeleton */}
      {loading && (
        <div className="usage-cards-grid">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="usage-card">
              <Skeleton height={20} width="60%" />
              <Skeleton height={32} width="40%" />
              <Skeleton height={6} width="100%" />
            </div>
          ))}
        </div>
      )}

      {/* TAB 1: OVERVIEW */}
      {!loading && activeTab === "overview" && (
        <>
          <div className="usage-cards-grid">
            {/* AI Chat Requests */}
            {metrics.chatRequests && (
              <div className="usage-card">
                <div className="usage-card-top">
                  <span className="metric-label">AI Chat Requests</span>
                  <div className="usage-card-icon">
                    <MessageSquare size={16} />
                  </div>
                </div>
                <div className="usage-card-value">
                  {Number(metrics.chatRequests.used || 0).toLocaleString()}
                  <span style={{ fontSize: "14px", fontWeight: "400", color: "var(--text-muted)" }}>
                    {" "}
                    / {metrics.chatRequests.isUnlimited ? "Unlimited" : Number(metrics.chatRequests.limit || 0).toLocaleString()}
                  </span>
                </div>
                <div className="usage-progress-bar">
                  <div
                    className="usage-progress-value"
                    style={{
                      width: `${Math.min(100, metrics.chatRequests.percentConsumed)}%`,
                      backgroundColor: getProgressColor(metrics.chatRequests.status, metrics.chatRequests.percentConsumed),
                    }}
                  />
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span className="usage-card-sub">{metrics.chatRequests.percentConsumed}% consumed</span>
                  {getStatusBadge(metrics.chatRequests.status)}
                </div>
              </div>
            )}

            {/* AI Tokens Consumed */}
            {metrics.aiTokens && (
              <div className="usage-card">
                <div className="usage-card-top">
                  <span className="metric-label">AI Tokens Consumed</span>
                  <div className="usage-card-icon" style={{ background: "rgba(14, 165, 233, 0.12)", color: "#0ea5e9" }}>
                    <Cpu size={16} />
                  </div>
                </div>
                <div className="usage-card-value">
                  {formatTokens(metrics.aiTokens.used)}
                  <span style={{ fontSize: "14px", fontWeight: "400", color: "var(--text-muted)" }}>
                    {" "}
                    / {metrics.aiTokens.isUnlimited ? "Unlimited" : formatTokens(metrics.aiTokens.limit)}
                  </span>
                </div>
                <div className="usage-progress-bar">
                  <div
                    className="usage-progress-value"
                    style={{
                      width: `${Math.min(100, metrics.aiTokens.percentConsumed)}%`,
                      backgroundColor: getProgressColor(metrics.aiTokens.status, metrics.aiTokens.percentConsumed),
                    }}
                  />
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span className="usage-card-sub">{metrics.aiTokens.percentConsumed}% consumed</span>
                  {getStatusBadge(metrics.aiTokens.status)}
                </div>
              </div>
            )}

            {/* Storage Consumed */}
            {metrics.storage && (
              <div className="usage-card">
                <div className="usage-card-top">
                  <span className="metric-label">{metrics.storage.label || "Project Storage"}</span>
                  <div className="usage-card-icon" style={{ background: "rgba(16, 185, 129, 0.12)", color: "#10b981" }}>
                    <HardDrive size={16} />
                  </div>
                </div>
                <div className="usage-card-value">
                  {metrics.storage.used} MB
                  <span style={{ fontSize: "14px", fontWeight: "400", color: "var(--text-muted)" }}>
                    {" "}
                    / {metrics.storage.isUnlimited ? "Unlimited" : `${metrics.storage.limit} MB`}
                  </span>
                </div>
                <div className="usage-progress-bar">
                  <div
                    className="usage-progress-value"
                    style={{
                      width: `${Math.min(100, metrics.storage.percentConsumed)}%`,
                      backgroundColor: getProgressColor(metrics.storage.status, metrics.storage.percentConsumed),
                    }}
                  />
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span className="usage-card-sub">{metrics.storage.percentConsumed}% consumed</span>
                  {getStatusBadge(metrics.storage.status)}
                </div>
              </div>
            )}

            {/* Public API Requests */}
            {metrics.publicApiRequests && (
              <div className="usage-card">
                <div className="usage-card-top">
                  <span className="metric-label">Public API Requests</span>
                  <div className="usage-card-icon" style={{ background: "rgba(245, 158, 11, 0.12)", color: "#f59e0b" }}>
                    <Globe size={16} />
                  </div>
                </div>
                <div className="usage-card-value">
                  {Number(metrics.publicApiRequests.used || 0).toLocaleString()}
                  <span style={{ fontSize: "14px", fontWeight: "400", color: "var(--text-muted)" }}>
                    {" "}
                    / {metrics.publicApiRequests.isUnlimited ? "Unlimited" : Number(metrics.publicApiRequests.limit || 0).toLocaleString()}
                  </span>
                </div>
                <div className="usage-progress-bar">
                  <div
                    className="usage-progress-value"
                    style={{
                      width: `${Math.min(100, metrics.publicApiRequests.percentConsumed)}%`,
                      backgroundColor: getProgressColor(metrics.publicApiRequests.status, metrics.publicApiRequests.percentConsumed),
                    }}
                  />
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span className="usage-card-sub">{metrics.publicApiRequests.percentConsumed}% consumed</span>
                  {getStatusBadge(metrics.publicApiRequests.status)}
                </div>
              </div>
            )}

            {/* MCP Tool Calls */}
            {metrics.mcpToolCalls && (
              <div className="usage-card">
                <div className="usage-card-top">
                  <span className="metric-label">MCP Tool Executions</span>
                  <div className="usage-card-icon" style={{ background: "rgba(168, 85, 247, 0.12)", color: "#a855f7" }}>
                    <Wrench size={16} />
                  </div>
                </div>
                <div className="usage-card-value">
                  {Number(metrics.mcpToolCalls.used || 0).toLocaleString()}
                  <span style={{ fontSize: "14px", fontWeight: "400", color: "var(--text-muted)" }}>
                    {" "}
                    / {metrics.mcpToolCalls.isUnlimited ? "Unlimited" : Number(metrics.mcpToolCalls.limit || 0).toLocaleString()}
                  </span>
                </div>
                <div className="usage-progress-bar">
                  <div
                    className="usage-progress-value"
                    style={{
                      width: `${Math.min(100, metrics.mcpToolCalls.percentConsumed)}%`,
                      backgroundColor: getProgressColor(metrics.mcpToolCalls.status, metrics.mcpToolCalls.percentConsumed),
                    }}
                  />
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span className="usage-card-sub">{metrics.mcpToolCalls.percentConsumed}% consumed</span>
                  {getStatusBadge(metrics.mcpToolCalls.status)}
                </div>
              </div>
            )}

            {/* Document Sources */}
            {metrics.documents && (
              <div className="usage-card">
                <div className="usage-card-top">
                  <span className="metric-label">Document Sources</span>
                  <div className="usage-card-icon">
                    <FileText size={16} />
                  </div>
                </div>
                <div className="usage-card-value">
                  {Number(metrics.documents.used || 0).toLocaleString()}
                  <span style={{ fontSize: "14px", fontWeight: "400", color: "var(--text-muted)" }}>
                    {" "}
                    / {metrics.documents.isUnlimited ? "Unlimited" : Number(metrics.documents.limit || 0).toLocaleString()}
                  </span>
                </div>
                <div className="usage-progress-bar">
                  <div
                    className="usage-progress-value"
                    style={{
                      width: `${Math.min(100, metrics.documents.percentConsumed)}%`,
                      backgroundColor: getProgressColor(metrics.documents.status, metrics.documents.percentConsumed),
                    }}
                  />
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span className="usage-card-sub">{metrics.documents.percentConsumed}% consumed</span>
                  {getStatusBadge(metrics.documents.status)}
                </div>
              </div>
            )}
          </div>

          {/* Quick Charts */}
          <div className="usage-charts-grid" style={{ marginTop: "16px" }}>
            <BarChart
              data={dailyMetrics}
              valueKey="messages"
              label="Daily Chat Messages"
              color="#6366f1"
            />
            <BarChart
              data={dailyMetrics}
              valueKey="tokens"
              label="Daily Tokens Processed"
              color="#0ea5e9"
              formatValue={(v) => formatTokens(v)}
            />
          </div>
        </>
      )}

      {/* TAB 2: AI & TOKENS */}
      {!loading && activeTab === "ai" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
          <div className="usage-charts-grid">
            <BarChart
              data={dailyMetrics}
              valueKey="inputTokens"
              label="Prompt / Input Tokens"
              color="#0ea5e9"
              formatValue={(v) => formatTokens(v)}
            />
            <BarChart
              data={dailyMetrics}
              valueKey="outputTokens"
              label="Completion / Output Tokens"
              color="#10b981"
              formatValue={(v) => formatTokens(v)}
            />
          </div>

          <div className="card">
            <h3 style={{ fontSize: "15px", fontWeight: "600", marginBottom: "12px" }}>
              Active AI Providers & Models
            </h3>
            {analytics?.breakdown?.models?.length > 0 ? (
              <div className="usage-table-wrapper">
                <table className="usage-table">
                  <thead>
                    <tr>
                      <th>Model Identifier</th>
                      <th>Requests Recorded</th>
                      <th>Total Tokens</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analytics.breakdown.models.map((m, idx) => (
                      <tr key={idx}>
                        <td><code>{m.model}</code></td>
                        <td>{m.requests.toLocaleString()}</td>
                        <td>{formatTokens(m.tokens)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div style={{ color: "var(--text-muted)", fontSize: "13px", padding: "10px 0" }}>
                No model-specific telemetry recorded yet for this period.
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 3: PUBLIC API */}
      {!loading && activeTab === "api" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
          <div className="usage-charts-grid">
            <BarChart
              data={dailyMetrics}
              valueKey="publicApiRequests"
              label="Public API Invocations (rag_pk_ & rag_sk_)"
              color="#f59e0b"
            />
            <BarChart
              data={dailyMetrics}
              valueKey="messages"
              label="Internal Dashboard Chat Invocations"
              color="#6366f1"
            />
          </div>
          <div className="card">
            <h3 style={{ fontSize: "15px", fontWeight: "600", marginBottom: "8px" }}>
              Public API Quota & Enforcement
            </h3>
            <p style={{ fontSize: "13px", color: "var(--text-secondary)", lineHeight: 1.6 }}>
              External chatbot calls authenticated using platform API keys (<code>rag_pk_live_...</code> and <code>rag_sk_live_...</code>) are metered against your workspace's public API quota of{" "}
              <strong>{metrics.publicApiRequests?.limit?.toLocaleString() || "10,000"} req/month</strong> and an allowed velocity of <strong>120 requests/minute</strong>.
            </p>
          </div>
        </div>
      )}

      {/* TAB 4: STORAGE & DOCUMENTS */}
      {!loading && activeTab === "storage" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
          <div className="card">
            <h3 style={{ fontSize: "15px", fontWeight: "600", marginBottom: "6px" }}>
              Workspace Storage Space
            </h3>
            <p style={{ fontSize: "13px", color: "var(--text-secondary)", marginBottom: "16px", lineHeight: 1.6 }}>
              Storage is metered for your workspace ({overview?.storageDetails?.usedMb || 0} MB of <strong>{overview?.storageDetails?.limitMb || 50} MB</strong> quota). It includes your extracted document text, vector chunks, and generated artifacts.
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "16px" }}>
              <div className="card" style={{ background: "rgba(255, 255, 255, 0.02)" }}>
                <div style={{ fontSize: "12px", color: "var(--text-muted)" }}>Storage Used</div>
                <div style={{ fontSize: "20px", fontWeight: "700", marginTop: "4px" }}>
                  {overview?.storageDetails?.usedMb || 0} MB
                  <span style={{ fontSize: "13px", fontWeight: "400", color: "var(--text-muted)", marginLeft: "4px" }}>
                    / {overview?.storageDetails?.limitMb || 50} MB
                  </span>
                </div>
              </div>
              <div className="card" style={{ background: "rgba(255, 255, 255, 0.02)" }}>
                <div style={{ fontSize: "12px", color: "var(--text-muted)" }}>Extracted Doc Text</div>
                <div style={{ fontSize: "20px", fontWeight: "700", marginTop: "4px" }}>
                  {((overview?.storageDetails?.sourceCharBytes || 0) / (1024 * 1024)).toFixed(2)} MB
                </div>
              </div>
              <div className="card" style={{ background: "rgba(255, 255, 255, 0.02)" }}>
                <div style={{ fontSize: "12px", color: "var(--text-muted)" }}>Vector Chunks Cached</div>
                <div style={{ fontSize: "20px", fontWeight: "700", marginTop: "4px" }}>
                  {overview?.storageDetails?.totalChunks || 0} chunks
                </div>
              </div>
              <div className="card" style={{ background: "rgba(255, 255, 255, 0.02)" }}>
                <div style={{ fontSize: "12px", color: "var(--text-muted)" }}>Generated Artifacts</div>
                <div style={{ fontSize: "20px", fontWeight: "700", marginTop: "4px" }}>
                  {((overview?.storageDetails?.artifactBytes || 0) / (1024 * 1024)).toFixed(2)} MB
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 5: MCP & TOOLS */}
      {!loading && activeTab === "mcp" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
          <div className="usage-charts-grid">
            <BarChart
              data={dailyMetrics}
              valueKey="mcpCalls"
              label="Daily MCP Tool Executions"
              color="#a855f7"
            />
          </div>
          <div className="card">
            <h3 style={{ fontSize: "15px", fontWeight: "600", marginBottom: "8px" }}>
              MCP Quota Policy
            </h3>
            <p style={{ fontSize: "13px", color: "var(--text-secondary)", lineHeight: 1.6 }}>
              Tools invoked by the AI agent (e.g. SQL querying, web retrieval, Slack, Linear) consume MCP executions. Your plan allows up to{" "}
              <strong>{metrics.mcpToolCalls?.limit?.toLocaleString() || "2,000"} executions/month</strong> with a velocity cap of <strong>60 executions/minute</strong>.
            </p>
          </div>
        </div>
      )}

      {/* TAB 6: LIMITS & QUOTAS TABLE */}
      {!loading && activeTab === "limits" && (
        <div className="card">
          <div style={{ marginBottom: "16px" }}>
            <h3 style={{ fontSize: "16px", fontWeight: "700" }}>Workspace Limit & Quota Matrix</h3>
            <p style={{ fontSize: "13px", color: "var(--text-secondary)", marginTop: "4px" }}>
              These quotas are actively enforced on the server. Operations exceeding hard limits return a structured 403 / QUOTA_EXCEEDED response.
            </p>
          </div>

          <div className="usage-table-wrapper">
            <table className="usage-table">
              <thead>
                <tr>
                  <th>Resource Metric</th>
                  <th>Current Consumption</th>
                  <th>Configured Limit</th>
                  <th>Remaining</th>
                  <th>Consumed %</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(metrics).map(([key, item]) => {
                  if (!item) return null;
                  const usedVal = Number(item.used ?? 0);
                  const limitVal = Number(item.limit ?? 0);
                  const remainingVal = Number(item.remaining ?? 0);
                  const pct = Number(item.percentConsumed ?? 0);
                  return (
                    <tr key={key}>
                      <td>
                        <div style={{ fontWeight: "600" }}>{item.label || key}</div>
                        <div style={{ fontSize: "11px", color: "var(--text-muted)" }}>{item.description || ""}</div>
                      </td>
                      <td>{usedVal.toLocaleString()} {item.unit || ""}</td>
                      <td>{item.isUnlimited ? "Unlimited" : `${limitVal.toLocaleString()} ${item.unit || ""}`}</td>
                      <td>{item.isUnlimited ? "—" : `${remainingVal.toLocaleString()} ${item.unit || ""}`}</td>
                      <td>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                          <div className="usage-progress-bar" style={{ width: "80px" }}>
                            <div
                              className="usage-progress-value"
                              style={{
                                width: `${Math.min(100, Math.max(0, pct))}%`,
                                backgroundColor: getProgressColor(item.status, pct),
                              }}
                            />
                          </div>
                          <span style={{ fontSize: "12px" }}>{pct}%</span>
                        </div>
                      </td>
                      <td>{getStatusBadge(item.status)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 7: USAGE HISTORY LOG */}
      {!loading && activeTab === "history" && (
        <div className="card">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px", flexWrap: "wrap", gap: "10px" }}>
            <div>
              <h3 style={{ fontSize: "16px", fontWeight: "700" }}>Usage Event Audit Log</h3>
              <p style={{ fontSize: "13px", color: "var(--text-secondary)", marginTop: "2px" }}>
                Canonical event stream for all metered operations. All private prompts and secrets are redacted.
              </p>
            </div>
            <div style={{ display: "flex", gap: "8px" }}>
              {["all", "ai", "public_api", "mcp", "storage"].map((cat) => (
                <button
                  key={cat}
                  type="button"
                  className={`btn btn-sm ${historyCategory === cat ? "btn-primary" : "btn-secondary"}`}
                  onClick={() => { setHistoryCategory(cat); setHistoryPage(1); }}
                >
                  {cat.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          <div className="usage-table-wrapper">
            <table className="usage-table">
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Event Type</th>
                  <th>Category</th>
                  <th>Model / Tool</th>
                  <th>Tokens</th>
                  <th>Duration</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {history?.data?.length > 0 ? (
                  history.data.map((ev) => (
                    <tr key={ev.id || ev._id}>
                      <td style={{ fontSize: "12px", color: "var(--text-muted)" }}>
                        {new Date(ev.createdAt).toLocaleString()}
                      </td>
                      <td><code>{ev.eventType}</code></td>
                      <td><Badge variant="neutral">{ev.category}</Badge></td>
                      <td>{ev.model || ev.toolName || "—"}</td>
                      <td>{ev.tokens?.totalTokens ? formatTokens(ev.tokens.totalTokens) : "—"}</td>
                      <td>{ev.durationMs ? `${ev.durationMs}ms` : "—"}</td>
                      <td>
                        {ev.status === "success" ? (
                          <Badge variant="success">Success</Badge>
                        ) : ev.status === "rate_limited" ? (
                          <Badge variant="warning">Rate Limited</Badge>
                        ) : (
                          <Badge variant="danger">Failed</Badge>
                        )}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={7} style={{ textAlign: "center", padding: "40px", color: "var(--text-muted)" }}>
                      No usage events recorded in this category yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {history?.pagination?.totalPages > 1 && (
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "16px" }}>
              <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>
                Page {history.pagination.page} of {history.pagination.totalPages} ({history.pagination.total} total events)
              </span>
              <div style={{ display: "flex", gap: "6px" }}>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={historyPage <= 1}
                  onClick={() => setHistoryPage((p) => Math.max(1, p - 1))}
                >
                  Previous
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={historyPage >= history.pagination.totalPages}
                  onClick={() => setHistoryPage((p) => p + 1)}
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
