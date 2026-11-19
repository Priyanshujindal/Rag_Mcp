import mcpManager from "./mcp.manager.js";

export const mcpController = {
  async list(req, res, next) {
    try {
      const result = await mcpManager.list(req.workspaceId);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },

  async getById(req, res, next) {
    try {
      const result = await mcpManager.getById(req.workspaceId, req.params.id);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },

  async create(req, res, next) {
    try {
      const result = await mcpManager.create(req.workspaceId, req.body);
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  },

  async update(req, res, next) {
    try {
      const result = await mcpManager.update(req.workspaceId, req.params.id, req.body);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },

  async delete(req, res, next) {
    try {
      const result = await mcpManager.delete(req.workspaceId, req.params.id);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },

  async toggleTool(req, res, next) {
    try {
      const result = await mcpManager.toggleTool(
        req.workspaceId,
        req.params.id,
        req.params.toolName,
        req.body
      );
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },
};

export default mcpController;

