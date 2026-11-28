import { Router } from "express";
import { authenticate } from "../../middleware/auth.middleware.js";
import { tenantGuard } from "../../middleware/tenant-guard.middleware.js";
import { requireRole } from "../../middleware/rbac.middleware.js";
import { IntegrationsController } from "./integrations.controller.js";

const router = Router();

// All routes require authentication and workspace tenant scope
router.use(authenticate, tenantGuard);

router.get("/catalog", IntegrationsController.getCatalog);
router.get("/connections", IntegrationsController.listConnections);

router.post("/connect-token", requireRole("OWNER", "ADMIN", "MEMBER"), IntegrationsController.connectToken);
router.post("/:id/demo-connect", requireRole("OWNER", "ADMIN", "MEMBER"), IntegrationsController.demoConnect);
router.post("/:id/authorize", requireRole("OWNER", "ADMIN", "MEMBER"), IntegrationsController.authorize);
router.post("/:id/callback", requireRole("OWNER", "ADMIN", "MEMBER"), IntegrationsController.callback);

router.patch("/connections/:id", requireRole("OWNER", "ADMIN", "MEMBER"), IntegrationsController.updateConnection);
router.post("/connections/:id/test", IntegrationsController.testConnection);
router.delete("/connections/:id", requireRole("OWNER", "ADMIN", "MEMBER"), IntegrationsController.disconnect);

export default router;
