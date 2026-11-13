/**
 * apps/api/src/services/ai-client.js
 * ===================================
 * Internal HTTP client for the Python ai-service (FastAPI).
 * Enforces:
 *   - X-Internal-Key authentication header matching INTERNAL_API_KEY
 *   - X-Workspace-Id header for tenant scoping
 *   - Request timeouts via AbortController
 *   - Retry logic with backoff for transient network / 5xx failures
 *   - SSE streaming relay for RAG chat completion
 */

import config from "../config/index.js";
import AppError from "../utils/app-error.js";
import logger from "../utils/logger.js";

class AiServiceClient {
  constructor() {
    this.baseUrl = config.AI_SERVICE_URL.replace(/\/+$/, "");
    this.internalApiKey = config.INTERNAL_API_KEY;
    this.defaultTimeoutMs = 30000;
  }

  /**
   * Helper to perform standard JSON requests with timeouts and retries
   * @param {string} workspaceId - Tenant ObjectId string
   * @param {string} path - Endpoint path (e.g. /retrieve)
   * @param {object} options - Fetch options (method, body, timeoutMs, maxRetries)
   */
  async _request(workspaceId, path, { method = "GET", body = null, timeoutMs = this.defaultTimeoutMs, maxRetries = 2 } = {}) {
    if (!workspaceId) {
      throw AppError.badRequest("Workspace ID is required for ai-service calls");
    }

    const url = `${this.baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
    const headers = {
      "X-Internal-Key": this.internalApiKey,
      "X-Workspace-Id": workspaceId.toString(),
      "Content-Type": "application/json",
    };

    let attempt = 0;
    let delayMs = 500;

    while (attempt <= maxRetries) {
      const controller = new AbortController();
      const timeoutTimer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const fetchOptions = {
          method,
          headers,
          signal: controller.signal,
        };

        if (body && (method === "POST" || method === "PUT" || method === "PATCH")) {
          fetchOptions.body = JSON.stringify(body);
        }

        const res = await fetch(url, fetchOptions);
        clearTimeout(timeoutTimer);

        if (res.ok) {
          // If no content or delete
          if (res.status === 204) return null;
          return await res.json();
        }

        // Parse standard error envelope
        let errorData = null;
        try {
          errorData = await res.json();
        } catch {
          // Response was not JSON
        }

        const errorMessage = errorData?.error?.message || `AI service returned HTTP ${res.status}`;
        const errorCode = errorData?.error?.code || `AI_SERVICE_${res.status}`;

        // Retry on 502/503/504 or network errors if retries remain
        if (attempt < maxRetries && [502, 503, 504].includes(res.status)) {
          attempt++;
          logger.warn({ attempt, url, status: res.status }, `Transient AI service error, retrying in ${delayMs}ms`);
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          delayMs *= 2;
          continue;
        }

        if (res.status === 404) {
          throw AppError.notFound(errorMessage);
        } else if (res.status === 422 || res.status === 400) {
          throw AppError.badRequest(errorMessage, errorData?.error?.details);
        } else if (res.status === 401 || res.status === 403) {
          throw AppError.internal("Internal authentication failure between API and AI service");
        } else {
          throw new AppError(errorMessage, res.status >= 500 ? 502 : res.status, errorCode, errorData?.error?.details);
        }
      } catch (err) {
        clearTimeout(timeoutTimer);

        if (err.name === "AbortError") {
          if (attempt < maxRetries) {
            attempt++;
            logger.warn({ attempt, url }, `AI service call timed out, retrying in ${delayMs}ms`);
            await new Promise((resolve) => setTimeout(resolve, delayMs));
            delayMs *= 2;
            continue;
          }
          throw new AppError("AI service request timed out", 504, "AI_SERVICE_TIMEOUT");
        }

        // Rethrow AppErrors directly
        if (err instanceof AppError) {
          throw err;
        }

        // Network connection error
        if (attempt < maxRetries) {
          attempt++;
          logger.warn({ attempt, url, err: err.message }, `AI service network error, retrying in ${delayMs}ms`);
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          delayMs *= 2;
          continue;
        }

        throw new AppError(`Failed to communicate with AI service: ${err.message}`, 502, "AI_SERVICE_UNAVAILABLE");
      }
    }
  }

  /**
   * Dispatches document ingestion (crawl, parse, chunk, embed)
   * @param {string} workspaceId
   * @param {object} payload { knowledgeBaseId, sourceId, sourceType, url, fileKey, originalFilename }
   */
  async ingest(workspaceId, payload) {
    return this._request(workspaceId, "/ingest", {
      method: "POST",
      body: payload,
    });
  }

  /**
   * Deletes all chunks belonging to a specific source
   * @param {string} workspaceId
   * @param {string} sourceId
   */
  async deleteSourceChunks(workspaceId, sourceId) {
    return this._request(workspaceId, `/sources/${sourceId}/chunks`, {
      method: "DELETE",
    });
  }

  /**
   * Deletes all chunks belonging to a specific knowledge base
   * @param {string} workspaceId
   * @param {string} kbId
   */
  async deleteKbChunks(workspaceId, kbId) {
    return this._request(workspaceId, `/knowledge-bases/${kbId}/chunks`, {
      method: "DELETE",
    });
  }

  /**
   * Retrieves chunk and storage usage metrics for a workspace
   * @param {string} workspaceId
   */
  async getUsage(workspaceId) {
    try {
      return await this._request(workspaceId, "/usage", {
        method: "GET",
      });
    } catch (err) {
      logger.warn({ workspaceId, err: err.message }, "Could not retrieve usage from AI service; returning zero defaults");
      return {
        workspaceId: workspaceId.toString(),
        totalChunks: 0,
        estimatedMb: 0,
        maxChunks: 5000,
        capacityMb: 400,
        chunkCapacityPercent: 0,
      };
    }
  }

  /**
   * Hybrid retrieval query
   * @param {string} workspaceId
   * @param {object} payload { knowledgeBaseId, query, top_k, strategy, min_score_threshold }
   */
  async retrieve(workspaceId, payload) {
    return this._request(workspaceId, "/retrieve", {
      method: "POST",
      body: payload,
    });
  }

  /**
   * Connects to POST /chat SSE stream and delivers parsed events to callbacks
   * @param {string} workspaceId
   * @param {object} payload ChatRequest payload
   * @param {object} callbacks { onToken, onCitations, onUsage, onDone, onError }
   * @param {AbortSignal} [signal] Optional abort signal from client disconnect
   */
  async streamChat(workspaceId, payload, { onToken, onCitations, onUsage, onDone, onError, signal } = {}) {
    if (!workspaceId) {
      throw AppError.badRequest("Workspace ID is required for chat streaming");
    }

    const url = `${this.baseUrl}/chat`;
    const headers = {
      "X-Internal-Key": this.internalApiKey,
      "X-Workspace-Id": workspaceId.toString(),
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    };

    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal,
    });

    if (!res.ok) {
      let errData = null;
      try {
        errData = await res.json();
      } catch {
        // Not JSON
      }
      const msg = errData?.error?.message || `AI service chat failed with status ${res.status}`;
      throw new AppError(msg, res.status >= 500 ? 502 : res.status, errData?.error?.code || "CHAT_ERROR");
    }

    if (!res.body) {
      throw new AppError("No response body received from AI service chat stream", 502);
    }

    // Process SSE stream chunks
    const reader = res.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Split by double newline for SSE events
        const events = buffer.split("\n\n");
        // Keep the last partial event in the buffer
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

          if (eventType === "token" && onToken) {
            onToken(parsedData?.delta || "");
          } else if (eventType === "citations" && onCitations) {
            onCitations(parsedData || []);
          } else if (eventType === "usage" && onUsage) {
            onUsage(parsedData || {});
          } else if (eventType === "done" && onDone) {
            onDone(parsedData || {});
          } else if (eventType === "error") {
            if (onError) onError(parsedData);
            throw new AppError(parsedData?.message || "LLM stream error", 502, parsedData?.code || "LLM_ERROR");
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * Request AI-generated title for a conversation.
   * @param {string} workspaceId
   * @param {{ message: string, model?: string }} payload
   * @returns {Promise<{ title: string }>}
   */
  async generateTitle(workspaceId, { message, model = "gemini-3.8-flash" }) {
    return this._request(workspaceId, "/generate-title", {
      method: "POST",
      body: { message, model },
      timeoutMs: 8000,
      maxRetries: 1,
    });
  }

  /**
   * Parse an ad-hoc attached file (PDF, TXT, CSV) via Python ai-service.
   * @param {string} workspaceId
   * @param {string} filename
   * @param {Buffer} buffer
   * @param {string} [mimeType="application/octet-stream"]
   * @returns {Promise<{ filename: string, text: string, characterCount: number, pages: number }>}
   */
  async parseDocument(workspaceId, filename, buffer, mimeType = "application/octet-stream") {
    return this._request(workspaceId, "/parse-document", {
      method: "POST",
      body: {
        filename,
        content_base64: buffer.toString("base64"),
        mime_type: mimeType,
      },
      timeoutMs: 15000,
      maxRetries: 1,
    });
  }

  /**
   * Run benchmark evaluation on a knowledge base
   * @param {string} workspaceId
   * @param {object} payload { knowledgeBaseId, dataset_name, queries, top_k, strategy }
   * @returns {Promise<object>}
   */
  async evaluate(workspaceId, payload) {
    return this._request(workspaceId, "/evaluate", {
      method: "POST",
      body: payload,
      timeoutMs: 60000,
      maxRetries: 1,
    });
  }

  /**
   * Generates a downloadable document, presentation, spreadsheet, or code file.
   * @param {string} workspaceId
   * @param {{ fileType: string, title?: string, filename?: string, content?: string, slides?: Array, headers?: Array, rows?: Array, sheetName?: string, language?: string }} payload
   * @returns {Promise<{ filename: string, file_type: string, mime_type: string, size_bytes: number, content_base64: string, preview_data?: object }>}
   */
  async generateFile(workspaceId, payload) {
    return this._request(workspaceId, "/files/generate", {
      method: "POST",
      body: {
        file_type: payload.fileType,
        title: payload.title,
        filename: payload.filename,
        content: payload.content,
        slides: payload.slides,
        headers: payload.headers,
        rows: payload.rows,
        sheet_name: payload.sheetName,
        language: payload.language,
      },
      timeoutMs: 120000,
      maxRetries: 1,
    });
  }
}

export const aiClient = new AiServiceClient();
export default aiClient;

