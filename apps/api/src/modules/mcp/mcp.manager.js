import AppError from "../../utils/app-error.js";
import { McpServer, McpExecution } from "../../db/models/index.js";
import { McpClientManager } from "./mcp.client-manager.js";
import { McpOrchestrator } from "./mcp.orchestrator.js";
import { validateRemoteMcpUrl } from "../../utils/ssrf-guard.js";

export const mcpManager = {
  async list(workspaceId, userId = null) {
    if (workspaceId) {
      await McpOrchestrator.ensureBuiltinServer(workspaceId, userId);
    }
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

  async create(workspaceId, userId, data) {
    const transport = (data.transport || "STREAMABLE_HTTP").toUpperCase();

    // SSRF protection for remote URLs
    if (data.url && (transport === "STREAMABLE_HTTP" || transport === "HTTP" || transport === "SSE")) {
      await validateRemoteMcpUrl(data.url);
    }

    const server = await McpServer.create({
      workspaceId,
      ownerUserId: userId,
      name: data.name,
      description: data.description || "",
      url: data.url || null,
      command: data.command || null,
      transport,
      headers: data.headers || {},
      env: data.env || {},
      status: "CONNECTING",
      healthStatus: "healthy",
      enabled: data.enabled !== undefined ? data.enabled : true,
      tools: data.tools || [],
    });

    // Attempt initial tool discovery handshake
    try {
      const res = await McpClientManager.connect(server);
      if (res.tools && res.tools.length > 0) {
        server.tools = res.tools.map((t) => ({
          name: t.name,
          description: t.description || "",
          inputSchema: t.inputSchema || {},
          enabled: true,
          permission: t.name.includes("sql") || t.name.includes("delete") || t.name.includes("write") ? "always_ask" : "auto",
          requiresApproval: t.name.includes("sql") || t.name.includes("delete") || t.name.includes("write"),
        }));
        server.status = "CONNECTED";
        server.lastConnectedAt = new Date();
        await server.save();
      }
    } catch (connErr) {
      server.status = "ERROR";
      server.lastError = connErr.message;
      server.healthStatus = "offline";
      await server.save();
    }

    return server.toJSON();
  },

  async update(workspaceId, id, data) {
    delete data.workspaceId;
    delete data.ownerUserId;

    if (data.url) {
      await validateRemoteMcpUrl(data.url);
    }

    const server = await McpServer.findOneAndUpdate(
      { _id: id, workspaceId },
      { $set: data },
      { new: true, runValidators: true }
    );
    if (!server) {
      throw AppError.notFound("MCP server not found");
    }

    // Invalidate active client session so new config takes effect
    await McpClientManager.disconnect(id);

    return server.toJSON();
  },

  async delete(workspaceId, id) {
    const server = await McpServer.findOneAndDelete({ _id: id, workspaceId });
    if (!server) {
      throw AppError.notFound("MCP server not found");
    }
    await McpClientManager.disconnect(id);
    return { success: true };
  },

  async refreshTools(workspaceId, id) {
    const server = await McpServer.findOne({ _id: id, workspaceId });
    if (!server) {
      throw AppError.notFound("MCP server not found");
    }

    try {
      await McpClientManager.disconnect(id);
      const res = await McpClientManager.connect(server);

      // Preserve existing permission states for previously configured tools
      const existingMap = new Map((server.tools || []).map((t) => [t.name, t]));

      server.tools = (res.tools || []).map((t) => {
        const prev = existingMap.get(t.name);
        return {
          name: t.name,
          description: t.description || "",
          inputSchema: t.inputSchema || {},
          enabled: prev ? prev.enabled : true,
          permission: prev ? prev.permission : (t.name.includes("sql") || t.name.includes("delete") ? "always_ask" : "auto"),
          requiresApproval: prev ? prev.requiresApproval : (t.name.includes("sql") || t.name.includes("delete")),
          lastDiscoveredAt: new Date(),
        };
      });

      server.status = "CONNECTED";
      server.healthStatus = "healthy";
      server.lastConnectedAt = new Date();
      server.lastError = null;
      await server.save();

      return server.toJSON();
    } catch (err) {
      server.status = "ERROR";
      server.lastError = err.message;
      server.healthStatus = "offline";
      await server.save();
      throw AppError.badRequest(`Tool discovery failed: ${err.message}`);
    }
  },

  async testConnection(workspaceId, id, data = null) {
    let serverConfig = null;
    if (id) {
      serverConfig = await McpServer.findOne({ _id: id, workspaceId });
      if (!serverConfig) {
        throw AppError.notFound("MCP server not found");
      }
    } else if (data) {
      serverConfig = {
        _id: "test_draft",
        workspaceId,
        ...data,
      };
    } else {
      throw AppError.badRequest("Server ID or config data required");
    }

    if (serverConfig.url) {
      await validateRemoteMcpUrl(serverConfig.url);
    }

    const testRes = await McpClientManager.testConnection(serverConfig);
    return testRes;
  },

  async toggleTool(workspaceId, serverId, toolName, { enabled, permission, requiresApproval }) {
    const server = await McpServer.findOne({ _id: serverId, workspaceId });
    if (!server) {
      throw AppError.notFound("MCP server not found");
    }

    const tool = server.tools.find((t) => t.name === toolName);
    if (!tool) {
      throw AppError.notFound(`Tool "${toolName}" not found on server`);
    }

    if (enabled !== undefined) tool.enabled = enabled;
    if (permission !== undefined) {
      tool.permission = permission;
      tool.requiresApproval = permission === "always_ask";
    }
    if (requiresApproval !== undefined) {
      tool.requiresApproval = requiresApproval;
      tool.permission = requiresApproval ? "always_ask" : "auto";
    }

    await server.save();
    return server.toJSON();
  },

  async listExecutions(workspaceId, limit = 50) {
    const executions = await McpExecution.find({ workspaceId })
      .sort("-createdAt")
      .limit(Number(limit) || 50);
    return executions.map((e) => e.toJSON());
  },
};

export default mcpManager;
