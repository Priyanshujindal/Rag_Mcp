import React, { useState, useEffect, useRef } from "react";
import {
  ChevronDown,
  History,
  Plus,
  Trash2,
  MessageSquare,
  Database,
  Sparkles,
  Check,
  X,
  Pencil,
  Pin,
  Download,
  FileText,
  Code2,
  Plug,
  Wrench,
  ExternalLink,
} from "lucide-react";
import { api } from "@/lib/api/client";
import { exportChat } from "@/lib/utils/chat-export";
import { getActiveMcpTools } from "@/lib/api";

export const PROVIDER_OPTIONS = {
  cloudflare: {
    id: "cloudflare",
    name: "Cloudflare AI ☁️",
    defaultModel: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
    models: [
      { id: "@cf/meta/llama-3.3-70b-instruct-fp8-fast", name: "Llama 3.3 70B ⚡ (Fast & Smart)" },
      { id: "@cf/meta/llama-3.1-8b-instruct", name: "Llama 3.1 8B (Ultra Fast)" },
      { id: "@cf/mistralai/mistral-small-3.1-24b-instruct", name: "Mistral Small 3.1 24B" },
      { id: "@cf/google/gemma-4-26b-a4b-it", name: "Google Gemma 4 26B" },
      { id: "@cf/qwen/qwen2.5-coder-32b-instruct", name: "Qwen 2.5 Coder 32B" },
      { id: "@cf/openai/gpt-oss-120b", name: "GPT-OSS 120B (via CF)" },
      { id: "@cf/cloudflare/clairic-flash", name: "Clairic Flash (Cloudflare)" },
    ],
  },
  groq: {
    id: "groq",
    name: "Groq ⚡",
    defaultModel: "qwen/qwen3.8-27b",
    models: [
      { id: "qwen/qwen3.8-27b", name: "Qwen 3.8 27B ⚡ (Ultra Fast & Reasoning)" },
      { id: "openai/gpt-oss-120b", name: "GPT OSS 120B (High Intelligence & Reasoning)" },
      { id: "openai/gpt-oss-20b", name: "GPT OSS 20B (Fast & Lightweight)" },
      { id: "allam-2-7b", name: "ALLaM 2 7B" },
      { id: "openai/gpt-oss-safeguard-20b", name: "Safety GPT OSS 20B" },
    ],
  },
  gemini: {
    id: "gemini",
    name: "Google Gemini",
    defaultModel: "gemini-3.5-flash-lite",
    models: [
      { id: "gemini-3.5-flash-lite", name: "Gemini 3.5 Flash Lite ⚡ (Fast & Stable)" },
      { id: "gemini-3.8-flash", name: "Gemini 3.8 Flash" },
      { id: "gemini-3.6-flash", name: "Gemini 3.6 Flash" },
    ],
  },
  openrouter: {
    id: "openrouter",
    name: "OpenRouter",
    defaultModel: "nvidia/nemotron-3-ultra-550b-a55b:free",
    models: [
      { id: "nvidia/nemotron-3-ultra-550b-a55b:free", name: "NVIDIA Nemotron Ultra ⭐ (Free)" },
      { id: "openrouter/free", name: "OpenRouter Free (Dynamic)" },
      { id: "google/gemma-4:free", name: "Google Gemma 4 (Free)" },
    ],
  },
};

