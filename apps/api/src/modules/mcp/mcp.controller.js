import mcpManager from "./mcp.manager.js";
import { McpOrchestrator } from "./mcp.orchestrator.js";
import { McpClientManager } from "./mcp.client-manager.js";

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

  async importConfig(req, res, next) {
    try {
      const rawInput = req.body.config || req.body.rawConfig || req.body;
      const result = await mcpManager.importConfig(req.workspaceId, req.user?.id, rawInput);
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  },

  async connect(req, res, next) {
    try {
      const result = await mcpManager.connectServer(req.workspaceId, req.params.id);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },

  async disconnect(req, res, next) {
    try {
      const result = await mcpManager.disconnectServer(req.workspaceId, req.params.id);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },

  async getConfig(req, res, next) {
    try {
      const result = await mcpManager.getConfig(req.workspaceId, req.params.id);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },

  async updateConfig(req, res, next) {
    try {
      const rawConfig = req.body.config || req.body.rawConfig || req.body;
      const result = await mcpManager.updateConfig(req.workspaceId, req.params.id, rawConfig);
      res.status(200).json(result);
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

  async batchUpdateTools(req, res, next) {
    try {
      const { action } = req.body;
      const result = await mcpManager.batchUpdateTools(req.workspaceId, req.params.id, action);
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

  async getLogs(req, res, next) {
    try {
      await mcpManager.getById(req.workspaceId, req.params.id);
      const logs = McpClientManager.getLogs(req.params.id);
      res.status(200).json({ serverId: req.params.id, logs });
    } catch (err) {
      next(err);
    }
  },
};

export default mcpController;
