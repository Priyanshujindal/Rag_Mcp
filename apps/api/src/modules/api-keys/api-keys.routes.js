import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../../middleware/auth.middleware.js";
import { tenantGuard } from "../../middleware/tenant-guard.middleware.js";
import { validate, objectIdSchema } from "../../middleware/validation.middleware.js";
import apiKeysController from "./api-keys.controller.js";

const router = Router();

const createApiKeySchema = z
  .object({
    name: z.string().min(1, "Name is required").trim(),
    keyType: z.enum(["publishable", "secret", "legacy"]).optional(),
    chatbotId: objectIdSchema.optional(),
    allowedOrigins: z.array(z.string()).optional(),
    rateLimit: z
      .object({
        requestsPerMinute: z.number().int().min(1).max(1000).optional(),
        requestsPerHour: z.number().int().min(1).max(50000).optional(),
      })
      .optional(),
    expiresInDays: z.number().int().min(1).max(365).optional(),
  })
  .strict();

const updateApiKeySchema = z
  .object({
    name: z.string().min(1).trim().optional(),
    allowedOrigins: z.array(z.string()).optional(),
    rateLimit: z
      .object({
        requestsPerMinute: z.number().int().min(1).max(1000).optional(),
        requestsPerHour: z.number().int().min(1).max(50000).optional(),
      })
      .optional(),
    status: z.enum(["active", "disabled"]).optional(),
  })
  .strict();

const idParamsSchema = z
  .object({
    id: objectIdSchema,
  })
  .strict();

router.use(authenticate, tenantGuard);

router.get("/", apiKeysController.list);
router.post("/", validate({ body: createApiKeySchema }), apiKeysController.create);
router.get("/:id", validate({ params: idParamsSchema }), apiKeysController.getById);
router.patch(
  "/:id",
  validate({ params: idParamsSchema, body: updateApiKeySchema }),
  apiKeysController.update
);
router.post("/:id/rotate", validate({ params: idParamsSchema }), apiKeysController.rotate);
router.post("/:id/revoke", validate({ params: idParamsSchema }), apiKeysController.revoke);
router.delete("/:id", validate({ params: idParamsSchema }), apiKeysController.delete);
router.get("/:id/usage", validate({ params: idParamsSchema }), apiKeysController.getUsage);

export default router;
