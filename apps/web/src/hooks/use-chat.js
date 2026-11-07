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
  const [isWebSearch, setIsWebSearch] = useState(() => {
    try {
      return localStorage.getItem("ragmcp_web_search") === "true";
    } catch {
      return false;
    }
  });
  const [copiedId, setCopiedId] = useState(null);
  const [knowledgeBaseId, setKnowledgeBaseId] = useState(null);
  const [chatMode, setChatMode] = useState(() => {
    try {
      return localStorage.getItem("ragmcp_chat_mode") || "rag";
    } catch {
      return "rag";
    }
  });
  const [conversationId, setConversationId] = useState(null);
  const [conversations, setConversations] = useState([]);
  const [isLoadingConversations, setIsLoadingConversations] = useState(false);
  const [isLoadingConversation, setIsLoadingConversation] = useState(false);
  const [attachedFiles, setAttachedFiles] = useState([]);

  const attachedFile = attachedFiles[0] || null;
  const setAttachedFile = useCallback((fileOrNull) => {
    setAttachedFiles(fileOrNull ? (Array.isArray(fileOrNull) ? fileOrNull : [fileOrNull]) : []);
  }, []);

  const addAttachedFiles = useCallback((newDocs) => {
    if (!newDocs || !newDocs.length) return;
    const list = Array.isArray(newDocs) ? newDocs : [newDocs];
    setAttachedFiles((prev) => [...prev, ...list]);
  }, []);

  const removeAttachedFile = useCallback((idxToRemove) => {
    setAttachedFiles((prev) => prev.filter((_, idx) => idx !== idxToRemove));
  }, []);

  const messagesEndRef = useRef(null);
  const activeConvIdRef = useRef(null);
  const isInitialMount = useRef(true);

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

  // Persist web search toggle
  useEffect(() => {
    try {
      localStorage.setItem("ragmcp_web_search", String(isWebSearch));
    } catch {
      // ignore
    }
  }, [isWebSearch]);

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
    if (!id || id === "null" || id === "undefined" || id === "new") return;
    try {
      setIsLoadingConversation(true);
      const data = await api.get(`/conversations/${id}`);
      const resolvedId = data.id || data._id || id;
      activeConvIdRef.current = resolvedId;
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
          data.messages.map((m) => {
            const rawDocs = Array.isArray(m.attachedDocuments) && m.attachedDocuments.length > 0
              ? m.attachedDocuments
              : m.attachedDocument
              ? [m.attachedDocument]
              : [];
            return {
              id: m.id || m._id || `msg_${Math.random()}`,
              role: (m.role || "user").toLowerCase(),
              content: m.content || "",
              reasoning: m.reasoning || "",
              attachedDocument: rawDocs[0] || null,
              attachedDocuments: rawDocs,
              sources: (m.citations || []).map((c) => ({
                title: c.title || "Source",
                url: c.url || "",
                score: c.score || 0,
                snippet: c.snippet || "",
              })),
            };
          })
        );
      } else {
        setMessages([]);
      }
    } catch (err) {
      console.error("Failed to load conversation:", err);
      activeConvIdRef.current = null;
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.delete("c");
        next.delete("id");
        return next;
      }, { replace: true });
      setConversationId(null);
      setMessages([]);
    } finally {
      setIsLoadingConversation(false);
    }
  }, [setSearchParams]);

  // Sync with URL query param changes (?c=... or ?id=...)
  useEffect(() => {
    if (urlConvId && urlConvId !== "null" && urlConvId !== "undefined" && urlConvId !== "new") {
      if (urlConvId !== activeConvIdRef.current) {
        selectConversation(urlConvId);
      }
    } else {
      // URL has no conversation ID (e.g. at "/")
      if (!isInitialMount.current && activeConvIdRef.current) {
        activeConvIdRef.current = null;
        setConversationId(null);
        setMessages([]);
        setInput("");
      }
    }
    isInitialMount.current = false;
  }, [urlConvId, selectConversation]);

  // Listen for explicit sidebar / external conversation selection
  useEffect(() => {
    const handleSelect = (e) => {
      const id = e.detail;
      if (id && id !== "null" && id !== "undefined") {
        selectConversation(id);
      }
    };
    window.addEventListener("rag:select-conversation", handleSelect);
    return () => window.removeEventListener("rag:select-conversation", handleSelect);
  }, [selectConversation]);

  // Start a fresh conversation
  const newConversation = useCallback(() => {
    activeConvIdRef.current = null;
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

  // Listen for global new-conversation trigger (e.g. from sidebar CTA or logo click)
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

  // Rename an existing conversation
  const renameConversation = useCallback(async (id, newTitle) => {
    if (!id || !newTitle || !newTitle.trim()) return;
    try {
      const trimmed = newTitle.trim();
      await api.patch(`/conversations/${id}`, { title: trimmed });
      setConversations((prev) =>
        prev.map((c) => ((c.id || c._id) === id ? { ...c, title: trimmed } : c))
      );
      window.dispatchEvent(new CustomEvent("rag:conversations-changed"));
    } catch (err) {
      console.error("Failed to rename conversation:", err);
    }
  }, []);

  // Toggle pinned status of a conversation
  const togglePinConversation = useCallback(async (id, currentPinned) => {
    if (!id) return;
    try {
      const nextPinned = !currentPinned;
      await api.patch(`/conversations/${id}`, { isPinned: nextPinned });
      setConversations((prev) =>
        prev.map((c) => ((c.id || c._id) === id ? { ...c, isPinned: nextPinned } : c))
      );
      window.dispatchEvent(new CustomEvent("rag:conversations-changed"));
    } catch (err) {
      console.error("Failed to toggle pin conversation:", err);
    }
  }, []);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, isTyping, scrollToBottom]);

  const executeMessageStream = useCallback(
    async (textToSend, baseMessages, convId, docsToSend = []) => {
      if (!textToSend || !textToSend.trim()) return;

      const normDocs = Array.isArray(docsToSend)
        ? docsToSend
        : docsToSend
        ? [docsToSend]
        : [];

      if (chatMode === "rag" && !knowledgeBaseId && normDocs.length === 0) {
        const hasExistingDocInConv = baseMessages.some(
          (m) => (m.attachedDocuments && m.attachedDocuments.length > 0) || m.attachedDocument
        );
        if (!hasExistingDocInConv) {
          const errorMsg = {
            id: `err_${Date.now()}`,
            role: "assistant",
            content: "⚠️ Please select a knowledge base from the top-left dropdown, or switch to General Chat mode.",
          };
          setMessages([...baseMessages, errorMsg]);
          return;
        }
      }

      setIsTyping(true);
      const assistantId = `asst_${Date.now()}`;
      let assistantContent = "";

      setMessages([
        ...baseMessages,
        {
          id: assistantId,
          role: "assistant",
          content: "",
          reasoning: "",
          sources: [],
        },
      ]);

      await streamChatMessage({
        message: textToSend,
        provider,
        model,
        knowledgeBaseId,
        conversationId: convId,
        chatMode,
        isThinking,
        isWebSearch,
        attachedDocument: normDocs[0] || null,
        attachedDocuments: normDocs,
        history: baseMessages
          .filter((m) => m.role === "user" || m.role === "assistant")
          .slice(0, -1)
          .map((m) => ({ role: m.role, content: m.content })),
        options: {
          max_tokens: 4096,
          isThinking,
          webSearch: isWebSearch,
        },
        onConversation: ({ conversationId: newConvId, title }) => {
          activeConvIdRef.current = newConvId;
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

            let reasoning = "";
            let displayContent = assistantContent;

            if (assistantContent.includes("<think>")) {
              const startIdx = assistantContent.indexOf("<think>") + 7;
              const endIdx = assistantContent.indexOf("</think>");
              if (endIdx !== -1) {
                reasoning = assistantContent.slice(startIdx, endIdx).trim();
                displayContent = assistantContent.slice(endIdx + 8).trimStart();
              } else {
                reasoning = assistantContent.slice(startIdx).trim();
                displayContent = "";
              }
            }

            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === assistantId
                  ? { ...msg, content: displayContent, reasoning }
                  : msg
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
                        url: s.url || "",
                        score: s.score || 0,
                        snippet: s.snippet || "",
                      })),
                    }
                  : msg
              )
            );
          }
        },
        onDone: () => {
          setIsTyping(false);
          if (assistantContent.trim()) {
            setMessages((prev) =>
              prev.map((msg) => {
                if (msg.id !== assistantId) return msg;
                let finalContent = msg.content;
                let finalReasoning = msg.reasoning;
                if (!finalContent && finalReasoning) {
                  finalContent = finalReasoning;
                }
                return {
                  ...msg,
                  content: finalContent || assistantContent,
                  reasoning: finalReasoning,
                };
              })
            );
          }
          loadConversations();
          window.dispatchEvent(new CustomEvent("rag:conversations-changed"));
        },
        onError: (err) => {
          console.error("Chat error:", err);
          setIsTyping(false);
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === assistantId
                ? {
                    ...msg,
                    content: msg.content
                      ? msg.content
                      : `❌ Error: ${err.message || "Failed to get response"}`,
                  }
                : msg
            )
          );
        },
      });
    },
    [provider, model, knowledgeBaseId, chatMode, isThinking, isWebSearch, loadConversations, setSearchParams]
  );

  const handleSend = useCallback(
    async (forcedText) => {
      const textToSend = forcedText || input;
      if (!textToSend.trim() || isTyping) return;

      const currentDocs = attachedFiles;
      const userMsg = {
        id: `usr_${Date.now()}`,
        role: "user",
        content: textToSend,
        attachedDocument: currentDocs[0]
          ? {
              name: currentDocs[0].name,
              size: currentDocs[0].size,
              type: currentDocs[0].type,
            }
          : null,
        attachedDocuments: currentDocs.map((d) => ({
          name: d.name,
          size: d.size,
          type: d.type,
          content: d.content || "",
          pages: d.pages || 1,
          characterCount: d.characterCount || (d.content || "").length,
        })),
      };

      setAttachedFiles([]);
      const nextBase = [...messages, userMsg];
      if (!forcedText) setInput("");
      await executeMessageStream(textToSend, nextBase, conversationId, currentDocs);
    },
    [input, isTyping, messages, conversationId, attachedFiles, executeMessageStream]
  );

  const handleEditMessage = useCallback(
    async (messageId, newContent) => {
      if (!newContent || !newContent.trim() || isTyping) return;
      const targetIdx = messages.findIndex((m) => m.id === messageId);
      if (targetIdx === -1) return;

      const userMsg = {
        id: `usr_${Date.now()}`,
        role: "user",
        content: newContent.trim(),
      };

      const nextBase = [...messages.slice(0, targetIdx), userMsg];
      await executeMessageStream(newContent.trim(), nextBase, conversationId);
    },
    [messages, isTyping, conversationId, executeMessageStream]
  );

  const handleRegenerate = useCallback(
    async (assistantMsgId) => {
      if (isTyping) return;
      const targetIdx = messages.findIndex((m) => m.id === assistantMsgId);
      if (targetIdx === -1) return;

      // The user prompt is the message immediately before this assistant turn
      const prevUserMsg = messages[targetIdx - 1];
      if (!prevUserMsg || prevUserMsg.role !== "user") return;

      // Keep up to and including the user message, remove this assistant message and anything after
      const nextBase = messages.slice(0, targetIdx);
      await executeMessageStream(prevUserMsg.content, nextBase, conversationId);
    },
    [messages, isTyping, conversationId, executeMessageStream]
  );

  const handleCopy = useCallback((id, text) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1800);
  }, []);

  const handleVoiceNotice = useCallback((errorType, customMsg) => {
    let content = "";
    let action = null;

    if (errorType === "not_supported") {
      content =
        "🎙️ **Speech Recognition Not Supported**\n\nYour current browser does not support native speech recognition. Please open this app in Google Chrome, Microsoft Edge, Safari, or Brave to dictate with your voice.";
    } else if (errorType === "permission_denied" || errorType === "not-allowed") {
      content =
        "🎙️ **Microphone Access Needed**\n\nTo dictate your prompt using your voice, please grant microphone access to this site.\n\nClick the button below to allow microphone access and start speaking:";
      action = "request_mic";
    } else if (errorType === "permission_blocked") {
      content =
        "🎙️ **Microphone Access Blocked**\n\nMicrophone permission was blocked in your browser settings for this site.\n\n• If prompted by your browser, please click **Allow**.\n• You can also enable it via the site permissions icon in your browser address bar.\n\nClick the button below to try again:";
      action = "request_mic";
    } else {
      content = `🎙️ **Voice Input Notice**\n\n${customMsg || "Microphone input stopped. Click below to try again."}`;
      action = "request_mic";
    }

    setMessages((prev) => [
      ...prev,
      {
        id: `voice_notice_${Date.now()}`,
        role: "assistant",
        content,
        action,
      },
    ]);
  }, []);

  return {
    messages,
    setMessages,
    input,
    setInput,
    attachedFile,
    setAttachedFile,
    attachedFiles,
    setAttachedFiles,
    addAttachedFiles,
    removeAttachedFile,
    isTyping,
    isThinking,
    setIsThinking,
    isWebSearch,
    setIsWebSearch,
    copiedId,
    messagesEndRef,
    handleSend,
    handleEditMessage,
    handleRegenerate,
    handleCopy,
    handleVoiceNotice,
    knowledgeBaseId,
    setKnowledgeBaseId,
    chatMode,
    setChatMode,
    conversationId,
    conversations,
    isLoadingConversations,
    isLoadingConversation,
    selectConversation,
    newConversation,
    deleteConversation,
    renameConversation,
    togglePinConversation,
    loadConversations,
  };
}
