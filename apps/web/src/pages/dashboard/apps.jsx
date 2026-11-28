import React, { useState, useEffect, useMemo } from "react";
import {
  Search,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  Settings,
  Trash2,
  RefreshCw,
  Mail,
  HardDrive,
  Calendar,
  FileText,
  Github,
  MessageSquare,
  CheckSquare,
  Layers,
  Cloud,
  Key,
  Shield,
  Loader2,
  Plug,
  Zap,
  Plus,
  Terminal,
  Globe,
  Power,
  Wrench,
} from "lucide-react";
import { Link } from "react-router-dom";
import AddMcpModal from "@/components/AddMcpModal";
import {
  getIntegrationsCatalog,
  authorizeIntegration,
  callbackIntegration,
  connectIntegrationToken,
  demoConnectIntegration,
  updateConnectedAccount,
  testConnectedAccount,
  disconnectAccount,
  getMockMcpServers,
  connectMcpServer,
  disconnectMcpServer,
  deleteMcpServer,
  refreshMcpTools,
  toggleMcpTool,
  testMcpConnection,
} from "@/lib/api";
import "./mcp.css";
import "./apps.css";

function getAppIcon(id, size = 22, app = null) {
  if (app?.isCustomMcp) {
    const isRemote =
      app.mcpServer?.transport?.toLowerCase().includes("http") ||
      app.mcpServer?.transport?.toLowerCase().includes("sse");
    return isRemote ? (
      <Globe size={size} className="icon-mcp" />
    ) : (
      <Terminal size={size} className="icon-mcp" />
    );
  }
  switch (id) {
    case "gmail":
      return <Mail size={size} className="icon-gmail" />;
    case "google_drive":
      return <HardDrive size={size} className="icon-drive" />;
    case "google_calendar":
      return <Calendar size={size} className="icon-calendar" />;
    case "notion":
      return <FileText size={size} className="icon-notion" />;
    case "github":
      return <Github size={size} className="icon-github" />;
    case "slack":
      return <MessageSquare size={size} className="icon-slack" />;
    case "linear":
      return <CheckSquare size={size} className="icon-linear" />;
    case "microsoft_outlook":
      return <Mail size={size} className="icon-ms" />;
    case "microsoft_onedrive":
      return <Cloud size={size} className="icon-ms" />;
    case "jira":
      return <Layers size={size} className="icon-jira" />;
    default:
      return <Plug size={size} />;
  }
}

