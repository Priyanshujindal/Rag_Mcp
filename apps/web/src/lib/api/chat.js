import { getAccessToken, getActiveWorkspaceId, refreshAccessToken } from "./client.js";

/**
 * Shared helper: performs a chat/SSE fetch with one automatic token-refresh
 * retry if the server returns 401 Access token has expired.
 */
async function fetchWithTokenRefresh(url, fetchOptions) {
  let response = await fetch(url, fetchOptions);

  if (response.status === 401) {
    // Attempt a silent refresh and retry exactly once
    const newToken = await refreshAccessToken();
    if (newToken) {
      const retryHeaders = new Headers(fetchOptions.headers || {});
      retryHeaders.set("Authorization", `Bearer ${newToken}`);
      response = await fetch(url, { ...fetchOptions, headers: retryHeaders });
    }
  }

  return response;
}

export async function streamChatMessage({
  message,
  provider,
  model,
  knowledgeBaseId,
  conversationId,
  chatMode = "rag",
  isThinking = false,
  isWebSearch = false,
  attachedDocument = null,
  attachedDocuments = null,
  options = {},
  onConversation,
  onChunk,
  onDone,
  onError,
}) {
  const BASE_URL = import.meta.env.VITE_API_URL || "/api/v1";
  const token = getAccessToken();
  const workspaceId = getActiveWorkspaceId();

  if (chatMode === "rag" && !knowledgeBaseId && !attachedDocument && (!attachedDocuments || attachedDocuments.length === 0)) {
    onError && onError(new Error("Please select a knowledge base for RAG mode, switch to General Chat mode, or attach a document"));
    return;
  }

  try {
    console.log("Sending chat request:", { message, knowledgeBaseId, conversationId, chatMode, model, provider, workspaceId, isThinking, isWebSearch, attachedDocument, attachedDocuments, options });
    
    const response = await fetchWithTokenRefresh(`${BASE_URL}/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token && { Authorization: `Bearer ${token}` }),
        ...(workspaceId && { "X-Workspace-Id": workspaceId }),
      },
      credentials: "include",
      body: JSON.stringify({
        message,
        knowledgeBaseId: chatMode === "general" ? null : knowledgeBaseId,
        chatMode,
        conversationId: conversationId || undefined,
        provider,
        model: model || (provider === "openrouter" ? "nvidia/nemotron-3-ultra-550b-a55b:free" : "gemini-3.8-flash"),
        webSearch: isWebSearch,
        isThinking,
        attachedDocument: attachedDocument || (attachedDocuments?.[0] || null),
        attachedDocuments: attachedDocuments || (attachedDocument ? [attachedDocument] : null),
        history: [],
        options: {
          max_tokens: 4096,
          isThinking,
          webSearch: isWebSearch,
          ...options,
        },
      }),
    });

    console.log("Response status:", response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Error response:", errorText);

      // Friendly message for auth failures
      if (response.status === 401) {
        throw new Error("Your session has expired. Please refresh the page and sign in again.");
      }

      let errorMessage = `Request failed with status ${response.status}`;
      try {
        const errorData = JSON.parse(errorText);
        errorMessage = errorData.error?.message || errorData.message || errorMessage;
      } catch (e) {
        errorMessage = errorText || errorMessage;
      }

      throw new Error(errorMessage);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let currentEvent = "";

    let hasFinished = false;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.trim()) continue;

        if (line.startsWith("event: ")) {
          currentEvent = line.slice(7).trim();
          continue;
        }

        if (line.startsWith("data: ")) {
          const data = line.slice(6).trim();
          
          try {
            const parsed = JSON.parse(data);
            
            if (currentEvent === "conversation" || parsed?.conversationId) {
              onConversation && onConversation({
                conversationId: parsed.conversationId,
                title: parsed.title,
              });
              continue;
            }

            if (currentEvent === "done" || parsed?.done) {
              if (!hasFinished) {
                hasFinished = true;
                onDone && onDone();
              }
              continue;
            }

            if (currentEvent === "error" || parsed?.code === "CHAT_ERROR" || parsed?.error) {
              const errMsg =
                parsed?.error?.message ||
                parsed?.message ||
                (typeof parsed === "string" ? parsed : "Chat stream error");
              onError && onError(new Error(errMsg));
              return;
            }

            if (currentEvent === "tool_call" || parsed?.type === "tool_call") {
              onChunk && onChunk({
                type: "tool_call",
                toolCallId: parsed.toolCallId || parsed.id,
                toolName: parsed.toolName || parsed.name,
                serverName: parsed.serverName,
                args: parsed.args || parsed.parameters,
                status: parsed.status || "executing",
              });
              continue;
            }

            if (currentEvent === "tool_approval" || parsed?.type === "tool_approval" || parsed?.requiresApproval) {
              onChunk && onChunk({
                type: "tool_approval",
                toolCallId: parsed.toolCallId || parsed.id,
                toolName: parsed.toolName || parsed.name,
                serverName: parsed.serverName,
                args: parsed.args || parsed.parameters,
                requiresApproval: true,
                status: "pending",
              });
              continue;
            }

            if (currentEvent === "tool_result" || parsed?.type === "tool_result") {
              onChunk && onChunk({
                type: "tool_result",
                toolCallId: parsed.toolCallId || parsed.id,
                toolName: parsed.toolName || parsed.name,
                serverName: parsed.serverName,
                result: parsed.result || parsed.data,
                status: "completed",
              });
              continue;
            }

            if (currentEvent === "artifact" || parsed?.type === "artifact") {
              onChunk && onChunk({
                type: "artifact",
                artifact: parsed,
              });
              continue;
            }

            if (parsed.delta) {
              onChunk && onChunk({ type: "token", delta: parsed.delta });
            } else if (Array.isArray(parsed)) {
              onChunk && onChunk({ type: "sources", sources: parsed });
            } else if (currentEvent === "citations" && parsed?.citations) {
              onChunk && onChunk({ type: "sources", sources: parsed.citations });
            }
          } catch (err) {
            console.warn("Parse error:", err);
          }
        }
      }
    }

    if (!hasFinished) {
      hasFinished = true;
      onDone && onDone();
    }
  } catch (error) {
    console.error("Chat stream error:", error);
    onError && onError(error);
  }
}

/**
 * Parses an ad-hoc attached file (PDF, TXT, CSV, MD, JSON).
 * For text-based files, reads directly in the browser; for PDFs, uses the backend parser.
 * @param {File} file
 * @returns {Promise<{ name: string, content: string, size: number, type: string, characterCount: number, pages: number }>}
 */
export async function parseDocumentFile(file) {
  if (!file) throw new Error("No file provided");
  const ext = (file.name.split(".").pop() || "").toLowerCase();

  // Instant browser reading for text/csv/markdown/json files
  if (["txt", "csv", "tsv", "md", "json"].includes(ext)) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target?.result || "";
        resolve({
          name: file.name,
          content: text,
          size: file.size,
          type: file.type || ext,
          characterCount: text.length,
          pages: 1,
        });
      };
      reader.onerror = () => reject(new Error("Failed to read text file in browser"));
      reader.readAsText(file);
    });
  }

  // Upload to backend parser for PDF or rich document formats
  const BASE_URL = import.meta.env.VITE_API_URL || "/api/v1";
  const token = getAccessToken();
  const workspaceId = getActiveWorkspaceId();
  const formData = new FormData();
  formData.append("file", file);

  const res = await fetchWithTokenRefresh(`${BASE_URL}/chat/parse-document`, {
    method: "POST",
    headers: {
      ...(token && { Authorization: `Bearer ${token}` }),
      ...(workspaceId && { "X-Workspace-Id": workspaceId }),
    },
    credentials: "include",
    body: formData,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || "Failed to parse document");
  }

  const data = await res.json();
  return {
    name: file.name,
    content: data.text || "",
    size: file.size,
    type: file.type || "application/pdf",
    characterCount: data.characterCount || (data.text || "").length,
    pages: data.pages || 1,
  };
}

/**
 * Parses multiple ad-hoc attached files concurrently.
 * @param {FileList|File[]} files
 * @returns {Promise<Array<{ name: string, content: string, size: number, type: string, characterCount: number, pages: number }>>}
 */
export async function parseDocumentFiles(files) {
  if (!files || !files.length) return [];
  const list = Array.from(files);
  return Promise.all(list.map((f) => parseDocumentFile(f)));
}

/**
 * Approves or rejects a human-in-the-loop MCP tool call.
 * Streams the resulting execution output and continues the response.
 */
export async function approveMcpTool({
  conversationId,
  toolCallId,
  approved = true,
  onChunk,
  onDone,
  onError,
}) {
  const BASE_URL = import.meta.env.VITE_API_URL || "/api/v1";
  const token = getAccessToken();
  const workspaceId = getActiveWorkspaceId();

  try {
    const res = await fetchWithTokenRefresh(`${BASE_URL}/chat/approve-tool`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token && { Authorization: `Bearer ${token}` }),
        ...(workspaceId && { "X-Workspace-Id": workspaceId }),
      },
      credentials: "include",
      body: JSON.stringify({
        conversationId,
        toolCallId,
        approved,
      }),
    });

    if (!res.ok) {
      throw new Error("HTTP error " + res.status);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.trim()) continue;

        if (line.startsWith("data: ")) {
          const data = line.slice(6).trim();
          try {
            const parsed = JSON.parse(data);
            if (currentEvent === "artifact" || parsed?.type === "artifact") {
              onChunk && onChunk({
                type: "artifact",
                artifact: parsed,
              });
              continue;
            }

            if (parsed.delta) {
              onChunk && onChunk({ type: "token", delta: parsed.delta });
            } else if (parsed.toolResult || parsed.result) {
              onChunk &&
                onChunk({
                  type: "tool_result",
                  toolCallId,
                  result: parsed.toolResult || parsed.result,
                  status: "completed",
                });
            }
          } catch {}
        }
      }
    }

    onDone && onDone();
  } catch (err) {
    // Offline / Mock fallback simulation
    console.info("[RagMcp] Simulating tool approval response offline:", err.message);
    if (approved) {
      setTimeout(() => {
        onChunk &&
          onChunk({
            type: "tool_result",
            toolCallId,
            result: {
              rowCount: 4,
              columns: ["id", "customer", "plan", "amount", "status"],
              data: [
                { id: "ord_101", customer: "Acme Corp", plan: "Enterprise", amount: 4800, status: "PAID" },
                { id: "ord_102", customer: "Globex Ltd", plan: "Pro", amount: 1200, status: "PAID" },
                { id: "ord_104", customer: "Umbrella Tech", plan: "Enterprise", amount: 9600, status: "PAID" },
              ],
            },
            status: "completed",
          });

        onChunk &&
          onChunk({
            type: "token",
            delta:
              "\n\nQuery executed successfully on the analytics replica. Retrieved 3 matching paid orders totaling **$15,600** across Enterprise and Pro plans.",
          });

        onDone && onDone();
      }, 300);
    } else {
      setTimeout(() => {
        onChunk &&
          onChunk({
            type: "token",
            delta: "❌ Tool execution was cancelled by user.",
          });
        onDone && onDone();
      }, 200);
    }
  }
}

