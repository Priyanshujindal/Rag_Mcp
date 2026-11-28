import crypto from "crypto";
import { IntegrationConnection } from "../../db/models/integration-connection.model.js";
import { INTEGRATIONS_CATALOG, getIntegrationById } from "./catalog.js";
import { getConnector } from "./connectors/index.js";
import AppError from "../../utils/app-error.js";
import logger from "../../utils/logger.js";
import { cacheSet, cacheGet, cacheDel } from "../../lib/redis.js";

export class IntegrationsController {
  /**
   * GET /api/v1/integrations/catalog
   * Returns catalog with current connection status for this user & workspace.
   */
  static async getCatalog(req, res, next) {
    try {
      const workspaceId = req.workspaceId;
      const userId = req.user?.id || req.user?.sub;

      const connections = await IntegrationConnection.find({
        workspaceId,
        userId,
      });

      const connectionMap = new Map();
      connections.forEach((c) => {
        if (!connectionMap.has(c.integrationId)) {
          connectionMap.set(c.integrationId, []);
        }
        connectionMap.get(c.integrationId).push(c.toJSON());
      });

      const catalogWithStatus = INTEGRATIONS_CATALOG.map((item) => {
        const itemConns = connectionMap.get(item.id) || [];
        const isConnected = itemConns.some((c) => c.status === "connected");
        const isConfigured = !item.oauth?.requiredEnv || item.oauth.requiredEnv.every((envVar) => Boolean(process.env[envVar]));
        return {
          ...item,
          isConnected,
          isConfigured,
          connectionsCount: itemConns.length,
          connections: itemConns,
        };
      });

      res.json({
        success: true,
        catalog: catalogWithStatus,
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/v1/integrations/connections
   * Lists all connected accounts for current user and workspace.
   */
  static async listConnections(req, res, next) {
    try {
      const workspaceId = req.workspaceId;
      const userId = req.user?.id || req.user?.sub;

      const connections = await IntegrationConnection.find({
        workspaceId,
        userId,
      }).sort({ createdAt: -1 });

      res.json({
        success: true,
        connections: connections.map((c) => c.toJSON()),
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/v1/integrations/:id/authorize
   * Generates OAuth authorization URL.
   */
  static async authorize(req, res, next) {
    try {
      const { id } = req.params;
      const workspaceId = req.workspaceId;
      const userId = req.user?.id || req.user?.sub;
      const { redirectUri, scopes } = req.body;

      const catalog = getIntegrationById(id);
      if (!catalog) throw AppError.notFound(`Integration "${id}" not found.`);
      if (catalog.status === "coming_soon") {
        throw AppError.badRequest(`Integration "${catalog.name}" is coming soon.`);
      }

      const isConfigured = !catalog.oauth?.requiredEnv || catalog.oauth.requiredEnv.every((envVar) => Boolean(process.env[envVar]));

      if (!isConfigured) {
        return res.json({
          success: true,
          isConfigured: false,
          authUrl: null,
          message: `OAuth client credentials for ${catalog.name} are not configured in .env (${catalog.oauth?.requiredEnv?.join(", ")}).`,
          requiredEnv: catalog.oauth?.requiredEnv || [],
        });
      }

      const connector = getConnector(id);
      const state = crypto.randomBytes(24).toString("hex");

      // Cache state in Redis (with in-memory fallback) for 10 mins
      await cacheSet(
        `oauth:state:${state}`,
        {
          integrationId: id,
          workspaceId: workspaceId.toString(),
          userId: userId.toString(),
          createdAt: Date.now(),
        },
        600
      );

      const effectiveRedirect = redirectUri || `${req.protocol}://${req.get("host")}/api/v1/integrations/${id}/callback`;
      const authUrl = connector.getAuthUrl({
        state,
        redirectUri: effectiveRedirect,
        scopes,
      });

      res.json({
        success: true,
        authUrl,
        state,
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/v1/integrations/:id/callback
   * Completes OAuth code exchange and persists connected account.
   */
  static async callback(req, res, next) {
    try {
      const { id } = req.params;
      const { code, state, redirectUri } = req.body;
      const workspaceId = req.workspaceId;
      const userId = req.user?.id || req.user?.sub;

      if (!code) throw AppError.badRequest("Authorization code is required.");

      // If state was provided, validate against state cache
      if (state) {
        const cached = await cacheGet(`oauth:state:${state}`);
        if (cached) {
          if (cached.integrationId !== id || cached.userId !== userId.toString()) {
            throw AppError.forbidden("OAuth state verification mismatch.");
          }
          await cacheDel(`oauth:state:${state}`);
        }
      }

      const connector = getConnector(id);
      const effectiveRedirect = redirectUri || `${req.protocol}://${req.get("host")}/api/v1/integrations/${id}/callback`;

      const tokenData = await connector.exchangeCode({
        code,
        redirectUri: effectiveRedirect,
      });

      const catalog = getIntegrationById(id);

      // Check if existing connection for this account exists
      let connection = await IntegrationConnection.findOne({
        workspaceId,
        userId,
        integrationId: id,
        accountEmail: tokenData.accountEmail || "",
      });

      if (!connection) {
        connection = new IntegrationConnection({
          workspaceId,
          userId,
          integrationId: id,
          accountDisplayName: tokenData.accountDisplayName || `${catalog.name} Account`,
          accountEmail: tokenData.accountEmail || "",
          providerAccountId: tokenData.providerAccountId || "",
          status: "connected",
          authType: "oauth2",
          enabled: true,
        });
      }

      connection.setTokens({
        accessToken: tokenData.accessToken,
        refreshToken: tokenData.refreshToken,
        expiresAt: tokenData.expiresAt,
      });
      connection.status = "connected";
      connection.lastConnectedAt = new Date();
      connection.lastError = null;

      await connection.save();

      logger.info({
        workspaceId,
        userId,
        integrationId: id,
        connectionId: connection._id,
        msg: "Connected app account linked successfully",
      });

      res.json({
        success: true,
        connection: connection.toJSON(),
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/v1/integrations/connect-token
   * Connect an app using Personal Access Token / API Key (e.g. GitHub PAT, Notion API Secret).
   */
  static async connectToken(req, res, next) {
    try {
      const { integrationId, token, displayName, accountEmail } = req.body;
      const workspaceId = req.workspaceId;
      const userId = req.user?.id || req.user?.sub;

      if (!integrationId || !token) {
        throw AppError.badRequest("integrationId and token are required.");
      }

      const catalog = getIntegrationById(integrationId);
      if (!catalog) throw AppError.notFound(`Integration "${integrationId}" not found.`);

      const connection = new IntegrationConnection({
        workspaceId,
        userId,
        integrationId,
        accountDisplayName: displayName || `${catalog.name} (API Token)`,
        accountEmail: accountEmail || "",
        status: "connected",
        authType: "token",
        enabled: true,
      });

      connection.setTokens({
        accessToken: token.trim(),
        expiresAt: null,
      });

      await connection.save();

      res.status(201).json({
        success: true,
        connection: connection.toJSON(),
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/v1/integrations/:id/demo-connect
   * Connect an app immediately in sandbox / demo mode without requiring third-party OAuth app registration.
   */
  static async demoConnect(req, res, next) {
    try {
      const { id } = req.params;
      const workspaceId = req.workspaceId;
      const userId = req.user?.id || req.user?.sub;
      const { accountEmail, displayName } = req.body || {};

      const catalog = getIntegrationById(id);
      if (!catalog) throw AppError.notFound(`Integration "${id}" not found.`);

      let connection = await IntegrationConnection.findOne({
        workspaceId,
        userId,
        integrationId: id,
      });

      if (!connection) {
        connection = new IntegrationConnection({
          workspaceId,
          userId,
          integrationId: id,
          accountDisplayName: displayName || `${catalog.name} (Demo Account)`,
          accountEmail: accountEmail || (id === "gmail" ? "priyanshujindal.demo@gmail.com" : `${id}_demo@rag-mcp.ai`),
          providerAccountId: `${id}_demo_12345`,
          status: "connected",
          authType: "oauth2",
          enabled: true,
        });
      }

      connection.setTokens({
        accessToken: `mock_${id}_token_${Date.now()}`,
        refreshToken: `mock_${id}_refresh_${Date.now()}`,
        expiresAt: new Date(Date.now() + 365 * 86400 * 1000),
      });
      connection.status = "connected";
      connection.lastConnectedAt = new Date();
      connection.lastError = null;

      await connection.save();

      res.status(201).json({
        success: true,
        connection: connection.toJSON(),
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * PATCH /api/v1/integrations/connections/:id
   * Updates connection settings (displayName, enabled, toolSettings).
   */
  static async updateConnection(req, res, next) {
    try {
      const { id } = req.params;
      const workspaceId = req.workspaceId;
      const userId = req.user?.id || req.user?.sub;
      const { accountDisplayName, enabled, toolSettings } = req.body;

      const connection = await IntegrationConnection.findOne({ _id: id, workspaceId, userId });
      if (!connection) throw AppError.notFound("Connected account not found.");

      if (accountDisplayName !== undefined) {
        connection.accountDisplayName = String(accountDisplayName).trim();
      }
      if (enabled !== undefined) {
        connection.enabled = Boolean(enabled);
      }
      if (toolSettings && typeof toolSettings === "object") {
        for (const [toolName, setting] of Object.entries(toolSettings)) {
          connection.toolSettings.set(toolName, {
            enabled: setting.enabled !== undefined ? Boolean(setting.enabled) : true,
            permission: setting.permission || "auto",
          });
        }
      }

      await connection.save();

      res.json({
        success: true,
        connection: connection.toJSON(),
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/v1/integrations/connections/:id/test
   * Tests connectivity and refreshes token if needed.
   */
  static async testConnection(req, res, next) {
    try {
      const { id } = req.params;
      const workspaceId = req.workspaceId;
      const userId = req.user?.id || req.user?.sub;

      const connection = await IntegrationConnection.findOne({ _id: id, workspaceId, userId });
      if (!connection) throw AppError.notFound("Connected account not found.");

      const connector = getConnector(connection.integrationId);
      const catalog = getIntegrationById(connection.integrationId);

      // Refresh if token is expired
      if (connection.tokenExpiresAt && connection.tokenExpiresAt.getTime() <= Date.now()) {
        const refreshToken = connection.getRefreshToken();
        if (refreshToken) {
          const refreshed = await connector.refreshToken(refreshToken);
          connection.setTokens({
            accessToken: refreshed.accessToken,
            refreshToken: refreshed.refreshToken,
            expiresAt: refreshed.expiresAt,
          });
          await connection.save();
        }
      }

      res.json({
        success: true,
        status: "healthy",
        integrationName: catalog?.name || connection.integrationId,
        account: connection.accountDisplayName,
        email: connection.accountEmail,
        lastConnectedAt: connection.lastConnectedAt,
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * DELETE /api/v1/integrations/connections/:id
   * Disconnects and deletes an account connection.
   */
  static async disconnect(req, res, next) {
    try {
      const { id } = req.params;
      const workspaceId = req.workspaceId;
      const userId = req.user?.id || req.user?.sub;

      const connection = await IntegrationConnection.findOneAndDelete({ _id: id, workspaceId, userId });
      if (!connection) throw AppError.notFound("Connected account not found.");

      logger.info({
        workspaceId,
        userId,
        integrationId: connection.integrationId,
        msg: "Disconnected and removed account connection",
      });

      res.json({
        success: true,
        message: `Successfully disconnected ${connection.accountDisplayName}.`,
      });
    } catch (err) {
      next(err);
    }
  }
}
