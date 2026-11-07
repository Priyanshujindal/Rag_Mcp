import React, { useState, useEffect } from "react";
import { Plus, Server, Wrench, CheckCircle, AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogTitle, DialogDesc, DialogFooter } from "@/components/ui/dialog";
import { CardSkeleton } from "@/components/ui/skeleton";
import { getMockMcpServers, createMcpServer, toggleMcpTool, isMock } from "@/lib/api";
import "./mcp.css";

function statusVariant(status) {
  const s = status?.toLowerCase();
  return s === "connected" ? "success" : s === "error" ? "danger" : "neutral";
}

export default function McpPage() {
  const [servers, setServers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [addDialog, setAddDialog] = useState(false);
  const [newServer, setNewServer] = useState({ name: "", command: "", transport: "stdio" });

  const fetchServers = () => {
    setLoading(true);
    setError(null);
    getMockMcpServers()
      .then((data) => {
        setServers(Array.isArray(data) ? data : []);
      })
      .catch((err) => {
        setError(err.message || "Failed to load MCP servers");
      })
      .finally(() => {
        setLoading(false);
      });
  };

  useEffect(() => {
    fetchServers();
  }, []);

  const handleAddServer = async () => {
    if (!newServer.name.trim()) return;
    try {
      if (!isMock) {
        await createMcpServer({
          name: newServer.name,
          command: newServer.command,
          transport: newServer.transport.toUpperCase(),
        });
        fetchServers();
      } else {
        const mockNew = {
          id: `mcp_${Date.now()}`,
          name: newServer.name,
          description: "Custom MCP server",
          status: "connected",
          transport: newServer.transport,
          tools: [],
        };
        setServers((prev) => [...prev, mockNew]);
      }
      setAddDialog(false);
      setNewServer({ name: "", command: "", transport: "stdio" });
    } catch (err) {
      setError(err.message || "Failed to add MCP server");
    }
  };

  const togglePermission = async (serverId, toolId, toolName) => {
    const server = servers.find((s) => s.id === serverId);
    const tool = server?.tools.find((t) => (t.id === toolId || t.name === toolName));
    if (!tool) return;

    const newApproval = tool.permission === "auto" || !tool.requiresApproval;

    try {
      if (!isMock) {
        await toggleMcpTool(serverId, toolName || tool.name, {
          requiresApproval: newApproval,
        });
      }
      setServers((prev) =>
        prev.map((srv) =>
          srv.id !== serverId ? srv : {
            ...srv,
            tools: srv.tools.map((t) =>
              (t.id !== toolId && t.name !== toolName) ? t : {
                ...t,
                permission: newApproval ? "require_approval" : "auto",
                requiresApproval: newApproval,
              }
            ),
          }
        )
      );
    } catch (err) {
      setError(err.message || "Failed to update tool permissions");
    }
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">MCP Plugins & Tools</h1>
          <p className="page-desc">Connect external tools via the Model Context Protocol. Control which tools the AI can call.</p>
        </div>
        <button className="btn btn-primary btn-with-icon" onClick={() => setAddDialog(true)}>
          <Plus size={15} /> Add MCP Server
        </button>
      </div>

      {error && (
        <div style={{ color: "#ef4444", fontSize: "13px", marginBottom: "16px" }}>
          {error}
        </div>
      )}

      {loading ? (
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
        servers.map((srv) => (
          <div key={srv.id} className="mcp-server-card">
            <div className="mcp-server-header">
              <div className="mcp-server-icon">
                <Server size={16} />
              </div>
              <div className="mcp-server-info">
                <div className="mcp-server-name">{srv.name}</div>
                <div className="mcp-server-desc">{srv.description || "Model Context Protocol Tool Provider"}</div>
              </div>
              <Badge variant={statusVariant(srv.status)} dot>{srv.status}</Badge>
              <div className="mcp-transport-badge">
                {srv.transport}
              </div>
            </div>

            <div className="mcp-tools-section">
              <div className="mcp-tools-label">Available Tools ({srv.tools?.length || 0})</div>
              {srv.tools?.map((tool) => {
                const requiresAppr = tool.requiresApproval || tool.permission === "require_approval";
                return (
                  <div key={tool.id || tool.name} className="mcp-tool-row">
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
                        <Switch defaultChecked={tool.enabled ?? true} />
                      </div>

                      <div className="mcp-tool-control-group">
                        <span className="mcp-control-label">Require approval</span>
                        <button
                          type="button"
                          className={`mcp-approval-btn ${requiresAppr ? "approval-required" : "approval-auto"}`}
                          onClick={() => togglePermission(srv.id, tool.id, tool.name)}
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
                );
              })}
            </div>
          </div>
        ))
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
              placeholder="e.g. GitHub Copilot MCP"
              value={newServer.name}
              onChange={(e) => setNewServer({ ...newServer, name: e.target.value })}
            />
          </div>
          <div>
            <label className="form-label">Command / URL</label>
            <input
              className="input"
              type="text"
              placeholder="npx -y @modelcontextprotocol/server-filesystem /path"
              value={newServer.command}
              onChange={(e) => setNewServer({ ...newServer, command: e.target.value })}
            />
          </div>
          <div>
            <label className="form-label">Transport</label>
            <select
              className="input"
              value={newServer.transport}
              onChange={(e) => setNewServer({ ...newServer, transport: e.target.value })}
            >
              <option value="stdio">STDIO (Local sub-process)</option>
              <option value="sse">SSE (Server-Sent Events HTTP)</option>
            </select>
          </div>
        </div>
        <DialogFooter>
          <button className="btn btn-secondary" onClick={() => setAddDialog(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={handleAddServer}>Add Server</button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}
