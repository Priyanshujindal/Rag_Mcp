import { Router } from "express";
import multer from "multer";
import { authenticate } from "../../middleware/auth.middleware.js";
import { tenantGuard } from "../../middleware/tenant-guard.middleware.js";
import { Conversation, Message, Membership, KnowledgeBase } from "../../db/models/index.js";
import aiClient from "../../services/ai-client.js";
import titleGeneratorService from "../conversations/title-generator.service.js";
import AppError from "../../utils/app-error.js";
import logger from "../../utils/logger.js";

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
});

/**
 * POST /api/v1/chat/parse-document
 * Parses an ad-hoc attached document (PDF, TXT, CSV, MD, JSON) for chat.
 */
router.post("/parse-document", authenticate, tenantGuard, upload.single("file"), async (req, res, next) => {
  try {
    if (!req.file) {
      return next(AppError.badRequest("No file uploaded"));
    }
    const filename = req.file.originalname || "attached_document";
    const ext = (filename.split(".").pop() || "").toLowerCase();

    // Direct memory decoding for text-based files
    if (["txt", "csv", "tsv", "md", "json"].includes(ext)) {
      const text = req.file.buffer.toString("utf-8");
      return res.json({
        filename,
        text,
        characterCount: text.length,
        pages: 1,
      });
    }

    let workspaceId = req.workspaceId || req.headers["x-workspace-id"];
    if (!workspaceId && req.user?.id) {
      const m = await Membership.findOne({ userId: req.user.id });
      if (m) workspaceId = m.workspaceId;
    }

    const parsed = await aiClient.parseDocument(
      workspaceId || "anon",
      filename,
      req.file.buffer,
      req.file.mimetype
    );
    res.json(parsed);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/chat
 * Direct RAG chat endpoint with conversation and message persistence.
 * Streams SSE response from AI service.
 */
router.post("/", authenticate, tenantGuard, async (req, res, next) => {
  try {
    const {
      message,
      knowledgeBaseId,
      conversationId,
      model,
      provider,
      webSearch,
      isThinking,
      attachedDocument,
      attachedDocuments,
      history = [],
      options = {},
    } = req.body;

    let incomingDocs = [];
    if (Array.isArray(attachedDocuments) && attachedDocuments.length > 0) {
      incomingDocs = attachedDocuments.filter((d) => d && d.name);
    } else if (attachedDocument && attachedDocument.name) {
      incomingDocs = [attachedDocument];
    }
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

    const hasIncomingDocs = incomingDocs.length > 0;
    if (mode === "rag" && !knowledgeBaseId && !hasIncomingDocs) {
      // Check if this conversation already has an active attached document from a previous turn
      let hasPriorDoc = false;
      if (conversationId) {
        const priorDoc = await Message.exists({
          conversationId,
          $or: [
            { "attachedDocuments.0": { $exists: true } },
            { "attachedDocument.content": { $exists: true, $ne: "" } },
          ],
        });
        hasPriorDoc = Boolean(priorDoc);
      }
      if (!hasPriorDoc) {
        return next(
          AppError.badRequest("Knowledge base ID is required in RAG mode. Please select a knowledge base, switch to General Chat mode, or attach a document.")
        );
      }
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
    const userMsgDoc = {
      workspaceId,
      conversationId: conversation._id,
      role: "USER",
      content: message.trim(),
    };
    if (incomingDocs.length > 0) {
      userMsgDoc.attachedDocuments = incomingDocs.map((d) => ({
        name: d.name,
        size: d.size || 0,
        type: d.type || "",
        content: d.content || "",
        pages: d.pages || 1,
        characterCount: d.characterCount || (d.content || "").length,
      }));
      // Keep primary doc for backwards compatibility
      userMsgDoc.attachedDocument = userMsgDoc.attachedDocuments[0];
    }
    await Message.create(userMsgDoc);

    // 4. Resolve active attached documents (either directly attached in this request, or inherited from previous turns)
    let activeAttachedDocs = incomingDocs;
    if (activeAttachedDocs.length === 0 && conversation) {
      const prevDocMsg = await Message.findOne({
        conversationId: conversation._id,
        workspaceId,
        $or: [
          { "attachedDocuments.0": { $exists: true } },
          { "attachedDocument.content": { $exists: true, $ne: "" } },
        ],
      }).sort({ createdAt: -1 });

      if (prevDocMsg?.attachedDocuments?.length) {
        activeAttachedDocs = prevDocMsg.attachedDocuments;
      } else if (prevDocMsg?.attachedDocument?.content) {
        activeAttachedDocs = [prevDocMsg.attachedDocument];
      }
    }

    const resolvedProvider = provider || (model && (model.includes("nvidia") || model.includes("openrouter") || model.includes("gemma")) ? "openrouter" : "gemini");
    const resolvedModel = model || (resolvedProvider === "openrouter" ? "nvidia/nemotron-3-ultra-550b-a55b:free" : "gemini-3.8-flash");

    const isWebSearch = Boolean(webSearch ?? options.webSearch);
    const resolvedThinking = Boolean(isThinking ?? options.isThinking);

    const isAdHocDocChat = mode === "rag" && !knowledgeBaseId && activeAttachedDocs.length > 0;
    const resolvedChatMode = isAdHocDocChat ? "general" : mode;

    const aiPayload = {
      message: message.trim(),
      knowledgeBaseId: resolvedChatMode === "general" ? null : knowledgeBaseId,
      mode: resolvedChatMode,
      conversationId: conversation._id.toString(),
      provider: resolvedProvider,
      model: resolvedModel,
      webSearch: isWebSearch,
      isThinking: resolvedThinking,
      attachedDocument: activeAttachedDocs[0] || null,
      attachedDocuments: activeAttachedDocs,
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
              let finalContent = assistantText;
              let reasoning = "";
              const thinkMatch = assistantText.match(/<think>([\s\S]*?)<\/think>/i);
              if (thinkMatch) {
                reasoning = thinkMatch[1].trim();
                finalContent = assistantText.replace(/<think>[\s\S]*?<\/think>/i, "").trim();
              }

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
                content: finalContent || assistantText,
                reasoning,
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
