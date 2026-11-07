import React, { useRef, useEffect, useState, useMemo } from "react";
import { Plus, Brain, Globe, Mic, ArrowUp, Paperclip, FileText, Loader2, X } from "lucide-react";
import { parseDocumentFile, parseDocumentFiles } from "@/lib/api/chat";

/**
 * Chat input composer bar with text auto-resize, voice, think toggle, web search toggle, multi-file attachments, and send button.
 * @param {object} props
 * @param {string} props.input - Current input text
 * @param {(val: string) => void} props.setInput - Setter for input
 * @param {() => void} props.onSend - Function to submit the message
 * @param {boolean} props.isThinking - Whether think mode is toggled on
 * @param {() => void} props.onToggleThinking - Toggle think mode
 * @param {boolean} [props.isWebSearch] - Whether live web search is toggled on
 * @param {() => void} [props.onToggleWebSearch] - Toggle live web search
 * @param {object} [props.attachedFile] - Single attached file for backward compatibility
 * @param {(file: object|null) => void} [props.setAttachedFile] - Setter for single attached file
 * @param {Array} [props.attachedFiles] - Multiple attached files
 * @param {(docs: Array) => void} [props.onAddFiles] - Add multiple files
 * @param {(idx: number) => void} [props.onRemoveFile] - Remove file at index
 * @param {(doc: object) => void} [props.onInspectDoc] - Callback to open Document Inspector
 * @param {object} [props.activeBot] - Currently active bot configuration
 * @param {boolean} [props.isListening] - Whether voice recognition is actively listening
 * @param {boolean} [props.isSupported] - Whether speech recognition is supported
 * @param {string} [props.voiceLangBadge] - Language badge code
 * @param {string} [props.voiceLangLabel] - Language display label
 * @param {() => void} [props.onToggleVoiceLang] - Toggle voice language
 * @param {() => void} [props.onToggleListening] - Function to toggle voice recognition
 */
export function Composer({
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
  activeBot,
  chatMode = "rag",
  isListening = false,
  isSupported = true,
  voiceLangBadge = "EN-IN",
  voiceLangLabel = "English (India)",
  onToggleVoiceLang,
  onToggleListening,
}) {
  const textareaRef = useRef(null);
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

  // Auto-resize textarea to fit content and snap back on send/clear
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      if (input && input.trim()) {
        textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 120)}px`;
      }
    }
  }, [input]);

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (input && input.trim()) {
        onSend();
      }
    }
  };

  return (
    <div className="chatgpt-bottom-bar" onDragOver={handleDragOver} onDrop={handleDrop}>
      {filesToDisplay.length > 0 && (
        <div className="composer-attached-files-row">
          {filesToDisplay.map((doc, idx) => (
            <div
              key={idx}
              className="composer-attached-file-badge clickable"
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
        <div className="composer-uploading-indicator">
          <Loader2 size={13} className="spin" />
          <span>Reading and parsing document(s)...</span>
        </div>
      )}

      <div className="chatgpt-floating-input chat-bottom-input-container">
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
          className="btn btn-ghost btn-icon chat-icon-round-btn composer-clip-btn"
          aria-label="Attach document (PDF, TXT, CSV) to chat"
          title="Attach document (PDF, TXT, CSV) to talk with it"
          onClick={() => fileInputRef.current?.click()}
          disabled={isUploadingFile}
        >
          <Paperclip size={17} />
        </button>

        <textarea
          ref={textareaRef}
          className="chatgpt-input-textarea"
          placeholder={
            isListening
              ? "🎙️ Listening... Speak into your microphone..."
              : attachedFile
              ? `Ask questions about ${attachedFile.name}…`
              : activeBot
              ? `Ask ${activeBot.name} anything…`
              : chatMode === "general"
              ? "Ask anything in General Chat (like ChatGPT)…"
              : "Ask anything from Knowledge Base…"
          }
          aria-label={activeBot ? `Ask ${activeBot.name} anything` : "Ask message input"}
          rows={1}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
        />

        <div className="chat-input-actions">
          <button
            type="button"
            className={`chatgpt-think-badge chatgpt-search-badge ${isWebSearch ? "active" : ""}`}
            onClick={onToggleWebSearch}
            title={isWebSearch ? "Web Search is ON: Live web facts enabled for all models" : "Toggle Web Search: Fetch live web facts across any model"}
            aria-label="Toggle live web search"
          >
            <Globe size={13} />
            <span>Search</span>
          </button>

          <button
            type="button"
            className={`chatgpt-think-badge ${isThinking ? "active" : ""}`}
            onClick={onToggleThinking}
            title="Toggle deeper reasoning mode"
            aria-label="Toggle think mode"
          >
            <Brain size={13} />
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
            className={`btn btn-ghost btn-icon chat-icon-round-btn ${isListening ? "voice-listening" : ""}`}
            title={
              !isSupported
                ? "Speech recognition not supported in this browser"
                : isListening
                ? "Listening... Click to stop"
                : `Voice input in ${voiceLangLabel || "English"} (Click to speak)`
            }
            aria-label="Voice input"
            onClick={onToggleListening}
          >
            <Mic size={17} className={isListening ? "mic-pulse-active" : ""} />
          </button>

          <button
            type="button"
            className={`chatgpt-send-icon-btn ${input && input.trim() ? "active" : ""}`}
            disabled={!input || !input.trim()}
            onClick={() => input && input.trim() && onSend()}
            aria-label="Send message"
          >
            <ArrowUp size={16} />
          </button>
        </div>
      </div>

      <div className="chat-disclaimer-text">
        Rag_Mcp can make mistakes. Verify important information with source citations.
      </div>
    </div>
  );
}

