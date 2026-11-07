import React, { useRef, useEffect } from "react";
import { Plus, Brain, Mic, ArrowUp } from "lucide-react";

/**
 * Chat input composer bar with text auto-resize, voice, think toggle, and send button.
 * @param {object} props
 * @param {string} props.input - Current input text
 * @param {(val: string) => void} props.setInput - Setter for input
 * @param {() => void} props.onSend - Function to submit the message
 * @param {boolean} props.isThinking - Whether think mode is toggled on
 * @param {() => void} props.onToggleThinking - Toggle think mode
 * @param {object} [props.activeBot] - Currently active bot configuration
 */
export function Composer({
  input,
  setInput,
  onSend,
  isThinking,
  onToggleThinking,
  activeBot,
}) {
  const textareaRef = useRef(null);

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
    <div className="chatgpt-bottom-bar">
      <div className="chatgpt-floating-input chat-bottom-input-container">
        <button
          type="button"
          className="btn btn-ghost btn-icon chat-icon-round-btn"
          aria-label="Add attachment"
          title="Add attachment"
        >
          <Plus size={18} />
        </button>

        <textarea
          ref={textareaRef}
          className="chatgpt-input-textarea"
          placeholder={activeBot ? `Ask ${activeBot.name} anything…` : "Ask ChatGPT"}
          aria-label={activeBot ? `Ask ${activeBot.name} anything` : "Ask ChatGPT message input"}
          rows={1}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
        />

        <div className="chat-input-actions">
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

          <button
            type="button"
            className="btn btn-ghost btn-icon chat-icon-round-btn"
            title="Voice input"
            aria-label="Voice input"
          >
            <Mic size={17} />
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

