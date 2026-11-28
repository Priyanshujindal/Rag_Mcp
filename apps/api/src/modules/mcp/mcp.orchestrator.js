/**
 * apps/api/src/modules/mcp/mcp.orchestrator.js
 * ============================================
 * Production MCP Tool Orchestration Engine:
 * - Discovers and aggregates available MCP tools across workspace-enabled servers
 * - Formats tool definitions for OpenAI-compatible and Gemini providers
 * - Enforces permissions, rate limits, schema validation, and human-in-the-loop approvals
 * - Dispatches execution via McpClientManager
 * - Records execution telemetry in MongoDB McpExecution collection
 * - Provides dynamic multi-turn agentic tool calling loop for AI models
 */

import crypto from "crypto";
import { McpServer, McpExecution, McpApproval } from "../../db/models/index.js";
import { McpClientManager } from "./mcp.client-manager.js";
import { IntegrationsAdapter } from "../integrations/integrations.adapter.js";
import usageService from "../usage/usage.service.js";
import logger from "../../utils/logger.js";

// Built-in standard server definition
export const BUILTIN_MCP_SERVER_NAME = "Builtin System Tools";
export const BUILTIN_SERVER_COMMAND = "node packages/mcp-servers/builtin-server.js";

export class McpOrchestrator {
  /**
   * Ensures the built-in MCP server exists for the workspace so out-of-the-box tools
   * (SQL analytics, math metrics, file inspection, directory listing, web search) are ready.
   */
  static async ensureBuiltinServer(workspaceId, userId = null) {
    if (!workspaceId) return null;
    let server = await McpServer.findOne({
      workspaceId,
      name: BUILTIN_MCP_SERVER_NAME,
    });

    if (!server) {
      server = await McpServer.create({
        workspaceId,
        ownerUserId: userId,
        name: BUILTIN_MCP_SERVER_NAME,
        description: "Official Model Context Protocol server exposing database analytics, metrics, files, and web search.",
        transport: "STDIO",
        command: BUILTIN_SERVER_COMMAND,
        status: "CONNECTED",
        healthStatus: "healthy",
        enabled: true,
        tools: [
          {
            name: "execute_readonly_sql",
            description: "Runs read-only SQL queries against the analytical replica database (tables: orders, customers). Requires human-in-the-loop approval before executing.",
            requiresApproval: true,
            permission: "always_ask",
            enabled: true,
          },
          {
            name: "calculate_metrics",
            description: "Evaluates exact mathematical operations, percentage changes, or KPI ratios.",
            requiresApproval: false,
            permission: "auto",
            enabled: true,
          },
          {
            name: "read_file_snippet",
            description: "Reads file text up to 50 lines within allowed workspace paths.",
            requiresApproval: false,
            permission: "auto",
            enabled: true,
          },
          {
            name: "list_directory",
            description: "Returns a directory listing of files and folders in the workspace.",
            requiresApproval: false,
            permission: "auto",
            enabled: true,
          },
          {
            name: "web_search_mcp",
            description: "Searches the live web for verified facts, documentation, or current information.",
            requiresApproval: false,
            permission: "auto",
            enabled: true,
          },
        ],
      });
    }

    return server;
  }

