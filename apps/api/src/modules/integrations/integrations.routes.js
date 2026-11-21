import { Router } from "express";
import { authenticate } from "../../middleware/auth.middleware.js";
import { tenantGuard } from "../../middleware/tenant-guard.middleware.js";
import { IntegrationsController } from "./integrations.controller.js";

const router = Router();

// All routes require authentication and workspace tenant scope
router.use(authenticate, tenantGuard);

router.get("/catalog", IntegrationsController.getCatalog);
router.get("/connections", IntegrationsController.listConnections);

router.post("/connect-token", IntegrationsController.connectToken);
router.post("/:id/demo-connect", IntegrationsController.demoConnect);
router.post("/:id/authorize", IntegrationsController.authorize);
router.post("/:id/callback", IntegrationsController.callback);

router.patch("/connections/:id", IntegrationsController.updateConnection);
router.post("/connections/:id/test", IntegrationsController.testConnection);
router.delete("/connections/:id", IntegrationsController.disconnect);

export default router;
