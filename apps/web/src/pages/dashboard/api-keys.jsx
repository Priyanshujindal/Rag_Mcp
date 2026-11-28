import React, { useState, useEffect } from "react";
import {
  Plus,
  Copy,
  Trash2,
  Key,
  AlertCircle,
  RefreshCw,
  Globe,
  Lock,
  Code2,
  RotateCw,
  BarChart2,
  CheckCircle,
  ExternalLink,
  Shield,
  Bot,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { TableSkeleton } from "@/components/ui/skeleton";
import { Dialog, DialogTitle, DialogDesc, DialogFooter } from "@/components/ui/dialog";
import {
  getMockApiKeys,
  getMockChatbots,
  createApiKey,
  rotateApiKey,
  revokeApiKey,
  deleteApiKey,
  getApiKeyUsage,
  getApiOrigin,
  isMock,
} from "@/lib/api";
import "./api-keys.css";

function formatDate(iso) {
  if (!iso) return "Never";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatRelativeTime(iso) {
  if (!iso) return "Never";
  const date = new Date(iso);
  const diffSec = Math.floor((Date.now() - date.getTime()) / 1000);
  if (diffSec < 60) return "Just now";
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return `${Math.floor(diffSec / 86400)}d ago`;
}

export default function ApiKeysPage() {
  const apiOrigin = getApiOrigin();
  const [keys, setKeys] = useState([]);
  const [chatbots, setChatbots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState("all");

  // Create Modal State
  const [createDialog, setCreateDialog] = useState(false);
  const [formName, setFormName] = useState("");
  const [formType, setFormType] = useState("publishable");
  const [formChatbotId, setFormChatbotId] = useState("");
  const [formOrigins, setFormOrigins] = useState("http://localhost:3000\nhttp://localhost:5173");
  const [formRateLimit, setFormRateLimit] = useState(60);
  const [formExpiresInDays, setFormExpiresInDays] = useState(0);

  // One-time Reveal Dialog
  const [revealDialog, setRevealDialog] = useState(null);
  const [copiedSecret, setCopiedSecret] = useState(false);

  // Usage Modal State
  const [usageKey, setUsageKey] = useState(null);
  const [usageData, setUsageData] = useState(null);
  const [loadingUsage, setLoadingUsage] = useState(false);

  // Documentation snippet active tab
  const [docSnippetLang, setDocSnippetLang] = useState("curl");

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [keysRes, botsRes] = await Promise.all([
        getMockApiKeys().catch(() => []),
        getMockChatbots().catch(() => []),
      ]);

      const keysArray = Array.isArray(keysRes) ? keysRes : keysRes?.data || [];
      const botsArray = Array.isArray(botsRes) ? botsRes : botsRes?.data || [];

      setKeys(keysArray);
      setChatbots(botsArray);
      if (botsArray.length > 0 && !formChatbotId) {
        setFormChatbotId(botsArray[0].id || botsArray[0]._id);
      }
    } catch (err) {
      setError(err.message || "Failed to load API keys");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleCreate = async () => {
    setError(null);
    try {
      const originsList = formOrigins
        .split(/[\n,]/)
        .map((s) => s.trim())
        .filter(Boolean);

      const payload = {
        name: formName.trim() || `${formType === "publishable" ? "Frontend Web" : "Backend"} Key`,
        keyType: formType,
        chatbotId: formChatbotId || (chatbots[0]?.id || chatbots[0]?._id),
        allowedOrigins: originsList.length > 0 ? originsList : ["*"],
        rateLimit: {
          requestsPerMinute: Number(formRateLimit) || 60,
        },
        expiresInDays: Number(formExpiresInDays) || undefined,
      };

      const res = await createApiKey(payload);
      const createdKey = res.apiKey || res;
      const secret = res.secret || res.key;

      setKeys((prev) => [createdKey, ...prev]);
      setCreateDialog(false);
      setRevealDialog({
        ...createdKey,
        secret,
      });

      // Reset form
      setFormName("");
      setFormType("publishable");
      setFormOrigins("http://localhost:3000\nhttp://localhost:5173");
    } catch (err) {
      setError(err.message || "Failed to create API key");
    }
  };

  const handleRotate = async (key) => {
    if (
      !window.confirm(
        `Rotate key "${key.name}"? The existing secret will be immediately invalidated and a new one generated.`
      )
    ) {
      return;
    }

    try {
      const res = await rotateApiKey(key.id || key._id);
      const updatedKey = res.apiKey || key;
      const newSecret = res.secret;

      setKeys((prev) =>
        prev.map((k) => (k.id === key.id || k._id === key._id ? { ...k, ...updatedKey } : k))
      );

      setRevealDialog({
        ...updatedKey,
        secret: newSecret,
        rotated: true,
      });
    } catch (err) {
      setError(err.message || "Failed to rotate API key");
    }
  };

  const handleRevoke = async (id) => {
    if (!window.confirm("Revoke this API key? External clients using it will immediately receive 401 Unauthorized.")) {
      return;
    }
    try {
      await revokeApiKey(id);
      loadData();
    } catch (err) {
      setError(err.message || "Failed to revoke API key");
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Permanently delete this API key? This action cannot be undone.")) {
      return;
    }
    try {
      await deleteApiKey(id);
      setKeys((prev) => prev.filter((k) => k.id !== id && k._id !== id));
    } catch (err) {
      setError(err.message || "Failed to delete API key");
    }
  };

  const handleViewUsage = async (key) => {
    setUsageKey(key);
    setLoadingUsage(true);
    try {
      const res = await getApiKeyUsage(key.id || key._id);
      setUsageData(res.data || res);
    } catch (err) {
      setUsageData({
        summary: key.usage || { totalRequests: 0, successfulRequests: 0 },
        lastUsedAt: key.lastUsedAt,
        recentLogs: [],
      });
    } finally {
      setLoadingUsage(false);
    }
  };

  const handleCopy = (text) => {
    navigator.clipboard.writeText(text);
    setCopiedSecret(true);
    setTimeout(() => setCopiedSecret(false), 2000);
  };

  // Filter keys by tab
  const filteredKeys = keys.filter((k) => {
    if (activeTab === "publishable") return k.keyType === "publishable";
    if (activeTab === "secret") return k.keyType === "secret";
    return true;
  });

  const totalKeys = keys.length;
  const activeKeys = keys.filter((k) => k.status === "active" && !k.revokedAt).length;
  const pubKeys = keys.filter((k) => k.keyType === "publishable").length;
  const secKeys = keys.filter((k) => k.keyType === "secret").length;

  const sampleChatbotId = chatbots[0]?.publicId || chatbots[0]?.id || "YOUR_CHATBOT_ID";

  return (
    <div className="api-keys-container">
      {/* Page Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Platform API Keys & External Chatbot API</h1>
          <p className="page-desc">
            Authenticate external websites, browser widgets, and server applications to interact with your hosted RAG chatbots.
          </p>
        </div>
        <div style={{ display: "flex", gap: "10px" }}>
          <button
            type="button"
            className="btn btn-secondary btn-with-icon"
            onClick={() => setActiveTab("docs")}
          >
            <Code2 size={15} /> Integration Docs
          </button>
          <button
            type="button"
            className="btn btn-primary btn-with-icon"
            onClick={() => {
              if (chatbots.length === 0) {
                alert("Please create a chatbot first before generating an API key.");
                return;
              }
              setCreateDialog(true);
            }}
          >
            <Plus size={15} /> Create API Key
          </button>
        </div>
      </div>

      {/* Error Banner */}
      {error && (
        <div
          className="card"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            borderColor: "var(--danger)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "8px", color: "var(--danger)" }}>
            <AlertCircle size={16} />
            <span>{error}</span>
          </div>
          <button type="button" className="btn btn-secondary btn-sm" onClick={loadData}>
            <RefreshCw size={12} /> Retry
          </button>
        </div>
      )}

      {/* Metric Overview Cards */}
      <div className="api-overview-grid">
        <div className="api-overview-card">
          <div className="api-overview-icon">
            <Key size={20} />
          </div>
          <div>
            <div className="api-overview-value">{totalKeys}</div>
            <div className="api-overview-label">Total Keys</div>
          </div>
        </div>

        <div className="api-overview-card">
          <div className="api-overview-icon publishable">
            <Globe size={20} />
          </div>
          <div>
            <div className="api-overview-value">{pubKeys}</div>
            <div className="api-overview-label">Publishable Keys (rag_pk_)</div>
          </div>
        </div>

        <div className="api-overview-card">
          <div className="api-overview-icon secret">
            <Lock size={20} />
          </div>
          <div>
            <div className="api-overview-value">{secKeys}</div>
            <div className="api-overview-label">Secret Keys (rag_sk_)</div>
          </div>
        </div>

        <div className="api-overview-card">
          <div className="api-overview-icon" style={{ background: "rgba(34, 197, 94, 0.12)", color: "#22c55e" }}>
            <Shield size={20} />
          </div>
          <div>
            <div className="api-overview-value">{activeKeys}</div>
            <div className="api-overview-label">Active Keys</div>
          </div>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="api-tab-bar">
        <button
          type="button"
          className={`api-tab-btn ${activeTab === "all" ? "active" : ""}`}
          onClick={() => setActiveTab("all")}
        >
          All Keys ({totalKeys})
        </button>
        <button
          type="button"
          className={`api-tab-btn ${activeTab === "publishable" ? "active" : ""}`}
          onClick={() => setActiveTab("publishable")}
        >
          <Globe size={13} /> Publishable Keys ({pubKeys})
        </button>
        <button
          type="button"
          className={`api-tab-btn ${activeTab === "secret" ? "active" : ""}`}
          onClick={() => setActiveTab("secret")}
        >
          <Lock size={13} /> Secret Keys ({secKeys})
        </button>
        <button
          type="button"
          className={`api-tab-btn ${activeTab === "docs" ? "active" : ""}`}
          onClick={() => setActiveTab("docs")}
        >
          <Code2 size={13} /> Quick Start & API Docs
        </button>
      </div>

      {/* TAB CONTENT: API KEYS TABLE */}
      {activeTab !== "docs" && (
        <>
          {loading ? (
            <TableSkeleton rows={4} cols={6} />
          ) : filteredKeys.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">
                <Key size={24} />
              </div>
              <div className="empty-state-title">No API keys found</div>
              <div className="empty-state-desc">
                {activeTab === "publishable"
                  ? "Create a publishable key (rag_pk_) to embed chatbots onto your frontend websites."
                  : activeTab === "secret"
                  ? "Create a secret key (rag_sk_) for server-to-server backend integrations."
                  : "Create an API key to allow external apps to communicate with your chatbots."}
              </div>
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
                    <th className="apikey-th">Key Name & Type</th>
                    <th className="apikey-th">Target Chatbot</th>
                    <th className="apikey-th">Key Prefix / Mask</th>
                    <th className="apikey-th">Allowed Origins</th>
                    <th className="apikey-th">Last Used</th>
                    <th className="apikey-th apikey-th-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredKeys.map((k) => {
                    const keyId = k.id || k._id;
                    const isPub = k.keyType === "publishable";
                    const isRevoked = k.status === "revoked" || !!k.revokedAt;
                    const isDisabled = k.status === "disabled";
                    const botName = k.chatbot?.name || k.chatbotId?.name || "Target Chatbot";

                    return (
                      <tr key={keyId} className="apikey-tr">
                        <td className="apikey-td">
                          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                            <span className="apikey-name">{k.name}</span>
                            {isPub ? (
                              <span className="api-key-badge-pub">Publishable</span>
                            ) : (
                              <span className="api-key-badge-sec">Secret</span>
                            )}
                            {isRevoked ? (
                              <Badge variant="danger">Revoked</Badge>
                            ) : isDisabled ? (
                              <Badge variant="warning">Disabled</Badge>
                            ) : (
                              <Badge variant="success">Active</Badge>
                            )}
                          </div>
                        </td>

                        <td className="apikey-td">
                          <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "13px" }}>
                            <Bot size={14} style={{ color: "var(--accent)" }} />
                            <span>{botName}</span>
                          </div>
                        </td>

                        <td className="apikey-td">
                          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                            <code className="api-key-code">
                              {k.maskedKey || (k.prefix ? `${k.prefix}••••••••••••` : "rag_sk_live_••••")}
                            </code>
                            <button
                              type="button"
                              className="btn btn-ghost btn-icon btn-sm"
                              onClick={() => handleCopy(k.maskedKey || k.prefix)}
                              title="Copy identifier"
                            >
                              <Copy size={13} />
                            </button>
                          </div>
                        </td>

                        <td className="apikey-td apikey-td-meta">
                          {isPub ? (
                            Array.isArray(k.allowedOrigins) && k.allowedOrigins.length > 0 ? (
                              <span title={k.allowedOrigins.join(", ")}>
                                {k.allowedOrigins.includes("*")
                                  ? "All (*)"
                                  : k.allowedOrigins.slice(0, 2).join(", ") +
                                    (k.allowedOrigins.length > 2 ? ` (+${k.allowedOrigins.length - 2})` : "")}
                              </span>
                            ) : (
                              "None configured"
                            )
                          ) : (
                            <span style={{ color: "var(--text-muted)" }}>Server-side only</span>
                          )}
                        </td>

                        <td className="apikey-td apikey-td-meta">
                          <span title={k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString() : "Never used"}>
                            {formatRelativeTime(k.lastUsedAt)}
                          </span>
                        </td>

                        <td className="apikey-td apikey-td-right">
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "4px" }}>
                            <button
                              type="button"
                              className="btn btn-ghost btn-icon btn-sm"
                              onClick={() => handleViewUsage(k)}
                              title="View usage analytics"
                            >
                              <BarChart2 size={13} />
                            </button>

                            {!isRevoked && (
                              <button
                                type="button"
                                className="btn btn-ghost btn-icon btn-sm"
                                onClick={() => handleRotate(k)}
                                title="Rotate secret key"
                              >
                                <RotateCw size={13} />
                              </button>
                            )}

                            {!isRevoked ? (
                              <button
                                type="button"
                                className="btn btn-ghost btn-sm"
                                onClick={() => handleRevoke(keyId)}
                                style={{ color: "var(--danger)", fontSize: "12px" }}
                              >
                                Revoke
                              </button>
                            ) : (
                              <button
                                type="button"
                                className="btn btn-ghost btn-icon btn-sm"
                                onClick={() => handleDelete(keyId)}
                                title="Delete permanently"
                              >
                                <Trash2 size={13} className="icon-danger" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* TAB CONTENT: DEVELOPER INTEGRATION DOCS */}
      {activeTab === "docs" && (
        <div className="api-docs-panel">
          <div className="card" style={{ background: "rgba(99, 102, 241, 0.05)", borderColor: "rgba(99, 102, 241, 0.2)" }}>
            <h3 style={{ fontSize: "16px", fontWeight: "600", marginBottom: "8px" }}>
              Public Chatbot API (v1) Reference
            </h3>
            <p style={{ fontSize: "13px", color: "var(--text-secondary)", lineHeight: 1.6 }}>
              All external chatbot requests must be authenticated using a platform API key. Publishable keys (
              <code>rag_pk_live_...</code>) are intended for browser embedding with origin validation, while secret keys (
              <code>rag_sk_live_...</code>) are designed for server-to-server calls.
            </p>
          </div>

          <div style={{ display: "flex", gap: "8px" }}>
            {["curl", "javascript", "nodejs", "python"].map((lang) => (
              <button
                key={lang}
                type="button"
                className={`btn btn-sm ${docSnippetLang === lang ? "btn-primary" : "btn-secondary"}`}
                onClick={() => setDocSnippetLang(lang)}
              >
                {lang === "curl"
                  ? "cURL"
                  : lang === "javascript"
                  ? "Browser / Frontend (JS)"
                  : lang === "nodejs"
                  ? "Node.js (Backend)"
                  : "Python"}
              </button>
            ))}
          </div>

          {/* Snippet Block */}
          <div className="api-snippet-block">
            <div className="api-snippet-header">
              <span>
                {docSnippetLang === "curl" && "POST /api/v1/public/chatbots/:chatbotId/messages"}
                {docSnippetLang === "javascript" && "Frontend Widget / React SSE Stream"}
                {docSnippetLang === "nodejs" && "Server-to-Server Backend Integration"}
                {docSnippetLang === "python" && "Python Backend Client (requests/httpx)"}
              </span>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  let codeToCopy = "";
                  if (docSnippetLang === "curl") {
                    codeToCopy = `curl -X POST "${apiOrigin}/api/v1/public/chatbots/${sampleChatbotId}/messages" \\\n  -H "Authorization: Bearer rag_sk_live_YOUR_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '{\n    "message": "What is our company return policy?",\n    "visitorId": "user_visitor_123"\n  }'`;
                  } else if (docSnippetLang === "javascript") {
                    codeToCopy = `// Browser SSE Streaming with Publishable Key\nconst response = await fetch("${apiOrigin}/api/v1/public/chatbots/${sampleChatbotId}/messages/stream", {\n  method: "POST",\n  headers: {\n    "x-api-key": "rag_pk_live_YOUR_KEY",\n    "Content-Type": "application/json"\n  },\n  body: JSON.stringify({\n    message: "Hello chatbot!",\n    visitorId: "anon_visitor_abc"\n  })\n});`;
                  }
                  handleCopy(codeToCopy);
                }}
              >
                <Copy size={12} /> Copy Snippet
              </button>
            </div>

            <pre className="api-snippet-content">
              {docSnippetLang === "curl" &&
`# 1. Synchronous Message Request (Returns JSON response)
curl -X POST "${apiOrigin}/api/v1/public/chatbots/${sampleChatbotId}/messages" \\
  -H "Authorization: Bearer rag_sk_live_YOUR_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "message": "How do I return a purchased item?",
    "visitorId": "visitor_anon_8821"
  }'

# 2. Real-time Streaming SSE Response (Live token chunks)
curl -N -X POST "${apiOrigin}/api/v1/public/chatbots/${sampleChatbotId}/messages/stream" \\
  -H "Authorization: Bearer rag_pk_live_YOUR_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "message": "Tell me about your services",
    "visitorId": "visitor_anon_8821"
  }'

# 3. Safe Public Chatbot Configuration
curl "${apiOrigin}/api/v1/public/chatbots/${sampleChatbotId}" \\
  -H "Authorization: Bearer rag_pk_live_YOUR_KEY"`}

              {docSnippetLang === "javascript" &&
`// Browser Client / Frontend Integration using Publishable Key
async function askChatbot(userMessage, visitorId) {
  const response = await fetch("${apiOrigin}/api/v1/public/chatbots/${sampleChatbotId}/messages/stream", {
    method: "POST",
    headers: {
      "Authorization": "Bearer rag_pk_live_YOUR_PUBLISHABLE_KEY",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      message: userMessage,
      visitorId: visitorId // preserves conversation across visitor sessions
    })
  });

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value);
    const lines = chunk.split("\\n");
    for (const line of lines) {
      if (line.startsWith("event: token")) {
        // Handle token event
      } else if (line.startsWith("data: ")) {
        const payload = JSON.parse(line.slice(6));
        if (payload.delta) {
          process.stdout.write(payload.delta);
        }
      }
    }
  }
}`}

              {docSnippetLang === "nodejs" &&
`// Node.js Server-to-Server Integration using Secret Key
import fetch from "node-fetch";

async function queryRagChatbot(prompt) {
  const res = await fetch("${apiOrigin}/api/v1/public/chatbots/${sampleChatbotId}/messages", {
    method: "POST",
    headers: {
      "Authorization": "Bearer rag_sk_live_YOUR_SECRET_KEY",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      message: prompt,
      options: {
        temperature: 0.7
      }
    })
  });

  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error?.message || "Public chatbot call failed");
  }

  const data = await res.json();
  console.log("Assistant:", data.message.content);
  console.log("Citations:", data.message.citations);
  console.log("Usage:", data.usage);
  return data;
}`}

              {docSnippetLang === "python" &&
`# Python Backend Integration using Secret Key
import requests

url = "${apiOrigin}/api/v1/public/chatbots/${sampleChatbotId}/messages"
headers = {
    "Authorization": "Bearer rag_sk_live_YOUR_SECRET_KEY",
    "Content-Type": "application/json"
}
payload = {
    "message": "Summarize the key requirements",
    "visitorId": "user_42"
}

response = requests.post(url, json=payload, headers=headers)
if response.status_code == 200:
    data = response.json()
    print("Answer:", data["message"]["content"])
    print("Citations:", data["message"]["citations"])
else:
    print("Error:", response.status_code, response.text)`}
            </pre>
          </div>
        </div>
      )}

      {/* CREATE API KEY DIALOG */}
      <Dialog open={createDialog} onClose={() => setCreateDialog(false)}>
        <DialogTitle>Create Platform API Key</DialogTitle>
        <DialogDesc>
          Generate a scoped credential to allow external applications to communicate with your chatbot.
        </DialogDesc>

        <div style={{ display: "flex", flexDirection: "column", gap: "16px", marginTop: "16px" }}>
          {/* Key Name */}
          <div>
            <label className="form-label">Key Name</label>
            <input
              className="input"
              type="text"
              placeholder="e.g. Production Website Embed"
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              autoFocus
            />
          </div>

          {/* Key Type Selection */}
          <div>
            <label className="form-label">Key Type & Intended Environment</label>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
              <div
                className={`type-selector-card ${formType === "publishable" ? "selected" : ""}`}
                onClick={() => setFormType("publishable")}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "8px", fontWeight: "600", marginBottom: "4px" }}>
                  <Globe size={16} style={{ color: "#10b981" }} />
                  <span>Publishable</span>
                </div>
                <div style={{ fontSize: "11px", color: "var(--text-muted)", lineHeight: 1.4 }}>
                  For browsers, frontend embeds & public widgets. Origin-restricted (rag_pk_).
                </div>
              </div>

              <div
                className={`type-selector-card ${formType === "secret" ? "selected" : ""}`}
                onClick={() => setFormType("secret")}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "8px", fontWeight: "600", marginBottom: "4px" }}>
                  <Lock size={16} style={{ color: "#f59e0b" }} />
                  <span>Secret</span>
                </div>
                <div style={{ fontSize: "11px", color: "var(--text-muted)", lineHeight: 1.4 }}>
                  For server-to-server backends. Never expose in frontend client code (rag_sk_).
                </div>
              </div>
            </div>
          </div>

          {/* Chatbot Selector (Strict 1-to-1 Scoping) */}
          <div>
            <label className="form-label">Target Chatbot Scope (1 Key → 1 Chatbot)</label>
            <select
              className="input"
              value={formChatbotId}
              onChange={(e) => setFormChatbotId(e.target.value)}
            >
              {chatbots.map((bot) => (
                <option key={bot.id || bot._id} value={bot.id || bot._id}>
                  {bot.name} ({bot.publicId || bot.id || bot._id})
                </option>
              ))}
            </select>
            <div style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "4px" }}>
              Requests using this key will only be authorized to interact with the selected chatbot.
            </div>
          </div>

          {/* Allowed Origins (for publishable keys) */}
          {formType === "publishable" && (
            <div>
              <label className="form-label">Allowed Web Domains / Origins</label>
              <textarea
                className="input"
                rows={3}
                placeholder="http://localhost:3000&#10;https://mycompany.com&#10;*"
                value={formOrigins}
                onChange={(e) => setFormOrigins(e.target.value)}
              />
              <div style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "4px" }}>
                Enter allowed web domains (one per line, e.g. <code>https://example.com</code> or <code>*</code> for testing).
              </div>
            </div>
          )}

          {/* Rate Limits & Expiration Grid */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
            <div>
              <label className="form-label">Rate Limit (Req/Min)</label>
              <input
                className="input"
                type="number"
                min="1"
                max="1000"
                value={formRateLimit}
                onChange={(e) => setFormRateLimit(e.target.value)}
              />
            </div>

            <div>
              <label className="form-label">Expiration</label>
              <select
                className="input"
                value={formExpiresInDays}
                onChange={(e) => setFormExpiresInDays(e.target.value)}
              >
                <option value="0">Never expires</option>
                <option value="30">30 days</option>
                <option value="90">90 days</option>
                <option value="365">1 year</option>
              </select>
            </div>
          </div>
        </div>

        <DialogFooter>
          <button type="button" className="btn btn-secondary" onClick={() => setCreateDialog(false)}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={handleCreate}>
            Generate API Key
          </button>
        </DialogFooter>
      </Dialog>

      {/* ONE-TIME SECRET REVEAL MODAL */}
      <Dialog open={!!revealDialog} onClose={() => setRevealDialog(null)}>
        <DialogTitle>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <CheckCircle size={20} style={{ color: "var(--success)" }} />
            <span>{revealDialog?.rotated ? "API Key Rotated" : "Save Your New API Key"}</span>
          </div>
        </DialogTitle>
        <DialogDesc>
          Please copy your API key now. For your security, this complete secret will <strong>never</strong> be displayed again.
        </DialogDesc>

        <div style={{ marginTop: "16px", display: "flex", flexDirection: "column", gap: "12px" }}>
          <div className="api-key-secret-box">
            <code>{revealDialog?.secret}</code>
            <button
              type="button"
              className="btn btn-primary btn-sm btn-with-icon"
              onClick={() => handleCopy(revealDialog?.secret)}
            >
              <Copy size={13} /> {copiedSecret ? "Copied!" : "Copy"}
            </button>
          </div>

          <div
            style={{
              padding: "10px 14px",
              borderRadius: "var(--radius-md)",
              background: revealDialog?.keyType === "secret" ? "rgba(245, 158, 11, 0.1)" : "rgba(16, 185, 129, 0.1)",
              border: `1px solid ${revealDialog?.keyType === "secret" ? "rgba(245, 158, 11, 0.3)" : "rgba(16, 185, 129, 0.3)"}`,
              fontSize: "12px",
              color: revealDialog?.keyType === "secret" ? "#f59e0b" : "#10b981",
              lineHeight: 1.5,
            }}
          >
            {revealDialog?.keyType === "secret" ? (
              <span>
                <strong>Warning:</strong> This is a secret server credential. Never expose it in browser code, client repositories, or public embeds.
              </span>
            ) : (
              <span>
                <strong>Publishable Key:</strong> This key is safe for frontend scripts and embed widgets, restricted to your configured domains.
              </span>
            )}
          </div>
        </div>

        <DialogFooter>
          <button type="button" className="btn btn-primary" onClick={() => setRevealDialog(null)}>
            I have securely saved this key
          </button>
        </DialogFooter>
      </Dialog>

      {/* USAGE ANALYTICS MODAL */}
      <Dialog open={!!usageKey} onClose={() => setUsageKey(null)}>
        <DialogTitle>Usage Analytics: {usageKey?.name}</DialogTitle>
        <DialogDesc>Request volumes and telemetry recorded for this API key.</DialogDesc>

        <div style={{ marginTop: "16px" }}>
          {loadingUsage ? (
            <div style={{ padding: "20px", textAlign: "center", color: "var(--text-muted)" }}>
              Loading telemetry...
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "10px" }}>
                <div className="card" style={{ padding: "12px", textAlign: "center" }}>
                  <div style={{ fontSize: "20px", fontWeight: "700" }}>
                    {usageData?.summary?.totalRequests || 0}
                  </div>
                  <div style={{ fontSize: "11px", color: "var(--text-muted)" }}>Total Requests</div>
                </div>
                <div className="card" style={{ padding: "12px", textAlign: "center" }}>
                  <div style={{ fontSize: "20px", fontWeight: "700", color: "#10b981" }}>
                    {usageData?.summary?.successfulRequests || 0}
                  </div>
                  <div style={{ fontSize: "11px", color: "var(--text-muted)" }}>Successful</div>
                </div>
                <div className="card" style={{ padding: "12px", textAlign: "center" }}>
                  <div style={{ fontSize: "20px", fontWeight: "700", color: "#f59e0b" }}>
                    {usageData?.summary?.rateLimitedRequests || 0}
                  </div>
                  <div style={{ fontSize: "11px", color: "var(--text-muted)" }}>Rate Limited</div>
                </div>
              </div>

              <div style={{ fontSize: "12px", color: "var(--text-muted)", display: "flex", flexDirection: "column", gap: "6px" }}>
                <div>
                  <strong>Input Tokens:</strong> {usageData?.summary?.totalInputTokens?.toLocaleString() || 0}
                </div>
                <div>
                  <strong>Output Tokens:</strong> {usageData?.summary?.totalOutputTokens?.toLocaleString() || 0}
                </div>
                <div>
                  <strong>Last Used IP:</strong> {usageData?.lastUsedIp || "N/A"}
                </div>
                <div>
                  <strong>Last Origin:</strong> {usageData?.lastUsedOrigin || "Direct / Server"}
                </div>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <button type="button" className="btn btn-secondary" onClick={() => setUsageKey(null)}>
            Close
          </button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}
