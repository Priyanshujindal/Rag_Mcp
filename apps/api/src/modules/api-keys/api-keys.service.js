import crypto from "crypto";
import AppError from "../../utils/app-error.js";
import { ApiKey, ApiKeyUsageLog, Chatbot } from "../../db/models/index.js";
import logger from "../../utils/logger.js";

const PEPPER = process.env.PLATFORM_KEY_PEPPER || "rag_mcp_platform_pepper_secret_2026";

/**
 * Computes a secure HMAC-SHA-256 hash using the server-side pepper.
 * @param {string} rawKey
 * @returns {string} Hex-encoded hash
 */
export function hashApiKey(rawKey) {
  return crypto.createHmac("sha256", PEPPER).update(rawKey).digest("hex");
}

export const apiKeysService = {
  /**
   * Generates a cryptographically secure API key pair (secret + metadata)
   * @param {"publishable"|"secret"|"legacy"} keyType
   * @returns {{ secret: string, prefix: string, maskedKey: string, keyHash: string }}
   */
  generateKey(keyType = "secret") {
    let prefix = "rag_sk_live_";
    let byteLen = 24;

    if (keyType === "publishable") {
      prefix = "rag_pk_live_";
      byteLen = 24;
    } else if (keyType === "secret") {
      prefix = "rag_sk_live_";
      byteLen = 24;
    } else if (keyType === "legacy") {
      prefix = "ragmcp_live_";
      byteLen = 16; // exactly 32 hex chars
    }

    const randomHex = crypto.randomBytes(byteLen).toString("hex");
    const secret = `${prefix}${randomHex}`;
    const maskedKey = `${prefix}${"•".repeat(12)}${randomHex.slice(-4)}`;
    const keyHash = hashApiKey(secret);

    return {
      secret,
      prefix,
      maskedKey,
      keyHash,
    };
  },

  /**
   * List all platform API keys for a workspace with populated chatbot details
   * @param {string} workspaceId
   * @returns {Promise<Array<object>>}
   */
  async list(workspaceId) {
    const keys = await ApiKey.find({ workspaceId })
      .populate("chatbotId", "name publicId status")
      .sort("-createdAt");

    return keys.map((key) => {
      const json = key.toJSON();
      delete json.keyHash;
      return json;
    });
  },

  /**
   * Get safe metadata for a specific key
   */
  async getById(workspaceId, id) {
    const key = await ApiKey.findOne({ _id: id, workspaceId }).populate(
      "chatbotId",
      "name publicId status"
    );
    if (!key) {
      throw AppError.notFound("API key not found");
    }
    const json = key.toJSON();
    delete json.keyHash;
    return json;
  },

  /**
   * Create a new scoped platform API key
   * @param {string} workspaceId
   * @param {string} userId
   * @param {object} payload
   */
  async create(workspaceId, userId, {
    name,
    keyType: rawKeyType,
    chatbotId,
    allowedOrigins = [],
    expiresInDays = null,
    rateLimit = {},
  }) {
    if (!name || typeof name !== "string" || !name.trim()) {
      throw AppError.badRequest("API key name is required");
    }

    const keyType = rawKeyType || (chatbotId ? "secret" : "legacy");
    if (!["publishable", "secret", "legacy"].includes(keyType)) {
      throw AppError.badRequest("Key type must be either 'publishable' or 'secret'");
    }

    // Chatbot scoping: strictly verify chatbot belongs to this workspace
    let verifiedChatbot = null;
    if (chatbotId) {
      verifiedChatbot = await Chatbot.findOne({
        _id: chatbotId,
        workspaceId,
      });
      if (!verifiedChatbot) {
        throw AppError.badRequest("Selected chatbot does not exist in this workspace");
      }
    } else {
      // Auto-link to first chatbot in workspace if none explicitly passed
      verifiedChatbot = await Chatbot.findOne({ workspaceId }).sort("createdAt");
    }

    // Clean & normalize allowed origins
    let origins = Array.isArray(allowedOrigins) ? allowedOrigins : [];
    origins = origins
      .map((o) => (typeof o === "string" ? o.trim() : ""))
      .filter(Boolean);

    // Default localhost for publishable keys in development if list is empty
    if (keyType === "publishable" && origins.length === 0) {
      origins = ["http://localhost:3000", "http://localhost:5173"];
    }

    // Calculate expiration if specified
    let expiresAt = null;
    if (expiresInDays && Number(expiresInDays) > 0) {
      expiresAt = new Date(Date.now() + Number(expiresInDays) * 86400000);
    }

    const { secret, prefix, maskedKey, keyHash } = this.generateKey(keyType);

    const apiKey = await ApiKey.create({
      workspaceId,
      userId,
      chatbotId: verifiedChatbot ? verifiedChatbot._id : null,
      name: name.trim(),
      keyType: keyType === "legacy" ? "secret" : keyType,
      prefix,
      maskedKey,
      keyHash,
      allowedOrigins: origins,
      permissions: keyType === "publishable" ? ["chat:read", "chat:write"] : ["chat:read", "chat:write", "admin:query"],
      status: "active",
      rateLimit: {
        requestsPerMinute: Number(rateLimit.requestsPerMinute) || (keyType === "publishable" ? 60 : 120),
        requestsPerHour: Number(rateLimit.requestsPerHour) || (keyType === "publishable" ? 1000 : 5000),
      },
      expiresAt,
    });

    const keyJson = apiKey.toJSON();
    delete keyJson.keyHash;

    if (verifiedChatbot) {
      keyJson.chatbot = {
        id: verifiedChatbot._id.toString(),
        name: verifiedChatbot.name,
        publicId: verifiedChatbot.publicId,
        status: verifiedChatbot.status,
      };
    }

    logger.info(
      { apiKeyId: apiKey._id, keyType, chatbotId: apiKey.chatbotId },
      "Created new platform API key"
    );

    // Full secret returned ONCE only at creation
    return {
      apiKey: keyJson,
      secret,
    };
  },

  /**
   * Update API key metadata, allowed domains, status, or rate limits
   */
  async update(workspaceId, id, { name, allowedOrigins, status, rateLimit }) {
    const updates = {};
    if (name && typeof name === "string") updates.name = name.trim();
    if (Array.isArray(allowedOrigins)) {
      updates.allowedOrigins = allowedOrigins.map((o) => (typeof o === "string" ? o.trim() : "")).filter(Boolean);
    }
    if (status && ["active", "disabled"].includes(status)) {
      updates.status = status;
    }
    if (rateLimit && typeof rateLimit === "object") {
      if (rateLimit.requestsPerMinute) updates["rateLimit.requestsPerMinute"] = Number(rateLimit.requestsPerMinute);
      if (rateLimit.requestsPerHour) updates["rateLimit.requestsPerHour"] = Number(rateLimit.requestsPerHour);
    }

    const key = await ApiKey.findOneAndUpdate(
      { _id: id, workspaceId },
      { $set: updates },
      { new: true }
    ).populate("chatbotId", "name publicId status");

    if (!key) {
      throw AppError.notFound("API key not found");
    }

    const json = key.toJSON();
    delete json.keyHash;
    return json;
  },

  /**
   * Revoke an API key immediately
   */
  async revoke(workspaceId, id) {
    const key = await ApiKey.findOneAndUpdate(
      { _id: id, workspaceId },
      { $set: { status: "revoked", revokedAt: new Date() } },
      { new: true }
    ).populate("chatbotId", "name publicId status");

    if (!key) {
      throw AppError.notFound("API key not found");
    }

    logger.info({ apiKeyId: key._id }, "Platform API key revoked");

    const json = key.toJSON();
    delete json.keyHash;
    return json;
  },

  /**
   * Rotate key: revokes existing secret and issues a brand-new cryptographically secure secret
   */
  async rotate(workspaceId, id) {
    const existing = await ApiKey.findOne({ _id: id, workspaceId });
    if (!existing) {
      throw AppError.notFound("API key not found");
    }

    const { secret, prefix, maskedKey, keyHash } = this.generateKey(existing.keyType);

    existing.prefix = prefix;
    existing.maskedKey = maskedKey;
    existing.keyHash = keyHash;
    existing.status = "active";
    existing.revokedAt = null;
    await existing.save();

    await existing.populate("chatbotId", "name publicId status");

    logger.info({ apiKeyId: existing._id }, "Platform API key rotated");

    const json = existing.toJSON();
    delete json.keyHash;

    return {
      apiKey: json,
      secret, // Returned ONCE only upon rotation
    };
  },

  /**
   * Delete an API key permanently
   */
  async delete(workspaceId, id) {
    const key = await ApiKey.findOneAndDelete({ _id: id, workspaceId });
    if (!key) {
      throw AppError.notFound("API key not found");
    }

    // Clean up associated usage logs asynchronously
    ApiKeyUsageLog.deleteMany({ apiKeyId: id }).catch((err) =>
      logger.warn({ err: err.message }, "Could not clean up ApiKeyUsageLog records")
    );

    return { success: true };
  },

  /**
   * Fetch usage analytics and logs for a specific key
   */
  async getUsage(workspaceId, id, limit = 50) {
    const key = await ApiKey.findOne({ _id: id, workspaceId });
    if (!key) {
      throw AppError.notFound("API key not found");
    }

    const logs = await ApiKeyUsageLog.find({ apiKeyId: id })
      .sort("-createdAt")
      .limit(Number(limit) || 50);

    return {
      summary: key.usage || {},
      lastUsedAt: key.lastUsedAt,
      lastUsedIp: key.lastUsedIp,
      lastUsedOrigin: key.lastUsedOrigin,
      recentLogs: logs.map((l) => l.toJSON()),
    };
  },

  /**
   * Authenticate and verify incoming raw API key from external caller
   * @param {string} rawKey - Full token provided by caller (starts with rag_pk_ or rag_sk_)
   * @returns {Promise<{ valid: boolean, apiKey: object, keyType: string, workspaceId: string, chatbot: object }>}
   */
  async verifyKey(rawKey) {
    if (!rawKey || typeof rawKey !== "string") {
      throw AppError.unauthorized("Missing API key");
    }

    const cleanKey = rawKey.trim();
    if (!cleanKey.startsWith("rag_pk_") && !cleanKey.startsWith("rag_sk_")) {
      // Backwards-compatibility fallback for legacy keys if any
      if (!cleanKey.startsWith("ragmcp_live_")) {
        throw AppError.unauthorized("Invalid API key format. Expected rag_pk_... or rag_sk_...");
      }
    }

    // Hash with server pepper
    const computedHash = cleanKey.startsWith("ragmcp_live_")
      ? crypto.createHash("sha256").update(cleanKey).digest("hex")
      : hashApiKey(cleanKey);

    const keyDoc = await ApiKey.findOne({ keyHash: computedHash });
    if (!keyDoc) {
      throw AppError.unauthorized("Invalid or unrecognized API key");
    }

    if (keyDoc.status === "revoked") {
      throw AppError.unauthorized("API key has been revoked");
    }

    if (keyDoc.status === "disabled") {
      throw AppError.unauthorized("API key has been temporarily disabled by owner");
    }

    if (keyDoc.expiresAt && keyDoc.expiresAt.getTime() <= Date.now()) {
      throw AppError.unauthorized("API key has expired");
    }

    // Resolve associated Chatbot document
    let chatbot = null;
    if (keyDoc.chatbotId) {
      chatbot = await Chatbot.findById(keyDoc.chatbotId);
      if (!chatbot) {
        throw AppError.badRequest("The chatbot linked to this API key no longer exists");
      }
    }

    return {
      valid: true,
      apiKey: keyDoc,
      keyType: keyDoc.keyType || (cleanKey.startsWith("rag_pk_") ? "publishable" : "secret"),
      workspaceId: keyDoc.workspaceId.toString(),
      chatbot,
    };
  },

  /**
   * Asynchronously records API request metrics and telemetry
   */
  recordUsage({
    apiKeyId,
    workspaceId,
    chatbotId,
    keyType,
    endpoint,
    statusCode,
    durationMs = 0,
    inputTokens = 0,
    outputTokens = 0,
    origin = null,
    ip = null,
  }) {
    if (!apiKeyId) return;

    const isSuccess = statusCode >= 200 && statusCode < 400;
    const isRateLimited = statusCode === 429;

    const incUpdates = {
      "usage.totalRequests": 1,
      "usage.totalInputTokens": inputTokens || 0,
      "usage.totalOutputTokens": outputTokens || 0,
    };

    if (isSuccess) {
      incUpdates["usage.successfulRequests"] = 1;
    } else if (isRateLimited) {
      incUpdates["usage.rateLimitedRequests"] = 1;
    } else {
      incUpdates["usage.failedRequests"] = 1;
    }

    ApiKey.updateOne(
      { _id: apiKeyId },
      {
        $inc: incUpdates,
        $set: {
          lastUsedAt: new Date(),
          lastUsedIp: ip,
          lastUsedOrigin: origin,
        },
      }
    ).catch((err) => logger.warn({ err: err.message }, "Failed to update ApiKey usage summary"));

    ApiKeyUsageLog.create({
      workspaceId,
      apiKeyId,
      chatbotId,
      keyType,
      endpoint,
      statusCode,
      durationMs,
      inputTokens,
      outputTokens,
      origin,
      ip,
    }).catch((err) => logger.warn({ err: err.message }, "Failed to write ApiKeyUsageLog"));
  },
};

export default apiKeysService;
