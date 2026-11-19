import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import config from "../../config/index.js";
import { authenticate } from "../../middleware/auth.middleware.js";
import { tenantGuard } from "../../middleware/tenant-guard.middleware.js";
import { validate, objectIdSchema } from "../../middleware/validation.middleware.js";
import sourcesController from "./sources.controller.js";

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: config.MAX_UPLOAD_MB * 1024 * 1024,
  },
});

const createUrlSourceSchema = z
  .object({
    knowledgeBaseId: objectIdSchema,
    name: z.string().min(1).trim(),
    url: z.string().url("Valid URL is required"),
  })
  .strict();

const idParamsSchema = z
  .object({
    id: objectIdSchema,
  })
  .strict();

router.use(authenticate, tenantGuard);

router.get("/", sourcesController.list);
router.post("/", validate({ body: createUrlSourceSchema }), sourcesController.create);
router.get("/:id", validate({ params: idParamsSchema }), sourcesController.getById);
router.get("/:id/chunks", validate({ params: idParamsSchema }), sourcesController.listChunks);
router.post("/:id/reindex", validate({ params: idParamsSchema }), sourcesController.reindex);
router.delete("/:id", validate({ params: idParamsSchema }), sourcesController.delete);
router.post("/upload", upload.single("file"), sourcesController.upload);

export default router;

