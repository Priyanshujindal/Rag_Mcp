import React, { useRef, useState, useMemo } from "react";
import { Bot, Plus, Brain, Globe, Mic, Paperclip, FileText, Loader2, X } from "lucide-react";
import { MessageItem } from "./MessageItem";
import { parseDocumentFile, parseDocumentFiles } from "@/lib/api/chat";

const STARTER_PROMPTS = [
  "Create a PDF summarizing the key points from my uploaded documents",
  "Generate a 5-slide PowerPoint presentation about Generative AI",
  "Create an Excel sheet with monthly expense tracking template",
  "Generate a Python script for binary search algorithm",
  "Calculate revenue difference between 125,000 and 84,200",
  "Summarize our latest release notes and key changes",
];

export function MessageList({ 
  messages, 
  isTyping, 
  copiedId, 
  onCopy, 
  messagesEndRef,
  input,
  setInput,
  onSend,
  isThinking,
  onToggleThinking,
  isWebSearch = false,
  onToggleWebSearch,
  attachedFile = null,
  setAttachedFile,
  attachedFiles = [],
  onAddFiles,
  onRemoveFile,
  onInspectDoc,
  chatMode = "rag",
  isLoadingConversation = false,
  onEditMessage,
  onRegenerate,
  isListening = false,
  isSupported = true,
  voiceLangBadge = "EN-IN",
  voiceLangLabel = "English (India)",
  onToggleVoiceLang,
  onToggleListening,
  onAction,
  onApproveTool,
  onRejectTool,
  onPreviewArtifact,
}) {
  const fileInputRef = useRef(null);
  const [isUploadingFile, setIsUploadingFile] = useState(false);

  const filesToDisplay = useMemo(() => {
    if (Array.isArray(attachedFiles) && attachedFiles.length > 0) {
      return attachedFiles;
    }
    if (attachedFile) {
      return [attachedFile];
    }
    return [];
  }, [attachedFiles, attachedFile]);

  const handleFileSelect = async (e) => {
    const files = e.target.files;
    if (!files || !files.length) return;
    try {
      setIsUploadingFile(true);
      const parsedList = await parseDocumentFiles(files);
      if (onAddFiles) {
        onAddFiles(parsedList);
      } else if (setAttachedFile) {
        setAttachedFile(parsedList[0]);
      }
    } catch (err) {
      console.error("Failed to parse file:", err);
    } finally {
      setIsUploadingFile(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const files = e.dataTransfer.files;
    if (!files || !files.length) return;
    try {
      setIsUploadingFile(true);
      const parsedList = await parseDocumentFiles(files);
      if (onAddFiles) {
        onAddFiles(parsedList);
      } else if (setAttachedFile) {
        setAttachedFile(parsedList[0]);
      }
    } catch (err) {
      console.error("Failed to parse dropped files:", err);
    } finally {
      setIsUploadingFile(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (input && input.trim()) {
        onSend();
      }
    }
  };

  if (isLoadingConversation && (!messages || messages.length === 0)) {
    return (
      <div className="chatgpt-hero-container" style={{ opacity: 0.75 }}>
        <h1 className="chatgpt-hero-title" style={{ fontSize: "1.4rem" }}>
          Loading conversation...
        </h1>
      </div>
    );
  }

  if (!messages || messages.length === 0) {
    return (
      <div className="chatgpt-hero-container" onDragOver={handleDragOver} onDrop={handleDrop}>
        <h1 className="chatgpt-hero-title">
          {chatMode === "general" ? "What's on your mind today?" : "Where should we begin?"}
        </h1>
        
        {filesToDisplay.length > 0 && (
          <div className="composer-attached-files-row hero-files-row">
            {filesToDisplay.map((doc, idx) => (
              <div
                key={idx}
                className="composer-attached-file-badge hero-file-badge clickable"
                onClick={() => onInspectDoc && onInspectDoc(doc)}
                title="Click to inspect extracted text"
              >
                <FileText size={14} className="file-badge-icon" />
                <span className="file-badge-name" title={doc.name}>
                  {doc.name}
                </span>
                {doc.size && (
                  <span className="file-badge-size">
                    ({(doc.size / 1024).toFixed(1)} KB)
                  </span>
                )}
                <button
                  type="button"
                  className="file-badge-remove-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemoveFile ? onRemoveFile(idx) : (setAttachedFile && setAttachedFile(null));
                  }}
                  title="Remove attached document"
                  aria-label="Remove attached document"
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        )}

        {isUploadingFile && (
          <div className="composer-uploading-indicator hero-uploading">
            <Loader2 size={13} className="spin" />
            <span>Reading and parsing document(s)...</span>
          </div>
        )}

        <div className="chatgpt-center-input-bar">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".pdf,.txt,.csv,.tsv,.md,.json"
            style={{ display: "none" }}
            onChange={handleFileSelect}
          />

          <button
            type="button"
            className="input-bar-btn"
            title="Attach document (PDF, TXT, CSV) to chat"
            aria-label="Attach document"
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploadingFile}
          >
            <Paperclip size={18} />
          </button>
          
          <input
            type="text"
            className="chatgpt-bar-input"
            placeholder={
              isListening
                ? "🎙️ Listening... Speak into your microphone..."
                : attachedFile
                ? `Ask questions about ${attachedFile.name}…`
                : chatMode === "general"
                ? "Ask anything in General Chat (like ChatGPT)..."
                : "Ask anything from your Knowledge Base..."
            }
            value={input || ""}
            onChange={(e) => setInput && setInput(e.target.value)}
            onKeyDown={handleKeyDown}
          />

          <button
            type="button"
            className={`input-bar-think input-bar-search ${isWebSearch ? "active" : ""}`}
            onClick={onToggleWebSearch}
            title={isWebSearch ? "Web Search is ON: Live web facts enabled for all models" : "Toggle Web Search: Fetch live web facts across any model"}
          >
            <Globe size={16} />
            <span>Search</span>
          </button>

          <button
            type="button"
            className={`input-bar-think ${isThinking ? "active" : ""}`}
            onClick={onToggleThinking}
          >
            <Brain size={16} />
            <span>Think</span>
          </button>

          {voiceLangBadge && (
            <button
              type="button"
              className="chatgpt-think-badge chatgpt-voice-lang-badge"
              onClick={onToggleVoiceLang}
              title={`Voice Language: ${voiceLangLabel || voiceLangBadge}. Click to switch language.`}
              aria-label="Switch voice recognition language"
            >
              <span>{voiceLangBadge}</span>
            </button>
          )}

          <button
            type="button"
            className={`input-bar-btn ${isListening ? "voice-listening" : ""}`}
            onClick={onToggleListening}
            title={
              !isSupported
                ? "Speech recognition not supported in this browser"
                : isListening
                ? "Listening... Click to stop"
                : `Voice input in ${voiceLangLabel || "English"} (Click to speak)`
            }
          >
            <Mic size={20} className={isListening ? "mic-pulse-active" : ""} />
          </button>

          <button
            type="button"
            className={`input-bar-voice ${isListening ? "voice-listening" : ""}`}
            onClick={onToggleListening}
            title={isListening ? "Listening... Click to stop" : "Voice input"}
          >
            <div className="voice-icon">
              <span className="bar"></span>
              <span className="bar"></span>
              <span className="bar"></span>
            </div>
          </button>
        </div>

        <div className="chatgpt-hero-suggestions">
          {STARTER_PROMPTS.map((prompt, i) => (
            <button 
              key={i} 
              type="button" 
              className="chatgpt-suggestion-card"
              onClick={() => onSend && onSend(prompt)}
            >
              <span>{prompt}</span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="chatgpt-messages-scroll">
      <div className="chatgpt-messages-inner">
        {messages.map((m) => (
          <MessageItem
            key={m.id}
            message={m}
            activeBot={null}
            isCopied={copiedId === m.id}
            onCopy={onCopy}
            onEdit={onEditMessage}
            onRegenerate={onRegenerate}
            onAction={onAction}
            onInspectDoc={onInspectDoc}
            onApproveTool={onApproveTool}
            onRejectTool={onRejectTool}
            onPreviewArtifact={onPreviewArtifact}
            isStreaming={isTyping}
            isListening={isListening}
          />
        ))}
        {isTyping && (
          <div className="chatgpt-msg-assistant">
            <div className="chat-typing-avatar">
              <Bot size={17} />
            </div>
            <div className="chat-typing-dots">
              <span className="typing-dot" />
              <span className="typing-dot" />
              <span className="typing-dot" />
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>
    </div>
  );
}
