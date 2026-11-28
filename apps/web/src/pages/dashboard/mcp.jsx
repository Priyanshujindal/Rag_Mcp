import React, { useState, useEffect, useMemo } from "react";
import {
  Plus,
  Server,
  Wrench,
  CheckCircle,
  AlertTriangle,
  RefreshCw,
  Trash2,
  Activity,
  Play,
  ChevronDown,
  ChevronRight,
  Shield,
  Layers,
  History,
  Plug,
  Terminal,
  Globe,
  FileJson,
  Search,
  Power,
  Sliders,
  Check,
  Copy,
  X,
  ExternalLink,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogTitle, DialogDesc, DialogFooter } from "@/components/ui/dialog";
import { CardSkeleton } from "@/components/ui/skeleton";
import {
  getMockMcpServers,
  createMcpServer,
  deleteMcpServer,
  refreshMcpTools,
  testMcpConnection,
  toggleMcpTool,
  batchUpdateMcpTools,
  importMcpConfig,
  connectMcpServer,
  disconnectMcpServer,
  getMcpConfig,
  updateMcpConfig,
  getMcpServerLogs,
  getMcpExecutions,
  getIntegrationsCatalog,
  getActiveMcpTools,
} from "@/lib/api";
import "./mcp.css";

const CONFIG_TEMPLATES = {
  calculator: {
    label: "Calculator / Everything (npx)",
    config: {
      mcpServers: {
        calculator: {
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-everything"],
        },
      },
    },
  },
  python: {
    label: "Python MCP (uv)",
    config: {
      mcpServers: {
        "my-python-mcp": {
          command: "uv",
          args: ["run", "my-mcp-server"],
          env: {
            API_KEY: "your_api_key_here",
          },
        },
      },
    },
  },
  remote: {
    label: "Remote Server (Streamable HTTP / SSE)",
    config: {
      mcpServers: {
        "remote-mcp": {
          url: "https://example.com/mcp",
          transport: "streamable-http",
          headers: {
            Authorization: "Bearer your_token_here",
          },
        },
      },
    },
  },
};

function statusBadgeVariant(status) {
  const s = status?.toLowerCase();
  if (s === "connected") return "success";
  if (s === "connecting") return "neutral";
  if (s === "error") return "danger";
  return "neutral";
}

