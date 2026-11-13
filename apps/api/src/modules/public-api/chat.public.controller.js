/**
 * apps/api/src/modules/public-api/chat.public.controller.js
 * ==========================================================
 * Public widget chat controller:
 * - PublicId lookup
 * - Public chatbot config endpoint for widget auto-customization
 * - Standalone widget.js distribution endpoint
 * - Active status validation
 * - Origin domain whitelist enforcement
 * - SSE streaming relay and message persistence
 */

import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { Chatbot } from "../../db/models/index.js";
import chatService from "../chatbots/chat.service.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const WIDGET_DIST_PATH = path.resolve(__dirname, "../../../../../packages/widget/dist/widget.js");

export const publicChatController = {
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

      // Fallback banner if widget hasn't been built yet
      res.setHeader("Content-Type", "application/javascript; charset=utf-8");
      return res.send(`console.warn("[Rag_Mcp] Widget bundle not built yet. Run 'pnpm --filter @rag-mcp/widget build'.");`);
    } catch (err) {
      next(err);
    }
  },

  /**
   * GET /api/v1/public/chatbots/:publicId/config
   * Returns public configuration for chatbot widget embedding.
   */
  async getConfig(req, res, next) {
    try {
      const { publicId } = req.params;

      let chatbot = await Chatbot.findOne({ publicId }).select(
        "name status publicId config allowedOrigins"
      );

      // Fallback for demo page: if "bot_demo" is passed, automatically map to the first active bot
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
   * SSE streaming chat turn for external widgets.
   */
  async chat(req, res, next) {
    try {
      const { publicId } = req.params;

      let chatbot = await Chatbot.findOne({ publicId });

      // Fallback for demo page: if "bot_demo" is passed, automatically map to the first active bot
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
