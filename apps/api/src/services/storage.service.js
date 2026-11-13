/**
 * apps/api/src/services/storage.service.js
 * =========================================
 * Storage abstraction for generated files and artifacts.
 * Enforces workspace directory isolation, path traversal prevention,
 * and secure file reading/writing.
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";
import config from "../config/index.js";
import logger from "../utils/logger.js";
import AppError from "../utils/app-error.js";

class StorageService {
  constructor(baseDir = config.STORAGE_DIR) {
    this.baseDir = path.resolve(process.cwd(), baseDir);
    this._ensureDirectory(this.baseDir);
  }

  _ensureDirectory(dirPath) {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
  }

  /**
   * Generates a safe workspace-scoped directory and validates path traversal.
   * @param {string} workspaceId
   * @returns {string} Safe workspace directory path
   */
  _getWorkspaceDir(workspaceId) {
    const safeWorkspaceId = String(workspaceId).replace(/[^a-zA-Z0-9_-]/g, "");
    if (!safeWorkspaceId) {
      throw AppError.badRequest("Invalid workspace ID for storage");
    }
    const wsDir = path.join(this.baseDir, safeWorkspaceId);
    if (!wsDir.startsWith(this.baseDir)) {
      throw AppError.forbidden("Access denied: path traversal attempt");
    }
    this._ensureDirectory(wsDir);
    return wsDir;
  }

  /**
   * Save a binary file to workspace storage.
   * @param {string} workspaceId
   * @param {string} filename
   * @param {Buffer|Uint8Array} fileBuffer
   * @returns {Promise<{ storageKey: string, storagePath: string, sizeBytes: number }>}
   */
  async saveFile(workspaceId, filename, fileBuffer) {
    const wsDir = this._getWorkspaceDir(workspaceId);
    const uniquePrefix = crypto.randomBytes(8).toString("hex");
    const safeFilename = path.basename(filename).replace(/[^a-zA-Z0-9._-]/g, "_");
    const storageKey = `${uniquePrefix}_${safeFilename}`;
    const storagePath = path.join(wsDir, storageKey);

    await fs.promises.writeFile(storagePath, fileBuffer);
    const sizeBytes = Buffer.isBuffer(fileBuffer) ? fileBuffer.length : Buffer.byteLength(fileBuffer);

    logger.info("Saved artifact file to storage", {
      workspaceId,
      filename: safeFilename,
      storageKey,
      sizeBytes,
    });

    return {
      storageKey,
      storagePath,
      sizeBytes,
    };
  }

  /**
   * Read a file securely from storage, verifying it belongs to the workspace.
   * @param {string} workspaceId
   * @param {string} storagePath
   * @returns {Promise<Buffer>}
   */
  async readFile(workspaceId, storagePath) {
    const wsDir = this._getWorkspaceDir(workspaceId);
    const resolvedPath = path.resolve(storagePath);

    // Validate that the file is strictly inside the workspace directory
    if (!resolvedPath.startsWith(wsDir)) {
      throw AppError.forbidden("Unauthorized access: file outside workspace storage");
    }

    if (!fs.existsSync(resolvedPath)) {
      throw AppError.notFound("Requested file does not exist or was deleted");
    }

    return await fs.promises.readFile(resolvedPath);
  }

  /**
   * Delete a file securely.
   * @param {string} workspaceId
   * @param {string} storagePath
   */
  async deleteFile(workspaceId, storagePath) {
    const wsDir = this._getWorkspaceDir(workspaceId);
    const resolvedPath = path.resolve(storagePath);

    if (!resolvedPath.startsWith(wsDir)) {
      throw AppError.forbidden("Unauthorized access: file outside workspace storage");
    }

    if (fs.existsSync(resolvedPath)) {
      await fs.promises.unlink(resolvedPath);
      logger.info("Deleted artifact file from storage", { workspaceId, storagePath });
    }
  }
}

export const storageService = new StorageService();
export default storageService;

