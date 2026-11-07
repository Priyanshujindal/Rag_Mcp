import { describe, it, expect } from "vitest";
import request from "supertest";
import express from "express";
import { validateEnv } from "../src/config/index.js";
import {
  createLoginLimiter,
  createLoginEmailLimiter,
  createRegisterLimiter,
  createRefreshLimiter,
} from "../src/middleware/rate-limit.middleware.js";
import app from "../src/app.js";

describe("Fix Pass Test Suite", () => {
  describe("Step 3: Unsafe Config Defaults & Strict Production Validation", () => {
    it("fails in every environment when MONGODB_URI is missing", () => {
      // Missing in development
      expect(() => validateEnv({ NODE_ENV: "development" })).toThrow(
        /MONGODB_URI is required and must start with "mongodb:\/\/" or "mongodb\+srv:\/\/"/
      );
      // Missing in test
      expect(() => validateEnv({ NODE_ENV: "test" })).toThrow(
        /MONGODB_URI is required and must start with "mongodb:\/\/" or "mongodb\+srv:\/\/"/
      );
      // Missing in production
      expect(() =>
        validateEnv({
          NODE_ENV: "production",
          JWT_ACCESS_SECRET: "a".repeat(32),
          JWT_REFRESH_SECRET: "b".repeat(32),
          INTERNAL_API_KEY: "c".repeat(32),
          WEB_ORIGIN: "https://rag-mcp.ai",
        })
      ).toThrow(/MONGODB_URI is required/);
    });

    it("fails when MONGODB_URI does not start with mongodb:// or mongodb+srv://", () => {
      expect(() =>
        validateEnv({
          NODE_ENV: "development",
          MONGODB_URI: "postgres://user:pass@localhost/db",
        })
      ).toThrow(/See docs\/atlas-setup\.md for setup instructions/);
    });

    it("fails in production when a secret is missing", () => {
      expect(() =>
        validateEnv({
          NODE_ENV: "production",
          MONGODB_URI: "mongodb+srv://user:pass@cluster.mongodb.net",
          WEB_ORIGIN: "https://rag-mcp.ai",
          // missing JWT_ACCESS_SECRET, JWT_REFRESH_SECRET, INTERNAL_API_KEY
        })
      ).toThrow(/JWT_ACCESS_SECRET is required in production/);
    });

    it("fails in production when a secret is shorter than 32 characters", () => {
      expect(() =>
        validateEnv({
          NODE_ENV: "production",
          MONGODB_URI: "mongodb+srv://user:pass@cluster.mongodb.net",
          JWT_ACCESS_SECRET: "short_secret",
          JWT_REFRESH_SECRET: "b".repeat(32),
          INTERNAL_API_KEY: "c".repeat(32),
          WEB_ORIGIN: "https://rag-mcp.ai",
        })
      ).toThrow(/JWT_ACCESS_SECRET must be at least 32 characters long in production/);
    });

    it("fails in production when JWT_ACCESS_SECRET equals JWT_REFRESH_SECRET", () => {
      const sameSecret = "x".repeat(40);
      expect(() =>
        validateEnv({
          NODE_ENV: "production",
          MONGODB_URI: "mongodb+srv://user:pass@cluster.mongodb.net",
          JWT_ACCESS_SECRET: sameSecret,
          JWT_REFRESH_SECRET: sameSecret,
          INTERNAL_API_KEY: "y".repeat(40),
          WEB_ORIGIN: "https://rag-mcp.ai",
        })
      ).toThrow(/JWT_ACCESS_SECRET must differ from JWT_REFRESH_SECRET/);
    });

    it("fails in production when a secret contains 'change_me'", () => {
      expect(() =>
        validateEnv({
          NODE_ENV: "production",
          MONGODB_URI: "mongodb+srv://user:pass@cluster.mongodb.net",
          JWT_ACCESS_SECRET: "super_secure_access_token_change_me_12345",
          JWT_REFRESH_SECRET: "b".repeat(40),
          INTERNAL_API_KEY: "c".repeat(40),
          WEB_ORIGIN: "https://rag-mcp.ai",
        })
      ).toThrow(/must not contain 'change_me'/);
    });

    it("fails in production when a secret starts with 'dev_'", () => {
      expect(() =>
        validateEnv({
          NODE_ENV: "production",
          MONGODB_URI: "mongodb+srv://user:pass@cluster.mongodb.net",
          JWT_ACCESS_SECRET: "dev_access_secret_that_is_quite_long_indeed",
          JWT_REFRESH_SECRET: "b".repeat(40),
          INTERNAL_API_KEY: "c".repeat(40),
          WEB_ORIGIN: "https://rag-mcp.ai",
        })
      ).toThrow(/must not start with 'dev_'/);
    });

    it("fails in production when WEB_ORIGIN is '*' or contains 'localhost'", () => {
      expect(() =>
        validateEnv({
          NODE_ENV: "production",
          MONGODB_URI: "mongodb+srv://user:pass@cluster.mongodb.net",
          JWT_ACCESS_SECRET: "a".repeat(40),
          JWT_REFRESH_SECRET: "b".repeat(40),
          INTERNAL_API_KEY: "c".repeat(40),
          WEB_ORIGIN: "http://localhost:3000",
        })
      ).toThrow(/WEB_ORIGIN must not be '\*' or include 'localhost' in production/);
    });

    it("passes with valid production environment configuration", () => {
      const validConfig = validateEnv({
        NODE_ENV: "production",
        MONGODB_URI: "mongodb+srv://user:pass@cluster.mongodb.net/?retryWrites=true&w=majority",
        MONGODB_DB_NAME: "Rag_Mcp",
        JWT_ACCESS_SECRET: "12345678901234567890123456789012_access",
        JWT_REFRESH_SECRET: "12345678901234567890123456789012_refresh",
        INTERNAL_API_KEY: "12345678901234567890123456789012_internal",
        WEB_ORIGIN: "https://rag-mcp.ai",
      });

      expect(validConfig.NODE_ENV).toBe("production");
      expect(validConfig.WEB_ORIGIN).toBe("https://rag-mcp.ai");
      expect(validConfig.MONGODB_DB_NAME).toBe("Rag_Mcp");
    });
  });

  describe("Step 1 & Step 2: Rate Limiting on Auth Routes", () => {
    it("the 11th FAILED login returns 429, but 15 SUCCESSFUL logins in a row do not", async () => {
      const testApp = express();
      testApp.use(express.json());
      const testLoginLimiter = createLoginLimiter({ max: 10, windowMs: 60000 });

      testApp.post("/login-test", testLoginLimiter, (req, res) => {
        if (req.body.password === "correct") {
          return res.status(200).json({ ok: true });
        }
        return res.status(401).json({ error: "Invalid password" });
      });

      // 15 successful logins in a row do NOT trigger 429 because skipSuccessfulRequests: true
      for (let i = 0; i < 15; i++) {
        const res = await request(testApp)
          .post("/login-test")
          .send({ email: "user@example.com", password: "correct" });
        expect(res.status).toBe(200);
      }

      // 10 failed logins
      for (let i = 0; i < 10; i++) {
        const res = await request(testApp)
          .post("/login-test")
          .send({ email: "user@example.com", password: "wrong" });
        expect(res.status).toBe(401);
      }

      // 11th failed login returns 429
      const blockedRes = await request(testApp)
        .post("/login-test")
        .send({ email: "user@example.com", password: "wrong" });

      expect(blockedRes.status).toBe(429);
      expect(blockedRes.headers).toHaveProperty("retry-after");
      expect(blockedRes.body.error.code).toBe("RATE_LIMITED");
    });

    it("/refresh allows far more than 10 calls (up to 60) and limits are independent between routes", async () => {
      const testApp = express();
      testApp.use(express.json());
      const testRefreshLimiter = createRefreshLimiter({ max: 60, windowMs: 60000 });
      const testRegisterLimiter = createRegisterLimiter({ max: 10, windowMs: 60000 });

      testApp.post("/refresh-test", testRefreshLimiter, (_req, res) => res.status(200).json({ ok: true }));
      testApp.post("/register-test", testRegisterLimiter, (_req, res) => res.status(200).json({ ok: true }));

      // 20 refresh calls in a row succeed (far more than 10)
      for (let i = 0; i < 20; i++) {
        const res = await request(testApp).post("/refresh-test");
        expect(res.status).toBe(200);
      }

      // Register route still works independently
      const regRes = await request(testApp).post("/register-test");
      expect(regRes.status).toBe(200);
    });

    it("Step 2: 21 failed logins for same email from different IPs trigger per-email 429 on 21st, different email unaffected", async () => {
      const testApp = express();
      testApp.set("trust proxy", true);
      testApp.use(express.json());

      const testEmailLimiter = createLoginEmailLimiter({ max: 20, windowMs: 60000 });

      testApp.post("/login-email-test", testEmailLimiter, (_req, res) => {
        return res.status(401).json({ error: "Invalid password" });
      });

      const victimEmail = "victim@example.com";
      const otherEmail = "other@example.com";

      // 20 failed logins from 20 different client IPs
      for (let i = 1; i <= 20; i++) {
        const res = await request(testApp)
          .post("/login-email-test")
          .set("X-Forwarded-For", `192.168.1.${i}`)
          .send({ email: victimEmail, password: "bad" });
        expect(res.status).toBe(401);
      }

      // 21st failed login for victim from a 21st IP is blocked (429)
      const blockedRes = await request(testApp)
        .post("/login-email-test")
        .set("X-Forwarded-For", "192.168.1.21")
        .send({ email: victimEmail, password: "bad" });

      expect(blockedRes.status).toBe(429);
      expect(blockedRes.body.error.code).toBe("RATE_LIMITED");

      // Different email from any IP is NOT blocked
      const otherRes = await request(testApp)
        .post("/login-email-test")
        .set("X-Forwarded-For", "192.168.1.22")
        .send({ email: otherEmail, password: "bad" });

      expect(otherRes.status).toBe(401);
    });
  });

  describe("Step 5: Refresh Token Only from httpOnly Cookie", () => {
    it("returns 401 when calling /api/v1/auth/refresh with token only in the body", async () => {
      const res = await request(app)
        .post("/api/v1/auth/refresh")
        .send({ refreshToken: "token_in_body_only" });

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("UNAUTHORIZED");
      expect(res.body.error.message).toBe("Authentication required");
    });

    it("returns 401 and clears cookie when calling /api/v1/auth/logout with token only in the body", async () => {
      const res = await request(app)
        .post("/api/v1/auth/logout")
        .send({ refreshToken: "token_in_body_only" });

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("UNAUTHORIZED");
      expect(res.body.error.message).toBe("Authentication required");

      const cookies = res.headers["set-cookie"] || [];
      const clearedCookie = cookies.find((c) => c.startsWith("refreshToken="));
      expect(clearedCookie).toBeDefined();
      expect(clearedCookie).toContain("Path=/api/v1/auth");
    });

    it("returns 401 when calling /api/v1/auth/refresh with no cookie or body", async () => {
      const res = await request(app).post("/api/v1/auth/refresh");
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("UNAUTHORIZED");
    });
  });
});
