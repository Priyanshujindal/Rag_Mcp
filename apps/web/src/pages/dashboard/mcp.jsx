import React, { useState, useEffect } from "react";
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
  Mail,
  HardDrive,
  Calendar,
  FileText,
  Github,
  MessageSquare,
  CheckSquare,
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
  getMcpExecutions,
  getIntegrationsCatalog,
  getActiveMcpTools,
  isMock,
} from "@/lib/api";
import { Link } from "react-router-dom";
import "./mcp.css";

function statusVariant(status) {
  const s = status?.toLowerCase();
  return s === "connected" ? "success" : s === "error" ? "danger" : "neutral";
}

export default function McpPage() {
  const [activeTab, setActiveTab] = useState("servers"); // 'servers' | 'apps' | 'history'
  const [servers, setServers] = useState([]);
  const [integrations, setIntegrations] = useState([]);
  const [executions, setExecutions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [successMsg, setSuccessMsg] = useState(null);

  const [addDialog, setAddDialog] = useState(false);
  const [newServer, setNewServer] = useState({
    name: "",
    url: "",
    command: "",
    transport: "STREAMABLE_HTTP",
    authHeader: "",
  });

  const [testingId, setTestingId] = useState(null);
  const [testResults, setTestResults] = useState({});
  const [refreshingId, setRefreshingId] = useState(null);
  const [expandedSchemas, setExpandedSchemas] = useState({});

  const fetchServers = () => {
    setLoading(true);
    setError(null);
    Promise.all([
      getMockMcpServers().catch(() => []),
      getIntegrationsCatalog().catch(() => []),
    ])
      .then(([serversData, integrationsData]) => {
        setServers(Array.isArray(serversData) ? serversData : []);
        setIntegrations(Array.isArray(integrationsData) ? integrationsData : []);
      })
      .catch((err) => {
        setError(err.message || "Failed to load MCP servers");
      })
      .finally(() => {
        setLoading(false);
      });
  };

  const fetchHistory = () => {
    getMcpExecutions()
      .then((data) => {
        setExecutions(Array.isArray(data) ? data : []);
      })
      .catch(() => {});
  };

  useEffect(() => {
    fetchServers();
    fetchHistory();
  }, []);

  const handleAddServer = async () => {
    if (!newServer.name.trim()) return;
    try {
      const payload = {
        name: newServer.name.trim(),
        transport: newServer.transport,
        url: newServer.url ? newServer.url.trim() : null,
        command: newServer.command ? newServer.command.trim() : null,
      };

      if (newServer.authHeader) {
        payload.headers = {
          Authorization: newServer.authHeader.startsWith("Bearer ")
            ? newServer.authHeader
            : `Bearer ${newServer.authHeader}`,
        };
      }

      await createMcpServer(payload);
      setSuccessMsg(`Server "${newServer.name}" added successfully.`);
      setTimeout(() => setSuccessMsg(null), 4000);
      setAddDialog(false);
      setNewServer({
        name: "",
        url: "",
        command: "",
        transport: "STREAMABLE_HTTP",
        authHeader: "",
      });
      fetchServers();
    } catch (err) {
      setError(err.message || "Failed to add MCP server");
    }
  };

  const handleDeleteServer = async (id, name) => {
    if (!window.confirm(`Are you sure you want to remove MCP server "${name}"?`)) return;
    try {
      await deleteMcpServer(id);
      setServers((prev) => prev.filter((s) => (s._id || s.id) !== id));
      setSuccessMsg(`Server "${name}" removed.`);
      setTimeout(() => setSuccessMsg(null), 3000);
    } catch (err) {
      setError(err.message || "Failed to delete server");
    }
  };

  const handleTestConnection = async (srv) => {
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

  const handleRefreshTools = async (srv) => {
    const sId = srv._id || srv.id;
    setRefreshingId(sId);
    try {
      const updated = await refreshMcpTools(sId);
      setServers((prev) =>
        prev.map((s) => ((s._id || s.id) === sId ? updated : s))
      );
      setSuccessMsg(`Tools refreshed for "${srv.name}".`);
      setTimeout(() => setSuccessMsg(null), 3000);
    } catch (err) {
      setError(err.message || "Failed to refresh tools");
    } finally {
      setRefreshingId(null);
    }
  };

  const togglePermission = async (serverId, toolName, currentApproval) => {
    const nextApproval = !currentApproval;
    try {
      await toggleMcpTool(serverId, toolName, {
        requiresApproval: nextApproval,
        permission: nextApproval ? "always_ask" : "auto",
      });
      setServers((prev) =>
        prev.map((srv) =>
          (srv._id || srv.id) !== serverId
            ? srv
            : {
                ...srv,
                tools: (srv.tools || []).map((t) =>
                  t.name !== toolName
                    ? t
                    : {
                        ...t,
                        requiresApproval: nextApproval,
                        permission: nextApproval ? "always_ask" : "auto",
                      }
                ),
              }
        )
      );
    } catch (err) {
      setError(err.message || "Failed to update tool permission");
    }
  };

  const toggleToolEnabled = async (serverId, toolName, currentEnabled) => {
    const nextEnabled = !currentEnabled;
    try {
      await toggleMcpTool(serverId, toolName, {
        enabled: nextEnabled,
      });
      setServers((prev) =>
        prev.map((srv) =>
          (srv._id || srv.id) !== serverId
            ? srv
            : {
                ...srv,
                tools: (srv.tools || []).map((t) =>
                  t.name !== toolName ? t : { ...t, enabled: nextEnabled }
                ),
              }
        )
      );
    } catch (err) {
      setError(err.message || "Failed to toggle tool");
    }
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Model Context Protocol (MCP)</h1>
          <p className="page-desc">
            Connect AI models to external tools, databases, and APIs using the official Model Context Protocol.
          </p>
        </div>
        <button className="btn btn-primary btn-with-icon" onClick={() => setAddDialog(true)}>
          <Plus size={15} /> Add MCP Server
        </button>
      </div>

      {error && (
        <div style={{ color: "#ef4444", fontSize: "13px", marginBottom: "16px", padding: "8px 12px", background: "rgba(239, 68, 68, 0.1)", borderRadius: "6px" }}>
          {error}
        </div>
      )}

      {successMsg && (
        <div style={{ color: "#10b981", fontSize: "13px", marginBottom: "16px", padding: "8px 12px", background: "rgba(16, 185, 129, 0.1)", borderRadius: "6px" }}>
          {successMsg}
        </div>
      )}

      {/* Navigation Tabs */}
      <div className="mcp-tabs">
        <button
          type="button"
          className={`mcp-tab-btn ${activeTab === "servers" ? "active" : ""}`}
          onClick={() => setActiveTab("servers")}
        >
          <Layers size={14} /> Connected Servers & Tools ({servers.length})
        </button>
        <button
          type="button"
          className={`mcp-tab-btn ${activeTab === "apps" ? "active" : ""}`}
          onClick={() => setActiveTab("apps")}
        >
          <Plug size={14} /> Connected Apps & Integrations (Gmail, Drive, etc.)
        </button>
        <button
          type="button"
          className={`mcp-tab-btn ${activeTab === "history" ? "active" : ""}`}
          onClick={() => {
            setActiveTab("history");
            fetchHistory();
          }}
        >
          <History size={14} /> Execution Audit History ({executions.length})
        </button>
      </div>

      {activeTab === "servers" && (
        loading ? (
          <div>
            <CardSkeleton />
            <div style={{ marginTop: "16px" }}><CardSkeleton /></div>
          </div>
        ) : servers.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">
              <Server size={24} />
            </div>
            <div className="empty-state-title">No MCP servers registered</div>
            <div className="empty-state-desc">Add an MCP server to give your chatbot access to external tools and APIs.</div>
            <button className="btn btn-primary btn-with-icon" onClick={() => setAddDialog(true)}>
              <Plus size={15} /> Add MCP Server
            </button>
          </div>
        ) : (
          servers.map((srv) => {
            const sId = srv._id || srv.id;
            const testInfo = testResults[sId];
            return (
              <div key={sId} className="mcp-server-card">
                <div className="mcp-server-header">
                  <div className="mcp-server-icon">
                    <Server size={18} />
                  </div>
                  <div className="mcp-server-info">
                    <div className="mcp-server-name">{srv.name}</div>
                    <div className="mcp-server-desc">
                      {srv.description || srv.url || srv.command || "Model Context Protocol Tool Provider"}
                    </div>
                  </div>
                  <Badge variant={statusVariant(srv.status)} dot>{srv.status || "CONNECTED"}</Badge>
                  <div className="mcp-transport-badge">
                    {srv.transport || "STREAMABLE_HTTP"}
                  </div>

                  <div className="mcp-server-actions">
                    <button
                      type="button"
                      className="mcp-icon-btn"
                      title="Test live connection to server"
                      onClick={() => handleTestConnection(srv)}
                      disabled={testingId === sId}
                    >
                      <Activity size={12} className={testingId === sId ? "spin" : ""} />
                      <span>{testingId === sId ? "Testing..." : "Test Connection"}</span>
                    </button>

                    <button
                      type="button"
                      className="mcp-icon-btn"
                      title="Refresh discovered tools list"
                      onClick={() => handleRefreshTools(srv)}
                      disabled={refreshingId === sId}
                    >
                      <RefreshCw size={12} className={refreshingId === sId ? "spin" : ""} />
                      <span>{refreshingId === sId ? "Refreshing..." : "Refresh Tools"}</span>
                    </button>

                    {srv.name !== "Builtin System Tools" && (
                      <button
                        type="button"
                        className="mcp-icon-btn danger"
                        title="Delete server"
                        onClick={() => handleDeleteServer(sId, srv.name)}
                      >
                        <Trash2 size={12} />
                      </button>
                    )}
                  </div>
                </div>

                {/* Connection Test Diagnostics Banner */}
                {testInfo && (
                  <div style={{
                    marginTop: "10px",
                    padding: "8px 12px",
                    borderRadius: "6px",
                    fontSize: "12px",
                    background: testInfo.success ? "rgba(16, 185, 129, 0.1)" : "rgba(239, 68, 68, 0.1)",
                    color: testInfo.success ? "#10b981" : "#ef4444",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between"
                  }}>
                    <span>
                      {testInfo.success
                        ? `✅ Connection Healthy: Discovered ${testInfo.toolCount} tools, ${testInfo.resourceCount || 0} resources, ${testInfo.promptCount || 0} prompts.`
                        : `❌ Connection Failed: ${testInfo.error}`}
                    </span>
                    <button
                      type="button"
                      style={{ background: "none", border: "none", color: "inherit", cursor: "pointer", fontSize: "11px" }}
                      onClick={() => setTestResults((prev) => ({ ...prev, [sId]: null }))}
                    >
                      Dismiss
                    </button>
                  </div>
                )}

                {/* Tools List */}
                <div className="mcp-tools-section">
                  <div className="mcp-tools-label">Available Tools ({srv.tools?.length || 0})</div>
                  {(!srv.tools || srv.tools.length === 0) ? (
                    <div style={{ fontSize: "12px", color: "var(--text-muted)" }}>No tools discovered yet. Click "Refresh Tools" to query server capabilities.</div>
                  ) : (
                    srv.tools.map((tool) => {
                      const requiresAppr = Boolean(tool.requiresApproval || tool.permission === "always_ask");
                      const isEnabled = tool.enabled !== false;
                      const schemaKey = `${sId}:${tool.name}`;
                      const isSchemaOpen = Boolean(expandedSchemas[schemaKey]);

                      return (
                        <div key={tool.name} className="mcp-tool-row">
                          <div className="mcp-tool-main-row">
                            <div className="mcp-tool-info">
                              <div className="mcp-tool-name">
                                <Wrench size={13} className="icon-faint" />
                                <code>{tool.name}</code>
                              </div>
                              <div className="mcp-tool-desc">{tool.description}</div>
                            </div>

                            <div className="mcp-tool-controls">
                              <div className="mcp-tool-control-group">
                                <span className="mcp-control-label">Enabled</span>
                                <Switch
                                  checked={isEnabled}
                                  onChange={() => toggleToolEnabled(sId, tool.name, isEnabled)}
                                />
                              </div>

                              <div className="mcp-tool-control-group">
                                <span className="mcp-control-label">Approval Policy</span>
                                <button
                                  type="button"
                                  className={`mcp-approval-btn ${requiresAppr ? "approval-required" : "approval-auto"}`}
                                  onClick={() => togglePermission(sId, tool.name, requiresAppr)}
                                  title={requiresAppr ? "Human approval is required before execution" : "Runs automatically without confirmation"}
                                >
                                  {requiresAppr ? (
                                    <>
                                      <AlertTriangle size={11} /> Required
                                    </>
                                  ) : (
                                    <>
                                      <CheckCircle size={11} /> Auto
                                    </>
                                  )}
                                </button>
                              </div>
                            </div>
                          </div>

                          {tool.inputSchema && Object.keys(tool.inputSchema).length > 0 && (
                            <div>
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
                                <span>{isSchemaOpen ? "Hide Input Schema" : "View Input Schema"}</span>
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
            );
          })
        )
      )}

      {/* Connected Apps & Integrations Tab */}
      {activeTab === "apps" && (
        <div>
          <div style={{ background: "rgba(59, 130, 246, 0.08)", border: "1px solid rgba(59, 130, 246, 0.25)", borderRadius: "8px", padding: "14px 18px", marginBottom: "18px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "10px" }}>
            <div>
              <div style={{ fontWeight: 600, color: "var(--foreground)", fontSize: "14px" }}>
                Connected Apps & Integrations
              </div>
              <div style={{ fontSize: "12px", color: "var(--text-muted)", marginTop: "2px" }}>
                Connect third-party accounts (Gmail, Google Drive, Notion, GitHub, Slack) to execute live queries and actions in chat.
              </div>
            </div>
            <Link to="/apps" className="btn btn-primary btn-sm" style={{ textDecoration: "none" }}>
              <ExternalLink size={13} style={{ marginRight: "4px" }} /> Open Apps Marketplace
            </Link>
          </div>

          {integrations.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">
                <Plug size={24} />
              </div>
              <div className="empty-state-title">No Connected Apps loaded</div>
              <div className="empty-state-desc">Open the Apps Marketplace to connect your personal or work accounts.</div>
              <Link to="/apps" className="btn btn-primary btn-with-icon" style={{ textDecoration: "none" }}>
                <Plug size={15} /> Go to Apps Marketplace
              </Link>
            </div>
          ) : (
            integrations.map((app) => (
              <div key={app.id} className="mcp-server-card">
                <div className="mcp-server-header">
                  <div className="mcp-server-icon">
                    {app.id === "gmail" ? <Mail size={18} color="#ea4335" /> :
                     app.id === "google_drive" ? <HardDrive size={18} color="#34a853" /> :
                     app.id === "google_calendar" ? <Calendar size={18} color="#4285f4" /> :
                     app.id === "notion" ? <FileText size={18} /> :
                     app.id === "github" ? <Github size={18} /> :
                     app.id === "slack" ? <MessageSquare size={18} color="#e01e5a" /> :
                     app.id === "linear" ? <CheckSquare size={18} color="#5e6ad2" /> :
                     <Plug size={18} />}
                  </div>
                  <div className="mcp-server-info">
                    <div className="mcp-server-name" style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      {app.name}
                      <span className="mcp-transport-badge">{app.category}</span>
                    </div>
                    <div className="mcp-server-desc">
                      {app.description}
                    </div>
                  </div>
                  <div className="mcp-server-status">
                    <span className={`badge-status ${app.isConnected ? "connected" : "disconnected"}`}>
                      {app.isConnected ? "CONNECTED" : app.status === "coming_soon" ? "COMING SOON" : "AVAILABLE"}
                    </span>
                    <Link to="/apps" className="btn btn-secondary btn-sm" style={{ textDecoration: "none" }}>
                      {app.isConnected ? "Manage" : "Connect"}
                    </Link>
                  </div>
                </div>

                {/* Exposed App Tools List */}
                <div className="mcp-tools-section">
                  <div className="mcp-tools-header">
                    <div className="mcp-tools-title">
                      <Wrench size={12} />
                      <span>Exposed Tools ({app.tools?.length || 0})</span>
                    </div>
                  </div>

                  <div className="mcp-tools-grid">
                    {(app.tools || []).map((tool) => (
                      <div key={tool.name} className="mcp-tool-row">
                        <div className="mcp-tool-details">
                          <div className="mcp-tool-name-line">
                            <span className="mcp-tool-name">{tool.fullName || tool.name}</span>
                            <span className="mcp-tool-kind">
                              {tool.writeOperation ? "WRITE ACTION" : "READ ONLY"}
                            </span>
                          </div>
                          <div className="mcp-tool-desc">{tool.description}</div>
                        </div>

                        <div className="mcp-tool-actions">
                          <div className="mcp-tool-control-group">
                            <span className="mcp-control-label">Policy</span>
                            <span className={`mcp-approval-btn ${tool.writeOperation ? "approval-required" : "approval-auto"}`}>
                              {tool.writeOperation ? <AlertTriangle size={11} /> : <CheckCircle size={11} />}
                              {tool.writeOperation ? "Approval Required" : "Auto Run"}
                            </span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Execution Audit History Tab */}
      {activeTab === "history" && (
        <div className="mcp-server-card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px" }}>
            <div className="mcp-server-name">Recent Tool Executions</div>
            <button type="button" className="mcp-icon-btn" onClick={fetchHistory}>
              <RefreshCw size={12} /> Refresh Logs
            </button>
          </div>

          {executions.length === 0 ? (
            <div style={{ textAlign: "center", padding: "30px", color: "var(--text-muted)", fontSize: "13px" }}>
              No tool executions recorded yet. Ask the AI to perform queries or math in chat!
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="mcp-history-table">
                <thead>
                  <tr>
                    <th>Status</th>
                    <th>Tool Name</th>
                    <th>Server</th>
                    <th>Duration</th>
                    <th>Timestamp</th>
                    <th>Input Arguments</th>
                    <th>Result Summary</th>
                  </tr>
                </thead>
                <tbody>
                  {executions.map((ex) => (
                    <tr key={ex.id || ex._id}>
                      <td>
                        <span className={`badge-status ${ex.status}`}>
                          {ex.status}
                        </span>
                      </td>
                      <td>
                        <code>{ex.toolName}</code>
                      </td>
                      <td style={{ color: "var(--text-muted)" }}>{ex.serverName}</td>
                      <td>{ex.durationMs ? `${ex.durationMs}ms` : "-"}</td>
                      <td style={{ color: "var(--text-muted)", fontSize: "11px" }}>
                        {ex.createdAt ? new Date(ex.createdAt).toLocaleTimeString() : "-"}
                      </td>
                      <td>
                        <pre style={{ margin: 0, fontSize: "10px", maxHeight: "40px", overflow: "hidden" }}>
                          {typeof ex.args === "string" ? ex.args : JSON.stringify(ex.args)}
                        </pre>
                      </td>
                      <td>
                        <span style={{ fontSize: "11px", color: ex.error ? "#ef4444" : "var(--text-muted)" }}>
                          {ex.error || ex.resultSummary || "Completed"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Add Server Dialog */}
      <Dialog open={addDialog} onClose={() => setAddDialog(false)}>
        <DialogTitle>Add MCP Server</DialogTitle>
        <DialogDesc>Connect a new local or remote Model Context Protocol server.</DialogDesc>
        <div style={{ marginTop: "16px", display: "flex", flexDirection: "column", gap: "12px" }}>
          <div>
            <label className="form-label">Server Name</label>
            <input
              className="input"
              type="text"
              placeholder="e.g. Remote Weather MCP"
              value={newServer.name}
              onChange={(e) => setNewServer({ ...newServer, name: e.target.value })}
            />
          </div>

          <div>
            <label className="form-label">Transport</label>
            <select
              className="input"
              value={newServer.transport}
              onChange={(e) => setNewServer({ ...newServer, transport: e.target.value })}
            >
              <option value="STREAMABLE_HTTP">Streamable HTTP (Standard for Remote MCP)</option>
              <option value="SSE">SSE (Server-Sent Events HTTP)</option>
              <option value="STDIO">STDIO (Local sub-process)</option>
            </select>
          </div>

          {newServer.transport !== "STDIO" ? (
            <div>
              <label className="form-label">Server URL</label>
              <input
                className="input"
                type="url"
                placeholder="https://api.my-mcp-server.com/mcp"
                value={newServer.url}
                onChange={(e) => setNewServer({ ...newServer, url: e.target.value })}
              />
            </div>
          ) : (
            <div>
              <label className="form-label">Command Line (Local Development)</label>
              <input
                className="input"
                type="text"
                placeholder="node packages/mcp-servers/builtin-server.js"
                value={newServer.command}
                onChange={(e) => setNewServer({ ...newServer, command: e.target.value })}
              />
            </div>
          )}

          {newServer.transport !== "STDIO" && (
            <div>
              <label className="form-label">Optional Bearer Token / API Key</label>
              <input
                className="input"
                type="password"
                placeholder="Optional Authorization token"
                value={newServer.authHeader}
                onChange={(e) => setNewServer({ ...newServer, authHeader: e.target.value })}
              />
            </div>
          )}
        </div>
        <DialogFooter>
          <button className="btn btn-secondary" onClick={() => setAddDialog(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={handleAddServer}>Connect & Discover</button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}
