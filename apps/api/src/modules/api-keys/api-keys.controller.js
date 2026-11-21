import apiKeysService from "./api-keys.service.js";

export const apiKeysController = {
  async list(req, res, next) {
    try {
      const result = await apiKeysService.list(req.workspaceId);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },

  async getById(req, res, next) {
    try {
      const result = await apiKeysService.getById(req.workspaceId, req.params.id);
      res.status(200).json({ data: result });
    } catch (err) {
      next(err);
    }
  },

  async create(req, res, next) {
    try {
      const result = await apiKeysService.create(req.workspaceId, req.user?.id, req.body);
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  },

  async update(req, res, next) {
    try {
      const result = await apiKeysService.update(req.workspaceId, req.params.id, req.body);
      res.status(200).json({ data: result });
    } catch (err) {
      next(err);
    }
  },

  async rotate(req, res, next) {
    try {
      const result = await apiKeysService.rotate(req.workspaceId, req.params.id);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },

  async revoke(req, res, next) {
    try {
      const result = await apiKeysService.revoke(req.workspaceId, req.params.id);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },

  async delete(req, res, next) {
    try {
      const result = await apiKeysService.delete(req.workspaceId, req.params.id);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },

  async getUsage(req, res, next) {
    try {
      const result = await apiKeysService.getUsage(
        req.workspaceId,
        req.params.id,
        req.query.limit
      );
      res.status(200).json({ data: result });
    } catch (err) {
      next(err);
    }
  },
};

export default apiKeysController;