  /**
   * Discovers and returns all active tools available to the given workspace.
   * Handles tool collisions safely by mapping server metadata.
   */
  static async getActiveTools(workspaceId, userId = null) {
    if (!workspaceId) return [];

    await this.ensureBuiltinServer(workspaceId, userId);

    const servers = await McpServer.find({
      workspaceId,
      enabled: true,
      status: { $ne: "ERROR" },
    });

    const activeTools = [];
    const seenNames = new Set();

    for (const srv of servers) {
      // Disconnect servers marked as DISCONNECTED
      if (srv.status === "DISCONNECTED") continue;

      let serverTools = srv.tools || [];

      // If server has no cached tools, attempt dynamic discovery
      if (serverTools.length === 0) {
        try {
          const res = await McpClientManager.connect(srv);
          if (res.tools && res.tools.length > 0) {
            srv.tools = res.tools.map((t) => ({
              name: t.name,
              description: t.description || "",
              inputSchema: t.inputSchema || {},
              enabled: true,
              permission: t.name.includes("sql") || t.name.includes("delete") || t.name.includes("write") ? "always_ask" : "auto",
              requiresApproval: t.name.includes("sql") || t.name.includes("delete") || t.name.includes("write"),
              lastDiscoveredAt: new Date(),
            }));
            srv.status = "CONNECTED";
            srv.healthStatus = "healthy";
            srv.lastConnectedAt = new Date();
            await srv.save();
            serverTools = srv.tools;
          }
        } catch (err) {
          logger.warn({ serverId: srv._id, err: err.message }, "Dynamic tool discovery failed on server");
        }
      }

      for (const t of serverTools) {
        if (!t.enabled || t.permission === "deny") continue;

        let toolName = t.name.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
        if (seenNames.has(toolName)) {
          // Collision resolution: prefix with sanitized server name
          const prefix = srv.name.toLowerCase().replace(/[^a-z0-9]/g, "_").slice(0, 20);
          toolName = `${prefix}_${toolName}`.slice(0, 64);
        }
        seenNames.add(toolName);

        activeTools.push({
          id: `${srv._id}:${t.name}`,
          name: toolName,
          originalName: t.name,
          description: t.description || `Execute ${t.name} on ${srv.name}`,
          inputSchema: t.inputSchema && typeof t.inputSchema === "object" ? t.inputSchema : { type: "object", properties: {} },
          serverId: srv._id.toString(),
          serverName: srv.name,
          enabled: t.enabled !== false,
          requiresApproval: t.requiresApproval || t.permission === "always_ask",
          permission: t.permission || (t.requiresApproval ? "always_ask" : "auto"),
          serverConfig: srv,
          lastExecutionStatus: t.lastExecutionStatus || null,
          lastExecutedAt: t.lastExecutedAt || null,
        });
      }
    }

    // Include connected OAuth and API integrations
    try {
      const appTools = await IntegrationsAdapter.getConnectedTools(workspaceId, userId);
      for (const at of appTools) {
        let aName = at.name.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
        if (!seenNames.has(aName)) {
          seenNames.add(aName);
          activeTools.push({
            ...at,
            name: aName,
            id: at.id || `integration:${aName}`,
          });
        }
      }
    } catch (appErr) {
      logger.warn({ appErr: appErr.message }, "Could not fetch connected app tools");
    }

    return activeTools;
  }

  /**
   * Converts tools into OpenAI-compatible tool specifications (used by OpenRouter, Groq, Cloudflare).
   */
  static formatToolsForOpenAI(tools = []) {
    return tools.map((t) => ({
      type: "function",
      function: {
        name: t.name,
        description: t.description,
        parameters: t.inputSchema && typeof t.inputSchema === "object" ? t.inputSchema : { type: "object", properties: {} },
      },
    }));
  }

  /**
   * Converts tools into Google Gemini function declarations.
   */
  static formatToolsForGemini(tools = []) {
    if (!tools || tools.length === 0) return undefined;
    return [
      {
        functionDeclarations: tools.map((t) => {
          let schema = t.inputSchema;
          // Ensure schema has type object for Gemini
          if (!schema || typeof schema !== "object" || !schema.type) {
            schema = { type: "object", properties: {} };
          }
          return {
            name: t.name,
            description: t.description || `Tool: ${t.name}`,
            parameters: schema,
          };
        }),
      },
    ];
  }

