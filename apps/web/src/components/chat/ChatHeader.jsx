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
} from "lucide-react";
import { api } from "@/lib/api/client";
import { exportChat } from "@/lib/utils/chat-export";

export const PROVIDER_OPTIONS = {
  gemini: {
    id: "gemini",
    name: "Google Gemini",
    defaultModel: "gemini-3.8-flash",
    models: [
      { id: "gemini-3.8-flash", name: "Gemini 3.8 Flash ⭐" },
      { id: "gemini-3.6-flash", name: "Gemini 3.6 Flash" },
      { id: "gemini-3.5-flash-lite", name: "Gemini 3.5 Flash Lite" },
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
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
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
    if (newProv === "openrouter") {
      setSelectedModel && setSelectedModel("nvidia/nemotron-3-ultra-550b-a55b:free");
    } else {
      setSelectedModel && setSelectedModel("gemini-3.8-flash");
    }
  };

  const currentKB = Array.isArray(knowledgeBases) 
    ? knowledgeBases.find(kb => kb && (kb._id === knowledgeBaseId || kb.id === knowledgeBaseId))
    : null;

  const providerName = selectedProvider === "openrouter" ? "OpenRouter" : "Google Gemini";
  const modelShortName = selectedModel
    ? selectedModel.includes("nemotron")
      ? "Nemotron Ultra"
      : selectedModel.includes("gemma")
      ? "Gemma 4"
      : selectedModel.includes("openrouter/free")
      ? "OpenRouter Free"
      : selectedModel.includes("3.8")
      ? "Gemini 3.8 Flash"
      : selectedModel.includes("3.6")
      ? "Gemini 3.6 Flash"
      : selectedModel.includes("3.5")
      ? "Gemini 3.5 Lite"
      : selectedModel
    : "Gemini 3.8 Flash";

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
