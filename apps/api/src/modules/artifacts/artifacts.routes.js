/**
 * apps/api/src/modules/artifacts/artifacts.routes.js
 * ===================================================
 * API endpoints for artifact retrieval, previews, and downloads.
 */

import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../../middleware/auth.middleware.js";
import { tenantGuard } from "../../middleware/tenant-guard.middleware.js";
import { validate, objectIdSchema } from "../../middleware/validation.middleware.js";
import artifactsController from "./artifacts.controller.js";

const router = Router();

const idParamsSchema = z
  .object({
    id: objectIdSchema,
  })
  .strict();

// Middleware to support auth token and workspace ID in query params (useful for direct downloads/previews)
const allowQueryAuth = (req, _res, next) => {
  if (!req.headers.authorization && req.query.token) {
    req.headers.authorization = `Bearer ${req.query.token}`;
  }
  if (!req.headers["x-workspace-id"] && req.query.workspaceId) {
    req.headers["x-workspace-id"] = req.query.workspaceId;
  }
  next();
};

router.use(allowQueryAuth, authenticate, tenantGuard);

router.get("/", artifactsController.list);
router.get("/:id", validate({ params: idParamsSchema }), artifactsController.getById);
router.get("/:id/preview", validate({ params: idParamsSchema }), artifactsController.getPreview);
router.get("/:id/download", validate({ params: idParamsSchema }), artifactsController.download);

export default router;

