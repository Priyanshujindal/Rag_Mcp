import crypto from "crypto";
import AppError from "../../utils/app-error.js";
import config from "../../config/index.js";
import { Chatbot, KnowledgeBase, Conversation, Message } from "../../db/models/index.js";

export const chatbotsService = {
  async list(workspaceId, { page = 1, limit = 20, sort = "-createdAt" } = {}) {
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const skip = (pageNum - 1) * limitNum;

    const [items, total] = await Promise.all([
      Chatbot.find({ workspaceId }).sort(sort).skip(skip).limit(limitNum),
      Chatbot.countDocuments({ workspaceId }),
    ]);

    return {
      items: items.map((bot) => bot.toJSON()),
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum),
      },
    };
  },

  async getById(workspaceId, id) {
    const bot = await Chatbot.findOne({ _id: id, workspaceId });
    if (!bot) {
      throw AppError.notFound("Chatbot not found");
    }
    return bot.toJSON();
  },

  async getChatbotDocument(workspaceId, id) {
    const bot = await Chatbot.findOne({ _id: id, workspaceId });
    if (!bot) {
      throw AppError.notFound("Chatbot not found");
    }
    return bot;
  },

  async create(workspaceId, data) {
    // If referencing a knowledge base, verify it belongs to this workspace
    if (data.knowledgeBaseId) {
      const kb = await KnowledgeBase.findOne({
        _id: data.knowledgeBaseId,
        workspaceId,
      });
      if (!kb) {
        throw AppError.notFound("Knowledge base not found in this workspace");
      }
    }

    const publicId = `bot_${crypto.randomBytes(6).toString("hex")}`;

    const bot = await Chatbot.create({
      workspaceId,
      knowledgeBaseId: data.knowledgeBaseId || null,
      name: data.name,
      status: data.status || "DRAFT",
      publicId,
      config: data.config || {},
      allowedOrigins: data.allowedOrigins || ["*"],
    });

    return bot.toJSON();
  },

  async update(workspaceId, id, data) {
    // If referencing a knowledge base, verify it belongs to this workspace
    if (data.knowledgeBaseId) {
      const kb = await KnowledgeBase.findOne({
        _id: data.knowledgeBaseId,
        workspaceId,
      });
      if (!kb) {
        throw AppError.notFound("Knowledge base not found in this workspace");
      }
    }

    // Never allow updating publicId
    delete data.publicId;
    delete data.workspaceId;

    const bot = await Chatbot.findOneAndUpdate(
      { _id: id, workspaceId },
      { $set: data },
      { new: true, runValidators: true }
    );

    if (!bot) {
      throw AppError.notFound("Chatbot not found");
    }

    return bot.toJSON();
  },

  async delete(workspaceId, id) {
    const bot = await Chatbot.findOneAndDelete({ _id: id, workspaceId });
    if (!bot) {
      throw AppError.notFound("Chatbot not found");
    }

    // Cascade delete conversations and messages
    const convs = await Conversation.find({ chatbotId: id, workspaceId }).select("_id");
    const convIds = convs.map((c) => c._id);

    if (convIds.length > 0) {
      await Message.deleteMany({ conversationId: { $in: convIds }, workspaceId });
      await Conversation.deleteMany({ _id: { $in: convIds }, workspaceId });
    }

    return { success: true };
  },

  async getEmbedSnippet(workspaceId, id) {
    const bot = await Chatbot.findOne({ _id: id, workspaceId });
    if (!bot) {
      throw AppError.notFound("Chatbot not found");
    }

    const snippet = `<script src="${config.WIDGET_URL}/widget.js" data-bot-id="${bot.publicId}" defer></script>`;

    return {
      publicId: bot.publicId,
      widgetUrl: config.WIDGET_URL,
      snippet,
    };
  },
};

export default chatbotsService;

