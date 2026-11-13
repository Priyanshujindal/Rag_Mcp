import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../../middleware/auth.middleware.js";
import { tenantGuard } from "../../middleware/tenant-guard.middleware.js";
import { validate, objectIdSchema } from "../../middleware/validation.middleware.js";
import kbController from "./kb.controller.js";

const router = Router();

const createKbSchema = z
  .object({
    name: z.string().min(1, "Name is required").trim(),
    description: z.string().optional(),
  })
  .strict();

const updateKbSchema = z
  .object({
    name: z.string().min(1).trim().optional(),
    description: z.string().optional(),
    status: z.enum(["ACTIVE", "INDEXING", "PAUSED", "FAILED"]).optional(),
  })
  .strict();

const idParamsSchema = z
  .object({
    id: objectIdSchema,
  })
  .strict();

router.use(authenticate, tenantGuard);

router.get("/", kbController.list);
router.post("/", validate({ body: createKbSchema }), kbController.create);
router.get("/:id", validate({ params: idParamsSchema }), kbController.getById);
router.patch(
  "/:id",
  validate({ params: idParamsSchema, body: updateKbSchema }),
  kbController.update
);
router.delete("/:id", validate({ params: idParamsSchema }), kbController.delete);

export default router;

