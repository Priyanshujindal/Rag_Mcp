/**
 * apps/api/src/modules/public-api/chat.public.controller.js
 * ==========================================================
 * Public widget chat controller:
 * - PublicId lookup
 * - Active status validation
 * - Origin domain whitelist enforcement
 * - SSE streaming relay and message persistence
 */

import { Chatbot } from "../../db/models/index.js";
import chatService from "../chatbots/chat.service.js";

export const publicChatController = {
  async chat(req, res, next) {
    try {
      const { publicId } = req.params;

      const chatbot = await Chatbot.findOne({ publicId });
      if (!chatbot) {
        return res.status(404).json({
          error: {
            code: "CHATBOT_NOT_FOUND",
            message: "Chatbot not found",
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

