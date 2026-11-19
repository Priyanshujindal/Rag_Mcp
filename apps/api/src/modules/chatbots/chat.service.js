/**
 * apps/api/src/modules/chatbots/chat.service.js
 * ==============================================
 * Shared core for streaming RAG chat interactions:
 * - Validates knowledge base / chatbot state
 * - Manages conversation history & message persistence
 * - Relays SSE tokens, citations, and usage to client
 * - Saves complete turn (user + assistant) to database
 */

import { Conversation, Message } from "../../db/models/index.js";
import aiClient from "../../services/ai-client.js";
import AppError from "../../utils/app-error.js";
import logger from "../../utils/logger.js";

/**
 * Format an SSE frame for writing to response stream
 */
function sseChunk(event, data) {
  const payload = typeof data === "object" ? JSON.stringify(data) : data;
  return `event: ${event}\ndata: ${payload}\n\n`;
}

export const chatService = {
  /**
   * Orchestrates RAG chat stream and message persistence
   * @param {object} params
   * @param {object} params.chatbot - Chatbot Mongoose document
   * @param {string} params.workspaceId - Workspace ObjectId
   * @param {string} [params.userId] - Optional User ObjectId (null for public widget)
   * @param {string} params.message - Latest user question
   * @param {string} [params.conversationId] - Existing conversation ObjectId
   * @param {object} [params.options] - Optional overrides (model, temperature, max_tokens)
   * @param {import("express").Response} res - Express response object to stream to
   * @param {import("express").Request} req - Express request object for close listener
   */
  async streamChatTurn({ chatbot, workspaceId, userId = null, message, conversationId = null, options = {} }, res, req) {
    if (!chatbot.knowledgeBaseId) {
      throw AppError.badRequest("Chatbot does not have an attached knowledge base");
    }

    const startTime = Date.now();

    // 1. Resolve or create Conversation
    let conversation = null;
    if (conversationId) {
      conversation = await Conversation.findOne({ _id: conversationId, workspaceId });
      if (!conversation) {
        throw AppError.notFound("Conversation not found in this workspace");
      }
    } else {
      const title = message.trim().slice(0, 60) || "New Conversation";
      conversation = await Conversation.create({
        workspaceId,
        chatbotId: chatbot._id,
        userId,
        title,
      });
    }

    // 2. Fetch recent conversation history
    const historyDocs = await Message.find({
      conversationId: conversation._id,
      workspaceId,
    })
      .sort({ createdAt: 1 })
      .limit(20);

    const history = historyDocs.map((doc) => ({
      role: doc.role.toLowerCase(),
      content: doc.content,
    }));

    // 3. Save User message to database
    await Message.create({
      workspaceId,
      conversationId: conversation._id,
      role: "USER",
      content: message,
    });

    // 4. Configure SSE headers on Express response
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    if (typeof res.flushHeaders === "function") {
      res.flushHeaders();
    }

    // Inform client of conversation ID
    res.write(sseChunk("conversation", { conversationId: conversation._id.toString() }));

    // 5. Connect to Python AI service and stream
    const abortController = new AbortController();
    res.on("close", () => {
      if (!res.writableEnded) {
        abortController.abort();
      }
    });

    let assistantText = "";
    let capturedCitations = [];
    let capturedUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

    const aiPayload = {
      knowledgeBaseId: chatbot.knowledgeBaseId.toString(),
      message,
      conversationId: conversation._id.toString(),
      history,
      custom_prompt: chatbot.config?.systemPrompt || null,
      model: options.model || null,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.max_tokens ?? 1024,
      top_k: options.top_k ?? 5,
      strategy: options.strategy || "auto",
    };

    try {
      await aiClient.streamChat(workspaceId.toString(), aiPayload, {
        signal: abortController.signal,
        onCitations: (citations) => {
          capturedCitations = citations;
          res.write(sseChunk("citations", citations));
        },
        onToken: (token) => {
          assistantText += token;
          res.write(sseChunk("token", { delta: token }));
        },
        onUsage: (usage) => {
          capturedUsage = usage;
          res.write(sseChunk("usage", usage));
        },
        onDone: () => {
          res.write(sseChunk("done", {}));
        },
        onError: (err) => {
          res.write(sseChunk("error", { message: err?.message || "AI stream error" }));
        },
      });

      // 6. Save Assistant message to database upon successful completion
      const latencyMs = Date.now() - startTime;
      const formattedCitations = (capturedCitations || []).map((c) => ({
        title: c.title || "",
        url: c.url || "",
        chunkId: c.sourceId || "",
        snippet: c.snippet || "",
        score: 0,
      }));

      await Message.create({
        workspaceId,
        conversationId: conversation._id,
        role: "ASSISTANT",
        content: assistantText,
        citations: formattedCitations,
        tokenUsage: {
          promptTokens: capturedUsage.prompt_tokens || 0,
          completionTokens: capturedUsage.completion_tokens || 0,
          totalTokens: capturedUsage.total_tokens || 0,
        },
        latencyMs,
      });
    } catch (err) {
      if (abortController.signal.aborted || err.name === "AbortError") {
        logger.info({ workspaceId, chatbotId: chatbot._id }, "Chat stream aborted by client");
        return;
      }
      logger.error({ err: err.message, workspaceId, chatbotId: chatbot._id }, "Error during chat stream relay");
      if (!res.writableEnded) {
        res.write(sseChunk("error", { message: err.message }));
        res.write(sseChunk("done", {}));
      }
    } finally {
      if (!res.writableEnded) {
        res.end();
      }
    }
  },
};

export default chatService;

