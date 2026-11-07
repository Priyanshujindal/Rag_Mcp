import React, { useState, useEffect } from "react";
import { ChevronDown } from "lucide-react";
import { api } from "@/lib/api/client";

export function ChatHeader({ 
  selectedProvider, 
  setSelectedProvider,
  selectedModel,
  setSelectedModel,
  knowledgeBaseId,
  setKnowledgeBaseId
}) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
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
      <div className="chat-selector-wrapper">
        <button
          type="button"
          className="chat-selector-btn"
          onClick={() => setDropdownOpen(!dropdownOpen)}
        >
          <span className="selector-label">
            {currentKB ? currentKB.name : loading ? "Loading..." : "Select Knowledge Base"}
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
              </div>
              
              {loading ? (
                <div className="dropdown-empty">Loading...</div>
              ) : knowledgeBases.length > 0 ? (
                knowledgeBases.map((kb) => (
                  <button
                    key={kb._id || kb.id}
                    type="button"
                    className={`dropdown-item ${(kb._id === knowledgeBaseId || kb.id === knowledgeBaseId) ? "active" : ""}`}
                    onClick={() => {
                      setKnowledgeBaseId(kb._id || kb.id);
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
  );
}
