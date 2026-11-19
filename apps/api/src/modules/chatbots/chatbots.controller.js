import chatbotsService from "./chatbots.service.js";
import chatService from "./chat.service.js";
import AppError from "../../utils/app-error.js";

export const chatbotsController = {
  async list(req, res, next) {
    try {
      const result = await chatbotsService.list(req.workspaceId, req.query);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },

  async getById(req, res, next) {
    try {
      const result = await chatbotsService.getById(req.workspaceId, req.params.id);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },

  async create(req, res, next) {
    try {
      const result = await chatbotsService.create(req.workspaceId, req.body);
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  },

  async update(req, res, next) {
    try {
      const result = await chatbotsService.update(req.workspaceId, req.params.id, req.body);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },

  async delete(req, res, next) {
    try {
      const result = await chatbotsService.delete(req.workspaceId, req.params.id);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },

  async getEmbed(req, res, next) {
    try {
      const result = await chatbotsService.getEmbedSnippet(req.workspaceId, req.params.id);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },

  async chat(req, res, next) {
    try {
      const chatbot = await chatbotsService.getChatbotDocument(req.workspaceId, req.params.id);
      if (chatbot.status === "PAUSED") {
        throw AppError.badRequest("This chatbot is currently paused");
      }
      await chatService.streamChatTurn(
        {
          chatbot,
          workspaceId: req.workspaceId,
          userId: req.user?._id,
          message: req.body.message,
          conversationId: req.body.conversationId,
          options: req.body,
        },
        res,
        req
      );
    } catch (err) {
      next(err);
    }
  },
};

export default chatbotsController;

