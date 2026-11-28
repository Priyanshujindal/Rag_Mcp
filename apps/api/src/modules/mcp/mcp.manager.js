import AppError from "../../utils/app-error.js";
import { McpServer, McpExecution } from "../../db/models/index.js";
import { McpClientManager } from "./mcp.client-manager.js";
import { McpOrchestrator } from "./mcp.orchestrator.js";
import { validateRemoteMcpUrl } from "../../utils/ssrf-guard.js";

/**
 * Parses user-provided MCP JSON configuration (Antigravity multi-server or single server format).
 * @param {string|object} rawInput
 * @returns {Array<object>} Normalized server definitions
 */
export function parseMcpConfigInput(rawInput) {
  let parsed = typeof rawInput === "string" ? JSON.parse(rawInput) : rawInput;
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Invalid configuration: root must be a JSON object");
  }

  // Handle standard Antigravity wrapper: { "mcpServers": { ... } }
  let serversMap = parsed.mcpServers || parsed;

  const serverConfigs = [];

  // If single server object directly: e.g. { "command": "...", "args": [...] }
  if (parsed.command || (parsed.url && !parsed.mcpServers)) {
    const sName = (parsed.name || "custom-mcp-server").trim();
    const transport = (parsed.transport || (parsed.command ? "STDIO" : "STREAMABLE_HTTP"))
      .toUpperCase()
      .replace(/-/g, "_");

    serverConfigs.push({
      name: sName,
      description: parsed.description || `MCP Server: ${sName}`,
      command: parsed.command ? parsed.command.trim() : null,
      args: Array.isArray(parsed.args) ? parsed.args.map(String) : [],
      url: parsed.url ? parsed.url.trim() : null,
      transport,
      headers: parsed.headers && typeof parsed.headers === "object" ? parsed.headers : {},
      env: parsed.env && typeof parsed.env === "object" ? parsed.env : {},
      rawConfig: parsed,
    });
    return serverConfigs;
  }

  for (const [serverKey, srv] of Object.entries(serversMap)) {
    if (!srv || typeof srv !== "object") continue;

    const sName = (srv.name || serverKey).trim();
    const transport = (srv.transport || (srv.command ? "STDIO" : "STREAMABLE_HTTP"))
      .toUpperCase()
      .replace(/-/g, "_");

    serverConfigs.push({
      name: sName,
      description: srv.description || `MCP Server: ${sName}`,
      command: srv.command ? srv.command.trim() : null,
      args: Array.isArray(srv.args) ? srv.args.map(String) : [],
      url: srv.url ? srv.url.trim() : null,
      transport,
      headers: srv.headers && typeof srv.headers === "object" ? srv.headers : {},
      env: srv.env && typeof srv.env === "object" ? srv.env : {},
      rawConfig: { [serverKey]: srv },
    });
  }

  if (serverConfigs.length === 0) {
    throw new Error("No valid MCP server definitions found in configuration.");
  }

  return serverConfigs;
}

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
    const transport = (data.transport || (data.command ? "STDIO" : "STREAMABLE_HTTP"))
      .toUpperCase()
      .replace(/-/g, "_");

    // SSRF protection for remote URLs
    if (data.url && (transport === "STREAMABLE_HTTP" || transport === "HTTP" || transport === "SSE")) {
      await validateRemoteMcpUrl(data.url);
    }

    const server = await McpServer.create({
      workspaceId,
      ownerUserId: userId,
      name: data.name.trim(),
      description: data.description || "",
      url: data.url || null,
      command: data.command || null,
      args: Array.isArray(data.args) ? data.args : [],
      transport,
      headers: data.headers || {},
      env: data.env || {},
      status: "CONNECTING",
      healthStatus: "healthy",
      enabled: data.enabled !== undefined ? data.enabled : true,
      tools: data.tools || [],
      rawConfig: data.rawConfig || null,
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
          lastDiscoveredAt: new Date(),
        }));
        server.status = "CONNECTED";
        server.lastConnectedAt = new Date();
        server.lastError = null;
        await server.save();
      } else {
        server.status = "CONNECTED";
        server.lastConnectedAt = new Date();
        server.lastError = null;
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

  /**
   * Imports multiple or single MCP servers from Antigravity-style JSON configuration.
   * Creates or updates each server independently with isolated connection & error states.
   */
  async importConfig(workspaceId, userId, rawInput) {
    let serverDefs = [];
    try {
      serverDefs = parseMcpConfigInput(rawInput);
    } catch (err) {
      throw AppError.badRequest(`Configuration syntax or structure error: ${err.message}`);
    }

    const results = [];

    for (const def of serverDefs) {
      try {
        if (def.url) {
          await validateRemoteMcpUrl(def.url);
        }

        // Look for existing server with same name in workspace
        let server = await McpServer.findOne({ workspaceId, name: def.name });

        if (server) {
          // Preserve existing tool configurations
          const existingToolsMap = new Map((server.tools || []).map((t) => [t.name, t]));

          server.command = def.command;
          server.args = def.args;
          server.url = def.url;
          server.transport = def.transport;
          if (Object.keys(def.headers).length > 0) server.headers = def.headers;
          if (Object.keys(def.env).length > 0) server.env = def.env;
          server.rawConfig = def.rawConfig;
          server.status = "CONNECTING";
          server.lastError = null;
          await server.save();

          // Invalidate existing client session
          await McpClientManager.disconnect(server._id);

          try {
            const conn = await McpClientManager.connect(server);
            server.tools = (conn.tools || []).map((t) => {
              const prev = existingToolsMap.get(t.name);
              return {
                name: t.name,
                description: t.description || "",
                inputSchema: t.inputSchema || {},
                enabled: prev ? prev.enabled : true,
                permission: prev ? prev.permission : (t.name.includes("delete") || t.name.includes("sql") ? "always_ask" : "auto"),
                requiresApproval: prev ? prev.requiresApproval : (t.name.includes("delete") || t.name.includes("sql")),
                lastDiscoveredAt: new Date(),
              };
            });
            server.status = "CONNECTED";
            server.healthStatus = "healthy";
            server.lastConnectedAt = new Date();
            server.lastError = null;
          } catch (connErr) {
            server.status = "ERROR";
            server.healthStatus = "offline";
            server.lastError = connErr.message;
          }
          await server.save();
          results.push(server.toJSON());
        } else {
          // Create new server
          server = await McpServer.create({
            workspaceId,
            ownerUserId: userId,
            name: def.name,
            description: def.description || `MCP Server: ${def.name}`,
            command: def.command,
            args: def.args,
            url: def.url,
            transport: def.transport,
            headers: def.headers,
            env: def.env,
            status: "CONNECTING",
            healthStatus: "healthy",
            enabled: true,
            rawConfig: def.rawConfig,
          });

          try {
            const conn = await McpClientManager.connect(server);
            server.tools = (conn.tools || []).map((t) => ({
              name: t.name,
              description: t.description || "",
              inputSchema: t.inputSchema || {},
              enabled: true,
              permission: t.name.includes("delete") || t.name.includes("sql") ? "always_ask" : "auto",
              requiresApproval: t.name.includes("delete") || t.name.includes("sql"),
              lastDiscoveredAt: new Date(),
            }));
            server.status = "CONNECTED";
            server.healthStatus = "healthy";
            server.lastConnectedAt = new Date();
            server.lastError = null;
          } catch (connErr) {
            server.status = "ERROR";
            server.healthStatus = "offline";
            server.lastError = connErr.message;
          }
          await server.save();
          results.push(server.toJSON());
        }
      } catch (serverErr) {
        // Individual server failure should not abort remaining servers
        results.push({
          name: def.name,
          status: "ERROR",
          error: serverErr.message,
        });
      }
    }

    return {
      success: true,
      importedCount: results.length,
      servers: results,
    };
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

  async connectServer(workspaceId, id) {
    const server = await McpServer.findOne({ _id: id, workspaceId });
    if (!server) {
      throw AppError.notFound("MCP server not found");
    }

    server.status = "CONNECTING";
    await server.save();

    try {
      await McpClientManager.disconnect(id);
      const res = await McpClientManager.connect(server);

      const existingMap = new Map((server.tools || []).map((t) => [t.name, t]));
      server.tools = (res.tools || []).map((t) => {
        const prev = existingMap.get(t.name);
        return {
          name: t.name,
          description: t.description || "",
          inputSchema: t.inputSchema || {},
          enabled: prev ? prev.enabled : true,
          permission: prev ? prev.permission : "auto",
          requiresApproval: prev ? prev.requiresApproval : false,
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
      server.healthStatus = "offline";
      server.lastError = err.message;
      await server.save();
      throw AppError.badRequest(`Connection failed: ${err.message}`);
    }
  },

  async disconnectServer(workspaceId, id) {
    const server = await McpServer.findOne({ _id: id, workspaceId });
    if (!server) {
      throw AppError.notFound("MCP server not found");
    }

    await McpClientManager.disconnect(id);
    server.status = "DISCONNECTED";
    server.healthStatus = "offline";
    await server.save();
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
      if (permission === "deny") tool.enabled = false;
    }
    if (requiresApproval !== undefined) {
      tool.requiresApproval = requiresApproval;
      tool.permission = requiresApproval ? "always_ask" : "auto";
    }

    await server.save();
    return server.toJSON();
  },

  async batchUpdateTools(workspaceId, serverId, action) {
    const server = await McpServer.findOne({ _id: serverId, workspaceId });
    if (!server) {
      throw AppError.notFound("MCP server not found");
    }

    if (action === "enable_all") {
      for (const t of server.tools) {
        t.enabled = true;
        if (t.permission === "deny") t.permission = "auto";
      }
    } else if (action === "disable_all") {
      for (const t of server.tools) {
        t.enabled = false;
      }
    } else {
      throw AppError.badRequest("Invalid batch action. Allowed: 'enable_all', 'disable_all'");
    }

    await server.save();
    return server.toJSON();
  },

  /**
   * Generates Antigravity-compatible JSON configuration for viewing / exporting.
   * Masks secrets like tokens and passwords.
   */
  async getConfig(workspaceId, id) {
    const server = await McpServer.findOne({ _id: id, workspaceId });
    if (!server) {
      throw AppError.notFound("MCP server not found");
    }

    const srvJson = server.toJSON();
    const configBlock = {};

    if (srvJson.transport === "STDIO" || srvJson.command) {
      configBlock[srvJson.name] = {
        command: srvJson.command,
        ...(srvJson.args?.length > 0 && { args: srvJson.args }),
        ...(srvJson.env && Object.keys(srvJson.env).length > 0 && { env: srvJson.env }),
      };
    } else {
      configBlock[srvJson.name] = {
        url: srvJson.url,
        transport: (srvJson.transport || "streamable-http").toLowerCase().replace(/_/g, "-"),
        ...(srvJson.headers && Object.keys(srvJson.headers).length > 0 && { headers: srvJson.headers }),
      };
    }

    return {
      mcpServers: configBlock,
    };
  },

  /**
   * Updates an existing server's configuration and reconnects.
   */
  async updateConfig(workspaceId, id, rawConfig) {
    const server = await McpServer.findOne({ _id: id, workspaceId });
    if (!server) {
      throw AppError.notFound("MCP server not found");
    }

    const serverDefs = parseMcpConfigInput(rawConfig);
    const def = serverDefs[0];
    if (!def) {
      throw AppError.badRequest("No valid server configuration provided");
    }

    if (def.url) {
      await validateRemoteMcpUrl(def.url);
    }

    server.name = def.name || server.name;
    server.command = def.command;
    server.args = def.args;
    server.url = def.url;
    server.transport = def.transport;
    if (def.headers && Object.keys(def.headers).length > 0) server.headers = def.headers;
    if (def.env && Object.keys(def.env).length > 0) server.env = def.env;
    server.rawConfig = def.rawConfig;

    await server.save();
    await McpClientManager.disconnect(id);

    try {
      const conn = await McpClientManager.connect(server);
      const existingMap = new Map((server.tools || []).map((t) => [t.name, t]));
      server.tools = (conn.tools || []).map((t) => {
        const prev = existingMap.get(t.name);
        return {
          name: t.name,
          description: t.description || "",
          inputSchema: t.inputSchema || {},
          enabled: prev ? prev.enabled : true,
          permission: prev ? prev.permission : "auto",
          requiresApproval: prev ? prev.requiresApproval : false,
          lastDiscoveredAt: new Date(),
        };
      });
      server.status = "CONNECTED";
      server.healthStatus = "healthy";
      server.lastConnectedAt = new Date();
      server.lastError = null;
    } catch (connErr) {
      server.status = "ERROR";
      server.healthStatus = "offline";
      server.lastError = connErr.message;
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
