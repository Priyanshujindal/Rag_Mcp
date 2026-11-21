import { Router } from "express";
import { z } from "zod";
import rateLimit from "express-rate-limit";
import { validate, objectIdSchema } from "../../middleware/validation.middleware.js";
import { authenticatePublicApiKey } from "../../middleware/public-auth.middleware.js";
import { publicApiRateLimiter } from "../../middleware/public-rate-limit.middleware.js";
import publicChatController from "./chat.public.controller.js";

const router = Router();

// Permissive CORS for public endpoints
router.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, x-api-key, x-publishable-key, x-visitor-id, X-Request-Id"
  );

  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }
  next();
});

const legacyChatLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: {
      code: "RATE_LIMITED",
      message: "Public chat rate limit exceeded. Please try again later.",
    },
  },
});

const publicChatSchema = z
  .object({
    message: z.string().min(1, "Message cannot be empty").trim(),
    conversationId: z.string().optional(),
    visitorId: z.string().optional(),
    model: z.string().optional(),
    temperature: z.number().min(0).max(2).optional(),
    max_tokens: z.number().min(1).max(4096).optional(),
    options: z.record(z.any()).optional(),
  })
  .passthrough();

const chatbotIdParamsSchema = z
  .object({
    chatbotId: z.string().min(1).trim(),
  })
  .strict();

const conversationParamsSchema = z
  .object({
    chatbotId: z.string().min(1).trim(),
    conversationId: objectIdSchema,
  })
  .strict();

const publicIdParamsSchema = z
  .object({
    publicId: z.string().min(1).trim(),
  })
  .strict();

// -------------------------------------------------------------
// PUBLIC PLATFORM API (v1) - Authenticated via Platform API Keys
// -------------------------------------------------------------

// Health check
router.get("/health", publicChatController.healthCheck);

// 1. Get Chatbot Public Config (Safe metadata)
router.get(
  "/chatbots/:chatbotId",
  validate({ params: chatbotIdParamsSchema }),
  authenticatePublicApiKey(),
  publicApiRateLimiter,
  publicChatController.getPublicChatbotConfig
);

// 2. Synchronous Chat Message
router.post(
  "/chatbots/:chatbotId/messages",
  validate({ params: chatbotIdParamsSchema, body: publicChatSchema }),
  authenticatePublicApiKey(),
  publicApiRateLimiter,
  publicChatController.sendMessage
);

// 3. Streaming SSE Chat Message
router.post(
  "/chatbots/:chatbotId/messages/stream",
  validate({ params: chatbotIdParamsSchema, body: publicChatSchema }),
  authenticatePublicApiKey(),
  publicApiRateLimiter,
  publicChatController.streamMessage
);

// 4. Conversation History (Visitor-isolated)
router.get(
  "/chatbots/:chatbotId/conversations/:conversationId",
  validate({ params: conversationParamsSchema }),
  authenticatePublicApiKey(),
  publicApiRateLimiter,
  publicChatController.getConversation
);

// -------------------------------------------------------------
// LEGACY WIDGET ENDPOINTS
// -------------------------------------------------------------

// Serve Standalone Widget Script
router.get("/widget.js", publicChatController.serveWidgetScript);

// Legacy Public Chatbot Configuration
router.get(
  "/chatbots/:publicId/config",
  validate({ params: publicIdParamsSchema }),
  publicChatController.getConfig
);

// Legacy widget chat endpoints
router.post(
  "/chatbots/:publicId/chat",
  legacyChatLimiter,
  validate({ params: publicIdParamsSchema, body: publicChatSchema }),
  publicChatController.chat
);

router.post(
  "/chat/:publicId",
  legacyChatLimiter,
  validate({ params: publicIdParamsSchema, body: publicChatSchema }),
  publicChatController.chat
);

// Fallback 501 for unmounted / future public endpoints
router.all("*", (_req, res) => {
  res.status(501).json({
    error: {
      code: "NOT_IMPLEMENTED",
      message: "Public API service is not implemented yet.",
    },
  });
});

export default router;
