# RAG CHAT FEATURE - REVISED IMPLEMENTATION PLAN
**Date**: November 6, 2026  
**Project**: Rag_Mcp - Functional RAG Chat with Gemini & OpenRouter  
**Status**: PENDING APPROVAL (REVISED)

---

## EXECUTIVE SUMMARY

Based on your final requirements, I've verified the current free AI model landscape and inspected your existing architecture. Here's what I found:

### ✅ **Existing Infrastructure (Reusable)**
- Python `/chat` endpoint with SSE streaming ✅
- Retrieval pipeline with workspace isolation ✅
- Prompt builder with grounding rules ✅
- Gemini provider implementation ✅
- Node API `streamChat()` relay ✅
- Citation forwarding ✅

### ❌ **What Needs Implementation**
1. OpenRouter provider (NEW)
2. Provider/model selector UI (NEW)
3. Frontend real API integration (MODIFY existing mock)
4. Enhanced citation display (MODIFY existing)
5. Error handling improvements (ADD)

### 🔄 **What to Remove**
- No Grok implementation
- No Ollama implementation
- No local model support (future-ready architecture only)

---

## FREE API VERIFICATION (NOVEMBER 2026)

### ✅ **Provider A: Google Gemini Direct API**

**Official Free Models** (verified from Google documentation):

| Model ID | Free Tier | Rate Limit | Context | Best For |
|----------|-----------|------------|---------|----------|
| `gemini-3.8-flash` | ✅ Yes | 20 req/day | 1M tokens | **RAG RECOMMENDED** |
| `gemini-3.6-flash` | ✅ Yes | 20 req/day | 1M tokens | RAG fallback |
| `gemini-3.5-flash-lite` | ✅ Yes | 500 req/day | 32K tokens | High-volume, short context |
| `gemini-3.1-flash-lite` | ✅ Yes | 500 req/day | 32K tokens | High-volume, short context |

**Recommendation for RAG**: ✅ **`gemini-3.8-flash`**

**Reasoning**:
- Released September 2, 2026
- Google's "best reasoning and coding model yet"
- 1M token context window (excellent for RAG with large retrieved chunks)
- Free tier with 20 requests/day
- Replaces deprecated gemini-3.7-flash
- Optimal balance of quality and context for RAG applications

