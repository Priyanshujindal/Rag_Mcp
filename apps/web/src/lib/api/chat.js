import { getAccessToken, getActiveWorkspaceId } from "./client.js";

export async function streamChatMessage({
  message,
  provider,
  model,
  knowledgeBaseId,
  isThinking = false,
  options = {},
  onChunk,
  onDone,
  onError,
}) {
  const BASE_URL = import.meta.env.VITE_API_URL || "/api/v1";
  const token = getAccessToken();
  const workspaceId = getActiveWorkspaceId();

  if (!knowledgeBaseId) {
    onError && onError(new Error("Please select a knowledge base first"));
    return;
  }

  try {
    console.log("Sending chat request:", { message, knowledgeBaseId, model, provider, workspaceId, isThinking, options });
    
    const response = await fetch(`${BASE_URL}/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token && { Authorization: `Bearer ${token}` }),
        ...(workspaceId && { "X-Workspace-Id": workspaceId }),
      },
      credentials: "include",
      body: JSON.stringify({
        message,
        knowledgeBaseId,
        model: model || "gemini-3.8-flash",
        history: [],
        options: {
          max_tokens: 4096,
          isThinking,
          ...options,
        },
      }),
    });

    console.log("Response status:", response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Error response:", errorText);
      
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
            
            if (currentEvent === "error" || parsed?.code === "CHAT_ERROR" || (parsed?.message && !parsed?.delta)) {
              const errMsg = parsed?.message || (typeof parsed === "string" ? parsed : "Chat stream error");
              onError && onError(new Error(errMsg));
              return;
            }

            if (parsed.delta) {
              onChunk && onChunk({ type: "token", delta: parsed.delta });
            } else if (Array.isArray(parsed)) {
              onChunk && onChunk({ type: "sources", sources: parsed });
            }
          } catch (err) {
            console.warn("Parse error:", err);
          }
        }
      }
    }

    onDone && onDone();
  } catch (error) {
    console.error("Chat stream error:", error);
    onError && onError(error);
  }
}
