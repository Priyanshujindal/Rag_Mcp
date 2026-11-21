import apiKeysService from "../modules/api-keys/api-keys.service.js";
import usageService from "../modules/usage/usage.service.js";
import { Chatbot } from "../db/models/index.js";
import AppError from "../utils/app-error.js";

/**
 * Middleware for authenticating platform API keys (rag_pk_ / rag_sk_) on public endpoints.
 * @param {object} options
 * @param {Array<"publishable"|"secret">} [options.allowedKeyTypes]
 * @param {boolean} [options.requireChatbotScope]
 */
export function authenticatePublicApiKey(
  options = { allowedKeyTypes: ["publishable", "secret"], requireChatbotScope: true }
) {
  const allowedKeyTypes = options.allowedKeyTypes || ["publishable", "secret"];

  return async (req, res, next) => {
    try {
      const startTime = Date.now();

      // 1. Extract API key from headers or query
      let rawKey = null;
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith("Bearer ")) {
        rawKey = authHeader.slice(7).trim();
      } else if (req.headers["x-api-key"]) {
        rawKey = String(req.headers["x-api-key"]).trim();
      } else if (req.headers["x-publishable-key"]) {
        rawKey = String(req.headers["x-publishable-key"]).trim();
      } else if (req.query.apiKey) {
        rawKey = String(req.query.apiKey).trim();
      }

      if (!rawKey) {
        return next(
          AppError.unauthorized(
            "Authentication required. Please provide a valid platform API key via Authorization: Bearer <key> or x-api-key header."
          )
        );
      }

      // 2. Verify key authenticity, status and expiration
      const { apiKey, keyType, workspaceId, chatbot } = await apiKeysService.verifyKey(rawKey);

      // 3. Verify key type permitted for this endpoint
      if (!allowedKeyTypes.includes(keyType)) {
        return next(
          AppError.forbidden(
            `Key type '${keyType}' is not authorized for this endpoint. Required: ${allowedKeyTypes.join(" or ")}.`
          )
        );
      }

      // 4. Chatbot scoping validation
      const requestedChatbotIdentifier = req.params.chatbotId || req.params.publicId;
      let targetChatbot = chatbot;

      if (requestedChatbotIdentifier) {
        if (targetChatbot) {
          const matchesId = targetChatbot._id.toString() === requestedChatbotIdentifier;
          const matchesPublicId = targetChatbot.publicId === requestedChatbotIdentifier;

          if (!matchesId && !matchesPublicId) {
            return next(
              AppError.forbidden("Access denied: API key is not authorized for the requested chatbot.")
            );
          }
        } else {
          // If key had no pre-bound chatbot, resolve within workspace
          targetChatbot = await Chatbot.findOne({
            workspaceId,
            $or: [{ _id: requestedChatbotIdentifier }, { publicId: requestedChatbotIdentifier }],
          });

          if (!targetChatbot) {
            return next(AppError.notFound("Chatbot not found"));
          }
        }
      }

      // 5. Ensure chatbot is active/available and external API is enabled
      if (targetChatbot) {
        const botStatus = (targetChatbot.status || "").toUpperCase();
        if (botStatus === "PAUSED") {
          return next(AppError.forbidden("The requested chatbot is currently paused."));
        }
        if (targetChatbot.externalApiEnabled === false) {
          return next(AppError.forbidden("External API access is disabled for this chatbot."));
        }
      }

      // 6. Allowed origin validation for publishable keys
      if (keyType === "publishable") {
        const origin = req.headers.origin || req.headers.referer;
        if (
          apiKey.allowedOrigins &&
          Array.isArray(apiKey.allowedOrigins) &&
          apiKey.allowedOrigins.length > 0 &&
          !apiKey.allowedOrigins.includes("*")
        ) {
          let originMatches = false;
          if (origin) {
            try {
              const url = new URL(origin);
              const hostOrigin = `${url.protocol}//${url.host}`;
              originMatches = apiKey.allowedOrigins.some(
                (allowed) => allowed === hostOrigin || allowed === origin || allowed === url.host
              );
            } catch {
              originMatches = apiKey.allowedOrigins.includes(origin);
            }
          } else {
            // Allow direct CLI/cURL testing in development when Origin header is omitted
            originMatches = true;
          }

          if (!originMatches) {
            return next(
              AppError.forbidden(
                `Origin '${origin || "unknown"}' is not permitted by this publishable API key's allowed domains.`
              )
            );
          }
        }
      }

      // 7. Attach to request
      req.apiKey = apiKey;
      req.keyType = keyType;
      req.workspaceId = workspaceId;
      req.chatbot = targetChatbot;

      // 8. Hook response to record usage analytics
      res.on("finish", () => {
        const durationMs = Date.now() - startTime;
        apiKeysService.recordUsage({
          apiKeyId: apiKey._id,
          workspaceId,
          chatbotId: targetChatbot?._id,
          keyType,
          endpoint: req.originalUrl || req.path,
          statusCode: res.statusCode,
          durationMs,
          inputTokens: res.locals?.inputTokens || 0,
          outputTokens: res.locals?.outputTokens || 0,
          origin: req.headers.origin || null,
          ip: req.ip || req.socket?.remoteAddress || null,
        });

        usageService.recordEvent({
          workspaceId,
          apiKeyId: apiKey._id,
          chatbotId: targetChatbot?._id,
          eventType: "public_api.request",
          category: "public_api",
          status: res.statusCode >= 400 ? (res.statusCode === 429 ? "rate_limited" : "failed") : "success",
          durationMs,
          tokens: {
            promptTokens: res.locals?.inputTokens || 0,
            completionTokens: res.locals?.outputTokens || 0,
          },
        });
      });

      next();
    } catch (err) {
      next(err);
    }
  };
}

export default authenticatePublicApiKey;
