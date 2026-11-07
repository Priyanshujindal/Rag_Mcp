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
router.post("/", authenticate, async (req, res, next) => {
  try {
    const { message, knowledgeBaseId, model, history = [], options = {} } = req.body;
    let workspaceId = req.user.activeWorkspaceId 
      || req.headers["x-workspace-id"] 
      || req.get("x-workspace-id")
      || req.get("X-Workspace-Id");
    
    logger.info({ 
      activeWorkspaceId: req.user.activeWorkspaceId,
      headerWorkspace: req.headers["x-workspace-id"],
      resolvedWorkspace: workspaceId,
      msg: "Workspace resolution debug"
    });
    
    if (!workspaceId && req.user.workspaces && req.user.workspaces.length > 0) {
      workspaceId = req.user.workspaces[0].toString();
    }
    
    if (!workspaceId) {
      logger.warn({ userId: req.user.sub, msg: "No workspace found for chat request" });
      return next(AppError.badRequest("Active workspace required. Please select a workspace first."));
    }

    if (!message || typeof message !== "string" || message.trim().length === 0) {
      return next(AppError.badRequest("Message is required"));
    }

    if (!knowledgeBaseId) {
      return next(AppError.badRequest("Knowledge base ID is required"));
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
      max_tokens: options.max_tokens || 4096,
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
    if (typeof res.flushHeaders === "function") {
      res.flushHeaders();
    }

    const abortController = new AbortController();

    // Handle client disconnect on response stream (not req.close which fires when body upload ends)
    res.on("close", () => {
      if (!res.writableEnded) {
        logger.info({ workspaceId, msg: "Client disconnected from chat stream" });
        abortController.abort();
      }
    });

    try {
      await aiClient.streamChat(workspaceId.toString(), aiPayload, {
        signal: abortController.signal,
        onCitations: (citations) => {
          if (!res.writableEnded) {
            res.write(`event: citations\ndata: ${JSON.stringify(citations)}\n\n`);
          }
        },
        onToken: (delta) => {
          if (!res.writableEnded) {
            res.write(`event: token\ndata: ${JSON.stringify({ delta })}\n\n`);
          }
        },
        onUsage: (usage) => {
          if (!res.writableEnded) {
            res.write(`event: usage\ndata: ${JSON.stringify(usage)}\n\n`);
          }
        },
        onDone: () => {
          if (!res.writableEnded) {
            res.write(`event: done\ndata: {}\n\n`);
            res.end();
          }
        },
        onError: (error) => {
          logger.error({ workspaceId, error, msg: "Chat stream error" });
          if (!res.writableEnded) {
            res.write(`event: error\ndata: ${JSON.stringify(error)}\n\n`);
            res.write(`event: done\ndata: {}\n\n`);
            res.end();
          }
        },
      });
    } catch (err) {
      if (abortController.signal.aborted || err.name === "AbortError") {
        logger.info({ workspaceId, msg: "Chat stream aborted by client" });
        return;
      }
      logger.error({ workspaceId, err: err.message, msg: "Failed to initiate chat stream" });
      if (!res.headersSent) {
        return next(err);
      }
      if (!res.writableEnded) {
        res.write(
          `event: error\ndata: ${JSON.stringify({ message: err.message, code: err.code || "CHAT_ERROR" })}\n\n`
        );
        res.write(`event: done\ndata: {}\n\n`);
        res.end();
      }
    }
  } catch (err) {
    next(err);
  }
});

export default router;
