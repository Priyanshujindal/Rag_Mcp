import conversationsService from "./conversations.service.js";

export const conversationsController = {
  async list(req, res, next) {
    try {
      const result = await conversationsService.list(req.workspaceId, {
        page: req.query.page,
        limit: req.query.limit,
        chatbotId: req.query.chatbotId,
        userId: req.user?.id,
      });
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },

  async getById(req, res, next) {
    try {
      const result = await conversationsService.getById(req.workspaceId, req.params.id, req.user?.id);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },

  async create(req, res, next) {
    try {
      const result = await conversationsService.create(req.workspaceId, {
        title: req.body.title,
        chatbotId: req.body.chatbotId,
        userId: req.user?.id,
      });
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  },

  async update(req, res, next) {
    try {
      const result = await conversationsService.update(
        req.workspaceId,
        req.params.id,
        {
          title: req.body.title,
          isPinned: req.body.isPinned,
        },
        req.user?.id
      );
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },

  async delete(req, res, next) {
    try {
      const result = await conversationsService.delete(req.workspaceId, req.params.id, req.user?.id);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },
};

export default conversationsController;

