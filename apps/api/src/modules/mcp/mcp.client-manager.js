/**
 * apps/api/src/modules/mcp/mcp.client-manager.js
 * ===============================================
 * Production MCP Client Manager using the official @modelcontextprotocol/sdk.
 * Manages active connections, dynamic capability discovery, tools discovery,
 * and execution across Streamable HTTP, SSE, and local Stdio transports.
 */

import fs from "fs";
import path from "path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import { validateRemoteMcpUrl } from "../../utils/ssrf-guard.js";
import logger from "../../utils/logger.js";

// Active client instances keyed by serverId string
const activeClients = new Map();

// Connection timeout constant (15 seconds)
const CONNECT_TIMEOUT_MS = 15000;

export class McpClientManager {
  /**
   * Initializes and connects an MCP Client for a given server configuration.
   * Discovers capabilities, tools, resources, and prompts.
   * @param {object} serverConfig
   * @returns {Promise<{ client: Client, tools: Array, resources: Array, prompts: Array }>}
   */
  static async connect(serverConfig) {
    const serverId = (serverConfig._id || serverConfig.id).toString();

    // If client already connected and healthy, return existing session
    if (activeClients.has(serverId)) {
      const existing = activeClients.get(serverId);
      try {
        const toolsResult = await existing.client.listTools();
        return {
          client: existing.client,
          tools: toolsResult?.tools || [],
          resources: existing.resources || [],
          prompts: existing.prompts || [],
        };
      } catch (err) {
        logger.warn({ serverId, err: err.message }, "Existing MCP client stale, reconnecting...");
        await this.disconnect(serverId);
      }
    }

    const transportType = (serverConfig.transport || "STREAMABLE_HTTP").toUpperCase();
    let transport;

    if (transportType === "STREAMABLE_HTTP" || transportType === "HTTP") {
      const safeUrl = await validateRemoteMcpUrl(serverConfig.url);
      const headers = serverConfig.headers || {};
      transport = new StreamableHTTPClientTransport(new URL(safeUrl), {
        headers,
      });
    } else if (transportType === "SSE") {
      const safeUrl = await validateRemoteMcpUrl(serverConfig.url);
      const headers = serverConfig.headers || {};
      transport = new SSEClientTransport(new URL(safeUrl), {
        eventSourceInit: { headers },
        requestInit: { headers },
      });
    } else if (transportType === "STDIO") {
      if (!serverConfig.command) {
        throw new Error("Command is required for STDIO transport");
      }
      const rawCommand = serverConfig.command.trim();
      const parts = rawCommand.split(/\s+/);
      const command = parts[0];
      const args = parts.slice(1);

      // Security check: only allow safe execution commands (node, python, npx, uv)
      const allowedBinaries = ["node", "npx", "python", "python3", "uv", "uvx"];
      const baseBinary = command.split(/[\\/]/).pop().toLowerCase();
      if (!allowedBinaries.includes(baseBinary)) {
        throw new Error(
          `Security violation: Command "${baseBinary}" is not in the permitted binary whitelist (${allowedBinaries.join(", ")})`
        );
      }

      // Resolve relative script paths against CWD or repo root
      const resolvedArgs = args.map((arg) => {
        if (!arg.startsWith("-") && (arg.endsWith(".js") || arg.endsWith(".py") || arg.includes("/") || arg.includes("\\"))) {
          if (fs.existsSync(arg)) return path.resolve(arg);
          const fromCwd = path.resolve(process.cwd(), arg);
          if (fs.existsSync(fromCwd)) return fromCwd;
          const fromRepo = path.resolve(process.cwd(), "../../", arg);
          if (fs.existsSync(fromRepo)) return fromRepo;
        }
        return arg;
      });

      transport = new StdioClientTransport({
        command,
        args: resolvedArgs,
        env: {
          ...process.env,
          ...(serverConfig.env || {}),
        },
      });
    } else {
      throw new Error(`Unsupported transport type: "${transportType}"`);
    }

    const client = new Client(
      {
        name: "Rag_Mcp_Client",
        version: "1.0.0",
      },
      {
        capabilities: {
          tools: {},
          resources: {},
          prompts: {},
        },
      }
    );

    // Timeout-guarded connection
    const connectPromise = client.connect(transport);
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`MCP server connection timed out after ${CONNECT_TIMEOUT_MS / 1000}s`)), CONNECT_TIMEOUT_MS)
    );

    await Promise.race([connectPromise, timeoutPromise]);

    logger.info({ serverId, serverName: serverConfig.name, transport: transportType }, "Connected to MCP server");

    // Discover tools
    let discoveredTools = [];
    try {
      const toolsResult = await client.listTools();
      discoveredTools = toolsResult?.tools || [];
    } catch (err) {
      logger.warn({ serverId, err: err.message }, "Could not discover tools from MCP server");
    }

    // Discover resources
    let discoveredResources = [];
    try {
      const resourcesResult = await client.listResources();
      discoveredResources = resourcesResult?.resources || [];
    } catch {
      // Optional capability
    }

    // Discover prompts
    let discoveredPrompts = [];
    try {
      const promptsResult = await client.listPrompts();
      discoveredPrompts = promptsResult?.prompts || [];
    } catch {
      // Optional capability
    }

    activeClients.set(serverId, {
      client,
      transport,
      serverConfig,
      tools: discoveredTools,
      resources: discoveredResources,
      prompts: discoveredPrompts,
      connectedAt: new Date().toISOString(),
    });

    return {
      client,
      tools: discoveredTools,
      resources: discoveredResources,
      prompts: discoveredPrompts,
    };
  }

  /**
   * Executes a tool on a connected MCP server.
   */
  static async callTool(serverConfig, toolName, args = {}, timeoutMs = 30000) {
    const serverId = (serverConfig._id || serverConfig.id).toString();

    let session = activeClients.get(serverId);
    if (!session) {
      session = await this.connect(serverConfig);
    }

    logger.info({ serverId, toolName, args }, "Calling MCP tool via official SDK");

    const execPromise = session.client.callTool({
      name: toolName,
      arguments: args,
    });

    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Tool execution timed out after ${timeoutMs / 1000}s`)), timeoutMs)
    );

    const rawResult = await Promise.race([execPromise, timeoutPromise]);

    return this.normalizeToolResult(rawResult);
  }

  /**
   * Disconnects an active MCP server session.
   */
  static async disconnect(serverId) {
    const id = serverId.toString();
    const session = activeClients.get(id);
    if (session) {
      try {
        await session.client.close();
      } catch (err) {
        logger.warn({ serverId: id, err: err.message }, "Error during MCP client close");
      }
      activeClients.delete(id);
      logger.info({ serverId: id }, "MCP server disconnected");
    }
  }

  /**
   * Tests connection to an MCP server without keeping session active.
   */
  static async testConnection(serverConfig) {
    try {
      const res = await this.connect(serverConfig);
      return {
        success: true,
        toolCount: res.tools.length,
        resourceCount: res.resources.length,
        promptCount: res.prompts.length,
        tools: res.tools.map((t) => ({ name: t.name, description: t.description })),
      };
    } catch (err) {
      return {
        success: false,
        error: err.message,
      };
    }
  }

  /**
   * Normalizes MCP tool execution output into a consistent format.
   */
  static normalizeToolResult(raw) {
    if (!raw) return { text: "No content returned", isError: false };

    if (raw.isError) {
      const errorMsg =
        raw.content?.map((c) => c.text).filter(Boolean).join("\n") || "Unknown error during tool execution";
      return { error: errorMsg, isError: true };
    }

    if (Array.isArray(raw.content)) {
      const textParts = [];
      const imageParts = [];
      const resourceParts = [];

      for (const item of raw.content) {
        if (item.type === "text") {
          textParts.push(item.text);
        } else if (item.type === "image") {
          imageParts.push(item.data);
        } else if (item.type === "resource") {
          resourceParts.push(item.resource);
        }
      }

      // Check if text is JSON string
      let parsedJson = null;
      if (textParts.length === 1) {
        try {
          parsedJson = JSON.parse(textParts[0]);
        } catch {}
      }

      return {
        text: textParts.join("\n\n"),
        data: parsedJson || (textParts.length > 0 ? textParts : null),
        images: imageParts.length > 0 ? imageParts : undefined,
        resources: resourceParts.length > 0 ? resourceParts : undefined,
        isError: false,
      };
    }

    return {
      text: typeof raw === "string" ? raw : JSON.stringify(raw),
      data: raw,
      isError: false,
    };
  }
}

export default McpClientManager;
