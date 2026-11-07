import React from "react";
import { Bot, Plus, Brain, Mic } from "lucide-react";
import { MessageItem } from "./MessageItem";

const STARTER_PROMPTS = [
  "Summarize our latest release notes and key changes",
  "Write an integration script for our Node.js SDK",
  "What are our API rate limits and tier quotas?",
  "How do I set up webhooks with HMAC signatures?",
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
  onToggleThinking
}) {
  const handleKeyDown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (input && input.trim()) {
        onSend();
      }
    }
  };

  if (!messages || messages.length === 0) {
    return (
      <div className="chatgpt-hero-container">
        <h1 className="chatgpt-hero-title">Where should we begin?</h1>
        
        <div className="chatgpt-center-input-bar">
          <button type="button" className="input-bar-btn">
            <Plus size={20} />
          </button>
          
          <input
            type="text"
            className="chatgpt-bar-input"
            placeholder="Ask anything..."
            value={input || ""}
            onChange={(e) => setInput && setInput(e.target.value)}
            onKeyDown={handleKeyDown}
          />

          <button
            type="button"
            className={`input-bar-think ${isThinking ? "active" : ""}`}
            onClick={onToggleThinking}
          >
            <Brain size={16} />
            <span>Think</span>
          </button>

          <button type="button" className="input-bar-btn">
            <Mic size={20} />
          </button>

          <button type="button" className="input-bar-voice">
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
            onRegenerate={undefined}
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
