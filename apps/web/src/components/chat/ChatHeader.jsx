import React, { useState, useEffect } from "react";
import { ChevronDown, History, Plus, Trash2, MessageSquare, Database, Sparkles } from "lucide-react";
import { api } from "@/lib/api/client";

export function ChatHeader({ 
  selectedProvider, 
  setSelectedProvider,
  selectedModel,
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
  isLoadingConversations,
}) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [knowledgeBases, setKnowledgeBases] = useState([]);
  const [loading, setLoading] = useState(true);

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

  const currentKB = Array.isArray(knowledgeBases) 
    ? knowledgeBases.find(kb => kb && (kb._id === knowledgeBaseId || kb.id === knowledgeBaseId))
    : null;

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
        <div className="chat-selector-wrapper">
          <button
            type="button"
            className="chat-selector-btn"
            onClick={() => setDropdownOpen(!dropdownOpen)}
          >
            <span className="selector-label">
              {chatMode === "general"
                ? `✨ Direct LLM (${selectedModel})`
                : currentKB
                ? currentKB.name
                : loading
                ? "Loading..."
                : "Select Knowledge Base"}
            </span>
            <ChevronDown size={14} />
          </button>

          {dropdownOpen && (
            <div className="chat-selector-dropdown">
              <div className="dropdown-section">
                <div className="dropdown-label">AI Provider</div>
                <select
                  value={selectedProvider}
                  onChange={(e) => setSelectedProvider(e.target.value)}
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
                  onChange={(e) => setSelectedModel(e.target.value)}
                  className="dropdown-select"
                >
                  {selectedProvider === "gemini" ? (
                    <>
                      <option value="gemini-3.8-flash">Gemini 3.8 Flash ⭐</option>
                      <option value="gemini-3.6-flash">Gemini 3.6 Flash</option>
                      <option value="gemini-3.5-flash-lite">Gemini 3.5 Flash Lite</option>
                    </>
                  ) : (
                    <>
                      <option value="nvidia/nemotron-3-ultra-550b-a55b:free">NVIDIA Nemotron Ultra ⭐</option>
                      <option value="openrouter/free">OpenRouter Free</option>
                      <option value="google/gemma-4:free">Google Gemma 4</option>
                    </>
                  )}
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
        {/* Past Conversations history dropdown */}
        <div className="chat-history-wrapper">
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
