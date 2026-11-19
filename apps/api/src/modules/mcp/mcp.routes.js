import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../../middleware/auth.middleware.js";
import { tenantGuard } from "../../middleware/tenant-guard.middleware.js";
import { validate, objectIdSchema } from "../../middleware/validation.middleware.js";
import mcpController from "./mcp.controller.js";

const router = Router();

const createMcpServerSchema = z
  .object({
    name: z.string().min(1, "Name is required").trim(),
    url: z.string().url().optional().nullable(),
    command: z.string().optional().nullable(),
    transport: z.enum(["SSE", "STDIO", "HTTP"]).optional(),
    tools: z
      .array(
        z.object({
          name: z.string().min(1),
          description: z.string().optional(),
          enabled: z.boolean().optional(),
          requiresApproval: z.boolean().optional(),
        })
      )
      .optional(),
  })
  .strict();

const updateMcpServerSchema = z
  .object({
    name: z.string().min(1).trim().optional(),
    url: z.string().url().optional().nullable(),
    command: z.string().optional().nullable(),
    transport: z.enum(["SSE", "STDIO", "HTTP"]).optional(),
    status: z.enum(["CONNECTED", "DISCONNECTED", "ERROR"]).optional(),
    tools: z
      .array(
        z.object({
          name: z.string().min(1),
          description: z.string().optional(),
          enabled: z.boolean().optional(),
          requiresApproval: z.boolean().optional(),
        })
      )
      .optional(),
  })
  .strict();

const idParamsSchema = z
  .object({
    id: objectIdSchema,
  })
  .strict();

router.use(authenticate, tenantGuard);

router.get("/", mcpController.list);
router.post("/", validate({ body: createMcpServerSchema }), mcpController.create);
router.get("/:id", validate({ params: idParamsSchema }), mcpController.getById);
router.patch(
  "/:id",
  validate({ params: idParamsSchema, body: updateMcpServerSchema }),
  mcpController.update
);
router.delete("/:id", validate({ params: idParamsSchema }), mcpController.delete);
router.patch("/:id/tools/:toolName", mcpController.toggleTool);

export default router;