export default function McpPage() {
  const [activeTab, setActiveTab] = useState("servers"); // 'servers' | 'apps' | 'history'
  const [servers, setServers] = useState([]);
  const [integrations, setIntegrations] = useState([]);
  const [executions, setExecutions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [successMsg, setSuccessMsg] = useState(null);

  // Add MCP Modal
  const [showAddModal, setShowAddModal] = useState(false);
  const [addMode, setAddMode] = useState("editor"); // 'editor' | 'guided'
  const [editorText, setEditorText] = useState(
    JSON.stringify(CONFIG_TEMPLATES.calculator.config, null, 2)
  );
  const [editorError, setEditorError] = useState(null);
  const [autoConnectOnImport, setAutoConnectOnImport] = useState(true);
  const [importing, setImporting] = useState(false);

  // Guided form state
  const [guidedForm, setGuidedForm] = useState({
    name: "",
    transport: "stdio",
    command: "npx",
    args: "",
    envVars: [{ key: "", value: "" }],
    url: "",
    authHeader: "",
  });

  // Action states
  const [connectingId, setConnectingId] = useState(null);
  const [refreshingId, setRefreshingId] = useState(null);
  const [testingId, setTestingId] = useState(null);
  const [testResults, setTestResults] = useState({});

  // Server Manage Drawer / Modal
  const [managingServer, setManagingServer] = useState(null);
  const [drawerTab, setDrawerTab] = useState("tools"); // 'tools' | 'config' | 'logs'
  const [toolSearch, setToolSearch] = useState("");
  const [expandedSchemas, setExpandedSchemas] = useState({});
  const [drawerConfigText, setDrawerConfigText] = useState("");
  const [drawerConfigError, setDrawerConfigError] = useState(null);
  const [savingDrawerConfig, setSavingDrawerConfig] = useState(false);
  const [processLogs, setProcessLogs] = useState([]);
  const [loadingProcessLogs, setLoadingProcessLogs] = useState(false);

  const fetchProcessLogs = async (serverId) => {
    setLoadingProcessLogs(true);
    try {
      const res = await getMcpServerLogs(serverId);
      setProcessLogs(Array.isArray(res?.logs) ? res.logs : []);
    } catch {
      setProcessLogs([]);
    } finally {
      setLoadingProcessLogs(false);
    }
  };

  const fetchServers = async () => {
    setLoading(true);
    setError(null);
    try {
      const [serversData, integrationsData] = await Promise.all([
        getMockMcpServers().catch(() => []),
        getIntegrationsCatalog().catch(() => []),
      ]);
      setServers(Array.isArray(serversData) ? serversData : []);
      setIntegrations(Array.isArray(integrationsData) ? integrationsData : []);
    } catch (err) {
      setError(err.message || "Failed to load MCP servers");
    } finally {
      setLoading(false);
    }
  };

  const fetchHistory = async () => {
    try {
      const data = await getMcpExecutions();
      setExecutions(Array.isArray(data) ? data : []);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    fetchServers();
    fetchHistory();
  }, []);

  const showToast = (msg, isErr = false) => {
    if (isErr) {
      setError(msg);
      setTimeout(() => setError(null), 5000);
    } else {
      setSuccessMsg(msg);
      setTimeout(() => setSuccessMsg(null), 4000);
    }
  };

  // Validate JSON on editor change
  const handleEditorChange = (e) => {
    const text = e.target.value;
    setEditorText(text);
    try {
      const parsed = JSON.parse(text);
      if (typeof parsed !== "object" || parsed === null) {
        setEditorError("Root must be a JSON object");
      } else {
        setEditorError(null);
      }
    } catch (err) {
      setEditorError(`Invalid JSON: ${err.message}`);
    }
  };

  const handleApplyTemplate = (templateKey) => {
    const tmpl = CONFIG_TEMPLATES[templateKey];
    if (tmpl) {
      setEditorText(JSON.stringify(tmpl.config, null, 2));
      setEditorError(null);
    }
  };

  // Import JSON Config (Option A)
  const handleImportConfig = async () => {
    if (editorError) return;
    let parsed;
    try {
      parsed = JSON.parse(editorText);
    } catch (err) {
      setEditorError(err.message);
      return;
    }

    setImporting(true);
    try {
      const res = await importMcpConfig(parsed, { autoConnect: autoConnectOnImport });
      const count = res.importedCount || res.servers?.length || 1;
      showToast(`Imported and discovered ${count} MCP server${count > 1 ? "s" : ""} successfully.`);
      setShowAddModal(false);
      await fetchServers();
    } catch (err) {
      setEditorError(err.message || "Import failed");
    } finally {
      setImporting(false);
    }
  };

  // Submit Guided Form (Option B)
  const handleGuidedSubmit = async () => {
    if (!guidedForm.name.trim()) {
      showToast("Server name is required", true);
      return;
    }

    setImporting(true);
    try {
      let configObj;
      if (guidedForm.transport === "stdio") {
        const envObj = {};
        guidedForm.envVars.forEach((pair) => {
          if (pair.key.trim()) envObj[pair.key.trim()] = pair.value;
        });

        const argsList = guidedForm.args
          ? guidedForm.args.split(/\s+/).filter(Boolean)
          : [];

        configObj = {
          mcpServers: {
            [guidedForm.name.trim()]: {
              command: guidedForm.command.trim(),
              args: argsList,
              env: Object.keys(envObj).length > 0 ? envObj : undefined,
            },
          },
        };
      } else {
        const headers = {};
        if (guidedForm.authHeader.trim()) {
          headers["Authorization"] = guidedForm.authHeader.startsWith("Bearer ")
            ? guidedForm.authHeader.trim()
            : `Bearer ${guidedForm.authHeader.trim()}`;
        }

        configObj = {
          mcpServers: {
            [guidedForm.name.trim()]: {
              url: guidedForm.url.trim(),
              transport: guidedForm.transport,
              headers: Object.keys(headers).length > 0 ? headers : undefined,
            },
          },
        };
      }

      const res = await importMcpConfig(configObj, { autoConnect: true });
      showToast(`Server "${guidedForm.name}" created and connected.`);
      setShowAddModal(false);
      await fetchServers();
    } catch (err) {
      showToast(err.message || "Failed to create server", true);
    } finally {
      setImporting(false);
    }
  };

  // Toggle Connect / Disconnect
  const handleToggleConnect = async (srv) => {
    const sId = srv._id || srv.id;
    const isConn = (srv.status || "").toLowerCase() === "connected";
    setConnectingId(sId);
    try {
      if (isConn) {
        await disconnectMcpServer(sId);
        showToast(`Disconnected "${srv.name}".`);
      } else {
        await connectMcpServer(sId);
        showToast(`Connected "${srv.name}" and refreshed tools.`);
      }
      await fetchServers();
    } catch (err) {
      showToast(err.message || "Failed to change connection state", true);
    } finally {
      setConnectingId(null);
    }
  };

  // Refresh Tools
  const handleRefresh = async (srv) => {
    const sId = srv._id || srv.id;
    setRefreshingId(sId);
    try {
      const updated = await refreshMcpTools(sId);
      setServers((prev) => prev.map((s) => ((s._id || s.id) === sId ? updated : s)));
      if (managingServer && (managingServer._id || managingServer.id) === sId) {
        setManagingServer(updated);
      }
      showToast(`Tools refreshed for "${srv.name}". Discovered ${updated.tools?.length || 0} tools.`);
    } catch (err) {
      showToast(err.message || "Failed to refresh tools", true);
    } finally {
      setRefreshingId(null);
    }
  };

  // Test Connection
  const handleTest = async (srv) => {
    const sId = srv._id || srv.id;
    setTestingId(sId);
    try {
      const res = await testMcpConnection(sId);
      setTestResults((prev) => ({ ...prev, [sId]: res }));
    } catch (err) {
      setTestResults((prev) => ({
        ...prev,
        [sId]: { success: false, error: err.message },
      }));
    } finally {
      setTestingId(null);
    }
  };

  // Delete Server
  const handleDelete = async (srv) => {
    const sId = srv._id || srv.id;
    if (!window.confirm(`Are you sure you want to delete MCP server "${srv.name}"?`)) return;
    try {
      await deleteMcpServer(sId);
      setServers((prev) => prev.filter((s) => (s._id || s.id) !== sId));
      if (managingServer && (managingServer._id || managingServer.id) === sId) {
        setManagingServer(null);
      }
      showToast(`Server "${srv.name}" deleted.`);
    } catch (err) {
      showToast(err.message || "Failed to delete server", true);
    }
  };

  // Toggle single tool enabled
  const handleToggleTool = async (serverId, toolName, currentEnabled) => {
    const nextEnabled = !currentEnabled;
    try {
      await toggleMcpTool(serverId, toolName, { enabled: nextEnabled });
      const updateList = (srvList) =>
        srvList.map((srv) => {
          if ((srv._id || srv.id) !== serverId) return srv;
          return {
            ...srv,
            tools: (srv.tools || []).map((t) =>
              t.name === toolName ? { ...t, enabled: nextEnabled } : t
            ),
          };
        });
      setServers(updateList);
      if (managingServer && (managingServer._id || managingServer.id) === serverId) {
        setManagingServer((prev) => ({
          ...prev,
          tools: (prev.tools || []).map((t) =>
            t.name === toolName ? { ...t, enabled: nextEnabled } : t
          ),
        }));
      }
    } catch (err) {
      showToast(err.message || "Failed to toggle tool", true);
    }
  };

  // Change permission policy
  const handleChangePermission = async (serverId, toolName, newPerm) => {
    try {
      const requiresApproval = newPerm === "always_ask";
      await toggleMcpTool(serverId, toolName, {
        permission: newPerm,
        requiresApproval,
      });

      const updateList = (srvList) =>
        srvList.map((srv) => {
          if ((srv._id || srv.id) !== serverId) return srv;
          return {
            ...srv,
            tools: (srv.tools || []).map((t) =>
              t.name === toolName
                ? { ...t, permission: newPerm, requiresApproval }
                : t
            ),
          };
        });
      setServers(updateList);
      if (managingServer && (managingServer._id || managingServer.id) === serverId) {
        setManagingServer((prev) => ({
          ...prev,
          tools: (prev.tools || []).map((t) =>
            t.name === toolName
              ? { ...t, permission: newPerm, requiresApproval }
              : t
          ),
        }));
      }
    } catch (err) {
      showToast(err.message || "Failed to change permission", true);
    }
  };

  // Batch toggle all tools
  const handleBatchTools = async (serverId, action) => {
    try {
      await batchUpdateMcpTools(serverId, action);
      const isEnable = action === "enable_all";
      const updateList = (srvList) =>
        srvList.map((srv) => {
          if ((srv._id || srv.id) !== serverId) return srv;
          return {
            ...srv,
            tools: (srv.tools || []).map((t) => ({
              ...t,
              enabled: isEnable,
              permission: !isEnable ? "deny" : t.permission === "deny" ? "auto" : t.permission,
            })),
          };
        });
      setServers(updateList);
      if (managingServer && (managingServer._id || managingServer.id) === serverId) {
        setManagingServer((prev) => ({
          ...prev,
          tools: (prev.tools || []).map((t) => ({
            ...t,
            enabled: isEnable,
            permission: !isEnable ? "deny" : t.permission === "deny" ? "auto" : t.permission,
          })),
        }));
      }
      showToast(isEnable ? "All tools enabled" : "All tools disabled");
    } catch (err) {
      showToast(err.message || "Failed to update tools", true);
    }
  };

  // Open Manage Drawer
  const handleOpenManage = async (srv, initialTab = "tools") => {
    setManagingServer(srv);
    setDrawerTab(initialTab);
    setDrawerConfigError(null);
    const sId = srv._id || srv.id;
    try {
      const cfg = await getMcpConfig(sId);
      setDrawerConfigText(JSON.stringify(cfg.rawConfig || cfg.config || {}, null, 2));
    } catch {
      setDrawerConfigText(
        JSON.stringify(
          {
            mcpServers: {
              [srv.name]: {
                command: srv.command,
                args: srv.args || [],
                transport: srv.transport,
              },
            },
          },
          null,
          2
        )
      );
    }
  };

  // Save drawer config
  const handleSaveDrawerConfig = async () => {
    if (!managingServer || drawerConfigError) return;
    const sId = managingServer._id || managingServer.id;
    let parsed;
    try {
      parsed = JSON.parse(drawerConfigText);
    } catch (err) {
      setDrawerConfigError(err.message);
      return;
    }

    setSavingDrawerConfig(true);
    try {
      await updateMcpConfig(sId, parsed);
      showToast(`Configuration updated and "${managingServer.name}" reconnected.`);
      await fetchServers();
      const updatedSrv = servers.find((s) => (s._id || s.id) === sId);
      if (updatedSrv) setManagingServer(updatedSrv);
    } catch (err) {
      setDrawerConfigError(err.message || "Save failed");
    } finally {
      setSavingDrawerConfig(false);
    }
  };

  // Filter tools in drawer
  const filteredTools = useMemo(() => {
    if (!managingServer?.tools) return [];
    if (!toolSearch.trim()) return managingServer.tools;
    const q = toolSearch.toLowerCase();
    return managingServer.tools.filter(
      (t) =>
        t.name?.toLowerCase().includes(q) ||
        t.description?.toLowerCase().includes(q)
    );
  }, [managingServer, toolSearch]);

  // Filter logs in drawer
  const serverLogs = useMemo(() => {
    if (!managingServer) return [];
    const sId = managingServer._id || managingServer.id;
    return executions.filter(
      (ex) =>
        ex.serverId === sId ||
        ex.serverName === managingServer.name ||
        ex.toolName?.startsWith(`${managingServer.name}.`)
    );
  }, [managingServer, executions]);

  return (
    <div className="mcp-dashboard-container">
      {/* Top Header */}
      <div className="page-header">
        <div>
          <div className="mcp-badge-header">
            <span className="mcp-badge-dot" /> Antigravity-Style Tooling
          </div>
          <h1 className="page-title">Model Context Protocol (MCP)</h1>
          <p className="page-desc">
            Connect AI models to your own command-based and remote MCP servers. Configure dynamic tools, manage granular execution permissions, and inspect live schemas.
          </p>
        </div>
        <div style={{ display: "flex", gap: "8px" }}>
          <button
            type="button"
            className="btn btn-secondary btn-with-icon"
            onClick={fetchServers}
            disabled={loading}
          >
            <RefreshCw size={14} className={loading ? "spin" : ""} /> Refresh
          </button>
          <button
            type="button"
            className="btn btn-primary btn-with-icon"
            onClick={() => setShowAddModal(true)}
          >
            <Plus size={15} /> Add MCP Server
          </button>
        </div>
      </div>

      {/* Notifications */}
      {error && (
        <div className="mcp-alert danger">
          <AlertTriangle size={15} />
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)} className="mcp-alert-close">
            <X size={13} />
          </button>
        </div>
      )}
      {successMsg && (
        <div className="mcp-alert success">
          <CheckCircle size={15} />
          <span>{successMsg}</span>
          <button type="button" onClick={() => setSuccessMsg(null)} className="mcp-alert-close">
            <X size={13} />
          </button>
        </div>
      )}

      {/* Main Tabs */}
      <div className="mcp-tabs">
        <button
          type="button"
          className={`mcp-tab-btn ${activeTab === "servers" ? "active" : ""}`}
          onClick={() => setActiveTab("servers")}
        >
          <Layers size={14} /> MCP Servers ({servers.length})
        </button>
        <button
          type="button"
          className={`mcp-tab-btn ${activeTab === "apps" ? "active" : ""}`}
          onClick={() => setActiveTab("apps")}
        >
          <Plug size={14} /> Connected Apps & OAuth
        </button>
        <button
          type="button"
          className={`mcp-tab-btn ${activeTab === "history" ? "active" : ""}`}
          onClick={() => {
            setActiveTab("history");
            fetchHistory();
          }}
        >
          <History size={14} /> Tool Execution Audit ({executions.length})
        </button>
      </div>

      {/* TAB 1: SERVERS */}
      {activeTab === "servers" && (
        loading ? (
          <div>
            <CardSkeleton />
            <div style={{ marginTop: "16px" }}>
              <CardSkeleton />
            </div>
          </div>
        ) : servers.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">
              <Server size={28} />
            </div>
            <div className="empty-state-title">No MCP servers registered</div>
            <div className="empty-state-desc">
              Add your own local command (npx, uv, python) or remote SSE server using the Antigravity configuration editor.
            </div>
            <button className="btn btn-primary btn-with-icon" onClick={() => setShowAddModal(true)}>
              <Plus size={15} /> Add MCP Server
            </button>
          </div>
        ) : (
          <div className="mcp-server-cards-list">
            {servers.map((srv) => {
              const sId = srv._id || srv.id;
              const isConn = (srv.status || "").toLowerCase() === "connected";
              const isConnecting = connectingId === sId;
              const toolsList = srv.tools || [];
              const enabledCount = toolsList.filter((t) => t.enabled !== false).length;
              const testInfo = testResults[sId];

              return (
                <div key={sId} className="mcp-server-card">
                  <div className="mcp-server-header">
                    <div className="mcp-server-icon">
                      {srv.transport?.toLowerCase().includes("http") || srv.transport?.toLowerCase().includes("sse") ? (
                        <Globe size={18} />
                      ) : (
                        <Terminal size={18} />
                      )}
                    </div>
                    <div className="mcp-server-info">
                      <div className="mcp-server-title-row">
                        <span className="mcp-server-name">{srv.name}</span>
                        <Badge variant={statusBadgeVariant(srv.status)} dot>
                          {srv.status || "CONNECTED"}
                        </Badge>
                        <span className="mcp-transport-badge">
                          {srv.transport || "STDIO"}
                        </span>
                        {srv.type === "builtin" && (
                          <span className="mcp-type-badge">Built-in</span>
                        )}
                      </div>
                      <div className="mcp-server-desc">
                        {srv.description ||
                          (srv.command
                            ? `${srv.command} ${(srv.args || []).join(" ")}`
                            : srv.url) ||
                          "Model Context Protocol Provider"}
                      </div>
                    </div>

                    <div className="mcp-tools-metric">
                      <span className="mcp-tools-count">
                        {enabledCount} / {toolsList.length}
                      </span>
                      <span className="mcp-tools-label-sub">Tools Active</span>
                    </div>

                    <div className="mcp-server-actions">
                      {/* Connect / Disconnect */}
                      <button
                        type="button"
                        className={`mcp-icon-btn ${isConn ? "connected-toggle" : "disconnected-toggle"}`}
                        onClick={() => handleToggleConnect(srv)}
                        disabled={isConnecting}
                        title={isConn ? "Disconnect server" : "Connect server"}
                      >
                        <Power size={13} className={isConnecting ? "spin" : ""} />
                        <span>{isConnecting ? "Updating..." : isConn ? "Connected" : "Connect"}</span>
                      </button>

                      {/* Refresh tools */}
                      <button
                        type="button"
                        className="mcp-icon-btn"
                        onClick={() => handleRefresh(srv)}
                        disabled={refreshingId === sId}
                        title="Query server for new or updated tools"
                      >
                        <RefreshCw size={12} className={refreshingId === sId ? "spin" : ""} />
                        <span>Refresh</span>
                      </button>

                      {/* Test Connection */}
                      <button
                        type="button"
                        className="mcp-icon-btn"
                        onClick={() => handleTest(srv)}
                        disabled={testingId === sId}
                        title="Perform roundtrip ping & discovery test"
                      >
                        <Activity size={12} className={testingId === sId ? "spin" : ""} />
                        <span>Test</span>
                      </button>

                      {/* Manage Drawer */}
                      <button
                        type="button"
                        className="mcp-icon-btn highlight"
                        onClick={() => handleOpenManage(srv, "tools")}
                        title="Manage tools, permissions, and configuration"
                      >
                        <Sliders size={12} />
                        <span>Manage</span>
                      </button>

                      {/* Delete */}
                      {srv.type !== "builtin" && srv.name !== "Builtin System Tools" && (
                        <button
                          type="button"
                          className="mcp-icon-btn danger"
                          onClick={() => handleDelete(srv)}
                          title="Delete server"
                        >
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Diagnostic Test Banner */}
                  {testInfo && (
                    <div
                      className={`mcp-test-banner ${
                        testInfo.success ? "success" : "danger"
                      }`}
                    >
                      <span>
                        {testInfo.success
                          ? `✅ Connection Healthy: Discovered ${testInfo.toolCount} tools, ${
                              testInfo.resourceCount || 0
                            } resources, ${testInfo.promptCount || 0} prompts.`
                          : `❌ Test Failed: ${testInfo.error}`}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          setTestResults((prev) => ({ ...prev, [sId]: null }))
                        }
                      >
                        Dismiss
                      </button>
                    </div>
                  )}

                  {/* Quick tool chips preview */}
                  {toolsList.length > 0 && (
                    <div className="mcp-quick-tools-preview">
                      <span className="mcp-preview-label">Discovered Tools:</span>
                      <div className="mcp-tool-chips">
                        {toolsList.slice(0, 6).map((t) => (
                          <span
                            key={t.name}
                            className={`mcp-tool-chip ${
                              t.enabled === false ? "disabled" : ""
                            }`}
                            onClick={() => handleOpenManage(srv, "tools")}
                            title={t.description || t.name}
                          >
                            <Wrench size={10} />
                            <code>{t.name}</code>
                          </span>
                        ))}
                        {toolsList.length > 6 && (
                          <span
                            className="mcp-tool-chip more"
                            onClick={() => handleOpenManage(srv, "tools")}
                          >
                            +{toolsList.length - 6} more...
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )
      )}

      {/* TAB 2: CONNECTED APPS */}
      {activeTab === "apps" && (
        <div className="mcp-apps-section">
          <p className="page-desc" style={{ marginBottom: "16px" }}>
            Preconfigured cloud integrations with OAuth authentication for Google Workspace, Notion, Slack, and Linear.
          </p>
          <div className="mcp-integrations-grid">
            {integrations.map((app) => (
              <div key={app.id} className="mcp-app-card">
                <div className="mcp-app-header">
                  <div className="mcp-app-name">{app.name}</div>
                  <Badge variant={app.status === "connected" ? "success" : "neutral"}>
                    {app.status === "connected" ? "CONNECTED" : "AVAILABLE"}
                  </Badge>
                </div>
                <div className="mcp-app-desc">{app.description}</div>
                <div className="mcp-app-tools-list">
                  {(app.tools || []).map((t) => (
                    <span key={t} className="mcp-app-tool-pill">
                      <code>{t}</code>
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 3: AUDIT HISTORY */}
      {activeTab === "history" && (
        <div className="mcp-server-card">
          <div className="mcp-tools-label" style={{ marginBottom: "12px" }}>
            Real-Time Tool Execution Audit Log ({executions.length} calls)
          </div>
          {executions.length === 0 ? (
            <div style={{ fontSize: "12px", color: "var(--text-muted)", padding: "16px 0" }}>
              No tool executions recorded yet. Call any enabled tool from the chat page to see executions appear here.
            </div>
          ) : (
            <table className="mcp-history-table">
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Tool</th>
                  <th>Server</th>
                  <th>Status</th>
                  <th>Duration</th>
                  <th>Input Arguments</th>
                </tr>
              </thead>
              <tbody>
                {executions.map((ex) => (
                  <tr key={ex._id || ex.id}>
                    <td style={{ color: "var(--text-muted)", fontSize: "11px" }}>
                      {new Date(ex.createdAt).toLocaleTimeString()}
                    </td>
                    <td>
                      <code>{ex.toolName}</code>
                    </td>
                    <td>{ex.serverName || "MCP Server"}</td>
                    <td>
                      <span
                        className={`badge-status ${
                          ex.status === "completed"
                            ? "success"
                            : ex.status === "error"
                            ? "error"
                            : "rejected"
                        }`}
                      >
                        {ex.status}
                      </span>
                    </td>
                    <td>{ex.durationMs ? `${ex.durationMs}ms` : "-"}</td>
                    <td>
                      <pre
                        style={{
                          margin: 0,
                          fontSize: "10px",
                          maxHeight: "40px",
                          overflowY: "hidden",
                        }}
                      >
                        {JSON.stringify(ex.args || ex.arguments || {}, null, 1)}
                      </pre>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ============================================================ */}
      {/* ADD MCP MODAL (Antigravity-Style JSON Editor & Guided Form) */}
      {/* ============================================================ */}
      {showAddModal && (
        <Dialog open onOpenChange={setShowAddModal}>
          <div className="mcp-modal-overlay">
            <div className="mcp-modal-content">
              <div className="mcp-modal-header">
                <div>
                  <DialogTitle className="mcp-modal-title">
                    Configure Custom MCP Server
                  </DialogTitle>
                  <DialogDesc className="mcp-modal-desc">
                    Paste an Antigravity MCP configuration or use the guided form to add command or remote servers.
                  </DialogDesc>
                </div>
                <button
                  type="button"
                  className="mcp-btn-close"
                  onClick={() => setShowAddModal(false)}
                >
                  <X size={16} />
                </button>
              </div>

              {/* Mode Switcher */}
              <div className="mcp-modal-mode-tabs">
                <button
                  type="button"
                  className={`mcp-mode-tab ${addMode === "editor" ? "active" : ""}`}
                  onClick={() => setAddMode("editor")}
                >
                  <FileJson size={14} /> JSON Configuration Editor (Antigravity Style)
                </button>
                <button
                  type="button"
                  className={`mcp-mode-tab ${addMode === "guided" ? "active" : ""}`}
                  onClick={() => setAddMode("guided")}
                >
                  <Sliders size={14} /> Guided Form
                </button>
              </div>

              {/* Option A: JSON Configuration Editor */}
              {addMode === "editor" && (
                <div className="mcp-editor-container">
                  <div className="mcp-templates-row">
                    <span className="mcp-templates-title">Quick Templates:</span>
                    {Object.entries(CONFIG_TEMPLATES).map(([key, item]) => (
                      <button
                        key={key}
                        type="button"
                        className="mcp-template-pill"
                        onClick={() => handleApplyTemplate(key)}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>

                  <div className="mcp-editor-wrapper">
                    <textarea
                      className="mcp-json-textarea"
                      rows={14}
                      value={editorText}
                      onChange={handleEditorChange}
                      placeholder='{ "mcpServers": { "my-server": { "command": "npx", "args": [...] } } }'
                      spellCheck={false}
                    />
                  </div>

                  {editorError ? (
                    <div className="mcp-editor-error">
                      <AlertTriangle size={13} />
                      <span>{editorError}</span>
                    </div>
                  ) : (
                    <div className="mcp-editor-valid">
                      <Check size={13} />
                      <span>Valid JSON configuration structure</span>
                    </div>
                  )}

                  <div className="mcp-editor-options">
                    <label className="mcp-checkbox-label">
                      <input
                        type="checkbox"
                        checked={autoConnectOnImport}
                        onChange={(e) => setAutoConnectOnImport(e.target.checked)}
                      />
                      <span>Automatically connect and discover tools immediately</span>
                    </label>
                  </div>
                </div>
              )}

              {/* Option B: Guided Form */}
              {addMode === "guided" && (
                <div className="mcp-guided-form">
                  <div className="form-group">
                    <label className="form-label">Server Name</label>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="e.g. calculator or github-tools"
                      value={guidedForm.name}
                      onChange={(e) =>
                        setGuidedForm((prev) => ({ ...prev, name: e.target.value }))
                      }
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label">Transport Type</label>
                    <select
                      className="form-input"
                      value={guidedForm.transport}
                      onChange={(e) =>
                        setGuidedForm((prev) => ({
                          ...prev,
                          transport: e.target.value,
                        }))
                      }
                    >
                      <option value="stdio">Local Stdio (Command / Process)</option>
                      <option value="streamable-http">Streamable HTTP (Remote)</option>
                      <option value="sse">Server-Sent Events (SSE)</option>
                    </select>
                  </div>

                  {guidedForm.transport === "stdio" ? (
                    <>
                      <div className="form-group">
                        <label className="form-label">Command Executable</label>
                        <input
                          type="text"
                          className="form-input"
                          placeholder="e.g. npx, uv, python, node, docker"
                          value={guidedForm.command}
                          onChange={(e) =>
                            setGuidedForm((prev) => ({
                              ...prev,
                              command: e.target.value,
                            }))
                          }
                        />
                      </div>

                      <div className="form-group">
                        <label className="form-label">Arguments (space separated)</label>
                        <input
                          type="text"
                          className="form-input"
                          placeholder="e.g. -y @modelcontextprotocol/server-everything"
                          value={guidedForm.args}
                          onChange={(e) =>
                            setGuidedForm((prev) => ({
                              ...prev,
                              args: e.target.value,
                            }))
                          }
                        />
                      </div>

                      <div className="form-group">
                        <label className="form-label">Environment Variables</label>
                        {guidedForm.envVars.map((env, idx) => (
                          <div key={idx} className="mcp-env-row">
                            <input
                              type="text"
                              className="form-input"
                              placeholder="KEY"
                              value={env.key}
                              onChange={(e) => {
                                const newEnvs = [...guidedForm.envVars];
                                newEnvs[idx].key = e.target.value;
                                setGuidedForm((p) => ({ ...p, envVars: newEnvs }));
                              }}
                            />
                            <input
                              type="password"
                              className="form-input"
                              placeholder="VALUE"
                              value={env.value}
                              onChange={(e) => {
                                const newEnvs = [...guidedForm.envVars];
                                newEnvs[idx].value = e.target.value;
                                setGuidedForm((p) => ({ ...p, envVars: newEnvs }));
                              }}
                            />
                          </div>
                        ))}
                        <button
                          type="button"
                          className="mcp-link-btn"
                          onClick={() =>
                            setGuidedForm((p) => ({
                              ...p,
                              envVars: [...p.envVars, { key: "", value: "" }],
                            }))
                          }
                        >
                          + Add Variable
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="form-group">
                        <label className="form-label">Server Endpoint URL</label>
                        <input
                          type="url"
                          className="form-input"
                          placeholder="https://mcp.company.internal/sse"
                          value={guidedForm.url}
                          onChange={(e) =>
                            setGuidedForm((prev) => ({
                              ...prev,
                              url: e.target.value,
                            }))
                          }
                        />
                      </div>

                      <div className="form-group">
                        <label className="form-label">Bearer Token / Authorization Header</label>
                        <input
                          type="password"
                          className="form-input"
                          placeholder="Secret token or Bearer key"
                          value={guidedForm.authHeader}
                          onChange={(e) =>
                            setGuidedForm((prev) => ({
                              ...prev,
                              authHeader: e.target.value,
                            }))
                          }
                        />
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* Modal Footer */}
              <div className="mcp-modal-footer">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowAddModal(false)}
                >
                  Cancel
                </button>
                {addMode === "editor" ? (
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={handleImportConfig}
                    disabled={importing || Boolean(editorError)}
                  >
                    {importing ? "Importing & Connecting..." : "Import & Connect"}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={handleGuidedSubmit}
                    disabled={importing}
                  >
                    {importing ? "Saving..." : "Save & Connect"}
                  </button>
                )}
              </div>
            </div>
          </div>
        </Dialog>
      )}

      {/* ============================================================ */}
      {/* SERVER DETAIL DRAWER (Tools, Config, Logs) */}
      {/* ============================================================ */}
      {managingServer && (
        <div className="mcp-drawer-overlay" onClick={() => setManagingServer(null)}>
          <div className="mcp-drawer-panel" onClick={(e) => e.stopPropagation()}>
            {/* Drawer Header */}
            <div className="mcp-drawer-header">
              <div className="mcp-drawer-title-group">
                <div className="mcp-drawer-server-name">{managingServer.name}</div>
                <Badge variant={statusBadgeVariant(managingServer.status)} dot>
                  {managingServer.status || "CONNECTED"}
                </Badge>
                <span className="mcp-transport-badge">{managingServer.transport}</span>
              </div>
              <button
                type="button"
                className="mcp-btn-close"
                onClick={() => setManagingServer(null)}
              >
                <X size={16} />
              </button>
            </div>

            {/* Drawer Tabs */}
            <div className="mcp-drawer-nav">
              <button
                type="button"
                className={`mcp-drawer-nav-item ${drawerTab === "tools" ? "active" : ""}`}
                onClick={() => setDrawerTab("tools")}
              >
                <Wrench size={13} /> Tools ({managingServer.tools?.length || 0})
              </button>
              <button
                type="button"
                className={`mcp-drawer-nav-item ${drawerTab === "config" ? "active" : ""}`}
                onClick={() => setDrawerTab("config")}
              >
                <FileJson size={13} /> Configuration
              </button>
              <button
                type="button"
                className={`mcp-drawer-nav-item ${drawerTab === "logs" ? "active" : ""}`}
                onClick={() => setDrawerTab("logs")}
              >
                <History size={13} /> Executions ({serverLogs.length})
              </button>
              <button
                type="button"
                className={`mcp-drawer-nav-item ${drawerTab === "diagnostics" ? "active" : ""}`}
                onClick={() => {
                  setDrawerTab("diagnostics");
                  fetchProcessLogs(managingServer._id || managingServer.id);
                }}
              >
                <Terminal size={13} /> Diagnostics / Stderr
              </button>
            </div>

            {/* DRAWER TAB 1: TOOLS */}
            {drawerTab === "tools" && (
              <div className="mcp-drawer-tab-content">
                <div className="mcp-tools-toolbar">
                  <div className="mcp-search-box">
                    <Search size={14} className="icon-faint" />
                    <input
                      type="text"
                      placeholder="Filter tools by name or description..."
                      value={toolSearch}
                      onChange={(e) => setToolSearch(e.target.value)}
                    />
                  </div>
                  <div className="mcp-batch-actions">
                    <button
                      type="button"
                      className="mcp-batch-btn"
                      onClick={() =>
                        handleBatchTools(
                          managingServer._id || managingServer.id,
                          "enable_all"
                        )
                      }
                    >
                      Enable All
                    </button>
                    <button
                      type="button"
                      className="mcp-batch-btn"
                      onClick={() =>
                        handleBatchTools(
                          managingServer._id || managingServer.id,
                          "disable_all"
                        )
                      }
                    >
                      Disable All
                    </button>
                  </div>
                </div>

                <div className="mcp-tools-list-body">
                  {filteredTools.length === 0 ? (
                    <div className="mcp-empty-state-sub">
                      {toolSearch ? "No tools match search filter" : "No tools exposed by this server"}
                    </div>
                  ) : (
                    filteredTools.map((tool) => {
                      const sId = managingServer._id || managingServer.id;
                      const isEnabled = tool.enabled !== false;
                      const currentPerm = tool.permission || (tool.requiresApproval ? "always_ask" : "auto");
                      const schemaKey = `${sId}:${tool.name}`;
                      const isSchemaOpen = Boolean(expandedSchemas[schemaKey]);

                      return (
                        <div key={tool.name} className="mcp-tool-card">
                          <div className="mcp-tool-card-main">
                            <div className="mcp-tool-details">
                              <div className="mcp-tool-name-line">
                                <Wrench size={13} className="mcp-tool-icon" />
                                <code>{tool.name}</code>
                                {tool.lastExecutionStatus && (
                                  <span
                                    className={`mcp-exec-status-pill ${tool.lastExecutionStatus}`}
                                  >
                                    Last run: {tool.lastExecutionStatus}
                                  </span>
                                )}
                              </div>
                              <div className="mcp-tool-desc-text">
                                {tool.description || "No description provided by server."}
                              </div>
                            </div>

                            <div className="mcp-tool-actions-column">
                              <div className="mcp-tool-switch-row">
                                <span className="mcp-sub-label">Enabled</span>
                                <Switch
                                  checked={isEnabled}
                                  onChange={() =>
                                    handleToggleTool(sId, tool.name, isEnabled)
                                  }
                                />
                              </div>

                              <div className="mcp-perm-select-row">
                                <span className="mcp-sub-label">Authorization:</span>
                                <select
                                  className={`mcp-perm-select ${currentPerm}`}
                                  value={currentPerm}
                                  onChange={(e) =>
                                    handleChangePermission(
                                      sId,
                                      tool.name,
                                      e.target.value
                                    )
                                  }
                                >
                                  <option value="auto">Auto (No confirmation)</option>
                                  <option value="always_ask">Always Ask (Human approval)</option>
                                  <option value="deny">Deny (Blocked)</option>
                                </select>
                              </div>
                            </div>
                          </div>

                          {/* Schema Preview */}
                          {tool.inputSchema && (
                            <div className="mcp-tool-schema-container">
                              <button
                                type="button"
                                className="mcp-schema-toggle"
                                onClick={() =>
                                  setExpandedSchemas((prev) => ({
                                    ...prev,
                                    [schemaKey]: !prev[schemaKey],
                                  }))
                                }
                              >
                                {isSchemaOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                                <span>Input Schema {isSchemaOpen ? "(Hide)" : "(View)"}</span>
                              </button>
                              {isSchemaOpen && (
                                <pre className="mcp-schema-box">
                                  {JSON.stringify(tool.inputSchema, null, 2)}
                                </pre>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            )}

            {/* DRAWER TAB 2: CONFIGURATION */}
            {drawerTab === "config" && (
              <div className="mcp-drawer-tab-content">
                <div className="mcp-config-notice">
                  <Shield size={14} />
                  <span>
                    Sensitive environment variables and bearer tokens are masked with asterisks to protect secrets.
                  </span>
                </div>

                <div className="mcp-editor-wrapper" style={{ marginTop: "12px" }}>
                  <textarea
                    className="mcp-json-textarea"
                    rows={16}
                    value={drawerConfigText}
                    onChange={(e) => {
                      setDrawerConfigText(e.target.value);
                      try {
                        JSON.parse(e.target.value);
                        setDrawerConfigError(null);
                      } catch (err) {
                        setDrawerConfigError(err.message);
                      }
                    }}
                    spellCheck={false}
                  />
                </div>

                {drawerConfigError && (
                  <div className="mcp-editor-error" style={{ marginTop: "8px" }}>
                    <AlertTriangle size={13} />
                    <span>{drawerConfigError}</span>
                  </div>
                )}

                <div style={{ marginTop: "16px", display: "flex", justifyContent: "flex-end" }}>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={handleSaveDrawerConfig}
                    disabled={savingDrawerConfig || Boolean(drawerConfigError)}
                  >
                    {savingDrawerConfig ? "Saving & Reconnecting..." : "Save & Reconnect Server"}
                  </button>
                </div>
              </div>
            )}

            {/* DRAWER TAB 3: AUDIT LOGS */}
            {drawerTab === "logs" && (
              <div className="mcp-drawer-tab-content">
                {serverLogs.length === 0 ? (
                  <div className="mcp-empty-state-sub">
                    No tool executions recorded for this server yet.
                  </div>
                ) : (
                  <table className="mcp-history-table">
                    <thead>
                      <tr>
                        <th>Time</th>
                        <th>Tool</th>
                        <th>Status</th>
                        <th>Duration</th>
                        <th>Arguments</th>
                      </tr>
                    </thead>
                    <tbody>
                      {serverLogs.map((log) => (
                        <tr key={log._id || log.id}>
                          <td style={{ color: "var(--text-muted)", fontSize: "11px" }}>
                            {new Date(log.createdAt).toLocaleTimeString()}
                          </td>
                          <td>
                            <code>{log.toolName}</code>
                          </td>
                          <td>
                            <span
                              className={`badge-status ${
                                log.status === "completed"
                                  ? "success"
                                  : log.status === "error"
                                  ? "error"
                                  : "rejected"
                              }`}
                            >
                              {log.status}
                            </span>
                          </td>
                          <td>{log.durationMs ? `${log.durationMs}ms` : "-"}</td>
                          <td>
                            <pre
                              style={{
                                margin: 0,
                                fontSize: "10px",
                                maxHeight: "40px",
                                overflowY: "hidden",
                              }}
                            >
                              {JSON.stringify(log.args || log.arguments || {}, null, 1)}
                            </pre>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}

            {/* DRAWER TAB 4: PROCESS STDERR & DIAGNOSTICS */}
            {drawerTab === "diagnostics" && (
              <div className="mcp-drawer-tab-content">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
                  <span className="mcp-preview-label">
                    Live Process Output & Stderr Stream (last 100 lines)
                  </span>
                  <button
                    type="button"
                    className="mcp-batch-btn"
                    onClick={() => fetchProcessLogs(managingServer._id || managingServer.id)}
                    disabled={loadingProcessLogs}
                  >
                    <RefreshCw size={11} className={loadingProcessLogs ? "spin" : ""} style={{ marginRight: "4px" }} />
                    Refresh Logs
                  </button>
                </div>
                {managingServer.lastError && (
                  <div className="mcp-editor-error" style={{ marginBottom: "10px" }}>
                    <AlertTriangle size={13} />
                    <span>Last Error: {managingServer.lastError}</span>
                  </div>
                )}
                <div className="mcp-schema-box" style={{ maxHeight: "420px", fontSize: "11px", lineHeight: 1.5 }}>
                  {processLogs.length === 0 ? (
                    <span style={{ color: "var(--text-muted)" }}>
                      No stderr or lifecycle logs recorded for this server yet.
                    </span>
                  ) : (
                    processLogs.map((entry, idx) => (
                      <div
                        key={idx}
                        style={{
                          color:
                            entry.level === "stderr" || entry.level === "error"
                              ? "#f87171"
                              : "#a1a1aa",
                          marginBottom: "4px",
                        }}
                      >
                        <span style={{ opacity: 0.6 }}>
                          [{new Date(entry.timestamp).toLocaleTimeString()}] [{entry.level.toUpperCase()}]
                        </span>{" "}
                        {entry.text}
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