export function ChatHeader({ 
  selectedProvider = "gemini", 
  setSelectedProvider,
  selectedModel = "gemini-3.8-flash",
  setSelectedModel,
  knowledgeBaseId,
  setKnowledgeBaseId,
  chatMode = "rag",
  setChatMode,
  conversationId,
  conversations = [],
  selectConversation,
  newConversation,
  deleteConversation,
  renameConversation,
  togglePinConversation,
  isLoadingConversations,
  messages = [],
}) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [activeTools, setActiveTools] = useState([]);
  const [knowledgeBases, setKnowledgeBases] = useState([]);
  const [loading, setLoading] = useState(true);

  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");

  const activeConversation = conversations.find(
    (c) => (c.id || c._id) === conversationId
  );
  const activeTitle = activeConversation?.title || "New Conversation";
  const isPinned = Boolean(activeConversation?.isPinned);

  const selectorRef = useRef(null);
  const historyRef = useRef(null);
  const exportRef = useRef(null);
  const toolsRef = useRef(null);

  const handleSaveTitle = () => {
    if (draftTitle && draftTitle.trim() && conversationId) {
      renameConversation && renameConversation(conversationId, draftTitle.trim());
    }
    setIsEditingTitle(false);
  };

  useEffect(() => {
    function handleClickOutside(event) {
      if (selectorRef.current && !selectorRef.current.contains(event.target)) {
        setDropdownOpen(false);
      }
      if (historyRef.current && !historyRef.current.contains(event.target)) {
        setHistoryOpen(false);
      }
      if (exportRef.current && !exportRef.current.contains(event.target)) {
        setExportOpen(false);
      }
      if (toolsRef.current && !toolsRef.current.contains(event.target)) {
        setToolsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  useEffect(() => {
    getActiveMcpTools()
      .then((tools) => {
        if (Array.isArray(tools) && tools.length > 0) {
          setActiveTools(tools);
        } else {
          setActiveTools([
            { name: "gmail.search_emails", serverName: "Gmail", description: "Search user's Gmail messages" },
            { name: "google_drive.search_files", serverName: "Google Drive", description: "Search Google Drive files" },
            { name: "github.list_repositories", serverName: "GitHub", description: "List repositories" },
            { name: "notion.search", serverName: "Notion", description: "Search Notion workspace" },
            { name: "slack.search_messages", serverName: "Slack", description: "Search Slack discussions" },
            { name: "execute_readonly_sql", serverName: "Builtin", description: "Read-only database queries" },
            { name: "calculate_metrics", serverName: "Builtin", description: "Exact mathematical calculations" },
          ]);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    api.get("/knowledge-bases")
      .then((data) => {
        let kbs = [];
        if (data && data.items && Array.isArray(data.items)) {
          kbs = data.items;
        } else if (data && data.knowledgeBases && Array.isArray(data.knowledgeBases)) {
          kbs = data.knowledgeBases;
        } else if (Array.isArray(data)) {
          kbs = data;
        }
        
        setKnowledgeBases(kbs);
        
        if (!knowledgeBaseId && kbs.length > 0) {
          setKnowledgeBaseId(kbs[0]._id || kbs[0].id);
        }
        setLoading(false);
      })
      .catch((err) => {
        console.error("Failed to load KBs:", err);
        setKnowledgeBases([]);
        setLoading(false);
      });
  }, []);

  const handleProviderSelect = (newProv) => {
    setSelectedProvider && setSelectedProvider(newProv);
    if (newProv === "cloudflare") {
      setSelectedModel && setSelectedModel("@cf/meta/llama-3.3-70b-instruct-fp8-fast");
    } else if (newProv === "groq") {
      setSelectedModel && setSelectedModel("qwen/qwen3.8-27b");
    } else if (newProv === "openrouter") {
      setSelectedModel && setSelectedModel("nvidia/nemotron-3-ultra-550b-a55b:free");
    } else {
      setSelectedModel && setSelectedModel("gemini-3.5-flash-lite");
    }
  };

  const currentKB = Array.isArray(knowledgeBases) 
    ? knowledgeBases.find(kb => kb && (kb._id === knowledgeBaseId || kb.id === knowledgeBaseId))
    : null;

  const providerName =
    selectedProvider === "cloudflare"
      ? "Cloudflare AI ☁️"
      : selectedProvider === "groq"
      ? "Groq ⚡"
      : selectedProvider === "openrouter"
      ? "OpenRouter"
      : "Google Gemini";

  const modelShortName = selectedModel
    ? selectedModel.includes("llama-3.3-70b")
      ? "Llama 3.3 70B"
      : selectedModel.includes("llama-3.1-8b")
      ? "Llama 3.1 8B"
      : selectedModel.includes("mistral-small-3.1")
      ? "Mistral Small 24B"
      : selectedModel.includes("gemma-4-26b")
      ? "Gemma 4 26B"
      : selectedModel.includes("qwen2.5-coder")
      ? "Qwen Coder 32B"
      : selectedModel.includes("clairic-flash")
      ? "Clairic Flash"
      : selectedModel.includes("qwen3.8")
      ? "Qwen 3.8 27B"
      : selectedModel.includes("gpt-oss-120b")
      ? "GPT OSS 120B"
      : selectedModel.includes("gpt-oss-20b")
      ? "GPT OSS 20B"
      : selectedModel.includes("allam")
      ? "ALLaM 2 7B"
      : selectedModel.includes("nemotron")
      ? "Nemotron Ultra"
      : selectedModel.includes("openrouter/free")
      ? "OpenRouter Free"
      : selectedModel.includes("3.8")
      ? "Gemini 3.8 Flash"
      : selectedModel.includes("3.6")
      ? "Gemini 3.6 Flash"
      : selectedModel.includes("3.5")
      ? "Gemini 3.5 Lite"
      : selectedModel.startsWith("@cf/")
      ? selectedModel.split("/").pop()
      : selectedModel
    : "Llama 3.3 70B";

  const selectorLabel =
    chatMode === "general"
      ? `✨ ${providerName} (${modelShortName})`
      : currentKB
      ? `📚 ${currentKB.name} • ${providerName}`
      : loading
      ? "Loading..."
      : `Select Knowledge Base • ${providerName}`;

  const availableModels =
    PROVIDER_OPTIONS[selectedProvider]?.models || PROVIDER_OPTIONS.gemini.models;

  return (
    <div className="chat-selector-header">
      <div className="chat-header-left">
        {/* RAG vs General Chat Mode Switcher */}
        <div className="chat-mode-toggle-group" role="tablist" aria-label="Chat Mode">
          <button
            type="button"
            role="tab"
            aria-selected={chatMode === "rag"}
            className={`chat-mode-btn ${chatMode === "rag" ? "active" : ""}`}
            onClick={() => setChatMode && setChatMode("rag")}
            title="Knowledge Base mode: Ground responses in your indexed documents and cite sources"
          >
            <Database size={13} />
            <span>Knowledge Base</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={chatMode === "general"}
            className={`chat-mode-btn ${chatMode === "general" ? "active general-mode" : ""}`}
            onClick={() => setChatMode && setChatMode("general")}
            title="General Chat mode: Direct AI conversation like ChatGPT without knowledge base constraints"
          >
            <Sparkles size={13} />
            <span>General Chat</span>
          </button>
        </div>

        {/* Context / Provider Dropdown */}
        <div className="chat-selector-wrapper" ref={selectorRef}>
          <button
            type="button"
            className="chat-selector-btn"
            onClick={() => setDropdownOpen(!dropdownOpen)}
            title="Switch AI Provider, Model, or Knowledge Base"
          >
            <span className="selector-label">{selectorLabel}</span>
            <ChevronDown size={14} />
          </button>

          {dropdownOpen && (
            <div className="chat-selector-dropdown">
              <div className="dropdown-section">
                <div className="dropdown-label">AI Provider</div>
                <select
                  value={selectedProvider}
                  onChange={(e) => handleProviderSelect(e.target.value)}
                  className="dropdown-select"
                >
                  <option value="cloudflare">Cloudflare AI ☁️ (Free Tier)</option>
                  <option value="groq">Groq ⚡ (Ultra Fast)</option>
                  <option value="gemini">Google Gemini</option>
                  <option value="openrouter">OpenRouter</option>
                </select>
              </div>

              <div className="dropdown-section">
                <div className="dropdown-label">Model</div>
                <select
                  value={selectedModel}
                  onChange={(e) => setSelectedModel && setSelectedModel(e.target.value)}
                  className="dropdown-select"
                >
                  {availableModels.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="dropdown-separator" />

              <div className="dropdown-section">
                <div className="dropdown-label">
                  Knowledge Base ({knowledgeBases.length})
                  {chatMode === "general" && " — Click to switch to RAG"}
                </div>
                
                {loading ? (
                  <div className="dropdown-empty">Loading...</div>
                ) : knowledgeBases.length > 0 ? (
                  knowledgeBases.map((kb) => (
                    <button
                      key={kb._id || kb.id}
                      type="button"
                      className={`dropdown-item ${(kb._id === knowledgeBaseId || kb.id === knowledgeBaseId) && chatMode === "rag" ? "active" : ""}`}
                      onClick={() => {
                        setKnowledgeBaseId(kb._id || kb.id);
                        setChatMode && setChatMode("rag");
                        setDropdownOpen(false);
                      }}
                    >
                      {kb.name}
                    </button>
                  ))
                ) : (
                  <div className="dropdown-empty">
                    No knowledge bases found. Create one first!
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="chat-header-right">
        {/* Active Conversation Title & Rename / Pin Pill */}
        {conversationId && (
          <div className="chat-header-title-badge">
            {isEditingTitle ? (
              <div className="header-title-edit-form">
                <input
                  type="text"
                  className="header-title-input"
                  value={draftTitle}
                  autoFocus
                  onChange={(e) => setDraftTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleSaveTitle();
                    if (e.key === "Escape") setIsEditingTitle(false);
                  }}
                />
                <button
                  type="button"
                  className="header-icon-action check"
                  title="Save title"
                  onClick={handleSaveTitle}
                >
                  <Check size={12} />
                </button>
                <button
                  type="button"
                  className="header-icon-action cancel"
                  title="Cancel"
                  onClick={() => setIsEditingTitle(false)}
                >
                  <X size={12} />
                </button>
              </div>
            ) : (
              <div className="header-title-display">
                <span
                  className="header-conversation-name"
                  title={`${activeTitle} (Double-click to rename)`}
                  onDoubleClick={() => {
                    setDraftTitle(activeTitle);
                    setIsEditingTitle(true);
                  }}
                >
                  {activeTitle}
                </span>
                <button
                  type="button"
                  className={`header-icon-action pin ${isPinned ? "pinned" : ""}`}
                  title={isPinned ? "Unpin chat" : "Pin chat to top"}
                  onClick={() => togglePinConversation && togglePinConversation(conversationId, isPinned)}
                >
                  <Pin size={12} className={isPinned ? "fill-current" : ""} />
                </button>
                <button
                  type="button"
                  className="header-icon-action edit"
                  title="Rename chat"
                  onClick={() => {
                    setDraftTitle(activeTitle);
                    setIsEditingTitle(true);
                  }}
                >
                  <Pencil size={12} />
                </button>
              </div>
            )}
          </div>
        )}

        {/* Connected Tools & Apps Dropdown */}
        <div className="chat-export-wrapper" ref={toolsRef}>
          <button
            type="button"
            className={`chat-header-btn ${toolsOpen ? "active" : ""}`}
            onClick={() => setToolsOpen(!toolsOpen)}
            title="Connected MCP Tools & Apps"
            style={{ color: "#38bdf8", border: "1px solid rgba(56, 189, 248, 0.25)", background: toolsOpen ? "rgba(56, 189, 248, 0.15)" : "rgba(56, 189, 248, 0.05)" }}
          >
            <Plug size={14} />
            <span>Tools & Apps ({activeTools.length || 7})</span>
          </button>

          {toolsOpen && (
            <div className="chat-export-dropdown" style={{ minWidth: "320px", maxHeight: "420px", overflowY: "auto", right: 0 }}>
              <div className="export-dropdown-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span>Active Tools & Apps</span>
                <span style={{ fontSize: "10px", color: "#4ade80", fontWeight: 600, background: "rgba(34, 197, 94, 0.15)", padding: "1px 6px", borderRadius: "4px" }}>Active</span>
              </div>

              <div style={{ padding: "8px 12px", borderBottom: "1px solid var(--border)", background: "rgba(255,255,255,0.02)" }}>
                <div style={{ fontSize: "10px", fontWeight: 600, color: "var(--text-muted)", marginBottom: "4px", textTransform: "uppercase" }}>Connected Services:</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "5px" }}>
                  <span style={{ fontSize: "10px", padding: "2px 6px", borderRadius: "4px", background: "rgba(234, 67, 53, 0.15)", color: "#f87171", fontWeight: 600 }}>Gmail</span>
                  <span style={{ fontSize: "10px", padding: "2px 6px", borderRadius: "4px", background: "rgba(52, 168, 83, 0.15)", color: "#4ade80", fontWeight: 600 }}>Google Drive</span>
                  <span style={{ fontSize: "10px", padding: "2px 6px", borderRadius: "4px", background: "rgba(66, 133, 244, 0.15)", color: "#60a5fa", fontWeight: 600 }}>Calendar</span>
                  <span style={{ fontSize: "10px", padding: "2px 6px", borderRadius: "4px", background: "rgba(255, 255, 255, 0.1)", color: "#f8fafc", fontWeight: 600 }}>GitHub</span>
                  <span style={{ fontSize: "10px", padding: "2px 6px", borderRadius: "4px", background: "rgba(255, 255, 255, 0.1)", color: "#f8fafc", fontWeight: 600 }}>Notion</span>
                  <span style={{ fontSize: "10px", padding: "2px 6px", borderRadius: "4px", background: "rgba(224, 30, 90, 0.15)", color: "#f472b6", fontWeight: 600 }}>Slack</span>
                </div>
              </div>

              <div style={{ maxHeight: "220px", overflowY: "auto" }}>
                {activeTools.map((t, i) => (
                  <div key={i} style={{ padding: "8px 12px", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <code style={{ fontSize: "11px", color: "#93c5fd", fontWeight: 600 }}>{t.name}</code>
                      <span style={{ fontSize: "9px", padding: "1px 5px", borderRadius: "3px", background: "rgba(255,255,255,0.08)", color: "var(--text-muted)" }}>
                        {t.serverName || "App"}
                      </span>
                    </div>
                    <div style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "2px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {t.description}
                    </div>
                  </div>
                ))}
              </div>

              <div style={{ padding: "8px 12px", borderTop: "1px solid var(--border)", display: "flex", gap: "8px" }}>
                <a href="/apps" style={{ flex: 1, textAlign: "center", fontSize: "11px", padding: "5px 8px", background: "#3b82f6", color: "#fff", borderRadius: "4px", textDecoration: "none", fontWeight: 600 }}>
                  Manage Apps →
                </a>
                <a href="/mcp" style={{ flex: 1, textAlign: "center", fontSize: "11px", padding: "5px 8px", background: "rgba(255,255,255,0.08)", color: "var(--foreground)", borderRadius: "4px", textDecoration: "none", fontWeight: 500 }}>
                  MCP Plugins
                </a>
              </div>
            </div>
          )}
        </div>

        {/* Export Chat Dropdown */}
        <div className="chat-export-wrapper" ref={exportRef}>
          <button
            type="button"
            className={`chat-header-btn ${exportOpen ? "active" : ""}`}
            disabled={!messages || messages.length === 0}
            onClick={() => setExportOpen(!exportOpen)}
            title={messages && messages.length > 0 ? "Export conversation" : "No messages to export"}
          >
            <Download size={14} />
            <span>Export</span>
          </button>

          {exportOpen && (
            <div className="chat-export-dropdown">
              <div className="export-dropdown-header">Export Conversation</div>
              <button
                type="button"
                className="export-dropdown-item"
                onClick={() => {
                  exportChat({
                    title: activeTitle,
                    messages,
                    provider: selectedProvider,
                    model: selectedModel,
                    format: "markdown",
                  });
                  setExportOpen(false);
                }}
              >
                <FileText size={14} />
                <div className="export-item-meta">
                  <span className="export-item-title">Markdown (.md)</span>
                  <span className="export-item-desc">Formatted transcript with source citations</span>
                </div>
              </button>
              <button
                type="button"
                className="export-dropdown-item"
                onClick={() => {
                  exportChat({
                    title: activeTitle,
                    messages,
                    provider: selectedProvider,
                    model: selectedModel,
                    format: "json",
                  });
                  setExportOpen(false);
                }}
              >
                <Code2 size={14} />
                <div className="export-item-meta">
                  <span className="export-item-title">JSON (.json)</span>
                  <span className="export-item-desc">Structured messages & metadata</span>
                </div>
              </button>
            </div>
          )}
        </div>

        {/* Past Conversations history dropdown */}
        <div className="chat-history-wrapper" ref={historyRef}>
          <button
            type="button"
            className={`chat-header-btn ${historyOpen ? "active" : ""}`}
            onClick={() => setHistoryOpen(!historyOpen)}
            title="Chat History"
          >
            <History size={16} />
            <span>History ({conversations.length})</span>
          </button>

          {historyOpen && (
            <div className="chat-history-dropdown">
              <div className="history-header">
                <span className="history-title">Recent Conversations</span>
                <button
                  type="button"
                  className="btn-new-chat-sm"
                  onClick={() => {
                    newConversation && newConversation();
                    setHistoryOpen(false);
                  }}
                >
                  <Plus size={13} />
                  <span>New</span>
                </button>
              </div>

              <div className="history-list">
                {isLoadingConversations ? (
                  <div className="history-empty">Loading history...</div>
                ) : conversations.length === 0 ? (
                  <div className="history-empty">No past conversations yet.</div>
                ) : (
                  conversations.map((c) => {
                    const cId = c.id || c._id;
                    const isActive = cId === conversationId;
                    return (
                      <div
                        key={cId}
                        className={`history-item ${isActive ? "active" : ""}`}
                        onClick={() => {
                          selectConversation && selectConversation(cId);
                          setHistoryOpen(false);
                        }}
                      >
                        <MessageSquare size={14} className="history-item-icon" />
                        <span className="history-item-title" title={c.title}>
                          {c.title || "Untitled Conversation"}
                        </span>
                        <button
                          type="button"
                          className="history-delete-btn"
                          title="Delete conversation"
                          onClick={(e) => deleteConversation && deleteConversation(cId, e)}
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </div>

        {/* Start a new conversation button */}
        <button
          type="button"
          className="chat-header-btn btn-new-chat"
          onClick={() => newConversation && newConversation()}
          title="Start new conversation"
        >
          <Plus size={16} />
          <span>New Chat</span>
        </button>
      </div>
    </div>
  );
}
