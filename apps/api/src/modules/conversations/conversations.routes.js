import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../../middleware/auth.middleware.js";
import { tenantGuard } from "../../middleware/tenant-guard.middleware.js";
import { validate, objectIdSchema } from "../../middleware/validation.middleware.js";
import conversationsController from "./conversations.controller.js";

const router = Router();

const createConversationSchema = z
  .object({
    title: z.string().max(200).optional(),
    chatbotId: objectIdSchema.optional(),
  })
  .strict();

const updateConversationSchema = z
  .object({
    title: z.string().min(1, "Title cannot be empty").max(200).optional(),
    isPinned: z.boolean().optional(),
  })
  .strict();

const idParamsSchema = z
  .object({
    id: objectIdSchema,
  })
  .strict();

router.use(authenticate, tenantGuard);

router.get("/", conversationsController.list);
router.post("/", validate({ body: createConversationSchema }), conversationsController.create);
router.get("/:id", validate({ params: idParamsSchema }), conversationsController.getById);
router.patch(
  "/:id",
  validate({ params: idParamsSchema, body: updateConversationSchema }),
  conversationsController.update
);
router.delete("/:id", validate({ params: idParamsSchema }), conversationsController.delete);

export default router;
