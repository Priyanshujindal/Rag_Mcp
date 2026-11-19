import AppError from "../../utils/app-error.js";
import { McpServer } from "../../db/models/index.js";

export const mcpManager = {
  async list(workspaceId) {
    const servers = await McpServer.find({ workspaceId }).sort("-createdAt");
    return servers.map((s) => s.toJSON());
  },

  async getById(workspaceId, id) {
    const server = await McpServer.findOne({ _id: id, workspaceId });
    if (!server) {
      throw AppError.notFound("MCP server not found");
    }
    return server.toJSON();
  },

  async create(workspaceId, data) {
    const server = await McpServer.create({
      workspaceId,
      name: data.name,
      url: data.url || null,
      command: data.command || null,
      transport: data.transport || "SSE",
      status: "DISCONNECTED",
      tools: data.tools || [],
    });
    return server.toJSON();
  },

  async update(workspaceId, id, data) {
    delete data.workspaceId;
    const server = await McpServer.findOneAndUpdate(
      { _id: id, workspaceId },
      { $set: data },
      { new: true, runValidators: true }
    );
    if (!server) {
      throw AppError.notFound("MCP server not found");
    }
    return server.toJSON();
  },

  async delete(workspaceId, id) {
    const server = await McpServer.findOneAndDelete({ _id: id, workspaceId });
    if (!server) {
      throw AppError.notFound("MCP server not found");
    }
    return { success: true };
  },

  async toggleTool(workspaceId, serverId, toolName, { enabled, requiresApproval }) {
    const server = await McpServer.findOne({ _id: serverId, workspaceId });
    if (!server) {
      throw AppError.notFound("MCP server not found");
    }

    const tool = server.tools.find((t) => t.name === toolName);
    if (!tool) {
      throw AppError.notFound(`Tool "${toolName}" not found on server`);
    }

    if (enabled !== undefined) tool.enabled = enabled;
    if (requiresApproval !== undefined) tool.requiresApproval = requiresApproval;

    await server.save();
    return server.toJSON();
  },
};

export default mcpManager;

