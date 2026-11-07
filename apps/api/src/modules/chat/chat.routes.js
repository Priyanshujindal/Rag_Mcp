import { Router } from "express";
import { authenticate } from "../../middleware/auth.middleware.js";
import { tenantGuard } from "../../middleware/tenant-guard.middleware.js";
import { Conversation, Message, Membership, KnowledgeBase } from "../../db/models/index.js";
import aiClient from "../../services/ai-client.js";
import titleGeneratorService from "../conversations/title-generator.service.js";
import AppError from "../../utils/app-error.js";
import logger from "../../utils/logger.js";

const router = Router();

/**
 * POST /api/v1/chat
 * Direct RAG chat endpoint with conversation and message persistence.
 * Streams SSE response from AI service.
 */
router.post("/", authenticate, tenantGuard, async (req, res, next) => {
  try {
    const { message, knowledgeBaseId, conversationId, model, history = [], options = {} } = req.body;
    let workspaceId = req.workspaceId
      || req.headers["x-workspace-id"]
      || req.get("x-workspace-id");

    if (!workspaceId && req.user?.id) {
      const membership = await Membership.findOne({ userId: req.user.id }).sort({ createdAt: 1 });
      if (membership) {
        workspaceId = membership.workspaceId;
      }
    }

    if (!workspaceId && knowledgeBaseId) {
      const kb = await KnowledgeBase.findById(knowledgeBaseId);
      if (kb) {
        workspaceId = kb.workspaceId;
      }
    }

    if (!workspaceId) {
      logger.warn({ userId: req.user?.id, msg: "No workspace found for chat request" });
      return next(AppError.badRequest("Active workspace required. Please select a workspace first."));
    }

    if (!message || typeof message !== "string" || message.trim().length === 0) {
      return next(AppError.badRequest("Message is required"));
    }

    const mode = req.body.chatMode || req.body.mode || (knowledgeBaseId ? "rag" : "general");

    if (mode === "rag" && !knowledgeBaseId) {
      return next(
        AppError.badRequest("Knowledge base ID is required in RAG mode. Please select a knowledge base or switch to General Chat mode.")
      );
    }

    const startTime = Date.now();
    const userId = req.user.id || req.user.sub || null;

    // 1. Resolve or create Conversation container
    let conversation = null;
    let isNewConversation = false;
    if (conversationId) {
      conversation = await Conversation.findOne({ _id: conversationId, workspaceId });
      if (!conversation) {
        throw AppError.notFound("Conversation not found");
      }
      // If previous title was generic (e.g. from an initial "hello"), refine it now with this real query!
      if (titleGeneratorService.isGenericTitle(conversation.title)) {
        const refinedTitle = titleGeneratorService.generateHeuristicTitle(message);
        if (!titleGeneratorService.isGenericTitle(refinedTitle)) {
          conversation.title = refinedTitle;
          await conversation.save();
        }
      }
    } else {
      isNewConversation = true;
      const title = titleGeneratorService.generateHeuristicTitle(message);
      conversation = await Conversation.create({
        workspaceId,
        userId,
        title,
      });
    }

    // 2. Resolve history from database if not explicitly provided
    let conversationHistory = history;
    if ((!conversationHistory || conversationHistory.length === 0) && conversation) {
      const pastMsgs = await Message.find({
        conversationId: conversation._id,
        workspaceId,
      })
        .sort({ createdAt: 1 })
        .limit(20);

      conversationHistory = pastMsgs.map((m) => ({
        role: m.role.toLowerCase(),
        content: m.content,
      }));
    }

    // 3. Save incoming user message
    await Message.create({
      workspaceId,
      conversationId: conversation._id,
      role: "USER",
      content: message.trim(),
    });

    // 4. Build payload for AI service
    const aiPayload = {
      message: message.trim(),
      knowledgeBaseId: mode === "general" ? null : knowledgeBaseId,
      mode,
      conversationId: conversation._id.toString(),
      model: model || "gemini-3.8-flash",
      history: conversationHistory || [],
      top_k: options.top_k || 5,
      strategy: options.strategy || "auto",
      temperature: options.temperature || 0.7,
      max_tokens: options.max_tokens || 4096,
    };

    logger.info({
      workspaceId,
      conversationId: conversation._id.toString(),
      knowledgeBaseId,
      model: aiPayload.model,
      msg: "Direct chat request received",
    });

    // 5. Set SSE headers and flush
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    if (typeof res.flushHeaders === "function") {
      res.flushHeaders();
    }

    // Notify client of the active conversation ID and title
    res.write(
      `event: conversation\ndata: ${JSON.stringify({
        conversationId: conversation._id.toString(),
        title: conversation.title,
      })}\n\n`
    );

    const abortController = new AbortController();

    // Handle client disconnect on response stream
    res.on("close", () => {
      if (!res.writableEnded) {
        logger.info({ workspaceId, msg: "Client disconnected from chat stream" });
        abortController.abort();
      }
    });

    let assistantText = "";
    let capturedCitations = [];
    let capturedUsage = null;

    try {
      await aiClient.streamChat(workspaceId.toString(), aiPayload, {
        signal: abortController.signal,
        onCitations: (citations) => {
          capturedCitations = citations;
          if (!res.writableEnded) {
            res.write(`event: citations\ndata: ${JSON.stringify(citations)}\n\n`);
          }
        },
        onToken: (delta) => {
          assistantText += delta;
          if (!res.writableEnded) {
            res.write(`event: token\ndata: ${JSON.stringify({ delta })}\n\n`);
          }
        },
        onUsage: (usage) => {
          capturedUsage = usage;
          if (!res.writableEnded) {
            res.write(`event: usage\ndata: ${JSON.stringify(usage)}\n\n`);
          }
        },
        onDone: async () => {
          // 6. Save completed assistant message to MongoDB
          if (assistantText.trim()) {
            try {
              const formattedCitations = (capturedCitations || []).map((c) => ({
                title: c.title || "",
                url: c.url || "",
                chunkId: c.sourceId || c.chunkId || "",
                snippet: c.snippet || "",
                score: c.score || 0,
              }));

              await Message.create({
                workspaceId,
                conversationId: conversation._id,
                role: "ASSISTANT",
                content: assistantText,
                citations: formattedCitations,
                tokenUsage: {
                  promptTokens: capturedUsage?.prompt_tokens || 0,
                  completionTokens: capturedUsage?.completion_tokens || 0,
                  totalTokens: capturedUsage?.total_tokens || 0,
                },
                latencyMs: Date.now() - startTime,
              });

              await Conversation.updateOne(
                { _id: conversation._id },
                { updatedAt: new Date() }
              );

              // 7. Fire asynchronous AI title refinement if new conversation or currently has a generic title
              if (isNewConversation || titleGeneratorService.isGenericTitle(conversation.title)) {
                titleGeneratorService.refineTitleWithAI(
                  workspaceId.toString(),
                  conversation._id.toString(),
                  message.trim(),
                  aiPayload.model
                ).catch((err) => {
                  logger.debug({ err: err.message, msg: "Background title refinement completed" });
                });
              }
            } catch (saveErr) {
              logger.error({ err: saveErr.message, msg: "Failed to persist assistant message" });
            }
          }

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
