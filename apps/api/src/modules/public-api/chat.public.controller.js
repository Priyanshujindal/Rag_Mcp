/**
 * apps/api/src/modules/public-api/chat.public.controller.js
 * ==========================================================
 * Public External Chatbot API Controller:
 * - Public API configuration (safe public metadata only)
 * - Synchronous message completion: POST /chatbots/:chatbotId/messages
 * - SSE streaming message completion: POST /chatbots/:chatbotId/messages/stream
 * - Public conversation history retrieval with visitor ID scoping
 * - Standalone widget script and legacy widget endpoints backward compatibility
 * - Public API health status endpoint
 */

import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { Chatbot, Conversation, Message } from "../../db/models/index.js";
import chatService from "../chatbots/chat.service.js";
import AppError from "../../utils/app-error.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const WIDGET_DIST_PATH = path.resolve(__dirname, "../../../../../packages/widget/dist/widget.js");

export const publicChatController = {
  /**
   * GET /api/v1/public/health
   * Public API service health check
   */
  healthCheck(_req, res) {
    return res.status(200).json({
      status: "ok",
      service: "public-chatbot-api",
      version: "v1",
      timestamp: new Date().toISOString(),
    });
  },

  /**
   * GET /api/v1/public/chatbots/:chatbotId
   * Authenticated endpoint returning safe, public-facing configuration.
   * Strips all internal secrets, prompts, tool definitions, and workspace details.
   */
  async getPublicChatbotConfig(req, res, next) {
    try {
      const chatbot = req.chatbot;
      if (!chatbot) {
        return next(AppError.notFound("Chatbot not found"));
      }

      const cfg = chatbot.config || {};

      return res.status(200).json({
        data: {
          id: chatbot.publicId || chatbot._id.toString(),
          name: chatbot.name,
          description: chatbot.publicDescription || chatbot.description || "",
          greeting: cfg.welcomeMessage || "Hello! How can I help you today?",
          appearance: {
            theme: cfg.theme || "dark",
            primaryColor: cfg.primaryColor || "#10a37f",
            position: cfg.position || "bottom-right",
          },
          suggestedQuestions: cfg.suggestedQuestions || [],
          capabilities: {
            streaming: true,
            fileUpload: false,
          },
          status: chatbot.status,
        },
      });
    } catch (err) {
      next(err);
    }
  },

  /**
   * POST /api/v1/public/chatbots/:chatbotId/messages
   * Synchronous / non-streaming message turnaround
   */
  async sendMessage(req, res, next) {
    try {
      const chatbot = req.chatbot;
      const { message, conversationId, visitorId, options = {} } = req.body;

      if (!message || typeof message !== "string" || !message.trim()) {
        return next(AppError.badRequest("Message is required and cannot be empty"));
      }

      const result = await chatService.executeChatTurn({
        chatbot,
        workspaceId: req.workspaceId,
        userId: null,
        visitorId: visitorId || req.headers["x-visitor-id"] || null,
        message: message.trim(),
        conversationId,
        options,
      });

      // Pass token counts to res.locals for telemetry logger
      res.locals.inputTokens = result.usage?.inputTokens || 0;
      res.locals.outputTokens = result.usage?.outputTokens || 0;

      return res.status(200).json({
        message: result.message,
        conversationId: result.conversationId,
        usage: result.usage,
      });
    } catch (err) {
      next(err);
    }
  },

  /**
   * POST /api/v1/public/chatbots/:chatbotId/messages/stream
   * Real-time SSE streaming response for external callers
   */
  async streamMessage(req, res, next) {
    try {
      const chatbot = req.chatbot;
      const { message, conversationId, visitorId, options = {} } = req.body;

      if (!message || typeof message !== "string" || !message.trim()) {
        return next(AppError.badRequest("Message is required and cannot be empty"));
      }

      await chatService.streamChatTurn(
        {
          chatbot,
          workspaceId: req.workspaceId,
          userId: null,
          visitorId: visitorId || req.headers["x-visitor-id"] || null,
          message: message.trim(),
          conversationId,
          options,
        },
        res,
        req
      );
    } catch (err) {
      next(err);
    }
  },

  /**
   * GET /api/v1/public/chatbots/:chatbotId/conversations/:conversationId
   * Retrieves conversation history. Validates visitor isolation when using publishable keys.
   */
  async getConversation(req, res, next) {
    try {
      const chatbot = req.chatbot;
      const { conversationId } = req.params;
      const visitorId = req.query.visitorId || req.headers["x-visitor-id"] || null;

      const conversation = await Conversation.findOne({
        _id: conversationId,
        chatbotId: chatbot._id,
        workspaceId: req.workspaceId,
      });

      if (!conversation) {
        return next(AppError.notFound("Conversation not found"));
      }

      // If key is publishable and conversation has a visitorId assigned, enforce visitor match
      if (req.keyType === "publishable" && conversation.visitorId) {
        if (!visitorId || conversation.visitorId !== visitorId) {
          return next(
            AppError.forbidden("Access denied: You are not authorized to view this conversation.")
          );
        }
      }

      const messages = await Message.find({
        conversationId: conversation._id,
        workspaceId: req.workspaceId,
      })
        .sort({ createdAt: 1 })
        .limit(100);

      const safeMessages = messages.map((m) => ({
        id: m._id.toString(),
        role: m.role.toLowerCase(),
        content: m.content,
        citations: (m.citations || []).map((c) => ({
          title: c.title,
          url: c.url,
          snippet: c.snippet,
        })),
        createdAt: m.createdAt,
      }));

      return res.status(200).json({
        conversation: {
          id: conversation._id.toString(),
          title: conversation.title,
          createdAt: conversation.createdAt,
        },
        messages: safeMessages,
      });
    } catch (err) {
      next(err);
    }
  },

  /**
   * GET /api/v1/public/widget.js
   * Serves the standalone bundled widget script.
   */
  async serveWidgetScript(_req, res, next) {
    try {
      if (fs.existsSync(WIDGET_DIST_PATH)) {
        res.setHeader("Content-Type", "application/javascript; charset=utf-8");
        res.setHeader("Cache-Control", "public, max-age=3600");
        return res.sendFile(WIDGET_DIST_PATH);
      }

      res.setHeader("Content-Type", "application/javascript; charset=utf-8");
      return res.send(
        `console.warn("[Rag_Mcp] Widget bundle not built yet. Run 'pnpm --filter @rag-mcp/widget build'.");`
      );
    } catch (err) {
      next(err);
    }
  },

  /**
   * GET /api/v1/public/chatbots/:publicId/config
   * Legacy widget configuration endpoint
   */
  async getConfig(req, res, next) {
    try {
      const { publicId } = req.params;

      let chatbot = await Chatbot.findOne({ publicId }).select(
        "name status publicId config allowedOrigins"
      );

      if (!chatbot && (publicId === "bot_demo" || publicId === "demo")) {
        chatbot =
          (await Chatbot.findOne({ status: "ACTIVE" }).select("name status publicId config allowedOrigins")) ||
          (await Chatbot.findOne({}).select("name status publicId config allowedOrigins"));
      }

      if (!chatbot) {
        return res.status(404).json({
          error: {
            code: "CHATBOT_NOT_FOUND",
            message: `Chatbot "${publicId}" not found. Please provide an active chatbot ID.`,
          },
        });
      }

      // Origin validation
      const origin = req.headers.origin;
      if (origin && Array.isArray(chatbot.allowedOrigins) && !chatbot.allowedOrigins.includes("*")) {
        if (!chatbot.allowedOrigins.includes(origin)) {
          return res.status(403).json({
            error: {
              code: "ORIGIN_FORBIDDEN",
              message: "Origin is not permitted to access this chatbot widget",
            },
          });
        }
      }

      const cfg = chatbot.config || {};

      return res.status(200).json({
        data: {
          publicId: chatbot.publicId,
          name: chatbot.name,
          status: chatbot.status,
          primaryColor: cfg.primaryColor || "#10a37f",
          theme: cfg.theme || "dark",
          position: cfg.position || "bottom-right",
          welcomeMessage: cfg.welcomeMessage || "Hello! How can I help you today?",
          suggestedQuestions: cfg.suggestedQuestions || [],
        },
      });
    } catch (err) {
      next(err);
    }
  },

  /**
   * POST /api/v1/public/chatbots/:publicId/chat
   * Legacy widget SSE chat endpoint
   */
  async chat(req, res, next) {
    try {
      const { publicId } = req.params;

      let chatbot = await Chatbot.findOne({ publicId });

      if (!chatbot && (publicId === "bot_demo" || publicId === "demo")) {
        chatbot =
          (await Chatbot.findOne({ status: "ACTIVE" })) ||
          (await Chatbot.findOne({}));
      }

      if (!chatbot) {
        return res.status(404).json({
          error: {
            code: "CHATBOT_NOT_FOUND",
            message: `Chatbot "${publicId}" not found. Please provide an active chatbot ID.`,
          },
        });
      }

      if (chatbot.status !== "ACTIVE") {
        return res.status(403).json({
          error: {
            code: "CHATBOT_NOT_ACTIVE",
            message: "This chatbot is currently not active",
          },
        });
      }

      const origin = req.headers.origin;
      if (origin && Array.isArray(chatbot.allowedOrigins) && !chatbot.allowedOrigins.includes("*")) {
        if (!chatbot.allowedOrigins.includes(origin)) {
          return res.status(403).json({
            error: {
              code: "ORIGIN_FORBIDDEN",
              message: "Origin is not permitted to access this chatbot widget",
            },
          });
        }
      }

      await chatService.streamChatTurn(
        {
          chatbot,
          workspaceId: chatbot.workspaceId,
          userId: null,
          message: req.body.message,
          conversationId: req.body.conversationId,
          options: req.body,
        },
        res,
        req
      );
    } catch (err) {
      next(err);
    }
  },
};

export default publicChatController;
