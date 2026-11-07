import { useState, useRef, useEffect, useCallback } from "react";
import { streamChatMessage } from "@/lib/api/chat";
import { api } from "@/lib/api/client";

export function useChat({ provider = "gemini", model = "gemini-3.8-flash" } = {}) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [copiedId, setCopiedId] = useState(null);
  const [knowledgeBaseId, setKnowledgeBaseId] = useState(null);

  const messagesEndRef = useRef(null);

  useEffect(() => {
    api.get("/knowledge-bases")
      .then((data) => {
        const kbs = (data && data.items) || (data && data.knowledgeBases) || [];
      if (kbs.length > 0) {
          setKnowledgeBaseId(kbs[0]._id || kbs[0].id);
        }
      })
      .catch((err) => {
        console.warn("No knowledge bases found:", err);
      });
  }, []);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, isTyping, scrollToBottom]);

  const handleSend = useCallback(
    async (forcedText) => {
      const textToSend = forcedText || input;
      if (!textToSend.trim() || isTyping) return;

      if (!knowledgeBaseId) {
        const errorMsg = {
          id: `err_${Date.now()}`,
          role: "assistant",
          content: "⚠️ Please select a knowledge base from the dropdown in the top-left corner first.",
        };
        setMessages((prev) => [...prev, errorMsg]);
        return;
      }

      const userMsg = {
        id: `usr_${Date.now()}`,
        role: "user",
        content: textToSend,
      };

      setMessages((prev) => [...prev, userMsg]);
      if (!forcedText) setInput("");
      setIsTyping(true);

      const assistantId = `asst_${Date.now()}`;
      let assistantContent = "";

      setMessages((prev) => [
        ...prev,
        {
          id: assistantId,
          role: "assistant",
          content: "",
          sources: [],
        },
      ]);

      await streamChatMessage({
        message: textToSend,
        provider,
        model,
        knowledgeBaseId,
        isThinking,
        options: {
          max_tokens: 4096,
          isThinking,
        },
        onChunk: (chunk) => {
          if (chunk.type === "token" && chunk.delta) {
            assistantContent += chunk.delta;
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === assistantId ? { ...msg, content: assistantContent } : msg
              )
            );
          } else if (chunk.type === "sources" && chunk.sources) {
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === assistantId
                  ? {
                      ...msg,
                      sources: chunk.sources.map((s) => ({
                        title: s.title || "Unknown",
                        score: s.score || 0,
                      })),
                    }
                  : msg
              )
            );
          }
        },
        onDone: () => {
          setIsTyping(false);
        },
        onError: (err) => {
          console.error("Chat error:", err);
          setIsTyping(false);
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === assistantId
                ? { ...msg, content: `❌ Error: ${err.message}` }
                : msg
            )
          );
        },
      });
    },
    [input, isTyping, provider, model, knowledgeBaseId]
  );

  const handleCopy = useCallback((id, text) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1800);
  }, []);

  return {
    messages,
    input,
    setInput,
    isTyping,
    isThinking,
    setIsThinking,
    copiedId,
    messagesEndRef,
    handleSend,
    handleCopy,
    knowledgeBaseId,
    setKnowledgeBaseId,
  };
}
