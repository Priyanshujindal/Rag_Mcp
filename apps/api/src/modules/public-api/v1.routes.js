import { Router } from "express";
import { z } from "zod";
import rateLimit from "express-rate-limit";
import { validate, objectIdSchema } from "../../middleware/validation.middleware.js";
import publicChatController from "./chat.public.controller.js";

const router = Router();

const publicChatLimiter = rateLimit({
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
    conversationId: objectIdSchema.optional(),
    model: z.string().optional(),
    temperature: z.number().min(0).max(2).optional(),
    max_tokens: z.number().min(1).max(4096).optional(),
  })
  .strict();

const publicIdParamsSchema = z
  .object({
    publicId: z.string().min(1).trim(),
  })
  .strict();

// Public widget chat endpoints
router.post(
  "/chatbots/:publicId/chat",
  publicChatLimiter,
  validate({ params: publicIdParamsSchema, body: publicChatSchema }),
  publicChatController.chat
);

router.post(
  "/chat/:publicId",
  publicChatLimiter,
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
