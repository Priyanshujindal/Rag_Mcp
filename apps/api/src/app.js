import crypto from "crypto";
import express from "express";
import helmet from "helmet";
import cors from "cors";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import pinoHttp from "pino-http";
import mongoose from "mongoose";
import { z } from "zod";

import config from "./config/index.js";
import logger from "./utils/logger.js";
import { notFoundHandler, errorHandler } from "./middleware/error.middleware.js";
import { noSqlDefenseMiddleware } from "./middleware/nosql-defense.middleware.js";
import { validate, objectIdSchema } from "./middleware/validation.middleware.js";

// Module routes
import authRoutes from "./modules/auth/auth.routes.js";
import kbRoutes from "./modules/knowledge-bases/kb.routes.js";
import sourcesRoutes from "./modules/documents/sources.routes.js";
import chatbotsRoutes from "./modules/chatbots/chatbots.routes.js";
import apiKeysRoutes from "./modules/api-keys/api-keys.routes.js";
import mcpRoutes from "./modules/mcp/mcp.routes.js";
import usageRoutes from "./modules/analytics/usage.routes.js";
import analyticsRoutes from "./modules/analytics/analytics.routes.js";
import conversationsRoutes from "./modules/conversations/conversations.routes.js";
import webhooksRoutes from "./modules/webhooks/webhooks.routes.js";
import publicApiRoutes from "./modules/public-api/v1.routes.js";
import chatRoutes from "./modules/chat/chat.routes.js";
import evalsRoutes from "./modules/evals/evals.routes.js";
import artifactsRoutes from "./modules/artifacts/artifacts.routes.js";

/**
 * Builds and configures the Express application
 */
export function createApp() {
  const app = express();

  // 0. Trust Proxy (never trust X-Forwarded-For by default)
  if (config.TRUST_PROXY === "true" || config.TRUST_PROXY === true) {
    app.set("trust proxy", true);
  } else if (!isNaN(Number(config.TRUST_PROXY)) && Number(config.TRUST_PROXY) > 0) {
    app.set("trust proxy", Number(config.TRUST_PROXY));
  } else if (typeof config.TRUST_PROXY === "string" && config.TRUST_PROXY !== "false" && config.TRUST_PROXY !== "0") {
    app.set("trust proxy", config.TRUST_PROXY);
  } else {
    app.set("trust proxy", false);
  }

  // 1. Security Headers
  app.use(helmet());

  // 2. CORS configuration restricted to WEB_ORIGIN with credentials
  const allowedOrigins = (config.WEB_ORIGIN || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin) return callback(null, true);
        if (allowedOrigins.includes(origin)) {
          return callback(null, true);
        }
        return callback(null, false);
      },
      credentials: true,
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization", "X-Request-Id", "X-Workspace-Id"],
    })
  );

  // 3. Request ID middleware
  app.use((req, res, next) => {
    const reqId = req.headers["x-request-id"] || crypto.randomUUID();
    req.id = reqId;
    res.setHeader("X-Request-Id", reqId);
    next();
  });

  // 4. Request logging
  if (config.NODE_ENV !== "test") {
    app.use(
      pinoHttp({
        logger,
        genReqId: (req) => req.id,
      })
    );
  }

  // 5. Global Rate Limiter
  const globalRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: config.NODE_ENV === "test" ? 10000 : 200,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      error: {
        code: "TOO_MANY_REQUESTS",
        message: "Too many requests. Please try again later.",
      },
    },
  });
  app.use(globalRateLimiter);

  // 6. Body Parsers with 1MB limit
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: true, limit: "1mb" }));
  app.use(cookieParser());

  // 7. NoSQL Injection Defense (inspects body, query, params)
  app.use(noSqlDefenseMiddleware);

  // 8. Health and Readiness probes
  app.get("/health", (_req, res) => {
    res.status(200).json({
      status: "ok",
      timestamp: new Date().toISOString(),
    });
  });

  app.get("/ready", async (_req, res) => {
    try {
      const isConnected = mongoose.connection.readyState === 1;
      if (!isConnected) {
        return res.status(503).json({
          status: "unavailable",
          db: "disconnected",
        });
      }
      // Ping database
      await mongoose.connection.db.admin().ping();
      return res.status(200).json({
        status: "ready",
        db: "connected",
      });
    } catch (err) {
      return res.status(503).json({
        status: "unavailable",
        db: "error",
        message: err.message,
      });
    }
  });

  // Stage 1 test verification endpoints for validation & objectId
  app.get(
    "/api/v1/test-resource/:id",
    validate({
      params: z.object({
        id: objectIdSchema,
      }).strict(),
    }),
    (req, res) => {
      res.status(200).json({ success: true, id: req.params.id });
    }
  );

  app.post(
    "/api/v1/test-resource",
    validate({
      body: z.object({
        name: z.string().min(1),
        count: z.number().optional(),
      }).strict(),
    }),
    (req, res) => {
      res.status(201).json({ success: true, data: req.body });
    }
  );

  // 9. API v1 Module Routes
  app.use("/api/v1/auth", authRoutes);
  app.use("/api/v1/knowledge-bases", kbRoutes);
  app.use("/api/v1/sources", sourcesRoutes);
  app.use("/api/v1/chatbots", chatbotsRoutes);
  app.use("/api/v1/api-keys", apiKeysRoutes);
  app.use("/api/v1/mcp", mcpRoutes);
  app.use("/api/v1/usage", usageRoutes);
  app.use("/api/v1/chat", chatRoutes);
  app.use("/api/v1/evals", evalsRoutes);
  app.use("/api/v1/artifacts", artifactsRoutes);

  // 10. Minimal 501 Stubs
  app.use("/api/v1/analytics", analyticsRoutes);
  app.use("/api/v1/conversations", conversationsRoutes);
  app.use("/api/v1/webhooks", webhooksRoutes);
  app.use("/api/v1/public", publicApiRoutes);

  // 11. 404 Handler
  app.use(notFoundHandler);

  // 12. Central Error Handler
  app.use(errorHandler);

  return app;
}

export const app = createApp();
export default app;