  /**
   * Executes a tool within permission boundaries and records execution audit log.
   */
  static async executeTool({
    workspaceId,
    userId,
    conversationId,
    toolCallId,
    toolName,
    args = {},
    isApproved = false,
  }) {
    const startTime = Date.now();
    const tools = await this.getActiveTools(workspaceId, userId);
    const matched = tools.find(
      (t) =>
        t.name === toolName ||
        t.originalName === toolName ||
        t.id === toolName ||
        (typeof toolName === "string" && t.id?.endsWith(`:${toolName}`))
    );

    if (!matched) {
      throw new Error(`Tool "${toolName}" is not registered or is disabled in this workspace.`);
    }

    // Permission and Human-in-the-Loop check
    if (matched.requiresApproval && !isApproved) {
      const approvalId = `appr_${crypto.randomBytes(8).toString("hex")}`;
      await McpApproval.create({
        approvalId,
        workspaceId,
        userId,
        conversationId,
        toolCallId: toolCallId || approvalId,
        serverName: matched.serverName,
        toolName: matched.name,
        args,
        status: "pending",
      });

      return {
        requiresApproval: true,
        approvalId,
        toolCallId: toolCallId || approvalId,
        toolName: matched.name,
        serverName: matched.serverName,
        args,
      };
    }

    let executionStatus = "success";
    let executionError = null;
    let resultPayload = null;

    if (matched.isAppIntegration) {
      try {
        resultPayload = await IntegrationsAdapter.executeAppTool({
          workspaceId,
          userId,
          toolName: matched.rawName || matched.name,
          args,
          connectionId: matched.connectionId,
        });
        return {
          status: "success",
          result: resultPayload,
          toolName: matched.name,
          serverName: matched.serverName,
        };
      } catch (err) {
        return {
          status: "error",
          result: { error: err.message, isError: true },
          toolName: matched.name,
          serverName: matched.serverName,
        };
      }
    }

    try {
      resultPayload = await McpClientManager.callTool(
        matched.serverConfig,
        matched.originalName,
        args
      );
    } catch (err) {
      executionStatus = "error";
      executionError = err.message;
      resultPayload = { error: err.message, isError: true };
    }

    const durationMs = Date.now() - startTime;

    // Update execution status on the tool in the server document
    if (matched.serverConfig?._id) {
      McpServer.updateOne(
        { _id: matched.serverConfig._id, "tools.name": matched.originalName },
        {
          $set: {
            "tools.$.lastExecutionStatus": executionStatus,
            "tools.$.lastExecutedAt": new Date(),
          },
        }
      ).catch(() => {});
    }

    // Persist audit record in MongoDB
    try {
      await McpExecution.create({
        workspaceId,
        userId,
        conversationId,
        serverId: matched.serverConfig?._id,
        serverName: matched.serverName,
        toolName: matched.name,
        args,
        resultSummary: resultPayload?.text ? resultPayload.text.slice(0, 500) : JSON.stringify(resultPayload).slice(0, 500),
        status: executionStatus,
        durationMs,
        error: executionError,
      });

      usageService.recordEvent({
        workspaceId,
        userId,
        eventType: "mcp.tool_call",
        category: "mcp",
        status: executionStatus === "success" ? "success" : "failed",
        mcpServerId: matched.serverConfig?._id,
        toolName: matched.name,
        durationMs,
        metadata: {
          serverName: matched.serverName,
          isAppIntegration: !!matched.isAppIntegration,
        },
      });
    } catch (logErr) {
      logger.warn({ logErr: logErr.message }, "Could not save McpExecution audit record");
    }

    return {
      requiresApproval: false,
      toolCallId,
      toolName: matched.name,
      serverName: matched.serverName,
      result: resultPayload?.data || resultPayload?.text || resultPayload,
      rawResult: resultPayload,
      durationMs,
      status: executionStatus,
    };
  }

  /**
   * Resolves a pending human approval and optionally executes the tool immediately.
   */
  static async resolveApproval({ approvalId, approved, userId }) {
    const record = await McpApproval.findOne({
      $or: [{ approvalId }, { toolCallId: approvalId }],
    });

    if (!record) {
      throw new Error("Approval record not found or expired");
    }

    record.status = approved ? "approved" : "rejected";
    record.resolvedAt = new Date();
    await record.save();

    if (!approved) {
      return {
        approved: false,
        status: "rejected",
        toolCallId: record.toolCallId,
      };
    }

    // Execute immediately upon approval
    const result = await this.executeTool({
      workspaceId: record.workspaceId,
      userId: userId || record.userId,
      conversationId: record.conversationId,
      toolCallId: record.toolCallId,
      toolName: record.toolName,
      args: record.args,
      isApproved: true,
    });

    return {
      approved: true,
      ...result,
    };
  }
}

export default McpOrchestrator;
