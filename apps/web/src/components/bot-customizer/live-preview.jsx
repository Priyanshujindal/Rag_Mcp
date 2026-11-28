import React, { useState, useEffect } from "react";
import { MessageSquare, X, Send, Bot, Globe } from "lucide-react";
import { MarkdownRenderer } from "@/components/chat/MarkdownRenderer";
import { isMock } from "@/lib/api";

const API_BASE =
  (typeof import.meta !== "undefined" && import.meta.env?.VITE_API_URL) || "/api/v1";

export function LiveWidgetPreview({ publicId, config, simulatedSiteUrl = "https://yourwebsite.com" }) {
  const [isOpen, setIsOpen] = useState(true);
  const [messages, setMessages] = useState([
    {
      id: "w_msg_1",
      sender: "bot",
      text: config.welcomeMessage || "Hi there! 👋 How can I help you today?",
    },
  ]);
  const [inputValue, setInputValue] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [conversationId, setConversationId] = useState(null);

  useEffect(() => {
    setMessages((prev) => {
      if (prev.length === 1 && prev[0].id === "w_msg_1") {
        return [{ ...prev[0], text: config.welcomeMessage || "Hi there! 👋 How can I help you today?" }];
      }
      return prev;
    });
  }, [config.welcomeMessage]);

  const brandColor = config.primaryColor || "var(--accent)";
  const isDark = config.theme === "dark";
  const isLeft = config.position === "bottom-left";
  const borderRadius = config.borderRadius || "16px";

  const handleSend = async (overrideText) => {
    const userText = (typeof overrideText === "string" ? overrideText : inputValue).trim();
    if (!userText || streaming) return;
    if (typeof overrideText !== "string") setInputValue("");

    const botMsgId = `b_${Date.now()}`;
    setMessages((prev) => [
      ...prev,
      { id: `u_${Date.now()}`, sender: "user", text: userText },
      ...(isMock || !publicId
        ? []
        : [{ id: botMsgId, sender: "bot", text: "" }]),
    ]);

    if (isMock || !publicId) {
      setTimeout(() => {
        setMessages((prev) => [
          ...prev,
          {
            id: botMsgId,
            sender: "bot",
            text: `Thanks for asking about "${userText}". Based on the knowledge base, here is the verified information!`,
          },
        ]);
      }, 400);
      return;
    }

    setStreaming(true);
    try {
      const res = await fetch(
        `${API_BASE}/public/chatbots/${encodeURIComponent(publicId)}/chat`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: userText,
            ...(conversationId ? { conversationId } : {}),
          }),
        }
      );

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson?.error?.message || `HTTP ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let currentEvent = "message";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (!line) {
            currentEvent = "message";
            continue;
          }
          if (line.startsWith("event:")) {
            currentEvent = line.slice(6).trim();
            continue;
          }
          if (line.startsWith("data:")) {
            const rawData = line.slice(5).trim();
            if (!rawData || rawData === "[DONE]") continue;
            try {
              const payload = JSON.parse(rawData);
              if (currentEvent === "conversation" && payload.conversationId) {
                setConversationId(payload.conversationId);
              } else if (
                (currentEvent === "token" || currentEvent === "delta") &&
                (payload.delta || payload.token)
              ) {
                const chunk = payload.delta || payload.token;
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === botMsgId ? { ...m, text: m.text + chunk } : m
                  )
                );
              } else if (currentEvent === "error") {
                throw new Error(payload.message || "Chat stream error");
              }
            } catch (parseErr) {
              if (currentEvent === "error") throw parseErr;
            }
          }
        }
      }
    } catch (err) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === botMsgId
            ? { ...m, text: m.text || `⚠️ ${err.message}` }
            : m
        )
      );
    } finally {
      setStreaming(false);
    }
  };

  const handleSuggestedClick = (q) => {
    handleSend(q);
  };

  return (
    <div className="preview-sticky">
      <div className="preview-top-bar">
        <span className="preview-top-title">
          Live Website Preview
        </span>
        <span className="preview-top-sub">
          Updates in real time
        </span>
      </div>

      <div className="preview-browser-frame">
        {/* Browser Top Chrome */}
        <div className="preview-browser-header">
          <div className="browser-dots">
            <span className="browser-dot dot-red" />
            <span className="browser-dot dot-amber" />
            <span className="browser-dot dot-green" />
          </div>
          <div className="browser-url-bar">
            <Globe size={11} className="browser-url-icon" />
            {simulatedSiteUrl}
          </div>
        </div>

        {/* Website Content Mockup */}
        <div className="preview-website-body">
          <div className="mock-site-hero">
            <span className="mock-site-badge">Demo Customer Website</span>
            <h4 className="mock-site-title">Modern AI Powered Platform</h4>
            <p className="mock-site-text">
              This simulated page shows how the floating chatbot widget renders on your website for your visitors.
            </p>
          </div>

          {/* Floating Widget In-Page */}
          <div
            className={`widget-overlay-container ${isLeft ? "pos-left" : ""}`}
            style={{ "--widget-brand": brandColor, "--widget-radius": borderRadius }}
          >
            {isOpen && (
              <div className={`widget-chat-box ${isDark ? "theme-dark" : "theme-light"}`}>
                {/* Widget Header */}
                <div className="widget-header">
                  <div className="chat-header-actions">
                    <div className="widget-header-avatar">
                      <Bot size={15} />
                    </div>
                    <div>
                      <div className="widget-header-title">
                        {config.headerTitle || config.name || "AI Assistant"}
                      </div>
                      <div className="widget-header-sub">Online • Typically replies instantly</div>
                    </div>
                  </div>
                  <button
                    onClick={() => setIsOpen(false)}
                    className="widget-close-btn"
                    title="Minimize"
                    aria-label="Minimize"
                  >
                    <X size={16} />
                  </button>
                </div>

                {/* Message Feed */}
                <div className="widget-messages-container">
                  {messages.map((m) => {
                    const isUser = m.sender === "user";
                    return (
                      <div
                        key={m.id}
                        className={`widget-msg-row ${isUser ? "user" : "bot"}`}
                      >
                        <div className={`widget-msg ${isUser ? "user" : "bot"}`}>
                          {isUser ? (
                            m.text
                          ) : m.text ? (
                            <MarkdownRenderer content={m.text} />
                          ) : (
                            "Thinking..."
                          )}
                        </div>
                      </div>
                    );
                  })}

                  {/* Suggested Starter Questions */}
                  {config.suggestedQuestions && config.suggestedQuestions.length > 0 && (
                    <div>
                      <div className="widget-suggested-label">
                        Suggested questions:
                      </div>
                      {config.suggestedQuestions.map((q, idx) => (
                        <button
                          key={idx}
                          type="button"
                          className="widget-suggested-pill"
                          onClick={() => handleSuggestedClick(q)}
                        >
                          {q}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Footer Input */}
                <div className="widget-input-footer">
                  <input
                    type="text"
                    className="input widget-input"
                    placeholder="Ask a question…"
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleSend()}
                  />
                  <button
                    type="button"
                    className="widget-send-btn"
                    onClick={handleSend}
                    aria-label="Send message"
                  >
                    <Send size={13} />
                  </button>
                </div>
              </div>
            )}

            {/* Floating Launcher Button */}
            <button
              type="button"
              className="widget-launcher-btn"
              onClick={() => setIsOpen((prev) => !prev)}
              title={isOpen ? "Close chatbot" : "Open chatbot"}
              aria-label={isOpen ? "Close chatbot" : "Open chatbot"}
            >
              {isOpen ? <X size={20} /> : <MessageSquare size={20} />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
