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
router.post("/:id/revoke", validate({ params: idParamsSchema }), apiKeysController.revoke);
router.delete("/:id", validate({ params: idParamsSchema }), apiKeysController.delete);

export default router;

