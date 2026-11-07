import { useState, useRef, useEffect, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { streamChatMessage } from "@/lib/api/chat";
import { api, getActiveWorkspaceId, setActiveWorkspaceId } from "@/lib/api/client";

export function useChat({ provider = "gemini", model = "gemini-3.8-flash" } = {}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const urlConvId = searchParams.get("c") || searchParams.get("id");

  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [copiedId, setCopiedId] = useState(null);
  const [knowledgeBaseId, setKnowledgeBaseId] = useState(null);
  const [chatMode, setChatMode] = useState(() => {
    try {
      return localStorage.getItem("ragmcp_chat_mode") || "rag";
    } catch {
      return "rag";
    }
  });
  const [conversationId, setConversationId] = useState(urlConvId || null);
  const [conversations, setConversations] = useState([]);
  const [isLoadingConversations, setIsLoadingConversations] = useState(false);

  const messagesEndRef = useRef(null);

  // Load available knowledge bases
  useEffect(() => {
    api.get("/knowledge-bases")
      .then((data) => {
        const kbs = (data && data.items) || (data && data.knowledgeBases) || [];
        if (kbs.length > 0) {
          const firstKb = kbs[0];
          setKnowledgeBaseId(firstKb._id || firstKb.id);
          const kbWsId = firstKb.workspaceId || firstKb.workspace;
          if (kbWsId && !getActiveWorkspaceId()) {
            setActiveWorkspaceId(typeof kbWsId === "object" ? kbWsId.id || kbWsId._id : kbWsId);
          }
        }
      })
      .catch((err) => {
        console.warn("No knowledge bases found:", err);
      });
  }, []);

  // Persist chatMode
  useEffect(() => {
    try {
      localStorage.setItem("ragmcp_chat_mode", chatMode);
    } catch {
      // ignore
    }
  }, [chatMode]);

  // Load conversation history for current workspace
  const loadConversations = useCallback(async () => {
    try {
      setIsLoadingConversations(true);
      const res = await api.get("/conversations?limit=30");
      setConversations(res?.items || []);
    } catch (err) {
      console.warn("Failed to load conversations:", err);
    } finally {
      setIsLoadingConversations(false);
    }
  }, []);

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  // Switch to an existing conversation
  const selectConversation = useCallback(async (id) => {
    if (!id) return;
    try {
      setIsTyping(true);
      const data = await api.get(`/conversations/${id}`);
      const resolvedId = data.id || data._id;
      setConversationId(resolvedId);

      // Keep search params in sync
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.set("c", resolvedId);
        next.delete("id");
        return next;
      }, { replace: true });

      if (Array.isArray(data.messages)) {
        setMessages(
          data.messages.map((m) => ({
            id: m.id || m._id || `msg_${Math.random()}`,
            role: m.role.toLowerCase(),
            content: m.content,
            sources: m.citations || [],
          }))
        );
      }
    } catch (err) {
      console.error("Failed to load conversation:", err);
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.delete("c");
        next.delete("id");
        return next;
      }, { replace: true });
      setConversationId(null);
      setMessages([]);
    } finally {
      setIsTyping(false);
    }
  }, [setSearchParams]);

  // Sync with URL query param changes (?c=... or ?id=...)
  useEffect(() => {
    if (urlConvId) {
      if (urlConvId !== conversationId) {
        selectConversation(urlConvId);
      }
    } else if (conversationId) {
      // User navigated to "/" or clicked New Chat
      setConversationId(null);
      setMessages([]);
      setInput("");
    }
  }, [urlConvId]);

  // Start a fresh conversation
  const newConversation = useCallback(() => {
    setConversationId(null);
    setMessages([]);
    setInput("");
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete("c");
      next.delete("id");
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  // Listen for global new-conversation trigger (e.g. from sidebar CTA)
  useEffect(() => {
    const handleNew = () => newConversation();
    window.addEventListener("rag:new-conversation", handleNew);
    return () => window.removeEventListener("rag:new-conversation", handleNew);
  }, [newConversation]);

  // Delete an existing conversation
  const deleteConversation = useCallback(async (id, e) => {
    if (e) e.stopPropagation();
    try {
      await api.delete(`/conversations/${id}`);
      setConversations((prev) => prev.filter((c) => (c.id || c._id) !== id));
      window.dispatchEvent(new CustomEvent("rag:conversations-changed"));
      if (conversationId === id) {
        newConversation();
      }
    } catch (err) {
      console.error("Failed to delete conversation:", err);
    }
  }, [conversationId, newConversation]);

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

      if (chatMode === "rag" && !knowledgeBaseId) {
        const errorMsg = {
          id: `err_${Date.now()}`,
          role: "assistant",
          content: "⚠️ Please select a knowledge base from the top-left dropdown, or switch to General Chat mode.",
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
        conversationId,
        chatMode,
        isThinking,
        options: {
          max_tokens: 4096,
          isThinking,
        },
        onConversation: ({ conversationId: newConvId, title }) => {
          setConversationId(newConvId);
          setSearchParams((prev) => {
            const next = new URLSearchParams(prev);
            next.set("c", newConvId);
            return next;
          }, { replace: true });
          window.dispatchEvent(new CustomEvent("rag:conversations-changed"));
          setConversations((prev) => {
            const exists = prev.some((c) => (c.id || c._id) === newConvId);
            if (!exists) {
              return [
                {
                  id: newConvId,
                  _id: newConvId,
                  title: title || textToSend.slice(0, 40),
                  updatedAt: new Date().toISOString(),
                },
                ...prev,
              ];
            }
            return prev;
          });
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
          loadConversations();
          window.dispatchEvent(new CustomEvent("rag:conversations-changed"));
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
    [input, isTyping, provider, model, knowledgeBaseId, conversationId, chatMode, isThinking, loadConversations, setSearchParams]
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
    chatMode,
    setChatMode,
    conversationId,
    conversations,
    isLoadingConversations,
    selectConversation,
    newConversation,
    deleteConversation,
    loadConversations,
  };
}
