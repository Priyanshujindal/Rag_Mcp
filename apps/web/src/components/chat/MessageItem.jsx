import React, { useState, useMemo } from "react";
import { Bot, Pencil, Check, X, Mic, FileText } from "lucide-react";
import { CitationList } from "./CitationList";
import { MessageActions } from "./MessageActions";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { ThinkingAccordion } from "./ThinkingAccordion";

/**
 * Individual chat message row supporting both user and assistant roles.
 * Supports inline editing for user prompts and regeneration for assistant turns.
 * @param {object} props
 * @param {object} props.message - The message object
 * @param {string} props.message.id - Message ID
 * @param {"user" | "assistant"} props.message.role - Role of sender
 * @param {string} props.message.content - Markdown or plain text message
 * @param {Array} [props.message.sources] - Citations attached to the response
 * @param {object} [props.activeBot] - Currently selected custom bot
 * @param {boolean} props.isCopied - Whether this message is copied
 * @param {(id: string, text: string) => void} props.onCopy - Copy handler
 * @param {(id: string, newText: string) => void} [props.onEdit] - Edit user message handler
 * @param {(id: string) => void} [props.onRegenerate] - Regenerate handler
 * @param {(action: string) => void} [props.onAction] - Action button handler
 * @param {boolean} [props.isListening] - Whether voice recognition is active
 */
export function MessageItem({
  message,
  activeBot,
  isCopied,
  onCopy,
  onEdit,
  onRegenerate,
  onAction,
  onInspectDoc,
  isListening = false,
}) {
  const isUser = message.role === "user";
  const [isEditing, setIsEditing] = useState(false);
  const [draftContent, setDraftContent] = useState(message.content || "");

  const docs = useMemo(() => {
    if (Array.isArray(message.attachedDocuments) && message.attachedDocuments.length > 0) {
      return message.attachedDocuments;
    }
    if (message.attachedDocument) {
      return [message.attachedDocument];
    }
    return [];
  }, [message.attachedDocuments, message.attachedDocument]);

  const handleSaveEdit = () => {
    if (!draftContent || !draftContent.trim()) return;
    setIsEditing(false);
    onEdit && onEdit(message.id, draftContent.trim());
  };

  const handleCancelEdit = () => {
    setDraftContent(message.content || "");
    setIsEditing(false);
  };

  if (isUser) {
    if (isEditing) {
      return (
        <div className="chatgpt-msg-user-edit-container">
          <textarea
            className="chatgpt-user-edit-textarea"
            value={draftContent}
            rows={Math.min(6, Math.max(2, draftContent.split("\n").length))}
            autoFocus
            onChange={(e) => setDraftContent(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSaveEdit();
              } else if (e.key === "Escape") {
                handleCancelEdit();
              }
            }}
          />
          <div className="chatgpt-user-edit-buttons">
            <button
              type="button"
              className="chatgpt-edit-btn cancel"
              onClick={handleCancelEdit}
            >
              Cancel
            </button>
            <button
              type="button"
              className="chatgpt-edit-btn save"
              disabled={!draftContent.trim()}
              onClick={handleSaveEdit}
            >
              Save & Submit
            </button>
          </div>
        </div>
      );
    }

    return (
      <div className="chatgpt-msg-user-wrapper">
        <div className="chatgpt-msg-user">
          {docs.length > 0 && (
            <div className="chat-msg-attached-docs-row">
              {docs.map((doc, idx) => (
                <div
                  key={idx}
                  className="chat-msg-attached-doc-pill clickable"
                  onClick={() => onInspectDoc && onInspectDoc(doc)}
                  title="Click to inspect extracted text"
                >
                  <FileText size={13} />
                  <span className="doc-pill-name">{doc.name}</span>
                  {doc.size && (
                    <span className="doc-pill-size">
                      ({(doc.size / 1024).toFixed(1)} KB)
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
          {message.content}
        </div>
        {onEdit && (
          <button
            type="button"
            className="chatgpt-msg-edit-trigger"
            title="Edit prompt & branch conversation"
            aria-label="Edit prompt"
            onClick={() => {
              setDraftContent(message.content || "");
              setIsEditing(true);
            }}
          >
            <Pencil size={12} />
          </button>
        )}
      </div>
    );
  }

  const avatarColor = activeBot?.theme?.primaryColor || "var(--accent)";

  return (
    <div className="chatgpt-msg-assistant">
      <div
        className="chat-msg-avatar"
        style={{ "--avatar-color": avatarColor }}
      >
        <Bot size={17} />
      </div>

      <div className="chat-msg-content-wrapper">
        {message.reasoning && (
          <ThinkingAccordion
            reasoning={message.reasoning}
            isStreaming={!message.content}
          />
        )}

        <div className="chat-msg-text">
          {message.content ? (
            <MarkdownRenderer content={message.content} />
          ) : (
            <div className="chat-typing-dots">
              <span className="typing-dot" />
              <span className="typing-dot" />
              <span className="typing-dot" />
            </div>
          )}
        </div>

        {message.action === "request_mic" && (
          <div className="chat-msg-action-box" style={{ marginTop: "12px", marginBottom: "8px" }}>
            <button
              type="button"
              className={`btn btn-primary chat-action-mic-btn ${isListening ? "voice-listening" : ""}`}
              onClick={() => onAction && onAction("request_mic")}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "8px",
                padding: "8px 16px",
                borderRadius: "8px",
                fontSize: "0.875rem",
                fontWeight: 500,
                backgroundColor: isListening ? "#ef4444" : "var(--accent, #10a37f)",
                color: "#ffffff",
                border: "none",
                cursor: "pointer",
                boxShadow: "0 2px 6px rgba(0,0,0,0.15)",
                transition: "background-color 0.2s ease, transform 0.1s ease",
              }}
            >
              <Mic size={16} className={isListening ? "mic-pulse-active" : ""} />
              <span>{isListening ? "Listening... Click to Finish" : "Allow Microphone & Start Speaking"}</span>
            </button>
          </div>
        )}

        {message.sources && <CitationList sources={message.sources} />}

        <MessageActions
          messageId={message.id}
          content={message.content}
          isCopied={isCopied}
          onCopy={onCopy}
          onRegenerate={onRegenerate ? () => onRegenerate(message.id) : undefined}
        />
      </div>
    </div>
  );
}


