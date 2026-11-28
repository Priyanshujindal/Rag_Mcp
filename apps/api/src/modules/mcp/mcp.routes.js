import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../../middleware/auth.middleware.js";
import { tenantGuard } from "../../middleware/tenant-guard.middleware.js";
import { requireRole } from "../../middleware/rbac.middleware.js";
import { validate, objectIdSchema } from "../../middleware/validation.middleware.js";
import { enforceQuota } from "../../middleware/quota-guard.middleware.js";
import mcpController from "./mcp.controller.js";

const router = Router();

const createMcpServerSchema = z
  .object({
    name: z.string().min(1, "Name is required").trim(),
    description: z.string().optional(),
    url: z.string().url().optional().nullable(),
    command: z.string().optional().nullable(),
    args: z.array(z.string()).optional(),
    transport: z.enum(["STREAMABLE_HTTP", "HTTP", "SSE", "STDIO"]).optional(),
    headers: z.record(z.string()).optional(),
    env: z.record(z.string()).optional(),
    enabled: z.boolean().optional(),
    tools: z
      .array(
        z.object({
          name: z.string().min(1),
          description: z.string().optional(),
          inputSchema: z.record(z.any()).optional(),
          enabled: z.boolean().optional(),
          permission: z.enum(["always_ask", "auto", "deny"]).optional(),
          requiresApproval: z.boolean().optional(),
        })
      )
      .optional(),
  })
  .strict();

const updateMcpServerSchema = z
  .object({
    name: z.string().min(1).trim().optional(),
    description: z.string().optional(),
    url: z.string().url().optional().nullable(),
    command: z.string().optional().nullable(),
    args: z.array(z.string()).optional(),
    transport: z.enum(["STREAMABLE_HTTP", "HTTP", "SSE", "STDIO"]).optional(),
    headers: z.record(z.string()).optional(),
    env: z.record(z.string()).optional(),
    status: z.enum(["CONNECTED", "CONNECTING", "DISCONNECTED", "ERROR"]).optional(),
    healthStatus: z.enum(["healthy", "degraded", "offline"]).optional(),
    enabled: z.boolean().optional(),
    tools: z
      .array(
        z.object({
          name: z.string().min(1),
          description: z.string().optional(),
          inputSchema: z.record(z.any()).optional(),
          enabled: z.boolean().optional(),
          permission: z.enum(["always_ask", "auto", "deny"]).optional(),
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

router.get("/tools", mcpController.listTools);
router.get("/executions", mcpController.listExecutions);
router.post("/test", mcpController.testConnection);
router.post("/import", requireRole("OWNER", "ADMIN"), mcpController.importConfig);

router.post("/:id/test", validate({ params: idParamsSchema }), mcpController.testConnection);
router.post("/:id/refresh", requireRole("OWNER", "ADMIN"), validate({ params: idParamsSchema }), mcpController.refreshTools);
router.post("/:id/connect", requireRole("OWNER", "ADMIN"), validate({ params: idParamsSchema }), mcpController.connect);
router.post("/:id/disconnect", requireRole("OWNER", "ADMIN"), validate({ params: idParamsSchema }), mcpController.disconnect);
router.get("/:id/config", validate({ params: idParamsSchema }), mcpController.getConfig);
router.get("/:id/logs", validate({ params: idParamsSchema }), mcpController.getLogs);
router.put("/:id/config", requireRole("OWNER", "ADMIN"), validate({ params: idParamsSchema }), mcpController.updateConfig);
router.patch("/:id/tools", requireRole("OWNER", "ADMIN"), validate({ params: idParamsSchema }), mcpController.batchUpdateTools);

router.get("/", mcpController.list);
router.post(
  "/",
  requireRole("OWNER", "ADMIN"),
  enforceQuota("mcpServers"),
  validate({ body: createMcpServerSchema }),
  mcpController.create
);
router.get("/:id", validate({ params: idParamsSchema }), mcpController.getById);
router.patch(
  "/:id",
  requireRole("OWNER", "ADMIN"),
  validate({ params: idParamsSchema, body: updateMcpServerSchema }),
  mcpController.update
);
router.delete("/:id", requireRole("OWNER", "ADMIN"), validate({ params: idParamsSchema }), mcpController.delete);
router.patch("/:id/tools/:toolName", requireRole("OWNER", "ADMIN"), mcpController.toggleTool);

export default router;
