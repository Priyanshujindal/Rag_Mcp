import React, { useState, useEffect, useRef } from "react";
import { useParams } from "react-router-dom";
import { Bot, Send, Loader2, AlertCircle, Sparkles, User } from "lucide-react";
import { MarkdownRenderer } from "@/components/chat/MarkdownRenderer";

const API_BASE =
  (typeof import.meta !== "undefined" && import.meta.env?.VITE_API_URL) || "/api/v1";

export default function PublicBotPage() {
  const { publicId } = useParams();
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [conversationId, setConversationId] = useState(null);
  const endRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    async function loadBot() {
      try {
        setLoading(true);
        setError(null);
        const res = await fetch(`${API_BASE}/public/chatbots/${encodeURIComponent(publicId)}/config`);
        const json = await res.json();
        if (!res.ok) {
          throw new Error(json?.error?.message || "Chatbot not found or unavailable");
        }
        if (!cancelled) {
          const botData = json.data || json;
          setConfig(botData);
          if (botData.welcomeMessage) {
            setMessages([
              {
                id: "welcome",
                role: "assistant",
                content: botData.welcomeMessage,
              },
            ]);
          }
        }
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    loadBot();
    return () => {
      cancelled = true;
    };
  }, [publicId]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMessage = async (text) => {
    const trimmed = (text || "").trim();
    if (!trimmed || streaming) return;

    const userMsg = { id: `u_${Date.now()}`, role: "user", content: trimmed };
    const assistantId = `a_${Date.now()}`;

    setMessages((prev) => [
      ...prev,
      userMsg,
      { id: assistantId, role: "assistant", content: "", isStreaming: true },
    ]);
    setInput("");
    setStreaming(true);

    try {
      const res = await fetch(`${API_BASE}/public/chatbots/${encodeURIComponent(publicId)}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: trimmed,
          conversationId: conversationId || undefined,
        }),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson?.error?.message || `Request failed (${res.status})`);
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
                (currentEvent === "delta" || currentEvent === "token" || currentEvent === "message") &&
                (payload.delta || payload.token || payload.content)
              ) {
                const chunk = payload.delta || payload.token || payload.content;
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantId ? { ...m, content: m.content + chunk } : m
                  )
                );
              } else if (currentEvent === "error") {
                throw new Error(payload.message || "Streaming error");
              }
            } catch (parseErr) {
              if (currentEvent === "error") throw parseErr;
            }
          }
        }
      }

      setMessages((prev) =>
        prev.map((m) => (m.id === assistantId ? { ...m, isStreaming: false } : m))
      );
    } catch (err) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? { ...m, content: m.content || `Error: ${err.message}`, isStreaming: false, isError: true }
            : m
        )
      );
    } finally {
      setStreaming(false);
    }
  };

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#09090b", color: "#e4e4e7", gap: "10px" }}>
        <Loader2 size={22} className="spin" />
        <span>Loading assistant...</span>
      </div>
    );
  }

  if (error || !config) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "#09090b", color: "#e4e4e7", gap: "12px", padding: "24px", textAlign: "center" }}>
        <AlertCircle size={36} color="#ef4444" />
        <h2 style={{ margin: 0 }}>Chatbot Unavailable</h2>
        <p style={{ color: "#a1a1aa", maxWidth: "420px" }}>{error || "This public chatbot link is invalid or inactive."}</p>
      </div>
    );
  }

  const accent = config.primaryColor || "#6366f1";
  const isLight = config.theme === "light";
  const bg = isLight ? "#f8fafc" : "#09090b";
  const cardBg = isLight ? "#ffffff" : "#18181b";
  const border = isLight ? "#e2e8f0" : "#27272a";
  const text = isLight ? "#0f172a" : "#f4f4f5";
  const muted = isLight ? "#64748b" : "#a1a1aa";

  return (
    <div style={{ minHeight: "100vh", background: bg, color: text, display: "flex", flexDirection: "column" }}>
      {/* Header */}
      <header style={{ borderBottom: `1px solid ${border}`, background: cardBg, padding: "14px 24px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <div style={{ width: "36px", height: "36px", borderRadius: "10px", background: accent, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Bot size={20} />
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: "15px" }}>{config.name}</div>
            <div style={{ fontSize: "11px", color: muted }}>Powered by Rag_Mcp</div>
          </div>
        </div>
        <span style={{ fontSize: "11px", padding: "3px 10px", borderRadius: "9999px", background: "rgba(16,185,129,0.12)", color: "#10b981", fontWeight: 600 }}>
          Online
        </span>
      </header>

      {/* Chat Stream */}
      <main style={{ flex: 1, maxWidth: "820px", width: "100%", margin: "0 auto", padding: "24px 16px", display: "flex", flexDirection: "column", gap: "16px", overflowY: "auto" }}>
        {messages.map((m) => (
          <div
            key={m.id}
            style={{
              display: "flex",
              gap: "12px",
              justifyContent: m.role === "user" ? "flex-end" : "flex-start",
            }}
          >
            {m.role !== "user" && (
              <div style={{ width: "30px", height: "30px", borderRadius: "8px", background: accent, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <Bot size={16} />
              </div>
            )}
            <div
              style={{
                maxWidth: "78%",
                padding: "12px 15px",
                borderRadius: "12px",
                background: m.role === "user" ? accent : cardBg,
                color: m.role === "user" ? "#ffffff" : text,
                border: m.role === "user" ? "none" : `1px solid ${border}`,
                fontSize: "14px",
                lineHeight: 1.6,
                whiteSpace: m.role === "user" ? "pre-wrap" : "normal",
              }}
            >
              {m.role === "user" ? (
                m.content
              ) : m.content ? (
                <MarkdownRenderer content={m.content} />
              ) : m.isStreaming ? (
                "Thinking..."
              ) : (
                ""
              )}
            </div>
            {m.role === "user" && (
              <div style={{ width: "30px", height: "30px", borderRadius: "8px", background: border, color: text, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <User size={16} />
              </div>
            )}
          </div>
        ))}

        {/* Suggested Questions */}
        {messages.length <= 1 && Array.isArray(config.suggestedQuestions) && config.suggestedQuestions.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginTop: "8px" }}>
            {config.suggestedQuestions.map((q, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => sendMessage(q)}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "7px 12px",
                  borderRadius: "9999px",
                  border: `1px solid ${border}`,
                  background: cardBg,
                  color: text,
                  fontSize: "12px",
                  cursor: "pointer",
                }}
              >
                <Sparkles size={12} color={accent} /> {q}
              </button>
            ))}
          </div>
        )}
        <div ref={endRef} />
      </main>

      {/* Input Bar */}
      <footer style={{ borderTop: `1px solid ${border}`, background: cardBg, padding: "14px 16px" }}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            sendMessage(input);
          }}
          style={{ maxWidth: "820px", margin: "0 auto", display: "flex", gap: "10px" }}
        >
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={`Ask ${config.name} anything...`}
            disabled={streaming}
            style={{
              flex: 1,
              padding: "11px 14px",
              borderRadius: "10px",
              border: `1px solid ${border}`,
              background: bg,
              color: text,
              fontSize: "14px",
              outline: "none",
            }}
          />
          <button
            type="submit"
            disabled={streaming || !input.trim()}
            style={{
              padding: "0 18px",
              borderRadius: "10px",
              border: "none",
              background: accent,
              color: "#ffffff",
              fontWeight: 600,
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              opacity: streaming || !input.trim() ? 0.6 : 1,
            }}
          >
            {streaming ? <Loader2 size={16} className="spin" /> : <Send size={16} />}
            Send
          </button>
        </form>
      </footer>
    </div>
  );
}
