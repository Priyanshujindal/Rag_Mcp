import AppError from "../../utils/app-error.js";
import { KnowledgeBase, Source } from "../../db/models/index.js";
import { assertKbQuota } from "../../utils/quota.js";
import aiClient from "../../services/ai-client.js";

export const kbService = {
  async list(workspaceId, { page = 1, limit = 20, sort = "-createdAt" } = {}) {
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const skip = (pageNum - 1) * limitNum;

    const [items, total] = await Promise.all([
      KnowledgeBase.find({ workspaceId }).sort(sort).skip(skip).limit(limitNum),
      KnowledgeBase.countDocuments({ workspaceId }),
    ]);

    return {
      items: items.map((kb) => kb.toJSON()),
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum),
      },
    };
  },

  async getById(workspaceId, id) {
    const kb = await KnowledgeBase.findOne({ _id: id, workspaceId });
    if (!kb) {
      throw AppError.notFound("Knowledge base not found");
    }
    return kb.toJSON();
  },

  async create(workspaceId, data) {
    await assertKbQuota(workspaceId);
    const kb = await KnowledgeBase.create({
      workspaceId,
      name: data.name,
      description: data.description || "",
      status: "ACTIVE",
    });
    return kb.toJSON();
  },

  async update(workspaceId, id, data) {
    const kb = await KnowledgeBase.findOneAndUpdate(
      { _id: id, workspaceId },
      { $set: data },
      { new: true, runValidators: true }
    );
    if (!kb) {
      throw AppError.notFound("Knowledge base not found");
    }
    return kb.toJSON();
  },

  async delete(workspaceId, id) {
    const kb = await KnowledgeBase.findOneAndDelete({ _id: id, workspaceId });
    if (!kb) {
      throw AppError.notFound("Knowledge base not found");
    }

    // Cascade delete related sources
    await Source.deleteMany({ knowledgeBaseId: id, workspaceId });

    // Cascade delete chunks from Python ai-service for this KB
    await aiClient.deleteKbChunks(workspaceId, id.toString()).catch(() => {});

    return { success: true };
  },
};

export default kbService;

