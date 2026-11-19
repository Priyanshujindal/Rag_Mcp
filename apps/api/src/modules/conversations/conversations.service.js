import AppError from "../../utils/app-error.js";
import { Conversation, Message } from "../../db/models/index.js";
import titleGeneratorService from "./title-generator.service.js";

export const conversationsService = {
  /**
   * List conversations for a workspace with pagination.
   */
  async list(workspaceId, { page = 1, limit = 20, chatbotId = null, userId = null } = {}) {
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const skip = (pageNum - 1) * limitNum;

    const filter = { workspaceId };
    if (chatbotId) filter.chatbotId = chatbotId;
    if (userId) filter.userId = userId;

    const [items, total] = await Promise.all([
      Conversation.find(filter)
        .sort({ isPinned: -1, updatedAt: -1, createdAt: -1 })
        .skip(skip)
        .limit(limitNum),
      Conversation.countDocuments(filter),
    ]);

    return {
      items: items.map((c) => c.toJSON()),
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum),
      },
    };
  },

  /**
   * Get a single conversation by ID with its messages.
   */
  async getById(workspaceId, id, userId = null) {
    const query = { _id: id };
    if (workspaceId && userId) {
      query.$or = [{ workspaceId }, { userId }];
    } else if (workspaceId) {
      query.workspaceId = workspaceId;
    } else if (userId) {
      query.userId = userId;
    }

    const conversation = await Conversation.findOne(query);
    if (!conversation) {
      throw AppError.notFound("Conversation not found");
    }

    const messages = await Message.find({ conversationId: conversation._id })
      .populate("artifacts")
      .sort({ createdAt: 1 })
      .limit(100);

    return {
      ...conversation.toJSON(),
      messages: messages.map((m) => m.toJSON()),
    };
  },

  /**
   * Create a new conversation container.
   */
  async create(workspaceId, { title, chatbotId = null, userId = null } = {}) {
    const finalTitle = title
      ? titleGeneratorService.formatTitleCase(title)
      : "New Conversation";

    const conv = await Conversation.create({
      workspaceId,
      chatbotId: chatbotId || null,
      userId: userId || null,
      title: finalTitle,
    });

    return conv.toJSON();
  },

  /**
   * Update conversation title and/or pin status.
   */
  async update(workspaceId, id, { title, isPinned }, userId = null) {
    const query = { _id: id };
    if (workspaceId && userId) {
      query.$or = [{ workspaceId }, { userId }];
    } else if (workspaceId) {
      query.workspaceId = workspaceId;
    }

    const conversation = await Conversation.findOne(query);
    if (!conversation) {
      throw AppError.notFound("Conversation not found");
    }

    if (title !== undefined && typeof title === "string") {
      conversation.title = titleGeneratorService.formatTitleCase(title.trim());
    }
    if (isPinned !== undefined) {
      conversation.isPinned = Boolean(isPinned);
    }

    await conversation.save();
    return conversation.toJSON();
  },

  /**
   * Delete a conversation and its messages.
   */
  async delete(workspaceId, id, userId = null) {
    const query = { _id: id };
    if (workspaceId && userId) {
      query.$or = [{ workspaceId }, { userId }];
    } else if (workspaceId) {
      query.workspaceId = workspaceId;
    }

    const conversation = await Conversation.findOne(query);
    if (!conversation) {
      throw AppError.notFound("Conversation not found");
    }

    await Promise.all([
      Message.deleteMany({ conversationId: conversation._id }),
      Conversation.deleteOne({ _id: conversation._id }),
    ]);

    return { success: true, id };
  },
};

export default conversationsService;

