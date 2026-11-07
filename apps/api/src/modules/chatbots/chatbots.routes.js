import { Router } from "express";
import { z } from "zod";
import rateLimit from "express-rate-limit";
import { authenticate } from "../../middleware/auth.middleware.js";
import { tenantGuard } from "../../middleware/tenant-guard.middleware.js";
import { validate, objectIdSchema } from "../../middleware/validation.middleware.js";
import chatbotsController from "./chatbots.controller.js";

const router = Router();

const chatRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: {
      code: "RATE_LIMITED",
      message: "Chat rate limit exceeded. Please slow down.",
    },
  },
});

const createChatbotSchema = z
  .object({
    name: z.string().min(1, "Name is required").trim(),
    knowledgeBaseId: objectIdSchema.optional().nullable(),
    status: z.enum(["ACTIVE", "PAUSED", "DRAFT"]).optional(),
    config: z
      .object({
        theme: z.string().optional(),
        welcomeMessage: z.string().optional(),
        systemPrompt: z.string().optional(),
        suggestedQuestions: z.array(z.string()).optional(),
        position: z.enum(["bottom-right", "bottom-left"]).optional(),
        primaryColor: z.string().optional(),
      })
      .optional(),
    allowedOrigins: z.array(z.string()).optional(),
  })
  .strict();

const updateChatbotSchema = z
  .object({
    name: z.string().min(1).trim().optional(),
    knowledgeBaseId: objectIdSchema.optional().nullable(),
    status: z.enum(["ACTIVE", "PAUSED", "DRAFT"]).optional(),
    config: z
      .object({
        theme: z.string().optional(),
        welcomeMessage: z.string().optional(),
        systemPrompt: z.string().optional(),
        suggestedQuestions: z.array(z.string()).optional(),
        position: z.enum(["bottom-right", "bottom-left"]).optional(),
        primaryColor: z.string().optional(),
      })
      .optional(),
    allowedOrigins: z.array(z.string()).optional(),
  })
  .strict();

const idParamsSchema = z
  .object({
    id: objectIdSchema,
  })
  .strict();

const chatMessageSchema = z
  .object({
    message: z.string().min(1, "Message cannot be empty").trim(),
    conversationId: objectIdSchema.optional(),
    model: z.string().optional(),
    temperature: z.number().min(0).max(2).optional(),
    max_tokens: z.number().min(1).max(4096).optional(),
  })
  .strict();

router.use(authenticate, tenantGuard);

router.get("/", chatbotsController.list);
router.post("/", validate({ body: createChatbotSchema }), chatbotsController.create);
router.get("/:id", validate({ params: idParamsSchema }), chatbotsController.getById);
router.get("/:id/embed", validate({ params: idParamsSchema }), chatbotsController.getEmbed);
router.post(
  "/:id/chat",
  chatRateLimiter,
  validate({ params: idParamsSchema, body: chatMessageSchema }),
  chatbotsController.chat
);
router.patch(
  "/:id",
  validate({ params: idParamsSchema, body: updateChatbotSchema }),
  chatbotsController.update
);
router.delete("/:id", validate({ params: idParamsSchema }), chatbotsController.delete);

export default router;

