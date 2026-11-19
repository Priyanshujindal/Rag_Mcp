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

  async create(req, res, next) {
    try {
      const result = await apiKeysService.create(req.workspaceId, req.body);
      res.status(201).json(result);
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
};

export default apiKeysController;