export default function AppsMarketplacePage() {
  const [catalog, setCatalog] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("All");
  const [statusFilter, setStatusFilter] = useState("all"); // 'all' | 'connected' | 'available'

  // Modals state
  const [connectModalApp, setConnectModalApp] = useState(null);
  const [manageModalConn, setManageModalConn] = useState(null);
  const [manageModalMcp, setManageModalMcp] = useState(null);
  const [showAddMcpModal, setShowAddMcpModal] = useState(false);
  const [togglingMcpId, setTogglingMcpId] = useState(null);
  const [connectTab, setConnectTab] = useState("oauth"); // 'oauth' | 'token'
  const [tokenInput, setTokenInput] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [testingConn, setTestingConn] = useState(false);

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);
      const [catalogData, mcpServersData] = await Promise.all([
        getIntegrationsCatalog().catch(() => []),
        getMockMcpServers().catch(() => []),
      ]);

      const customMcpApps = (Array.isArray(mcpServersData) ? mcpServersData : [])
        .filter((srv) => srv.type !== "builtin" && srv.name !== "Builtin System Tools")
        .map((srv) => {
          const tools = srv.tools || [];
          const isConnected = (srv.status || "").toLowerCase() === "connected";
          return {
            id: srv._id || srv.id,
            name: srv.name,
            category: "Custom MCP",
            description:
              srv.description ||
              (srv.command
                ? `${srv.command} ${(srv.args || []).join(" ")}`.trim()
                : srv.url) ||
              "Custom Model Context Protocol Server",
            isCustomMcp: true,
            mcpServer: srv,
            isConnected,
            status: isConnected ? "connected" : "available",
            capabilities: tools
              .slice(0, 3)
              .map((t) => `${t.name}: ${t.description || "MCP Tool"}`),
            tools,
          };
        });

      const merged = [
        ...(Array.isArray(catalogData) ? catalogData : []),
        ...customMcpApps,
      ];
      setCatalog(merged);

      // Keep open manageModalMcp in sync if refreshed
      if (manageModalMcp) {
        const updated = customMcpApps.find((a) => a.id === manageModalMcp.id);
        if (updated) setManageModalMcp(updated);
      }
    } catch (err) {
      setError(err.message || "Failed to load apps catalog");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Check if redirected back from OAuth provider with code & state
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const state = params.get("state");

    if (code) {
      const finishOAuth = async () => {
        try {
          setLoading(true);
          // Try to match integration from state or catalog
          const integrationId = window.localStorage.getItem("last_oauth_app") || "gmail";
          await callbackIntegration(integrationId, {
            code,
            state,
            redirectUri: window.location.origin + "/dashboard/apps",
          });
          // Clean query params from browser URL
          window.history.replaceState({}, document.title, window.location.pathname);
          window.localStorage.removeItem("last_oauth_app");
        } catch (err) {
          console.error("OAuth callback error:", err);
          setError(`OAuth authentication error: ${err.message}`);
        } finally {
          await loadData();
        }
      };
      finishOAuth();
    } else {
      loadData();
    }
  }, []);

  const categories = useMemo(() => {
    const set = new Set(["All"]);
    catalog.forEach((item) => {
      if (item.category) set.add(item.category);
    });
    return Array.from(set);
  }, [catalog]);

  const filteredCatalog = useMemo(() => {
    return catalog.filter((app) => {
      const matchesSearch =
        app.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        app.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
        app.category.toLowerCase().includes(searchQuery.toLowerCase());

      const matchesCategory =
        selectedCategory === "All" || app.category === selectedCategory;

      const matchesStatus =
        statusFilter === "all" ||
        (statusFilter === "connected" && app.isConnected) ||
        (statusFilter === "available" && !app.isConnected && app.status !== "coming_soon");

      return matchesSearch && matchesCategory && matchesStatus;
    });
  }, [catalog, searchQuery, selectedCategory, statusFilter]);

  const connectedCount = useMemo(() => {
    return catalog.filter((c) => c.isConnected).length;
  }, [catalog]);

  // Handle OAuth Connect
  const handleOAuthConnect = async (app) => {
    setConnecting(true);
    try {
      window.localStorage.setItem("last_oauth_app", app.id);
      const res = await authorizeIntegration(app.id, {
        redirectUri: window.location.origin + "/dashboard/apps",
      });
      if (res?.authUrl) {
        window.location.href = res.authUrl;
      } else if (res?.isConfigured === false) {
        alert(
          `${res.message || "OAuth credentials not configured in .env."}\n\nYou can click "Connect in Demo / Sandbox Mode (Instant)" to test all ${app.name} tools right now without Google Cloud setup!`
        );
      }
    } catch (err) {
      alert(`Connection failed: ${err.message}`);
    } finally {
      setConnecting(false);
    }
  };

  // Handle Demo / Sandbox Instant Connect
  const handleDemoConnect = async (app) => {
    setConnecting(true);
    try {
      await demoConnectIntegration(app.id, {
        accountEmail: app.id === "gmail" ? "priyanshujindal.demo@gmail.com" : `${app.id}_demo@rag-mcp.ai`,
        displayName: `${app.name} (Demo Sandbox)`,
      });
      setConnectModalApp(null);
      await loadData();
    } catch (err) {
      alert(`Demo connection failed: ${err.message}`);
    } finally {
      setConnecting(false);
    }
  };

  // Handle Token Connect
  const handleTokenConnect = async (e) => {
    e.preventDefault();
    if (!tokenInput.trim() || !connectModalApp) return;

    setConnecting(true);
    try {
      await connectIntegrationToken({
        integrationId: connectModalApp.id,
        token: tokenInput.trim(),
        displayName: `${connectModalApp.name} Account`,
      });
      setConnectModalApp(null);
      setTokenInput("");
      await loadData();
    } catch (err) {
      alert(`Token connection failed: ${err.message}`);
    } finally {
      setConnecting(false);
    }
  };

  // Handle Disconnect
  const handleDisconnect = async (connectionId) => {
    if (!window.confirm("Are you sure you want to disconnect this account?")) return;
    try {
      await disconnectAccount(connectionId);
      setManageModalConn(null);
      await loadData();
    } catch (err) {
      alert(`Failed to disconnect: ${err.message}`);
    }
  };

  // Handle Test Connection
  const handleTestConnection = async (connId) => {
    setTestingConn(true);
    setTestResult(null);
    try {
      const res = await testConnectedAccount(connId);
      setTestResult({ success: true, message: `Connected & healthy. Verified for ${res.account || res.email}.` });
    } catch (err) {
      setTestResult({ success: false, message: err.message });
    } finally {
      setTestingConn(false);
    }
  };

  // Handle Tool Permission Toggle
  const handleToolPermissionToggle = async (conn, toolName, newPermission) => {
    try {
      const toolSettings = {
        [toolName]: {
          enabled: newPermission !== "deny",
          permission: newPermission,
        },
      };
      await updateConnectedAccount(conn._id || conn.id, { toolSettings });
      await loadData();
      if (manageModalConn) {
        setManageModalConn((prev) => ({
          ...prev,
          toolSettings: {
            ...(prev.toolSettings || {}),
            [toolName]: { enabled: newPermission !== "deny", permission: newPermission },
          },
        }));
      }
    } catch (err) {
      alert(`Failed to update tool setting: ${err.message}`);
    }
  };

  // Custom MCP App Handlers
  const handleMcpConnectToggle = async (app) => {
    setTogglingMcpId(app.id);
    try {
      if (app.isConnected) {
        await disconnectMcpServer(app.id);
      } else {
        await connectMcpServer(app.id);
      }
      await loadData();
    } catch (err) {
      alert(`Connection toggle failed: ${err.message}`);
    } finally {
      setTogglingMcpId(null);
    }
  };

  const handleMcpToolPermission = async (app, toolName, newPermission) => {
    try {
      const enabled = newPermission !== "deny";
      const requiresApproval = newPermission === "always_ask";
      await toggleMcpTool(app.id, toolName, {
        enabled,
        permission: newPermission,
        requiresApproval,
      });
      setManageModalMcp((prev) =>
        prev && prev.id === app.id
          ? {
              ...prev,
              tools: (prev.tools || []).map((t) =>
                t.name === toolName
                  ? { ...t, enabled, permission: newPermission, requiresApproval }
                  : t
              ),
            }
          : prev
      );
      await loadData();
    } catch (err) {
      alert(`Failed to update MCP tool setting: ${err.message}`);
    }
  };

  const handleMcpTest = async (appId) => {
    setTestingConn(true);
    setTestResult(null);
    try {
      const res = await testMcpConnection(appId);
      setTestResult({
        success: res?.success !== false,
        message:
          res?.success !== false
            ? `Connected & healthy. Discovered ${res.toolCount || 0} tools.`
            : res.error || "Connection test failed",
      });
    } catch (err) {
      setTestResult({ success: false, message: err.message });
    } finally {
      setTestingConn(false);
    }
  };

  const handleMcpRefresh = async (appId) => {
    setTestingConn(true);
    setTestResult(null);
    try {
      const updated = await refreshMcpTools(appId);
      setTestResult({
        success: true,
        message: `Refreshed capabilities. Found ${updated?.tools?.length || 0} tools.`,
      });
      await loadData();
    } catch (err) {
      setTestResult({ success: false, message: err.message });
    } finally {
      setTestingConn(false);
    }
  };

  const handleMcpDelete = async (app) => {
    if (!window.confirm(`Are you sure you want to remove custom MCP app "${app.name}"?`)) return;
    try {
      await deleteMcpServer(app.id);
      setManageModalMcp(null);
      await loadData();
    } catch (err) {
      alert(`Failed to delete custom MCP app: ${err.message}`);
    }
  };

  return (
    <div className="apps-marketplace-container">
      {/* Header Banner */}
      <div className="apps-header">
        <div className="apps-header-content">
          <div className="apps-title-row">
            <h1 className="apps-title">Connected Apps & Integrations</h1>
            <span className="apps-counter-pill">
              <Plug size={14} /> {connectedCount} Connected
            </span>
            <button
              type="button"
              className="btn-add-custom-mcp"
              onClick={() => setShowAddMcpModal(true)}
            >
              <Plus size={15} /> Add Custom MCP App
            </button>
          </div>
          <p className="apps-subtitle">
            Supercharge your AI assistant with connected tools like Gmail, Google Drive, Notion, GitHub, and Slack to search, read, analyze, and execute actions with precision.
          </p>
        </div>

        {/* Search & Status Filters */}
        <div className="apps-search-bar-row">
          <div className="apps-search-input-wrap">
            <Search size={18} className="search-icon" />
            <input
              type="text"
              placeholder="Search apps by name, capability, or category..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="apps-search-input"
            />
          </div>

          <div className="apps-status-tabs">
            <button
              className={`status-tab ${statusFilter === "all" ? "active" : ""}`}
              onClick={() => setStatusFilter("all")}
            >
              All Apps
            </button>
            <button
              className={`status-tab ${statusFilter === "connected" ? "active" : ""}`}
              onClick={() => setStatusFilter("connected")}
            >
              Connected ({connectedCount})
            </button>
            <button
              className={`status-tab ${statusFilter === "available" ? "active" : ""}`}
              onClick={() => setStatusFilter("available")}
            >
              Available
            </button>
          </div>
        </div>

        {/* Category Filter Chips */}
        <div className="apps-category-chips">
          {categories.map((cat) => (
            <button
              key={cat}
              className={`category-chip ${selectedCategory === cat ? "active" : ""}`}
              onClick={() => setSelectedCategory(cat)}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Main Content Area */}
      {loading ? (
        <div className="apps-loading-state">
          <Loader2 size={32} className="spin" />
          <p>Discovering available integrations and connected accounts...</p>
        </div>
      ) : error ? (
        <div className="apps-error-state">
          <AlertCircle size={28} />
          <p>{error}</p>
          <button onClick={loadData} className="btn-retry">
            <RefreshCw size={14} /> Retry
          </button>
        </div>
      ) : filteredCatalog.length === 0 ? (
        <div className="apps-empty-state">
          <Plug size={40} />
          <h3>No integrations found</h3>
          <p>Try searching for a different keyword or category.</p>
        </div>
      ) : (
        <div className="apps-grid">
          {filteredCatalog.map((app) => {
            const isComingSoon = app.status === "coming_soon";
            const firstConn = app.connections?.[0];

            return (
              <div key={app.id} className={`app-card ${app.isConnected ? "is-connected" : ""}`}>
                {/* Top card row */}
                <div className="app-card-header">
                  <div className="app-icon-badge">{getAppIcon(app.id, 22, app)}</div>
                  <div className="app-card-title-wrap">
                    <div className="app-name-row">
                      <h3 className="app-name">{app.name}</h3>
                      <span className={`app-category-pill ${app.isCustomMcp ? "mcp-cat-pill" : ""}`}>
                        {app.category}
                      </span>
                    </div>
                    {app.isConnected ? (
                      <span className="badge-connected">
                        <CheckCircle2 size={12} /> Connected
                      </span>
                    ) : isComingSoon ? (
                      <span className="badge-coming-soon">Coming Soon</span>
                    ) : (
                      <span className="badge-available">
                        {app.isCustomMcp ? "Disconnected" : "Available"}
                      </span>
                    )}
                  </div>
                </div>

                {/* Description */}
                <p className="app-description">{app.description}</p>

                {/* Capabilities list */}
                {app.capabilities && app.capabilities.length > 0 && (
                  <div className="app-capabilities-box">
                    <span className="capabilities-label">
                      {app.isCustomMcp ? `Discovered Tools (${app.tools?.length || 0}):` : "Capabilities:"}
                    </span>
                    <ul className="capabilities-list">
                      {app.capabilities.slice(0, 3).map((cap, i) => (
                        <li key={i}>{cap}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Card footer actions */}
                <div className="app-card-footer">
                  {app.isCustomMcp ? (
                    <div className="connected-actions-row">
                      <button
                        type="button"
                        className={`btn-mcp-power ${app.isConnected ? "is-on" : ""}`}
                        onClick={() => handleMcpConnectToggle(app)}
                        disabled={togglingMcpId === app.id}
                      >
                        {togglingMcpId === app.id ? (
                          <Loader2 size={13} className="spin" />
                        ) : (
                          <Power size={13} />
                        )}
                        {togglingMcpId === app.id
                          ? "Updating..."
                          : app.isConnected
                          ? "Disconnect"
                          : "Connect"}
                      </button>
                      <button
                        type="button"
                        className="btn-manage"
                        onClick={() => {
                          setManageModalMcp(app);
                          setTestResult(null);
                        }}
                      >
                        <Settings size={14} /> Manage
                      </button>
                    </div>
                  ) : app.isConnected ? (
                    <div className="connected-actions-row">
                      <div className="account-tag" title={firstConn?.accountEmail}>
                        {firstConn?.accountDisplayName || firstConn?.accountEmail || "Active Account"}
                      </div>
                      <button
                        className="btn-manage"
                        onClick={() => {
                          setManageModalConn({ ...firstConn, app });
                          setTestResult(null);
                        }}
                      >
                        <Settings size={14} /> Manage
                      </button>
                    </div>
                  ) : isComingSoon ? (
                    <button className="btn-disabled" disabled>
                      Coming Soon
                    </button>
                  ) : (
                    <button
                      className="btn-connect"
                      onClick={() => {
                        setConnectModalApp(app);
                        setConnectTab(app.id === "notion" || app.id === "github" || app.id === "slack" || app.id === "linear" ? "token" : "oauth");
                        setTokenInput("");
                      }}
                    >
                      <Plug size={14} /> Connect App
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Connect Modal */}
      {connectModalApp && (
        <div className="apps-modal-overlay" onClick={() => setConnectModalApp(null)}>
          <div className="apps-modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="apps-modal-header">
              <div className="apps-modal-title-row">
                {getAppIcon(connectModalApp.id, 24)}
                <h2>Connect {connectModalApp.name}</h2>
              </div>
              <button className="btn-close" onClick={() => setConnectModalApp(null)}>
                ×
              </button>
            </div>

            <p className="modal-desc">
              Connect your {connectModalApp.name} account to enable natural language search, data extraction, and tool actions in chat.
            </p>

            {/* Tabs for OAuth vs Token */}
            <div className="modal-tabs">
              <button
                className={`modal-tab ${connectTab === "oauth" ? "active" : ""}`}
                onClick={() => setConnectTab("oauth")}
              >
                OAuth 2.0 {connectModalApp.provider === "google" ? "(Recommended)" : ""}
              </button>
              <button
                className={`modal-tab ${connectTab === "token" ? "active" : ""}`}
                onClick={() => setConnectTab("token")}
              >
                API Token / Personal Key {connectModalApp.id === "notion" || connectModalApp.id === "github" || connectModalApp.id === "linear" ? "(Recommended)" : ""}
              </button>
            </div>

            {connectTab === "oauth" ? (
              <div className="oauth-panel">
                {connectModalApp.isConfigured === false ? (
                  <>
                    <div className="oauth-warning-unconfigured">
                      <AlertCircle size={18} className="warn-icon" />
                      <div>
                        <strong>OAuth Credentials Unconfigured in .env</strong>
                        <p>
                          {connectModalApp.name} OAuth requires <code>{connectModalApp.oauth?.requiredEnv?.join(" & ") || "OAuth Client credentials"}</code> in your <code>.env</code> file.
                          {connectModalApp.id === "notion" && (
                            <span style={{ display: "block", marginTop: "4px" }}>
                              👉 <strong>Good news:</strong> You do NOT need Google Cloud or OAuth for Notion! Click the <strong>"API Token / Personal Key"</strong> tab above to connect using your Notion Integration Secret.
                            </span>
                          )}
                        </p>
                      </div>
                    </div>

                    <button
                      className="btn-modal-demo"
                      onClick={() => handleDemoConnect(connectModalApp)}
                      disabled={connecting}
                    >
                      {connecting ? <Loader2 size={16} className="spin" /> : <Zap size={16} />}
                      Connect in Demo / Sandbox Mode (Instant)
                    </button>

                    {connectModalApp.id === "notion" ? (
                      <div className="oauth-setup-hint">
                        <p>
                          🔑 <strong>Fastest Way to Connect Notion:</strong>
                          <br />
                          1. Go to <a href="https://www.notion.so/profile/integrations" target="_blank" rel="noreferrer">notion.so/profile/integrations</a> and create an integration.
                          <br />
                          2. Copy your <strong>Internal Integration Secret</strong>.
                          <br />
                          3. Switch to the <strong>"API Token / Personal Key"</strong> tab above and paste it.
                        </p>
                      </div>
                    ) : connectModalApp.provider === "google" ? (
                      <div className="oauth-setup-hint">
                        <p>
                          💡 <strong>Want to connect your real personal {connectModalApp.name}?</strong>
                          <br />
                          Create an OAuth 2.0 Client ID in <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noreferrer">Google Cloud Console</a>, add <code>http://localhost:3000/dashboard/apps</code> as an authorized redirect URI, and set <code>GOOGLE_CLIENT_ID</code> & <code>GOOGLE_CLIENT_SECRET</code> in <code>.env</code>. See <code>docs/apps-oauth-setup.md</code>.
                        </p>
                      </div>
                    ) : (
                      <div className="oauth-setup-hint">
                        <p>
                          💡 To use OAuth for {connectModalApp.name}, register an OAuth application with the provider and set <code>{connectModalApp.oauth?.requiredEnv?.join(", ")}</code> in your <code>.env</code>.
                        </p>
                      </div>
                    )}

                    <div className="oauth-secondary-action">
                      <button
                        className="btn-link-action"
                        onClick={() => handleOAuthConnect(connectModalApp)}
                        disabled={connecting}
                      >
                        Try Live OAuth Redirect Anyway <ExternalLink size={12} />
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="oauth-notice">
                      <Shield size={16} />
                      <span>
                        You will be redirected to {connectModalApp.name}'s secure authentication server. Credentials are encrypted at rest with AES-256-GCM.
                      </span>
                    </div>
                    <button
                      className="btn-modal-primary"
                      onClick={() => handleOAuthConnect(connectModalApp)}
                      disabled={connecting}
                    >
                      {connecting ? <Loader2 size={16} className="spin" /> : <ExternalLink size={16} />}
                      Authorize with {connectModalApp.name}
                    </button>

                    <div className="oauth-divider">
                      <span>or</span>
                    </div>

                    <button
                      className="btn-modal-demo-outline"
                      onClick={() => handleDemoConnect(connectModalApp)}
                      disabled={connecting}
                    >
                      <Zap size={15} /> Instant Demo / Sandbox Mode
                    </button>
                  </>
                )}
              </div>
            ) : (
              <form onSubmit={handleTokenConnect} className="token-form">
                {connectModalApp.id === "slack" && (
                  <div className="token-hint-box" style={{ background: "rgba(236, 72, 153, 0.1)", borderColor: "rgba(236, 72, 153, 0.3)", color: "#f472b6" }}>
                    <span>💡 Paste your Slack <strong>Bot User OAuth Token</strong> (starts with <code>xoxb-</code>) or User Token (<code>xoxp-</code>) from <a href="https://api.slack.com/apps" target="_blank" rel="noreferrer" style={{ color: "#f472b6", textDecoration: "underline" }}>api.slack.com/apps</a>.</span>
                  </div>
                )}
                {connectModalApp.id === "github" && (
                  <div className="token-hint-box" style={{ background: "rgba(59, 130, 246, 0.1)", borderColor: "rgba(59, 130, 246, 0.3)", color: "#93c5fd" }}>
                    <span>💡 To access private repositories, generate a <a href="https://github.com/settings/tokens/new" target="_blank" rel="noreferrer" style={{ color: "#60a5fa", textDecoration: "underline" }}>GitHub Personal Access Token (Classic)</a> and check the <strong><code>repo</code></strong> scope box.</span>
                  </div>
                )}
                {connectModalApp.id === "notion" && (
                  <div className="token-hint-box" style={{ background: "rgba(16, 185, 129, 0.1)", borderColor: "rgba(16, 185, 129, 0.3)", color: "#6ee7b7" }}>
                    <span>💡 Paste your Notion <strong>Internal Integration Secret</strong> (starts with <code>secret_</code> or <code>ntn_</code>) from <a href="https://www.notion.so/profile/integrations" target="_blank" rel="noreferrer" style={{ color: "#34d399", textDecoration: "underline" }}>notion.so/profile/integrations</a>.</span>
                  </div>
                )}
                {connectModalApp.id === "linear" && (
                  <div className="token-hint-box" style={{ background: "rgba(94, 106, 210, 0.1)", borderColor: "rgba(94, 106, 210, 0.3)", color: "#a5b4fc" }}>
                    <span>💡 Paste your Linear <strong>Personal API Key</strong> (starts with <code>lin_api_</code>) from <a href="https://linear.app/settings/api" target="_blank" rel="noreferrer" style={{ color: "#818cf8", textDecoration: "underline" }}>linear.app/settings/api</a>.</span>
                  </div>
                )}
                {connectModalApp.provider === "google" && (
                  <div className="token-hint-box">
                    <span>💡 Google does not support raw static API tokens for user mailboxes. We recommend using OAuth 2.0 or Instant Demo Mode above, or paste an existing OAuth Bearer access token below.</span>
                  </div>
                )}
                <label className="token-label">
                  Enter API Token or Secret Key:
                  <input
                    type="password"
                    placeholder={`e.g. lin_api_... or ghp_... or secret_...`}
                    value={tokenInput}
                    onChange={(e) => setTokenInput(e.target.value)}
                    className="token-input"
                    required
                  />
                </label>
                <div className="token-actions">
                  <button type="button" className="btn-secondary" onClick={() => setConnectModalApp(null)}>
                    Cancel
                  </button>
                  <button type="submit" className="btn-modal-primary" disabled={connecting || !tokenInput.trim()}>
                    {connecting ? <Loader2 size={16} className="spin" /> : <Key size={16} />}
                    Save & Connect Token
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Manage Connection Modal */}
      {manageModalConn && (
        <div className="apps-modal-overlay" onClick={() => setManageModalConn(null)}>
          <div className="apps-modal-box manage-box" onClick={(e) => e.stopPropagation()}>
            <div className="apps-modal-header">
              <div className="apps-modal-title-row">
                {getAppIcon(manageModalConn.integrationId, 24)}
                <h2>Manage {manageModalConn.accountDisplayName}</h2>
              </div>
              <button className="btn-close" onClick={() => setManageModalConn(null)}>
                ×
              </button>
            </div>

            {/* Diagnostic Banner */}
            {testResult && (
              <div className={`diag-banner ${testResult.success ? "success" : "error"}`}>
                {testResult.success ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
                <span>{testResult.message}</span>
              </div>
            )}

            <div className="conn-details-list">
              <div className="detail-item">
                <span className="detail-key">Account Email:</span>
                <span className="detail-val">{manageModalConn.accountEmail || "None provided"}</span>
              </div>
              <div className="detail-item">
                <span className="detail-key">Auth Type:</span>
                <span className="detail-val">{manageModalConn.authType?.toUpperCase() || "OAUTH2"}</span>
              </div>
              <div className="detail-item">
                <span className="detail-key">Status:</span>
                <span className="detail-val badge-connected">
                  <CheckCircle2 size={12} /> {manageModalConn.status}
                </span>
              </div>
            </div>

            {/* Tools & Permissions Configuration */}
            <div className="tools-management-section">
              <h4>Exposed MCP Tools & Safety Policies:</h4>
              <p className="tools-subtext">Configure which tools the AI model can run automatically versus requiring explicit human confirmation.</p>

              <div className="tools-list-compact">
                {(manageModalConn.app?.tools || []).map((tool) => {
                  const setting = manageModalConn.toolSettings?.[tool.name] || {};
                  const isApproval = setting.permission === "always_ask" || (!setting.permission && tool.requiresApproval);

                  return (
                    <div key={tool.name} className="tool-row-item">
                      <div className="tool-info">
                        <span className="tool-name">{tool.fullName || tool.name}</span>
                        <span className="tool-desc">{tool.description}</span>
                      </div>
                      <div className="tool-perm-control">
                        <select
                          value={isApproval ? "always_ask" : "auto"}
                          onChange={(e) =>
                            handleToolPermissionToggle(manageModalConn, tool.name, e.target.value)
                          }
                          className="tool-perm-select"
                        >
                          <option value="auto">Auto Run (Safe)</option>
                          <option value="always_ask">Require Approval</option>
                          <option value="deny">Disabled</option>
                        </select>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Modal Bottom Actions */}
            <div className="manage-modal-footer">
              <button
                className="btn-test-conn"
                onClick={() => handleTestConnection(manageModalConn._id || manageModalConn.id)}
                disabled={testingConn}
              >
                {testingConn ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />}
                Test Connectivity
              </button>
              <button
                className="btn-danger-disconnect"
                onClick={() => handleDisconnect(manageModalConn._id || manageModalConn.id)}
              >
                <Trash2 size={14} /> Disconnect Account
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Manage Custom MCP App Modal */}
      {manageModalMcp && (
        <div className="apps-modal-overlay" onClick={() => setManageModalMcp(null)}>
          <div className="apps-modal-box manage-box" onClick={(e) => e.stopPropagation()}>
            <div className="apps-modal-header">
              <div className="apps-modal-title-row">
                {getAppIcon(manageModalMcp.id, 24, manageModalMcp)}
                <h2>Manage {manageModalMcp.name}</h2>
              </div>
              <button className="btn-close" onClick={() => setManageModalMcp(null)}>
                ×
              </button>
            </div>

            {testResult && (
              <div className={`diag-banner ${testResult.success ? "success" : "error"}`}>
                {testResult.success ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
                <span>{testResult.message}</span>
              </div>
            )}

            <div className="conn-details-list">
              <div className="detail-item">
                <span className="detail-key">Transport:</span>
                <span className="detail-val">{manageModalMcp.mcpServer?.transport || "STDIO"}</span>
              </div>
              <div className="detail-item">
                <span className="detail-key">Endpoint / Command:</span>
                <span className="detail-val" style={{ fontFamily: "monospace", fontSize: "12px" }}>
                  {manageModalMcp.mcpServer?.command
                    ? `${manageModalMcp.mcpServer.command} ${(manageModalMcp.mcpServer.args || []).join(" ")}`
                    : manageModalMcp.mcpServer?.url || "-"}
                </span>
              </div>
              <div className="detail-item">
                <span className="detail-key">Status:</span>
                <span className={`detail-val ${manageModalMcp.isConnected ? "badge-connected" : ""}`}>
                  {manageModalMcp.isConnected ? <CheckCircle2 size={12} /> : <AlertCircle size={12} />}{" "}
                  {manageModalMcp.mcpServer?.status || "DISCONNECTED"}
                </span>
              </div>
            </div>

            {/* Discovered Tools & Permissions */}
            <div className="tools-management-section">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <h4>Discovered MCP Tools ({manageModalMcp.tools?.length || 0}):</h4>
                <Link
                  to="/dashboard/mcp"
                  style={{ fontSize: "12px", color: "#818cf8", display: "inline-flex", alignItems: "center", gap: "4px" }}
                >
                  Open Full JSON Editor <ExternalLink size={12} />
                </Link>
              </div>
              <p className="tools-subtext">
                Configure which tools the AI assistant can run automatically, require confirmation, or disable.
              </p>

              <div className="tools-list-compact">
                {(!manageModalMcp.tools || manageModalMcp.tools.length === 0) ? (
                  <div style={{ fontSize: "12px", color: "#94a3b8", padding: "12px 0" }}>
                    No tools discovered yet. Click "Refresh Tools" below to query the server.
                  </div>
                ) : (
                  manageModalMcp.tools.map((tool) => {
                    const currentPerm =
                      tool.enabled === false
                        ? "deny"
                        : tool.permission || (tool.requiresApproval ? "always_ask" : "auto");

                    return (
                      <div key={tool.name} className="tool-row-item">
                        <div className="tool-info">
                          <span className="tool-name">
                            <Wrench size={12} style={{ marginRight: "5px", verticalAlign: "middle" }} />
                            {tool.name}
                          </span>
                          <span className="tool-desc">{tool.description || "No description"}</span>
                        </div>
                        <div className="tool-perm-control">
                          <select
                            value={currentPerm}
                            onChange={(e) =>
                              handleMcpToolPermission(manageModalMcp, tool.name, e.target.value)
                            }
                            className="tool-perm-select"
                          >
                            <option value="auto">Auto Run (Safe)</option>
                            <option value="always_ask">Require Approval</option>
                            <option value="deny">Disabled</option>
                          </select>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            <div className="manage-modal-footer">
              <div style={{ display: "flex", gap: "8px" }}>
                <button
                  type="button"
                  className="btn-test-conn"
                  onClick={() => handleMcpTest(manageModalMcp.id)}
                  disabled={testingConn}
                >
                  {testingConn ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />}
                  Test
                </button>
                <button
                  type="button"
                  className="btn-test-conn"
                  onClick={() => handleMcpRefresh(manageModalMcp.id)}
                  disabled={testingConn}
                >
                  <RefreshCw size={14} /> Refresh Tools
                </button>
              </div>
              <button
                type="button"
                className="btn-danger-disconnect"
                onClick={() => handleMcpDelete(manageModalMcp)}
              >
                <Trash2 size={14} /> Remove MCP App
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Custom MCP Modal */}
      <AddMcpModal
        open={showAddMcpModal}
        onClose={() => setShowAddMcpModal(false)}
        onSuccess={() => loadData()}
      />
    </div>
  );
}