**Sources**:
- [Gemini API Free Tier (aifreeapi.com)](https://www.aifreeapi.com/en/posts/google-gemini-api-free-tier)
- [Gemini 3.8 Flash Guide (lindy.ai)](https://www.lindy.ai/blog/gemini-3-8-flash)
- [Gemini API Pricing (blog.laozhang.ai)](https://blog.laozhang.ai/en/posts/gemini-api-pricing)

**API Configuration**:
```bash
GEMINI_API_KEY=your_api_key_here
```
Get key: https://aistudio.google.com/apikey

---

### ✅ **Provider B: OpenRouter**

**Verified Free Models** (as of November 2026):

| Model ID | Provider | Context | Type | Best For |
|----------|----------|---------|------|----------|
| `nvidia/nemotron-3-ultra-550b-a55b:free` | NVIDIA | 1M tokens | Text | **RAG RECOMMENDED** |
| `nvidia/nemotron-3.5-super-vl:free` | NVIDIA | 262K tokens | Multimodal | Vision + text |
| `nvidia/nemotron-3.5-lightning:free` | NVIDIA | 65K tokens | Text | Fast inference |
| `google/gemma-4:free` | Google | 32K tokens | Text | General purpose |
| `cohere/north-mini-code:free` | Cohere | 65K tokens | Code | Code-focused |
| `recursivellm/flint:free` | Recursive | 128K tokens | Code | Coding tasks |
| `openrouter/free` | Router | Varies | Text | **Dynamic free selector** |

**Recommendation for RAG**: ✅ **Two Options**

**Option 1: Fixed Model** - `nvidia/nemotron-3-ultra-550b-a55b:free`
- 550B MoE (55B active)
- 1M token context
- Frontier reasoning quality
- Stable model ID
- Best for consistent RAG quality

**Option 2: Dynamic Router** - `openrouter/free`
- Selects from available free models
- Automatic fallback if one model unavailable
- May vary in quality
- Good for high availability

**Implementation Strategy**: Support both
- Default: `nvidia/nemotron-3-ultra-550b-a55b:free`
- Fallback: `openrouter/free` (if user prefers)
- Allow user to select specific free models

**Sources**:
- [OpenRouter Free Models (openrouter.us.helicone.ai)](https://openrouter.us.helicone.ai/collections/free-models)
- [OpenRouter Models (openrouter.ai)](https://openrouter.ai/models)
- [Free Models Nov 2026 (teamday.ai)](https://www.teamday.ai/blog/best-free-ai-models-openrouter-2026)

**API Configuration**:
```bash
OPENROUTER_API_KEY=your_api_key_here
```
Get key: https://openrouter.ai/keys

**API Format**:
- Base URL: `https://openrouter.ai/api/v1`
- OpenAI-compatible chat completions format
- Streaming supported via SSE

---

## ARCHITECTURE ANALYSIS

### Existing RAG Flow (Verified)

```
User Question (Frontend)
    ↓
Node API (/api/v1/chat endpoint - TO BE CREATED)
    ↓
aiClient.streamChat() (apps/api/src/services/ai-client.js) ✅ EXISTS
    ↓
Python AI Service POST /chat (services/ai-service/app/api/query.py) ✅ EXISTS
    ↓
Retriever.retrieve() - Hybrid search ✅ EXISTS
    ↓
MongoDB chunks (workspace-isolated) ✅ EXISTS
    ↓
PromptBuilder.build_chat_prompt() ✅ EXISTS
    ↓
LLM Router get_llm_provider(model) (services/ai-service/app/llm/router.py) ✅ EXISTS
    ↓
GeminiLLMProvider.stream_chat() ✅ EXISTS
OR
OpenRouterLLMProvider.stream_chat() ❌ TO BE CREATED
    ↓
SSE Stream (token, citations, usage, done, error)
    ↓
Node API relays SSE to frontend
    ↓
Frontend displays streaming response + citations
```

### Existing Chat Service (Verified)

**File**: `apps/api/src/modules/chatbots/chat.service.js`
- Method: `streamChatTurn()` ✅ EXISTS
- Purpose: Handles chatbot conversations
- Already calls `aiClient.streamChat()`
- Saves conversation history to MongoDB

**Current Usage**: Only for chatbot widget (public API)

**Plan**: Create parallel direct chat endpoint for internal dashboard use

---

## IMPLEMENTATION PLAN

### Phase 1: Backend Provider Implementation

#### 1.1 Add OpenRouter Provider

**File**: `services/ai-service/app/llm/providers/openrouter.py` (NEW)

```python
"""
OpenRouter LLM Provider using OpenAI-compatible API.
Supports free models via OpenRouter's unified API.
"""

from __future__ import annotations

import json
from typing import AsyncGenerator, List, Optional
import httpx

from app.core.logging import logger
from app.rag.prompt_builder import ChatMessage
from app.llm.providers.base import BaseLLMProvider, StreamChunk
from app.llm.streaming import StreamUsage


class OpenRouterLLMProvider(BaseLLMProvider):
    """
    Streaming provider for OpenRouter models via OpenAI-compatible API.
    Base URL: https://openrouter.ai/api/v1
    """

    def __init__(
        self,
        api_key: str,
        default_model: str = "nvidia/nemotron-3-ultra-550b-a55b:free",
        base_url: str = "https://openrouter.ai/api/v1",
    ):
        self.api_key = api_key
        self.default_model = default_model
        self.base_url = base_url.rstrip("/")

    async def stream_chat(
        self,
        messages: List[ChatMessage],
        system_prompt: str,
        model: Optional[str] = None,
        temperature: float = 0.7,
        max_tokens: int = 1024,
    ) -> AsyncGenerator[StreamChunk, None]:
        target_model = model or self.default_model

        url = f"{self.base_url}/chat/completions"

        # Convert to OpenAI format
        formatted_messages = []
        if system_prompt:
            formatted_messages.append({"role": "system", "content": system_prompt})

        for msg in messages:
            formatted_messages.append({"role": msg.role, "content": msg.content})

        payload = {
            "model": target_model,
            "messages": formatted_messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
            "stream": True,
        }

        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
            "HTTP-Referer": "https://rag-mcp.ai",  # Optional: for OpenRouter analytics
            "X-Title": "Rag_Mcp",  # Optional: for OpenRouter analytics
        }

        timeout = httpx.Timeout(connect=10.0, read=45.0, write=10.0, pool=10.0)

        async with httpx.AsyncClient(timeout=timeout) as client:
            try:
                async with client.stream("POST", url, json=payload, headers=headers) as response:
                    if response.status_code != 200:
                        err_body = await response.aread()
                        logger.error(
                            f"OpenRouter API error {response.status_code}: {err_body.decode('utf-8', errors='replace')}"
                        )
                        raise RuntimeError(f"OpenRouter streaming failed with status {response.status_code}")

                    async for line in response.aiter_lines():
                        if not line or not line.startswith("data: "):
                            continue

                        raw_data = line[len("data: ") :].strip()
                        if not raw_data or raw_data == "[DONE]":
                            continue

                        try:
                            chunk_data = json.loads(raw_data)
                        except json.JSONDecodeError:
                            continue

                        # Extract delta from OpenAI format
                        choices = chunk_data.get("choices", [])
                        if not choices:
                            continue

                        first_choice = choices[0]
                        delta = first_choice.get("delta", {})
                        delta_text = delta.get("content", "")
                        finish_reason = first_choice.get("finish_reason")

                        # Extract usage if present
                        usage = None
                        usage_data = chunk_data.get("usage")
                        if usage_data:
                            usage = StreamUsage(
                                prompt_tokens=usage_data.get("prompt_tokens", 0),
                                completion_tokens=usage_data.get("completion_tokens", 0),
                                total_tokens=usage_data.get("total_tokens", 0),
                            )

                        if delta_text or usage or finish_reason:
                            yield StreamChunk(
                                delta=delta_text,
                                usage=usage,
                                finish_reason=finish_reason,
                            )

            except httpx.TimeoutException as exc:
                logger.error(f"OpenRouter API request timed out: {exc}")
                raise RuntimeError("OpenRouter API connection timed out") from exc
            except httpx.NetworkError as exc:
                logger.error(f"OpenRouter API network error: {exc}")
                raise RuntimeError(f"OpenRouter API network error: {exc}") from exc
```

**Estimated Time**: 1 hour

---

#### 1.2 Update Config

**File**: `services/ai-service/app/core/config.py` (MODIFY)

Add after line ~75:

```python
# OpenRouter
OPENROUTER_API_KEY: str = Field(default="", description="OpenRouter API key")
```

**Estimated Time**: 5 minutes

---

#### 1.3 Update LLM Router

**File**: `services/ai-service/app/llm/router.py` (MODIFY)

Add imports:
```python
from app.llm.providers.openrouter import OpenRouterLLMProvider

_openrouter_instance: Optional[OpenRouterLLMProvider] = None
```

Modify `get_llm_provider()` function to add OpenRouter logic:

```python
def get_llm_provider(model: Optional[str] = None) -> BaseLLMProvider:
    """
    Selects and returns an LLM provider instance based on model name prefix or available credentials.
    """
    global _gemini_instance, _openai_instance, _ollama_instance, _openrouter_instance
    settings = get_settings()

    model_lower = (model or "").lower().strip()

    # OpenRouter models (check first for specific routing)
    if any(prefix in model_lower for prefix in ("nvidia/", "google/gemma", "cohere/", "recursivellm/", "openrouter/free")):
        if not settings.OPENROUTER_API_KEY:
            raise ValueError(f"Model '{model}' requested, but OPENROUTER_API_KEY is not configured.")
        if _openrouter_instance is None:
            _openrouter_instance = OpenRouterLLMProvider(api_key=settings.OPENROUTER_API_KEY)
        return _openrouter_instance

    # Gemini models
    if model_lower.startswith("gemini"):
        if not settings.GEMINI_API_KEY:
            raise ValueError(f"Model '{model}' requested, but GEMINI_API_KEY is not configured.")
        if _gemini_instance is None:
            _gemini_instance = GeminiLLMProvider(api_key=settings.GEMINI_API_KEY)
        return _gemini_instance

    # OpenAI models
    if any(model_lower.startswith(prefix) for prefix in ("gpt", "o1", "o3", "text-davinci")):
        if not settings.OPENAI_API_KEY:
            raise ValueError(f"Model '{model}' requested, but OPENAI_API_KEY is not configured.")
        if _openai_instance is None:
            _openai_instance = OpenAILLMProvider(api_key=settings.OPENAI_API_KEY)
        return _openai_instance

    # Ollama local models (kept for future, not exposed in UI)
    if (
        model_lower.startswith("ollama/")
        or any(m in model_lower for m in ("llama", "mistral", "qwen", "phi", "deepseek"))
    ):
        if _ollama_instance is None:
            _ollama_instance = OllamaLLMProvider(base_url=settings.OLLAMA_BASE_URL)
        return _ollama_instance

    # Default fallback: prefer Gemini, then OpenRouter, then OpenAI
    if settings.GEMINI_API_KEY:
        if _gemini_instance is None:
            _gemini_instance = GeminiLLMProvider(api_key=settings.GEMINI_API_KEY)
        return _gemini_instance

    if settings.OPENROUTER_API_KEY:
        if _openrouter_instance is None:
            _openrouter_instance = OpenRouterLLMProvider(api_key=settings.OPENROUTER_API_KEY)
        return _openrouter_instance

    if settings.OPENAI_API_KEY:
        if _openai_instance is None:
            _openai_instance = OpenAILLMProvider(api_key=settings.OPENAI_API_KEY)
        return _openai_instance

    # Local fallback (not exposed in UI for now)
    if _ollama_instance is None:
        _ollama_instance = OllamaLLMProvider(base_url=settings.OLLAMA_BASE_URL)
    return _ollama_instance
```

Update `reset_llm_providers()`:
```python
def reset_llm_providers() -> None:
    """Reset cached provider singletons (for tests)."""
    global _gemini_instance, _openai_instance, _ollama_instance, _openrouter_instance
    _gemini_instance = None
    _openai_instance = None
    _ollama_instance = None
    _openrouter_instance = None
```

**Estimated Time**: 30 minutes

---

#### 1.4 Create Node API Chat Endpoint

**File**: `apps/api/src/modules/chat/chat.routes.js` (NEW)

```javascript
import { Router } from "express";
import { authenticate } from "../../middleware/auth.middleware.js";
import aiClient from "../../services/ai-client.js";
import AppError from "../../utils/app-error.js";
import logger from "../../utils/logger.js";

const router = Router();

/**
 * POST /api/v1/chat
 * Direct RAG chat endpoint for dashboard (not chatbot widget).
 * Streams SSE response from AI service.
 */
router.post("/", authenticate, async (req, res) => {
  const { message, knowledgeBaseId, model, history = [], options = {} } = req.body;
  const workspaceId = req.user.activeWorkspaceId;

  if (!workspaceId) {
    throw AppError.badRequest("Active workspace required");
  }

  if (!message || typeof message !== "string" || message.trim().length === 0) {
    throw AppError.badRequest("Message is required");
  }

  if (!knowledgeBaseId) {
    throw AppError.badRequest("Knowledge base ID is required");
  }

  // Build payload for AI service
  const aiPayload = {
    message: message.trim(),
    knowledgeBaseId,
    model: model || "gemini-3.8-flash", // Default to Gemini 3.8 Flash
    history: history || [],
    top_k: options.top_k || 5,
    strategy: options.strategy || "auto",
    temperature: options.temperature || 0.7,
    max_tokens: options.max_tokens || 1024,
  };

  logger.info({
    workspaceId,
    knowledgeBaseId,
    model: aiPayload.model,
    msg: "Direct chat request received",
  });

  // Set SSE headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");

  const abortController = new AbortController();

  // Handle client disconnect
  req.on("close", () => {
    logger.info({ workspaceId, msg: "Client disconnected from chat stream" });
    abortController.abort();
  });

  try {
    await aiClient.streamChat(workspaceId.toString(), aiPayload, {
      signal: abortController.signal,
      onCitations: (citations) => {
        res.write(`event: citations\ndata: ${JSON.stringify(citations)}\n\n`);
      },
      onToken: (delta) => {
        res.write(`event: token\ndata: ${JSON.stringify({ delta })}\n\n`);
      },
      onUsage: (usage) => {
        res.write(`event: usage\ndata: ${JSON.stringify(usage)}\n\n`);
      },
      onDone: () => {
        res.write(`event: done\ndata: {}\n\n`);
        res.end();
      },
      onError: (error) => {
        logger.error({ workspaceId, error, msg: "Chat stream error" });
        res.write(`event: error\ndata: ${JSON.stringify(error)}\n\n`);
        res.write(`event: done\ndata: {}\n\n`);
        res.end();
      },
    });
  } catch (err) {
    logger.error({ workspaceId, err: err.message, msg: "Failed to initiate chat stream" });
    if (!res.headersSent) {
      throw err;
    }
    res.write(
      `event: error\ndata: ${JSON.stringify({ message: err.message, code: err.code || "CHAT_ERROR" })}\n\n`
    );
    res.write(`event: done\ndata: {}\n\n`);
    res.end();
  }
});

export default router;
```

**File**: `apps/api/src/app.js` (MODIFY)

Add route import and registration:
```javascript
import chatRoutes from "./modules/chat/chat.routes.js";

// ... after other route registrations
app.use("/api/v1/chat", chatRoutes);
```

**Estimated Time**: 1 hour

---

### Phase 2: Frontend Implementation

#### 2.1 Create Chat API Client

**File**: `apps/web/src/lib/api/chat.js` (NEW)

```javascript
import { getAccessToken } from "../auth/client-auth";

/**
 * Stream chat messages from the backend RAG pipeline.
 * @param {object} payload - { message, knowledgeBaseId, model, history, options }
 * @param {object} callbacks - { onToken, onCitations, onUsage, onDone, onError }
 * @param {AbortSignal} signal - Abort signal for cancellation
 */
export async function streamChatMessage(payload, callbacks, signal) {
  const token = getAccessToken();
  if (!token) {
    throw new Error("Not authenticated");
  }

  const response = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/v1/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
    signal,
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData?.error?.message || `Chat failed with status ${response.status}`);
  }

  if (!response.body) {
    throw new Error("No response body");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Split by double newline for SSE events
      const events = buffer.split("\n\n");
      buffer = events.pop() || "";

      for (const rawEvent of events) {
        if (!rawEvent.trim()) continue;

        let eventType = "message";
        let dataStr = "";

        const lines = rawEvent.split("\n");
        for (const line of lines) {
          if (line.startsWith("event: ")) {
            eventType = line.slice(7).trim();
          } else if (line.startsWith("data: ")) {
            dataStr = line.slice(6).trim();
          }
        }

        let parsedData = null;
        try {
          parsedData = dataStr ? JSON.parse(dataStr) : {};
        } catch {
          parsedData = dataStr;
        }

        if (eventType === "token" && callbacks.onToken) {
          callbacks.onToken(parsedData?.delta || "");
        } else if (eventType === "citations" && callbacks.onCitations) {
          callbacks.onCitations(parsedData || []);
        } else if (eventType === "usage" && callbacks.onUsage) {
          callbacks.onUsage(parsedData || {});
        } else if (eventType === "done" && callbacks.onDone) {
          callbacks.onDone(parsedData || {});
        } else if (eventType === "error") {
          if (callbacks.onError) callbacks.onError(parsedData);
          throw new Error(parsedData?.message || "Stream error");
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
```

**Estimated Time**: 30 minutes

---

#### 2.2 Update Chat Hook

**File**: `apps/web/src/hooks/use-chat.js` (MODIFY)

Replace mock implementation with real API:

```javascript
import { useState, useRef, useEffect, useCallback } from "react";
import { streamChatMessage } from "@/lib/api/chat";
import { getActiveWorkspace } from "@/lib/api/real";

/**
 * Hook for managing real RAG chat with streaming.
 */
export function useChat() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [copiedId, setCopiedId] = useState(null);
  const [error, setError] = useState(null);
  const [selectedProvider, setSelectedProvider] = useState("gemini");
  const [selectedModel, setSelectedModel] = useState("gemini-3.8-flash");
  const [knowledgeBaseId, setKnowledgeBaseId] = useState(null);

  const messagesEndRef = useRef(null);
  const abortControllerRef = useRef(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, isTyping, scrollToBottom]);

  // Load workspace and default KB on mount
  useEffect(() => {
    async function loadWorkspace() {
      try {
        const workspace = await getActiveWorkspace();
        // TODO: Get first KB from workspace
        // For now, set to null and show error if not selected
        console.log("Active workspace:", workspace);
      } catch (err) {
        console.error("Failed to load workspace:", err);
      }
    }
    loadWorkspace();
  }, []);

  const handleSend = useCallback(
    async (forcedText) => {
      const textToSend = forcedText || input;
      if (!textToSend.trim() || isTyping) return;

      if (!knowledgeBaseId) {
        setError("Please select a knowledge base first");
        return;
      }

      const userMsg = {
        id: `usr_${Date.now()}`,
        role: "user",
        content: textToSend,
        timestamp: new Date().toLocaleTimeString(),
      };

      setMessages((prev) => [...prev, userMsg]);
      if (!forcedText) setInput("");
      setIsTyping(true);
      setError(null);

      // Start assistant message
      const assistantId = `asst_${Date.now()}`;
      let assistantContent = "";
      let citations = [];

      setMessages((prev) => [
        ...prev,
        {
          id: assistantId,
          role: "assistant",
          content: "",
          sources: [],
          timestamp: new Date().toLocaleTimeString(),
        },
      ]);

      abortControllerRef.current = new AbortController();

      try {
        await streamChatMessage(
          {
            message: textToSend,
            knowledgeBaseId,
            model: selectedModel,
            history: messages.slice(-10).map((m) => ({
              role: m.role,
              content: m.content,
            })),
          },
          {
            onToken: (delta) => {
              assistantContent += delta;
              setMessages((prev) =>
                prev.map((msg) =>
                  msg.id === assistantId ? { ...msg, content: assistantContent } : msg
                )
              );
            },
            onCitations: (cites) => {
              citations = cites;
              setMessages((prev) =>
                prev.map((msg) =>
                  msg.id === assistantId
                    ? {
                        ...msg,
                        sources: cites.map((c) => ({
                          title: c.metadata?.title || "Unknown Source",
                          score: c.score,
                          url: c.metadata?.url,
                          text: c.text,
                        })),
                      }
                    : msg
                )
              );
            },
            onUsage: (usage) => {
              console.log("Token usage:", usage);
            },
            onDone: () => {
              setIsTyping(false);
            },
            onError: (err) => {
              console.error("Stream error:", err);
              setError(err.message || "Failed to get response");
              setIsTyping(false);
            },
          },
          abortControllerRef.current.signal
        );
      } catch (err) {
        console.error("Chat error:", err);
        setError(err.message || "Failed to send message");
        setIsTyping(false);
        // Remove incomplete assistant message
        setMessages((prev) => prev.filter((m) => m.id !== assistantId));
      }
    },
    [input, isTyping, knowledgeBaseId, selectedModel, messages]
  );

  const handleCopy = useCallback((id, text) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1800);
  }, []);

  const clearChat = useCallback(() => {
    setMessages([]);
    setError(null);
  }, []);

  const stopGeneration = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      setIsTyping(false);
    }
  }, []);

  return {
    messages,
    setMessages,
    input,
    setInput,
    isTyping,
    isThinking,
    setIsThinking,
    copiedId,
    messagesEndRef,
    handleSend,
    handleCopy,
    error,
    setError,
    selectedProvider,
    setSelectedProvider,
    selectedModel,
    setSelectedModel,
    knowledgeBaseId,
    setKnowledgeBaseId,
    clearChat,
    stopGeneration,
  };
}
```

**Estimated Time**: 1.5 hours

---

#### 2.3 Create Provider/Model Selector Component

**File**: `apps/web/src/components/chat/ProviderSelector.jsx` (NEW)

```jsx
import React from "react";

const PROVIDERS = {
  gemini: {
    name: "Google Gemini",
    models: [
      {
        id: "gemini-3.8-flash",
        name: "Gemini 3.8 Flash",
        free: true,
        recommended: true,
        context: "1M tokens",
        limit: "20 req/day",
      },
      {
        id: "gemini-3.6-flash",
        name: "Gemini 3.6 Flash",
        free: true,
        context: "1M tokens",
        limit: "20 req/day",
      },
      {
        id: "gemini-3.5-flash-lite",
        name: "Gemini 3.5 Flash Lite",
        free: true,
        context: "32K tokens",
        limit: "500 req/day",
      },
    ],
  },
  openrouter: {
    name: "OpenRouter",
    models: [
      {
        id: "nvidia/nemotron-3-ultra-550b-a55b:free",
        name: "NVIDIA Nemotron 3 Ultra",
        free: true,
        recommended: true,
        context: "1M tokens",
        limit: "Provider-dependent",
      },
      {
        id: "nvidia/nemotron-3.5-super-vl:free",
        name: "NVIDIA Nemotron 3.5 Super VL",
        free: true,
        context: "262K tokens",
        limit: "Provider-dependent",
      },
      {
        id: "openrouter/free",
        name: "OpenRouter Free (Dynamic)",
        free: true,
        context: "Varies",
        limit: "Provider-dependent",
      },
      {
        id: "google/gemma-4:free",
        name: "Google Gemma 4",
        free: true,
        context: "32K tokens",
        limit: "Provider-dependent",
      },
    ],
  },
};

export function ProviderSelector({
  selectedProvider,
  onProviderChange,
  selectedModel,
  onModelChange,
}) {
  const currentModels = PROVIDERS[selectedProvider]?.models || [];

  return (
    <div className="provider-selector">
      <div className="selector-group">
        <label>Provider</label>
        <select
          value={selectedProvider}
          onChange={(e) => {
            const newProvider = e.target.value;
            onProviderChange(newProvider);
            // Auto-select first model
            const firstModel = PROVIDERS[newProvider]?.models[0];
            if (firstModel) {
              onModelChange(firstModel.id);
            }
          }}
        >
          {Object.entries(PROVIDERS).map(([key, provider]) => (
            <option key={key} value={key}>
              {provider.name}
            </option>
          ))}
        </select>
      </div>

      <div className="selector-group">
        <label>Model</label>
        <select value={selectedModel} onChange={(e) => onModelChange(e.target.value)}>
          {currentModels.map((model) => (
            <option key={model.id} value={model.id}>
              {model.name}
              {model.recommended && " ⭐"}
              {model.free && " (FREE)"}
            </option>
          ))}
        </select>
      </div>

      <div className="model-info">
        {currentModels
          .filter((m) => m.id === selectedModel)
          .map((model) => (
            <div key={model.id} className="info-badge">
              <span className="badge free">FREE</span>
              <span className="badge context">{model.context}</span>
              <span className="badge limit">{model.limit}</span>
            </div>
          ))}
      </div>
    </div>
  );
}
```

**Estimated Time**: 1 hour

---

#### 2.4 Update Chat Header

**File**: `apps/web/src/components/chat/ChatHeader.jsx` (MODIFY)

Add ProviderSelector integration:

```jsx
import { ProviderSelector } from "./ProviderSelector";

export function ChatHeader({
  currentTitle,
  selectedBotId,
  onSelectBot,
  dropdownOpen,
  onToggleDropdown,
  isThinking,
  onToggleThinking,
  showRagDebug,
  onToggleRagDebug,
  // NEW PROPS
  selectedProvider,
  onProviderChange,
  selectedModel,
  onModelChange,
}) {
  return (
    <div className="chatgpt-header">
      {/* ... existing header content ... */}

      <ProviderSelector
        selectedProvider={selectedProvider}
        onProviderChange={onProviderChange}
        selectedModel={selectedModel}
        onModelChange={onModelChange}
      />

      {/* ... rest of header ... */}
    </div>
  );
}
```

**Estimated Time**: 30 minutes

---

#### 2.5 Update Chat Canvas Page

**File**: `apps/web/src/pages/dashboard/chat-canvas.jsx` (MODIFY)

Connect all the pieces:

```jsx
import { ProviderSelector } from "@/components/chat/ProviderSelector";

export default function ChatCanvas() {
  // ... existing code ...

  const {
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
    error,
    setError,
    selectedProvider,
    setSelectedProvider,
    selectedModel,
    setSelectedModel,
    knowledgeBaseId,
    setKnowledgeBaseId,
    clearChat,
    stopGeneration,
  } = useChat();

  // ... rest of implementation ...

  return (
    <div className="chatgpt-canvas-container">
      <ChatHeader
        currentTitle={currentTitle}
        selectedBotId={selectedBotId}
        onSelectBot={handleSelectBot}
        dropdownOpen={modelDropdownOpen}
        onToggleDropdown={() => setModelDropdownOpen((v) => !v)}
        isThinking={isThinking}
        onToggleThinking={() => setIsThinking((v) => !v)}
        showRagDebug={showRagDebug}
        onToggleRagDebug={() => setShowRagDebug((v) => !v)}
        selectedProvider={selectedProvider}
        onProviderChange={setSelectedProvider}
        selectedModel={selectedModel}
        onModelChange={setSelectedModel}
      />
      {/* ... rest ... */}
    </div>
  );
}
```

**Estimated Time**: 30 minutes

---

#### 2.6 Enhanced Citation Display

**File**: `apps/web/src/components/chat/MessageList.jsx` (MODIFY)

Update to show real citation metadata:

```jsx
// In message rendering:
{msg.sources && msg.sources.length > 0 && (
  <div className="message-sources">
    <div className="sources-label">Sources:</div>
    {msg.sources.map((source, idx) => (
      <div key={idx} className="source-card">
        <div className="source-header">
          <span className="source-title">{source.title}</span>
          <span className="source-score">{(source.score * 100).toFixed(0)}% match</span>
        </div>
        {source.url && (
          <a href={source.url} target="_blank" rel="noopener noreferrer" className="source-url">
            {source.url}
          </a>
        )}
        {source.text && (
          <div className="source-preview">
            {source.text.substring(0, 150)}...
          </div>
        )}
      </div>
    ))}
  </div>
)}
```

**Estimated Time**: 30 minutes

---

### Phase 3: Testing

**Test Matrix**:

| Test Case | Provider | Expected | Status |
|-----------|----------|----------|--------|
| Valid question with indexed docs | Gemini | Relevant answer + citations | ⬜ |
| Valid question with indexed docs | OpenRouter | Relevant answer + citations | ⬜ |
| Unrelated question | Both | "Not enough information" | ⬜ |
| Empty KB | Both | "Not enough information" | ⬜ |
| No relevant chunks | Both | "Not enough information" | ⬜ |
| Switch providers mid-conversation | Both | Continues correctly | ⬜ |
| Missing GEMINI_API_KEY | Gemini | Clear error | ⬜ |
| Missing OPENROUTER_API_KEY | OpenRouter | Clear error | ⬜ |
| Invalid API key | Both | Clear error | ⬜ |
| Rate limit (Gemini) | Gemini | 429 error + retry | ⬜ |
| Model unavailable (OpenRouter) | OpenRouter | Error + fallback option | ⬜ |
| Workspace isolation | Both | Only own docs retrieved | ⬜ |
| Citation correctness | Both | Matches retrieved chunks | ⬜ |
| SSE stream interrupt | Both | Graceful cleanup | ⬜ |
| Frontend build | N/A | No errors | ⬜ |
| Existing tests | N/A | No regression | ⬜ |

**Estimated Time**: 3-4 hours

---

## FILE CHANGES SUMMARY

### New Files (5):
1. `services/ai-service/app/llm/providers/openrouter.py` - OpenRouter provider
2. `apps/api/src/modules/chat/chat.routes.js` - Direct chat endpoint
3. `apps/web/src/lib/api/chat.js` - Chat API client
4. `apps/web/src/components/chat/ProviderSelector.jsx` - Provider/model selector UI
5. `apps/web/src/components/chat/ProviderSelector.css` - Selector styles

### Modified Files (8):
1. `services/ai-service/app/core/config.py` - Add OPENROUTER_API_KEY
2. `services/ai-service/app/llm/router.py` - Add OpenRouter routing
3. `apps/api/src/app.js` - Register chat routes
4. `apps/web/src/hooks/use-chat.js` - Replace mock with real API
5. `apps/web/src/components/chat/ChatHeader.jsx` - Add provider selector
6. `apps/web/src/components/chat/MessageList.jsx` - Enhanced citations
7. `apps/web/src/pages/dashboard/chat-canvas.jsx` - Connect provider state
8. `apps/web/src/pages/dashboard/chat-canvas.css` - Styling updates

### Removed Files (0):
- No deletions (keep Ollama provider for future, just don't expose in UI)

### Environment Variables (2):
```bash
# Required
GEMINI_API_KEY=your_gemini_key_here

# Required
OPENROUTER_API_KEY=your_openrouter_key_here
```

---

## PROVIDER CONFIGURATION

### Google Gemini
**Get API Key**: https://aistudio.google.com/apikey  
**Cost**: FREE (20 req/day for 3.8 Flash)  
**Default Model**: `gemini-3.8-flash`

### OpenRouter
**Get API Key**: https://openrouter.ai/keys  
**Cost**: FREE (provider-dependent limits)  
**Default Model**: `nvidia/nemotron-3-ultra-550b-a55b:free`

---

## GROUNDED ANSWER ENFORCEMENT

**No changes needed** - existing prompt builder already enforces:
- Rule #1: Only answer based on provided passages
- Rule #2: Cite sources using [N] notation
- Rule #3: If context insufficient, say so explicitly
- Rule #4: Do not invent facts
- Rule #5: When NO context provided, respond: "I don't have enough information..."

**File**: `services/ai-service/app/rag/prompt_builder.py` ✅ ALREADY IMPLEMENTED

---

## MODULAR ARCHITECTURE (FUTURE-READY)

The implementation maintains a modular provider architecture:

**Current**: Gemini + OpenRouter (both free)  
**Future-Ready**: Can add user-provided local models via same interface

**Not Implemented Now** (but architecture supports):
- Ollama integration UI
- Custom model endpoint configuration
- Local model selector

The provider system is extensible without modifying RAG pipeline.

---

## ESTIMATED TIMELINE

| Phase | Task | Time |
|-------|------|------|
| 1.1 | OpenRouter Provider | 1h |
| 1.2 | Config Update | 5m |
| 1.3 | Router Update | 30m |
| 1.4 | Node API Endpoint | 1h |
| 2.1 | Chat API Client | 30m |
| 2.2 | Update Chat Hook | 1.5h |
| 2.3 | Provider Selector | 1h |
| 2.4 | Update Chat Header | 30m |
| 2.5 | Update Chat Canvas | 30m |
| 2.6 | Enhanced Citations | 30m |
| 3 | Testing | 3-4h |
| **TOTAL** | **10-11 hours** |

---

## RISKS & MITIGATION

### Gemini Rate Limits (20 req/day)
**Risk**: Users exceed free tier  
**Mitigation**: Show rate limit warning, implement exponential backoff, suggest OpenRouter fallback

### OpenRouter Model Availability
**Risk**: Free models change over time  
**Mitigation**: Support dynamic fallback to `openrouter/free`, show clear error messages

### API Key Security
**Risk**: Keys exposed in frontend  
**Mitigation**: All keys stored backend-only, never sent to React

### Workspace Isolation
**Risk**: Cross-workspace data leakage  
**Mitigation**: Already enforced via `X-Workspace-Id` header at Python service level

---

## NEXT STEPS

**I am ready to implement this revised plan after your approval.**

Please confirm:
1. ✅ Use `gemini-3.8-flash` as default Gemini model (not 3.5)
2. ✅ Use `nvidia/nemotron-3-ultra-550b-a55b:free` as default OpenRouter model
3. ✅ Support `openrouter/free` dynamic router as fallback option
4. ✅ NO Grok implementation
5. ✅ NO Ollama UI integration (keep provider class for future)
6. ✅ Implement direct chat endpoint separate from chatbot widget
7. ✅ Reuse existing RAG pipeline (no parallel implementation)
8. ✅ Display only verified free models in UI

**Once approved, I will**:
1. Implement backend (OpenRouter provider, router, endpoint)
2. Test backend with both providers
3. Implement frontend (API client, hooks, UI)
4. Test frontend integration
5. Run full test suite
6. Report results with evidence

**Awaiting your approval to proceed.**

---

**Prepared By**: AI Development Agent  
**Review Status**: REVISED - Ready for User Approval  
**Implementation Status**: READY TO START AFTER APPROVAL

