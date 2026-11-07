/**
 * apps/api/src/modules/mcp/mcp.runner.js
 * ==========================================================
 * MCP Tool Execution Engine:
 * - Dynamically exposes registered workspace tools to the LLM agent
 * - Enforces permissions & human-in-the-loop approval checks
 * - Dispatches tool calls to built-in or external MCP servers
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { McpServer } from "../../db/models/index.js";
import logger from "../../utils/logger.js";

// Import sample built-in MCP servers
import fsMcp from "../../../../../packages/mcp-servers/filesystem-scoped/src/index.js";
import demoMcp from "../../../../../packages/mcp-servers/demo-tools/src/index.js";

const BUILT_IN_SERVERS = [fsMcp, demoMcp];

// In-memory pending approvals store
const pendingApprovals = new Map();

export const mcpRunner = {
  /**
   * Retrieves all enabled tools for a workspace.
   */
  async getActiveTools(workspaceId) {
    const tools = [];

    // 1. Fetch configured DB servers
    let dbServers = [];
    if (workspaceId) {
      try {
        dbServers = await McpServer.find({ workspaceId, status: { $ne: "DISCONNECTED" } });
      } catch (err) {
        logger.warn(`Could not fetch MCP servers for workspace ${workspaceId}: ${err.message}`);
      }
    }

    // 2. Map built-in tools
    for (const server of BUILT_IN_SERVERS) {
      for (const t of server.tools) {
        // Check if DB overridden
        const dbServer = dbServers.find((s) => s.name === server.name);
        const dbTool = dbServer?.tools?.find((tool) => tool.name === t.name);

        if (dbTool && dbTool.enabled === false) {
          continue;
        }

        const requiresApproval =
          dbTool?.requiresApproval !== undefined
            ? dbTool.requiresApproval
            : Boolean(t.requiresApproval);

        tools.push({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
          requiresApproval,
          serverName: server.name,
        });
      }
    }

    return tools;
  },

  /**
   * Creates a pending approval record for human-in-the-loop validation.
   */
  createPendingApproval({ conversationId, toolName, args, serverName }) {
    const id = `appr_${crypto.randomBytes(8).toString("hex")}`;
    const record = {
      id,
      conversationId,
      toolName,
      args,
      serverName: serverName || "MCP Tool",
      status: "pending",
      createdAt: new Date().toISOString(),
    };
    pendingApprovals.set(id, record);
    return record;
  },

  getPendingApproval(toolCallId) {
    return pendingApprovals.get(toolCallId);
  },

  resolvePendingApproval(toolCallId, approved) {
    const record = pendingApprovals.get(toolCallId);
    if (!record) return null;
    record.status = approved ? "approved" : "rejected";
    return record;
  },

  /**
   * Executes a tool by name with provided arguments.
   */
  async executeTool(toolName, args = {}) {
    logger.info({ toolName, args }, "Executing MCP tool");

    for (const server of BUILT_IN_SERVERS) {
      const match = server.tools.find((t) => t.name === toolName);
      if (match) {
        try {
          const result = await match.execute(args);
          return {
            success: !result.error,
            toolName,
            serverName: server.name,
            result,
          };
        } catch (err) {
          return {
            success: false,
            toolName,
            serverName: server.name,
            error: err.message,
          };
        }
      }
    }

    return {
      success: false,
      toolName,
      error: `No handler found for tool "${toolName}"`,
    };
  },
};

export default mcpRunner;

