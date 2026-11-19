import sourcesService from "./sources.service.js";

export const sourcesController = {
  async list(req, res, next) {
    try {
      const result = await sourcesService.list(req.workspaceId, req.query);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },

  async getById(req, res, next) {
    try {
      const result = await sourcesService.getById(req.workspaceId, req.params.id);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },

  async listChunks(req, res, next) {
    try {
      const result = await sourcesService.listChunks(
        req.workspaceId,
        req.params.id,
        req.query
      );
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },

  async create(req, res, next) {
    try {
      const result = await sourcesService.createUrlSource(req.workspaceId, req.body);
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  },

  async reindex(req, res, next) {
    try {
      const result = await sourcesService.reindex(req.workspaceId, req.params.id);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },

  async delete(req, res, next) {
    try {
      const result = await sourcesService.delete(req.workspaceId, req.params.id);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },

  async upload(req, res, next) {
    try {
      const result = await sourcesService.uploadFile(req.workspaceId, {
        knowledgeBaseId: req.body.knowledgeBaseId,
        file: req.file,
      });
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  },
};

export default sourcesController;

