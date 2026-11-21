import { IntegrationConnection } from "../../db/models/integration-connection.model.js";
import { McpExecution } from "../../db/models/mcp-execution.model.js";
import { getIntegrationById } from "./catalog.js";
import { getConnector } from "./connectors/index.js";
import logger from "../../utils/logger.js";

/**
 * Unified Integration-to-MCP Adapter.
 * Bridges connected OAuth/API accounts into the core McpOrchestrator pipeline.
 */
export class IntegrationsAdapter {
  /**
   * Retrieves all active tools provided by the user's connected integrations.
   * @param {string} workspaceId
   * @param {string} userId
   * @returns {Promise<Array<object>>}
   */
  static async getConnectedTools(workspaceId, userId) {
    if (!workspaceId || !userId) return [];

    try {
      const connections = await IntegrationConnection.find({
        workspaceId,
        userId,
        status: "connected",
        enabled: true,
      });

      const tools = [];

      for (const conn of connections) {
        const catalog = getIntegrationById(conn.integrationId);
        if (!catalog || !catalog.tools) continue;

        for (const tool of catalog.tools) {
          // Check if user disabled this specific tool
          const userSetting = conn.toolSettings?.get(tool.name) || conn.toolSettings?.get(tool.fullName);
          if (userSetting && userSetting.enabled === false) continue;

          let requiresApproval = tool.requiresApproval ?? tool.writeOperation;
          if (userSetting?.permission === "always_ask") {
            requiresApproval = true;
          } else if (userSetting?.permission === "auto" && !tool.destructive) {
            requiresApproval = false;
          }

          tools.push({
            name: tool.fullName,
            rawName: tool.name,
            displayName: `${catalog.name}: ${tool.name.replace(/_/g, " ")}`,
            description: `[${catalog.name}] ${tool.description} (Connected Account: ${conn.accountDisplayName || conn.accountEmail})`,
            serverName: catalog.name,
            integrationId: conn.integrationId,
            connectionId: conn._id.toString(),
            inputSchema: tool.inputSchema,
            requiresApproval,
            isAppIntegration: true,
            accountEmail: conn.accountEmail,
            accountDisplayName: conn.accountDisplayName,
          });
        }
      }

      return tools;
    } catch (err) {
      logger.error({ err, workspaceId, userId, msg: "Failed to load connected app tools" });
      return [];
    }
  }

  /**
   * Executes a tool belonging to a connected app.
   * @param {object} params
   * @param {string} params.workspaceId
   * @param {string} params.userId
   * @param {string} params.toolName
   * @param {object} params.args
   * @param {string} [params.connectionId]
   * @returns {Promise<any>}
   */
  static async executeAppTool({ workspaceId, userId, toolName, args = {}, connectionId }) {
    const started = Date.now();
    let status = "success";
    let result = null;
    let errorMsg = null;
    let integrationId = null;
    let serverName = "Connected App";

    try {
      // Find connection either by direct connectionId or matching integrationId from tool prefix
      let connection = null;
      if (connectionId) {
        connection = await IntegrationConnection.findOne({ _id: connectionId, workspaceId, userId });
      }

      if (!connection) {
        const prefix = toolName.split(".")[0];
        connection = await IntegrationConnection.findOne({
          workspaceId,
          userId,
          integrationId: prefix,
          status: "connected",
          enabled: true,
        });
      }

      if (!connection) {
        throw new Error(`No active connected account found for tool: ${toolName}. Please connect the app in the Marketplace.`);
      }

      integrationId = connection.integrationId;
      const catalog = getIntegrationById(integrationId);
      if (catalog) serverName = catalog.name;

      // Check token expiration and refresh if necessary
      if (connection.tokenExpiresAt && connection.tokenExpiresAt.getTime() <= Date.now()) {
        const refreshToken = connection.getRefreshToken();
        if (refreshToken) {
          try {
            const connector = getConnector(integrationId);
            const refreshed = await connector.refreshToken(refreshToken);
            connection.setTokens({
              accessToken: refreshed.accessToken,
              refreshToken: refreshed.refreshToken,
              expiresAt: refreshed.expiresAt,
            });
            await connection.save();
          } catch (refreshErr) {
            connection.status = "expired";
            connection.lastError = `Token refresh failed: ${refreshErr.message}`;
            await connection.save();
            throw new Error(`Connected account authentication expired for ${serverName}. Please reconnect.`);
          }
        }
      }

      const connector = getConnector(integrationId);
      result = await connector.executeTool(toolName, args, connection);

      connection.lastUsedAt = new Date();
      connection.lastError = null;
      await connection.save();

      return result;
    } catch (err) {
      status = "error";
      errorMsg = err.message;
      throw err;
    } finally {
      const durationMs = Date.now() - started;
      try {
        await McpExecution.create({
          workspaceId,
          userId,
          toolName,
          serverName,
          args,
          status,
          durationMs,
          resultSummary: result ? JSON.stringify(result).slice(0, 500) : null,
          error: errorMsg,
        });
      } catch (logErr) {
        logger.warn({ logErr, msg: "Failed to log app execution record" });
      }
    }
  }
}
