import React, { useState, useEffect } from "react";
import { Plus, Copy, Eye, EyeOff, Trash2, Key, AlertCircle, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { TableSkeleton } from "@/components/ui/skeleton";
import { Dialog, DialogTitle, DialogDesc, DialogFooter } from "@/components/ui/dialog";
import { getMockApiKeys, createApiKey, revokeApiKey, deleteApiKey, isMock } from "@/lib/api";
import "./api-keys.css";

function formatDate(iso) {
  if (!iso) return "Never";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default function ApiKeysPage() {
  const [keys, setKeys] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [createDialog, setCreateDialog] = useState(false);
  const [newKeyDialog, setNewKeyDialog] = useState(null);
  const [newKeyName, setNewKeyName] = useState("");
  const [revealId, setRevealId] = useState(null);
  const [copied, setCopied] = useState(false);

  const fetchKeys = () => {
    setLoading(true);
    setError(null);
    getMockApiKeys()
      .then((data) => {
        setKeys(Array.isArray(data) ? data : []);
      })
      .catch((err) => {
        setError(err.message || "Failed to load API keys");
      })
      .finally(() => {
        setLoading(false);
      });
  };

  useEffect(() => {
    fetchKeys();
  }, []);

  const handleCreate = async () => {
    setError(null);
    try {
      if (!isMock) {
        const res = await createApiKey({ name: newKeyName || "Unnamed Key" });
        const createdKey = {
          ...res.apiKey,
          secret: res.secret,
        };
        setKeys((k) => [res.apiKey, ...k]);
        setNewKeyDialog(createdKey);
      } else {
        const created = {
          id: `key_${Date.now()}`,
          name: newKeyName || "Unnamed Key",
          prefix: `ragmcp_live_${Math.random().toString(36).slice(2, 10)}`,
          secret: `ragmcp_live_${"x".repeat(32)}`,
          createdAt: new Date().toISOString(),
          lastUsedAt: null,
          rateLimitPerMin: 60,
        };
        setKeys((k) => [...k, created]);
        setNewKeyDialog(created);
      }
      setCreateDialog(false);
      setNewKeyName("");
    } catch (err) {
      setError(err.message || "Failed to create API key");
    }
  };

  const handleCopy = (text) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleRevoke = async (id) => {
    if (window.confirm("Revoke this API key? This cannot be undone.")) {
      try {
        if (!isMock) {
          await revokeApiKey(id);
          fetchKeys();
        } else {
          setKeys((k) => k.filter((key) => key.id !== id));
        }
      } catch (err) {
        setError(err.message || "Failed to revoke API key");
      }
    }
  };

  const handleDelete = async (id) => {
    try {
      if (!isMock) {
        await deleteApiKey(id);
        fetchKeys();
      } else {
        setKeys((k) => k.filter((key) => key.id !== id));
      }
    } catch (err) {
      setError(err.message || "Failed to delete API key");
    }
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">API Keys</h1>
          <p className="page-desc">Manage API keys for integrating Rag_Mcp into your applications.</p>
        </div>
        <button
          type="button"
          className="btn btn-primary btn-with-icon"
          onClick={() => setCreateDialog(true)}
          aria-label="Create API Key"
        >
          <Plus size={15} /> Create API Key
        </button>
      </div>

      {error && (
        <div className="card" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px", borderColor: "var(--danger)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", color: "var(--danger)", fontSize: "14px" }}>
            <AlertCircle size={16} />
            <span>{error}</span>
          </div>
          <button type="button" className="btn btn-secondary btn-sm" onClick={fetchKeys}>
            <RefreshCw size={12} /> Retry
          </button>
        </div>
      )}

      {loading ? (
        <TableSkeleton rows={4} cols={5} />
      ) : keys.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">
            <Key size={24} />
          </div>
          <div className="empty-state-title">No API keys yet</div>
          <div className="empty-state-desc">Create an API key to connect external services to your chatbots.</div>
          <button
            type="button"
            className="btn btn-primary btn-with-icon"
            onClick={() => setCreateDialog(true)}
          >
            <Plus size={15} /> Create API Key
          </button>
        </div>
      ) : (
        <div className="card apikey-table-wrapper">
          <table className="apikey-table">
            <thead>
              <tr className="apikey-tr-head">
                <th className="apikey-th">Name</th>
                <th className="apikey-th">Key Prefix</th>
                <th className="apikey-th">Created</th>
                <th className="apikey-th">Last Used</th>
                <th className="apikey-th apikey-th-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => (
                <tr key={k.id} className="apikey-tr">
                  <td className="apikey-td">
                    <span className="apikey-name">{k.name}</span>
                    {k.revokedAt && (
                      <Badge variant="danger" className="apikey-badge">Revoked</Badge>
                    )}
                  </td>
                  <td className="apikey-td">
                    <div className="apikey-key-preview">
                      <code className="apikey-code">
                        {revealId === k.id
                          ? (k.secret || k.prefix)
                          : `${k.prefix || "ragmcp_live_..."}`}
                      </code>
                      <button
                        type="button"
                        className="btn btn-ghost btn-icon btn-sm"
                        onClick={() => setRevealId(revealId === k.id ? null : k.id)}
                        title={revealId === k.id ? "Hide" : "Show"}
                        aria-label={revealId === k.id ? "Hide key" : "Show key"}
                      >
                        {revealId === k.id ? <EyeOff size={13} /> : <Eye size={13} />}
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-icon btn-sm"
                        onClick={() => handleCopy(k.secret || k.prefix)}
                        title="Copy"
                        aria-label="Copy key"
                      >
                        <Copy size={13} />
                      </button>
                    </div>
                  </td>
                  <td className="apikey-td apikey-td-meta">{formatDate(k.createdAt)}</td>
                  <td className="apikey-td apikey-td-meta">{formatDate(k.lastUsedAt)}</td>
                  <td className="apikey-td apikey-td-right">
                    {!k.revokedAt ? (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => handleRevoke(k.id)}
                        style={{ color: "var(--danger)" }}
                      >
                        Revoke
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="btn btn-ghost btn-icon btn-sm"
                        onClick={() => handleDelete(k.id)}
                        title="Delete permanently"
                        aria-label="Delete key permanently"
                      >
                        <Trash2 size={13} className="icon-danger" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Create Dialog */}
      <Dialog open={createDialog} onClose={() => setCreateDialog(false)}>
        <DialogTitle>Create API Key</DialogTitle>
        <DialogDesc>Give your API key a recognizable name to track usage.</DialogDesc>
        <div style={{ marginTop: "16px" }}>
          <label htmlFor="key-name-input" className="form-label">Key Name</label>
          <input
            id="key-name-input"
            className="input"
            type="text"
            placeholder="e.g. Production Webhook Agent"
            value={newKeyName}
            onChange={(e) => setNewKeyName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            autoFocus
          />
        </div>
        <DialogFooter>
          <button type="button" className="btn btn-secondary" onClick={() => setCreateDialog(false)}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={handleCreate}>
            Create Key
          </button>
        </DialogFooter>
      </Dialog>

      {/* Secret Reveal Dialog (Shown ONCE only) */}
      <Dialog open={!!newKeyDialog} onClose={() => setNewKeyDialog(null)}>
        <DialogTitle>Save Your API Key</DialogTitle>
        <DialogDesc>
          Make sure to copy your API key now as you won't be able to see it again!
        </DialogDesc>
        <div style={{ marginTop: "16px" }}>
          <div className="apikey-secret-box" style={{ background: "var(--bg-main)", padding: "12px", borderRadius: "var(--radius-md)", border: "1px solid var(--border-color)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <code style={{ fontSize: "13px", color: "var(--accent)" }}>{newKeyDialog?.secret}</code>
            <button
              type="button"
              className="btn btn-secondary btn-sm btn-with-icon"
              onClick={() => handleCopy(newKeyDialog?.secret)}
            >
              <Copy size={13} /> {copied ? "Copied!" : "Copy"}
            </button>
          </div>
        </div>
        <DialogFooter>
          <button type="button" className="btn btn-primary" onClick={() => setNewKeyDialog(null)}>
            I have saved this key
          </button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}
