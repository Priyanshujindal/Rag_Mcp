import React, { useState } from "react";
import {
  FileJson,
  Sliders,
  AlertTriangle,
  Check,
  X,
} from "lucide-react";
import { Dialog, DialogTitle, DialogDesc } from "@/components/ui/dialog";
import { importMcpConfig } from "@/lib/api";

export const MCP_CONFIG_TEMPLATES = {
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

export default function AddMcpModal({ open, onClose, onSuccess }) {
  const [addMode, setAddMode] = useState("editor"); // 'editor' | 'guided'
  const [editorText, setEditorText] = useState(
    JSON.stringify(MCP_CONFIG_TEMPLATES.calculator.config, null, 2)
  );
  const [editorError, setEditorError] = useState(null);
  const [autoConnectOnImport, setAutoConnectOnImport] = useState(true);
  const [importing, setImporting] = useState(false);
  const [guidedError, setGuidedError] = useState(null);

  const [guidedForm, setGuidedForm] = useState({
    name: "",
    transport: "stdio",
    command: "npx",
    args: "",
    envVars: [{ key: "", value: "" }],
    url: "",
    authHeader: "",
  });

  if (!open) return null;

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
    const tmpl = MCP_CONFIG_TEMPLATES[templateKey];
    if (tmpl) {
      setEditorText(JSON.stringify(tmpl.config, null, 2));
      setEditorError(null);
    }
  };

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
      onSuccess?.(res);
      onClose();
    } catch (err) {
      setEditorError(err.message || "Import failed");
    } finally {
      setImporting(false);
    }
  };

  const handleGuidedSubmit = async () => {
    setGuidedError(null);
    if (!guidedForm.name.trim()) {
      setGuidedError("Server name is required");
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
        if (!guidedForm.url.trim()) {
          setGuidedError("Server Endpoint URL is required");
          setImporting(false);
          return;
        }
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
      onSuccess?.(res);
      onClose();
    } catch (err) {
      setGuidedError(err.message || "Failed to create server");
    } finally {
      setImporting(false);
    }
  };

  return (
    <Dialog open onOpenChange={(isOpen) => !isOpen && onClose()}>
      <div className="mcp-modal-overlay" onClick={onClose}>
        <div className="mcp-modal-content" onClick={(e) => e.stopPropagation()}>
          <div className="mcp-modal-header">
            <div>
              <DialogTitle className="mcp-modal-title">
                Add Custom MCP Server App
              </DialogTitle>
              <DialogDesc className="mcp-modal-desc">
                Paste an Antigravity MCP JSON configuration or use the guided form to add any local command or remote MCP server.
              </DialogDesc>
            </div>
            <button type="button" className="mcp-btn-close" onClick={onClose}>
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
              <FileJson size={14} /> JSON Configuration Editor
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
                {Object.entries(MCP_CONFIG_TEMPLATES).map(([key, item]) => (
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
                  rows={13}
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
              {guidedError && (
                <div className="mcp-editor-error">
                  <AlertTriangle size={13} />
                  <span>{guidedError}</span>
                </div>
              )}

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
            <button type="button" className="btn btn-secondary" onClick={onClose}>
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
  );
}
