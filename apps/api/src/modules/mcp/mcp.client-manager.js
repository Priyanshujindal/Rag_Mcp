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

// Per-server stderr/diagnostics ring buffer (last 100 entries)
const serverLogs = new Map();
const MAX_LOG_LINES = 100;

// Connection timeout constant (15 seconds)
const CONNECT_TIMEOUT_MS = 15000;
const MAX_STDIO_PER_WORKSPACE = Number(process.env.MAX_MCP_STDIO_PER_WORKSPACE) || 5;
const IDLE_TIMEOUT_MS = Number(process.env.MCP_IDLE_TIMEOUT_MS) || 15 * 60 * 1000;

function appendServerLog(serverId, level, text) {
  const id = String(serverId);
  if (!serverLogs.has(id)) {
    serverLogs.set(id, []);
  }
  const buf = serverLogs.get(id);
  const lines = String(text || "").split(/\r?\n/).filter((l) => l.trim() !== "");
  for (const line of lines) {
    buf.push({
      timestamp: new Date().toISOString(),
      level,
      text: line.slice(0, 2000),
    });
    if (buf.length > MAX_LOG_LINES) {
      buf.shift();
    }
  }
}

// Sweep idle stdio/remote MCP connections every 5 minutes
const idleSweepTimer = setInterval(async () => {
  const now = Date.now();
  for (const [serverId, session] of activeClients.entries()) {
    if (session.serverConfig?.type === "builtin") continue;
    const lastUsed = session.lastUsedAt || new Date(session.connectedAt).getTime();
    if (now - lastUsed > IDLE_TIMEOUT_MS) {
      logger.info({ serverId }, "Auto-disconnecting idle MCP server");
      appendServerLog(serverId, "info", "Auto-disconnected due to idle timeout.");
      try {
        await session.client?.close?.();
        await session.transport?.close?.();
      } catch {}
      activeClients.delete(serverId);
    }
  }
}, 5 * 60 * 1000);
if (typeof idleSweepTimer.unref === "function") {
  idleSweepTimer.unref();
}

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

    let transportType = (serverConfig.transport || "").toUpperCase().replace(/-/g, "_");
    if (!transportType) {
      transportType = serverConfig.command ? "STDIO" : "STREAMABLE_HTTP";
    }
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
      let command = rawCommand;
      let args = Array.isArray(serverConfig.args) ? [...serverConfig.args] : [];
      if (args.length === 0) {
        const parts = rawCommand.split(/\s+/);
        command = parts[0];
        args = parts.slice(1);
      }

      // Security check: only allow safe execution commands (node, python, npx, uv, docker, etc.)
      const allowedBinaries = ["node", "npx", "python", "python3", "uv", "uvx", "docker", "bun", "deno"];
      const baseBinary = command.split(/[\\/]/).pop().toLowerCase().replace(/\.(exe|cmd|bat)$/, "");
      if (!allowedBinaries.includes(baseBinary)) {
        throw new Error(
          `Security violation: Command "${baseBinary}" is not in the permitted binary whitelist (${allowedBinaries.join(", ")})`
        );
      }

      // Resolve relative script paths against CWD or repo root
      const resolvedArgs = args.map((arg) => {
        if (typeof arg === "string" && !arg.startsWith("-") && (arg.endsWith(".js") || arg.endsWith(".py") || arg.includes("/") || arg.includes("\\"))) {
          if (fs.existsSync(arg)) return path.resolve(arg);
          const fromCwd = path.resolve(process.cwd(), arg);
          if (fs.existsSync(fromCwd)) return fromCwd;
          const fromRepo = path.resolve(process.cwd(), "../../", arg);
          if (fs.existsSync(fromRepo)) return fromRepo;
        }
        return arg;
      });

      // Enforce per-workspace concurrent stdio process limit
      if (serverConfig.workspaceId && serverConfig.type !== "builtin") {
        const wsIdStr = String(serverConfig.workspaceId);
        let wsStdioCount = 0;
        for (const [id, sess] of activeClients.entries()) {
          if (
            id !== serverId &&
            String(sess.serverConfig?.workspaceId) === wsIdStr &&
            (sess.serverConfig?.transport || "").toUpperCase() === "STDIO" &&
            sess.serverConfig?.type !== "builtin"
          ) {
            wsStdioCount++;
          }
        }
        if (wsStdioCount >= MAX_STDIO_PER_WORKSPACE) {
          throw new Error(
            `Workspace limit reached: maximum ${MAX_STDIO_PER_WORKSPACE} concurrent local stdio MCP processes allowed. Disconnect an unused server first.`
          );
        }
      }

      transport = new StdioClientTransport({
        command,
        args: resolvedArgs,
        stderr: "pipe",
        env: {
          ...process.env,
          ...(serverConfig.env || {}),
        },
      });

      if (transport.stderr) {
        transport.stderr.on("data", (chunk) => {
          appendServerLog(serverId, "stderr", chunk.toString());
        });
      }
      appendServerLog(serverId, "info", `Spawning stdio process: ${command} ${resolvedArgs.join(" ")}`);
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
    try {
      const connectPromise = client.connect(transport);
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`MCP server connection timed out after ${CONNECT_TIMEOUT_MS / 1000}s`)), CONNECT_TIMEOUT_MS)
      );

      await Promise.race([connectPromise, timeoutPromise]);
    } catch (err) {
      appendServerLog(serverId, "error", `Connection failed: ${err.message}`);
      try {
        await transport?.close?.();
      } catch {}
      throw err;
    }

    appendServerLog(serverId, "info", `Connected successfully via ${transportType}`);

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
      lastUsedAt: Date.now(),
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
    if (session) {
      session.lastUsedAt = Date.now();
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
   * Checks if an active client session exists for a server.
   */
  static isConnected(serverId) {
    return activeClients.has(serverId.toString());
  }

  /**
   * Returns captured stderr and lifecycle logs for a server.
   */
  static getLogs(serverId) {
    return serverLogs.get(String(serverId)) || [];
  }

  /**
   * Clears captured logs for a server.
   */
  static clearLogs(serverId) {
    serverLogs.delete(String(serverId));
  }

  /**
   * Normalizes MCP tool execution output into a consistent format,
   * capping output text to prevent memory exhaustion and context window overflows.
   */
  static normalizeToolResult(raw, maxOutputChars = 65536) {
    if (!raw) return { text: "No content returned", isError: false };

    if (raw.isError) {
      const errorMsg =
        raw.content?.map((c) => c.text).filter(Boolean).join("\n") || "Unknown error during tool execution";
      return { error: errorMsg.slice(0, maxOutputChars), isError: true };
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

      let combinedText = textParts.join("\n\n");
      if (combinedText.length > maxOutputChars) {
        combinedText = combinedText.slice(0, maxOutputChars) + "\n\n...[output truncated due to size limit]";
      }

      // Check if text is JSON string
      let parsedJson = null;
      if (textParts.length === 1) {
        try {
          parsedJson = JSON.parse(textParts[0]);
        } catch {}
      }

      return {
        text: combinedText,
        data: parsedJson || (textParts.length > 0 ? textParts : null),
        images: imageParts.length > 0 ? imageParts : undefined,
        resources: resourceParts.length > 0 ? resourceParts : undefined,
        isError: false,
      };
    }

    const rawStr = typeof raw === "string" ? raw : JSON.stringify(raw);
    const truncatedStr = rawStr.length > maxOutputChars ? rawStr.slice(0, maxOutputChars) + "...[truncated]" : rawStr;

    return {
      text: truncatedStr,
      data: raw,
      isError: false,
    };
  }
}

export default McpClientManager;
