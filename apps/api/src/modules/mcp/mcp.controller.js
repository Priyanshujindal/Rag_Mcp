import mcpManager from "./mcp.manager.js";
import { McpOrchestrator } from "./mcp.orchestrator.js";

export const mcpController = {
  async listTools(req, res, next) {
    try {
      const tools = await McpOrchestrator.getActiveTools(req.workspaceId, req.user?.id);
      res.status(200).json({ success: true, tools });
    } catch (err) {
      next(err);
    }
  },

  async list(req, res, next) {
    try {
      const result = await mcpManager.list(req.workspaceId, req.user?.id);
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
      const result = await mcpManager.create(req.workspaceId, req.user?.id, req.body);
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

  async refreshTools(req, res, next) {
    try {
      const result = await mcpManager.refreshTools(req.workspaceId, req.params.id);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },

  async testConnection(req, res, next) {
    try {
      const result = await mcpManager.testConnection(req.workspaceId, req.params.id || null, req.body);
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

  async listExecutions(req, res, next) {
    try {
      const result = await mcpManager.listExecutions(req.workspaceId, req.query.limit);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },
};

export default mcpController;
