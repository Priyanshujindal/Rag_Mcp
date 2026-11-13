import path from "path";
import AppError from "../../utils/app-error.js";
import { Source, KnowledgeBase, Chunk } from "../../db/models/index.js";
import { assertSourceQuota } from "../../utils/quota.js";
import storage from "../../utils/storage.js";
import aiClient from "../../services/ai-client.js";

/**
 * Validates that file buffer matches claimed extension and rejects disguised executables
 * @param {Buffer} buffer
 * @param {string} ext
 * @param {string} mimetype
 */
export function validateFileIntegrity(buffer, ext, _mimetype) {
  if (!buffer || buffer.length === 0) {
    throw AppError.badRequest("Uploaded file is empty.");
  }

  // Check for DOS/Windows executable header (MZ)
  if (buffer.length >= 2 && buffer[0] === 0x4d && buffer[1] === 0x5a) {
    throw AppError.badRequest("File upload rejected: Executable files are strictly forbidden.");
  }

  const allowedExtensions = [".pdf", ".docx", ".txt", ".csv"];
  if (!allowedExtensions.includes(ext)) {
    throw AppError.badRequest(`Unsupported file extension: ${ext}. Allowed: ${allowedExtensions.join(", ")}`);
  }

  // Deep header verification for PDF
  if (ext === ".pdf") {
    const header = buffer.slice(0, 5).toString("ascii");
    if (!header.startsWith("%PDF")) {
      throw AppError.badRequest("Invalid PDF file structure. File appears corrupted or disguised.");
    }
  }

  // Deep header verification for DOCX (standard ZIP archive PK..)
  if (ext === ".docx") {
    if (buffer.length < 4 || buffer[0] !== 0x50 || buffer[1] !== 0x4b) {
      throw AppError.badRequest("Invalid DOCX file structure.");
    }
  }
}

export const sourcesService = {
  async list(workspaceId, { knowledgeBaseId, page = 1, limit = 50 } = {}) {
    const query = { workspaceId };
    if (knowledgeBaseId) {
      query.knowledgeBaseId = knowledgeBaseId;
    }

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));
    const skip = (pageNum - 1) * limitNum;

    const [items, total] = await Promise.all([
      Source.find(query).sort("-createdAt").skip(skip).limit(limitNum),
      Source.countDocuments(query),
    ]);

    return {
      items: items.map((s) => s.toJSON()),
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum),
      },
    };
  },

  async getById(workspaceId, id) {
    const source = await Source.findOne({ _id: id, workspaceId });
    if (!source) {
      throw AppError.notFound("Source not found");
    }
    return source.toJSON();
  },

  async listChunks(workspaceId, id, { page = 1, limit = 5 } = {}) {
    const source = await Source.findOne({ _id: id, workspaceId }).select("_id workspaceId knowledgeBaseId");
    if (!source) {
      throw AppError.notFound("Source not found");
    }

    const pageNum = Number(page);
    const limitNum = Number(limit);
    if (!Number.isInteger(pageNum) || pageNum < 1 ||
        !Number.isInteger(limitNum) || limitNum < 1 || limitNum > 20) {
      throw AppError.badRequest("Invalid pagination. Page must be >= 1 and limit must be between 1 and 20.");
    }

    const filter = {
      workspaceId: source.workspaceId,
      knowledgeBaseId: source.knowledgeBaseId,
      sourceId: source._id,
    };

    const [items, total] = await Promise.all([
      Chunk.find(filter)
        .select("_id chunkIndex text metadata createdAt")
        .sort({ chunkIndex: 1 })
        .skip((pageNum - 1) * limitNum)
        .limit(limitNum)
        .lean(),
      Chunk.countDocuments(filter),
    ]);

    return {
      items: items.map((chunk) => ({
        id: String(chunk._id),
        index: chunk.chunkIndex,
        content: chunk.text || "",
        characterCount: (chunk.text || "").length,
        metadata: chunk.metadata || {},
        createdAt: chunk.createdAt || null,
      })),
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum),
      },
    };
  },

  async createUrlSource(workspaceId, { knowledgeBaseId, name, url }) {
    // Validate knowledge base belongs to same workspace
    const kb = await KnowledgeBase.findOne({ _id: knowledgeBaseId, workspaceId });
    if (!kb) {
      throw AppError.notFound("Knowledge base not found in this workspace");
    }

    await assertSourceQuota(workspaceId, knowledgeBaseId);

    const source = await Source.create({
      workspaceId,
      knowledgeBaseId,
      type: "URL",
      name,
      url,
      status: "QUEUED",
    });

    // Dispatch crawl & ingestion via Python ai-service asynchronously
    aiClient
      .ingest(workspaceId, {
        knowledgeBaseId: knowledgeBaseId.toString(),
        sourceId: source._id.toString(),
        sourceType: "URL",
        url,
      })
      .catch((err) => {
        source.status = "FAILED";
        source.error = err.message;
        source.save().catch(() => {});
      });

    return source.toJSON();
  },

  async reindex(workspaceId, id) {
    const source = await Source.findOne({ _id: id, workspaceId });
    if (!source) {
      throw AppError.notFound("Source not found");
    }

    source.status = "QUEUED";
    source.error = null;
    await source.save();

    // Dispatch re-indexing task to Python ai-service
    aiClient
      .ingest(workspaceId, {
        knowledgeBaseId: source.knowledgeBaseId.toString(),
        sourceId: source._id.toString(),
        sourceType: source.type,
        url: source.url,
        fileKey: source.fileKey,
        originalFilename: source.name,
      })
      .catch((err) => {
        source.status = "FAILED";
        source.error = err.message;
        source.save().catch(() => {});
      });

    return source.toJSON();
  },

  async delete(workspaceId, id) {
    const source = await Source.findOneAndDelete({ _id: id, workspaceId });
    if (!source) {
      throw AppError.notFound("Source not found");
    }

    if (source.fileKey) {
      await storage.deleteFile(source.fileKey);
    }

    // Call ai-service to delete chunks associated with sourceId: id
    await aiClient.deleteSourceChunks(workspaceId, id.toString()).catch(() => {});

    return { success: true };
  },

  async uploadFile(workspaceId, { knowledgeBaseId, file }) {
    if (!file) {
      throw AppError.badRequest("No file was uploaded");
    }

    const kb = await KnowledgeBase.findOne({ _id: knowledgeBaseId, workspaceId });
    if (!kb) {
      throw AppError.notFound("Knowledge base not found in this workspace");
    }

    await assertSourceQuota(workspaceId, knowledgeBaseId);

    const ext = path.extname(file.originalname).toLowerCase();
    validateFileIntegrity(file.buffer, ext, file.mimetype);

    const typeMap = {
      ".pdf": "PDF",
      ".docx": "DOCX",
      ".txt": "TXT",
      ".csv": "CSV",
    };
    const sourceType = typeMap[ext] || "TXT";

    const { fileKey } = await storage.saveFile(file.buffer, file.originalname);

    const source = await Source.create({
      workspaceId,
      knowledgeBaseId,
      type: sourceType,
      name: file.originalname,
      fileKey,
      status: "QUEUED",
    });

    // Dispatch parsing & chunking job to ai-service
    aiClient
      .ingest(workspaceId, {
        knowledgeBaseId: knowledgeBaseId.toString(),
        sourceId: source._id.toString(),
        sourceType,
        fileKey,
        originalFilename: file.originalname,
      })
      .catch((err) => {
        source.status = "FAILED";
        source.error = err.message;
        source.save().catch(() => {});
      });

    return source.toJSON();
  },
};

export default sourcesService;
