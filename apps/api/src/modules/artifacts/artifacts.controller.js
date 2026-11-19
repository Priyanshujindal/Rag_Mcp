/**
 * apps/api/src/modules/artifacts/artifacts.controller.js
 * =======================================================
 * Manages artifact metadata, secure downloads, previews, and listing.
 * Strict workspace tenant isolation enforced on every action.
 */

import { Artifact } from "../../db/models/index.js";
import storageService from "../../services/storage.service.js";
import AppError from "../../utils/app-error.js";
import logger from "../../utils/logger.js";

export const artifactsController = {
  /**
   * List all artifacts for current workspace (optionally scoped to conversation)
   */
  async list(req, res, next) {
    try {
      const filter = { workspaceId: req.workspaceId };
      if (req.query.conversationId) {
        filter.conversationId = req.query.conversationId;
      }
      const artifacts = await Artifact.find(filter).sort({ createdAt: -1 }).limit(50);
      res.json({ artifacts });
    } catch (err) {
      next(err);
    }
  },

  /**
   * Get single artifact metadata
   */
  async getById(req, res, next) {
    try {
      const artifact = await Artifact.findOne({
        _id: req.params.id,
        workspaceId: req.workspaceId,
      });

      if (!artifact) {
        throw AppError.notFound("Artifact not found");
      }

      res.json({ artifact });
    } catch (err) {
      next(err);
    }
  },

  /**
   * Get preview data for an artifact
   */
  async getPreview(req, res, next) {
    try {
      const artifact = await Artifact.findOne({
        _id: req.params.id,
        workspaceId: req.workspaceId,
      });

      if (!artifact) {
        throw AppError.notFound("Artifact not found");
      }

      res.json({
        artifact,
        previewData: artifact.previewData || {},
      });
    } catch (err) {
      next(err);
    }
  },

  /**
   * Secure download of artifact binary with appropriate Content-Disposition
   */
  async download(req, res, next) {
    try {
      const artifact = await Artifact.findOne({
        _id: req.params.id,
        workspaceId: req.workspaceId,
      });

      if (!artifact) {
        throw AppError.notFound("Artifact not found");
      }

      const fileBuffer = await storageService.readFile(req.workspaceId, artifact.storagePath);

      res.setHeader("Content-Type", artifact.mimeType || "application/octet-stream");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${encodeURIComponent(artifact.filename)}"; filename*=UTF-8''${encodeURIComponent(artifact.filename)}`
      );
      res.setHeader("Content-Length", fileBuffer.length);
      res.setHeader("Cache-Control", "private, no-cache, no-store, must-revalidate");

      return res.send(fileBuffer);
    } catch (err) {
      logger.error("Artifact download failed", {
        artifactId: req.params.id,
        workspaceId: req.workspaceId,
        error: err.message,
      });
      next(err);
    }
  },
};

export default artifactsController;

