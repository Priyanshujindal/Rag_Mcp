import { describe, it, expect, afterAll, beforeEach } from "vitest";
import request from "supertest";
import mongoose from "mongoose";
import app from "../src/app.js";
import { checkLiveAtlasAvailability, disconnectDb } from "./helpers/atlas-guard.js";
import { validateFileIntegrity } from "../src/modules/documents/sources.service.js";
import {
  User,
  Workspace,
  Membership,
  RefreshToken,
  KnowledgeBase,
  Source,
  Chatbot,
  ApiKey,
  McpServer,
} from "../src/db/models/index.js";
import config from "../src/config/index.js";

// Top-level await for ESM: detect whether live Atlas is reachable
const { available: hasLiveAtlas } = await checkLiveAtlasAvailability();

describe("Auth, Tenancy, and Core CRUD (Stage 3)", () => {
  describe("File Upload Integrity & Disguised Executable Rejection", () => {
    it("rejects an executable disguised as a PDF (.exe renamed to .pdf)", () => {
      const fakeExeBuffer = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00]);

      expect(() => {
        validateFileIntegrity(fakeExeBuffer, ".pdf", "application/pdf");
      }).toThrow(/Executable files are strictly forbidden/);
    });

    it("rejects corrupted or non-PDF files with .pdf extension", () => {
      const invalidPdfBuffer = Buffer.from("Just plain text content without PDF header");

      expect(() => {
        validateFileIntegrity(invalidPdfBuffer, ".pdf", "application/pdf");
      }).toThrow(/Invalid PDF file structure/);
    });

    it("accepts a genuine PDF file starting with %PDF-", () => {
      const genuinePdfBuffer = Buffer.from("%PDF-1.7\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF");

      expect(() => {
        validateFileIntegrity(genuinePdfBuffer, ".pdf", "application/pdf");
      }).not.toThrow();
    });

    it("rejects unsupported extensions", () => {
      const scriptBuffer = Buffer.from("console.log('hello')");

      expect(() => {
        validateFileIntegrity(scriptBuffer, ".js", "text/javascript");
      }).toThrow(/Unsupported file extension/);
    });
  });

  describe("API Stubs & Future Stage Placeholders", () => {
    it("POST /api/v1/webhooks returns 501 Not Implemented", async () => {
      const res = await request(app).post("/api/v1/webhooks").send({});
      expect(res.status).toBe(501);
      expect(res.body.error.code).toBe("NOT_IMPLEMENTED");
    });

    it("GET /api/v1/public returns 501 Not Implemented", async () => {
      const res = await request(app).get("/api/v1/public/chat");
      expect(res.status).toBe(501);
      expect(res.body.error.code).toBe("NOT_IMPLEMENTED");
    });
  });

  // Live Atlas Database Test Suite (Skipped cleanly if Atlas is unconfigured / unreachable)
  describe.skipIf(!hasLiveAtlas)("Live Atlas DB Suite (Auth, Rotation, Tenancy, Quotas, Cascade)", () => {
    afterAll(async () => {
      if (mongoose.connection.readyState === 1) {
        await disconnectDb();
      }
    });

    beforeEach(async () => {
      if (mongoose.connection.readyState === 1) {
        if (!mongoose.connection.name.endsWith("_test")) {
          throw new Error("SAFETY VIOLATION: Cannot clean non-test database!");
        }
        await Promise.all([
          User.deleteMany({}),
          Workspace.deleteMany({}),
          Membership.deleteMany({}),
          RefreshToken.deleteMany({}),
          KnowledgeBase.deleteMany({}),
          Source.deleteMany({}),
          Chatbot.deleteMany({}),
          ApiKey.deleteMany({}),
          McpServer.deleteMany({}),
        ]);
      }
    });

    it("full auth lifecycle: register -> login -> refresh -> reuse detection -> logout", async () => {
      // 1. Register
      const regRes = await request(app).post("/api/v1/auth/register").send({
        email: "alice@example.com",
        password: "Password123!",
        name: "Alice Cooper",
      });

      expect(regRes.status).toBe(201);
      expect(regRes.body).toHaveProperty("accessToken");
      expect(regRes.body).toHaveProperty("user");
      expect(regRes.body).toHaveProperty("workspace");
      expect(regRes.body.workspace.name).toBe("Alice Cooper's Workspace");
      expect(regRes.body.refreshToken).toBeUndefined();

      const cookies = regRes.headers["set-cookie"] || [];
      const refreshCookie = cookies.find((c) => c.startsWith("refreshToken="));
      expect(refreshCookie).toBeDefined();
      expect(refreshCookie.toLowerCase()).toContain("httponly");
      expect(refreshCookie).toContain("Path=/api/v1/auth");

      const rawRefreshToken = refreshCookie.split(";")[0].split("=")[1];

      // 2. Login
      const loginRes = await request(app).post("/api/v1/auth/login").send({
        email: "alice@example.com",
        password: "Password123!",
      });
      expect(loginRes.status).toBe(200);
      expect(loginRes.body).toHaveProperty("accessToken");
      expect(loginRes.body.refreshToken).toBeUndefined();

      const loginCookies = loginRes.headers["set-cookie"] || [];
      const loginCookie = loginCookies.find((c) => c.startsWith("refreshToken="));
      expect(loginCookie).toBeDefined();
      expect(loginCookie.toLowerCase()).toContain("httponly");
      expect(loginCookie).toContain("Path=/api/v1/auth");

      // 3. Refresh rotation
      const refreshRes = await request(app)
        .post("/api/v1/auth/refresh")
        .set("Cookie", [`refreshToken=${rawRefreshToken}`]);

      expect(refreshRes.status).toBe(200);
      expect(refreshRes.body).toHaveProperty("accessToken");
      expect(refreshRes.body.refreshToken).toBeUndefined();

      const rotatedCookies = refreshRes.headers["set-cookie"] || [];
      const rotatedCookie = rotatedCookies.find((c) => c.startsWith("refreshToken="));
      expect(rotatedCookie).toBeDefined();
      expect(rotatedCookie.toLowerCase()).toContain("httponly");
      expect(rotatedCookie).toContain("Path=/api/v1/auth");

      // 4. Token Reuse Detection: using old refresh token again must fail
      const reuseRes = await request(app)
        .post("/api/v1/auth/refresh")
        .set("Cookie", [`refreshToken=${rawRefreshToken}`]);

      expect(reuseRes.status).toBe(401);

      // 5. Logout with rotated cookie
      const logoutRes = await request(app)
        .post("/api/v1/auth/logout")
        .set("Cookie", [rotatedCookie]);
      expect(logoutRes.status).toBe(200);
    });

    it("Step 3: 5 concurrent /refresh calls produce exactly ONE success and four 401s, user's other session stays valid", async () => {
      // 1. Register User (Session 1)
      const regRes = await request(app).post("/api/v1/auth/register").send({
        email: "concurrent@example.com",
        password: "Password123!",
        name: "Concurrent User",
      });
      expect(regRes.status).toBe(201);
      const session1Cookie = regRes.headers["set-cookie"].find((c) => c.startsWith("refreshToken="));
      expect(session1Cookie).toBeDefined();

      // 2. Login User (Session 2 - e.g. second device or tab)
      const loginRes = await request(app).post("/api/v1/auth/login").send({
        email: "concurrent@example.com",
        password: "Password123!",
      });
      expect(loginRes.status).toBe(200);
      const session2Cookie = loginRes.headers["set-cookie"].find((c) => c.startsWith("refreshToken="));
      expect(session2Cookie).toBeDefined();

      // 3. Fire 5 concurrent refresh calls with Session 1's cookie
      const refreshPromises = [
        request(app).post("/api/v1/auth/refresh").set("Cookie", [session1Cookie]),
        request(app).post("/api/v1/auth/refresh").set("Cookie", [session1Cookie]),
        request(app).post("/api/v1/auth/refresh").set("Cookie", [session1Cookie]),
        request(app).post("/api/v1/auth/refresh").set("Cookie", [session1Cookie]),
        request(app).post("/api/v1/auth/refresh").set("Cookie", [session1Cookie]),
      ];

      const results = await Promise.all(refreshPromises);
      const successes = results.filter((r) => r.status === 200);
      const failures = results.filter((r) => r.status === 401);

      expect(successes.length).toBe(1);
      expect(failures.length).toBe(4);

      // 4. Verify user's other session (Session 2) remains valid and was NOT revoked by harmless race
      const session2Refresh = await request(app)
        .post("/api/v1/auth/refresh")
        .set("Cookie", [session2Cookie]);

      expect(session2Refresh.status).toBe(200);
      expect(session2Refresh.body).toHaveProperty("accessToken");
    });

    it("Step 3: replaying a token after grace window revokes all sessions; normal rotation works across several rounds", async () => {
      // 1. Register User
      const regRes = await request(app).post("/api/v1/auth/register").send({
        email: "grace@example.com",
        password: "Password123!",
        name: "Grace User",
      });
      let currentCookie = regRes.headers["set-cookie"].find((c) => c.startsWith("refreshToken="));
      const firstCookie = currentCookie;

      // 2. Normal rotation across several rounds
      for (let round = 1; round <= 3; round++) {
        const nextRes = await request(app)
          .post("/api/v1/auth/refresh")
          .set("Cookie", [currentCookie]);

        expect(nextRes.status).toBe(200);
        expect(nextRes.body).toHaveProperty("accessToken");
        currentCookie = nextRes.headers["set-cookie"].find((c) => c.startsWith("refreshToken="));
        expect(currentCookie).toBeDefined();
      }

      // 3. Simulate passage of time past grace window for the first revoked token
      const rawFirstToken = firstCookie.split(";")[0].split("=")[1];
      const crypto = await import("crypto");
      const hash = crypto.createHash("sha256").update(rawFirstToken).digest("hex");

      // Force rotatedAt to 10 minutes in the past
      await RefreshToken.updateOne(
        { tokenHash: hash },
        { rotatedAt: new Date(Date.now() - 600 * 1000) }
      );

      // 4. Replaying first token after grace window revokes ALL sessions
      const attackRes = await request(app)
        .post("/api/v1/auth/refresh")
        .set("Cookie", [firstCookie]);

      expect(attackRes.status).toBe(401);
      expect(attackRes.body.error.message).toContain("revoked or expired");

      // Verify the latest session was revoked as part of reuse defense
      const latestRes = await request(app)
        .post("/api/v1/auth/refresh")
        .set("Cookie", [currentCookie]);

      expect(latestRes.status).toBe(401);
    });

    it("multi-tenant isolation: User A cannot read, update, or delete User B's resources (404 each)", async () => {
      // Register User A
      const userARes = await request(app).post("/api/v1/auth/register").send({
        email: "tenantA@example.com",
        password: "Password123!",
        name: "Tenant A",
      });
      const tokenA = userARes.body.accessToken;
      const workspaceAId = userARes.body.workspace.id;

      // Register User B
      const userBRes = await request(app).post("/api/v1/auth/register").send({
        email: "tenantB@example.com",
        password: "Password123!",
        name: "Tenant B",
      });
      const tokenB = userBRes.body.accessToken;

      // User A creates Knowledge Base
      const kbRes = await request(app)
        .post("/api/v1/knowledge-bases")
        .set("Authorization", `Bearer ${tokenA}`)
        .send({ name: "Tenant A Private KB" });
      const kbAId = kbRes.body.id;

      // User A creates Chatbot
      const botRes = await request(app)
        .post("/api/v1/chatbots")
        .set("Authorization", `Bearer ${tokenA}`)
        .send({ name: "Tenant A Bot", knowledgeBaseId: kbAId });
      const botAId = botRes.body.id;

      // User A creates API Key
      const keyRes = await request(app)
        .post("/api/v1/api-keys")
        .set("Authorization", `Bearer ${tokenA}`)
        .send({ name: "Tenant A Key" });
      const keyAId = keyRes.body.apiKey.id;
      expect(keyRes.body).toHaveProperty("secret");
      expect(keyRes.body.secret).toMatch(/^ragmcp_live_[a-f0-9]{32}$/);

      // Verify User B receives 404 when attempting to access User A's Knowledge Base
      const getKbByB = await request(app)
        .get(`/api/v1/knowledge-bases/${kbAId}`)
        .set("Authorization", `Bearer ${tokenB}`);
      expect(getKbByB.status).toBe(404);

      // Verify User B receives 404 when attempting to update User A's Chatbot
      const patchBotByB = await request(app)
        .patch(`/api/v1/chatbots/${botAId}`)
        .set("Authorization", `Bearer ${tokenB}`)
        .send({ name: "Hacked Name" });
      expect(patchBotByB.status).toBe(404);

      // Verify User B receives 404 when attempting to delete User A's API Key
      const deleteKeyByB = await request(app)
        .delete(`/api/v1/api-keys/${keyAId}`)
        .set("Authorization", `Bearer ${tokenB}`);
      expect(deleteKeyByB.status).toBe(404);

      // User B tries to pass User A's workspace ID in header -> rejected with 404 (no membership)
      const spoofWorkspaceRes = await request(app)
        .get("/api/v1/knowledge-bases")
        .set("Authorization", `Bearer ${tokenB}`)
        .set("X-Workspace-Id", workspaceAId);
      expect(spoofWorkspaceRes.status).toBe(404);

      // User B cannot create a Chatbot referencing User A's Knowledge Base -> 404
      const crossRefBotRes = await request(app)
        .post("/api/v1/chatbots")
        .set("Authorization", `Bearer ${tokenB}`)
        .send({ name: "Tenant B Bot", knowledgeBaseId: kbAId });
      expect(crossRefBotRes.status).toBe(404);
    });

    it("API key secret is returned only upon creation and never in list view", async () => {
      const userRes = await request(app).post("/api/v1/auth/register").send({
        email: "dev@example.com",
        password: "Password123!",
        name: "Dev User",
      });
      const token = userRes.body.accessToken;

      const createRes = await request(app)
        .post("/api/v1/api-keys")
        .set("Authorization", `Bearer ${token}`)
        .send({ name: "Agent Production Key" });

      expect(createRes.status).toBe(201);
      expect(createRes.body).toHaveProperty("secret");
      expect(createRes.body.secret).toContain("ragmcp_live_");

      const listRes = await request(app)
        .get("/api/v1/api-keys")
        .set("Authorization", `Bearer ${token}`);

      expect(listRes.status).toBe(200);
      expect(Array.isArray(listRes.body)).toBe(true);
      expect(listRes.body[0]).toHaveProperty("prefix");
      expect(listRes.body[0]).not.toHaveProperty("secret");
      expect(listRes.body[0]).not.toHaveProperty("keyHash");
    });

    it("usage endpoint returns counts and configured quota limits", async () => {
      const userRes = await request(app).post("/api/v1/auth/register").send({
        email: "usage@example.com",
        password: "Password123!",
        name: "Usage User",
      });
      const token = userRes.body.accessToken;

      const usageRes = await request(app)
        .get("/api/v1/usage")
        .set("Authorization", `Bearer ${token}`);

      expect(usageRes.status).toBe(200);
      expect(usageRes.body).toHaveProperty("knowledgeBases");
      expect(usageRes.body.knowledgeBases.limit).toBe(config.MAX_KBS_PER_WORKSPACE);
      expect(usageRes.body).toHaveProperty("sources");
      expect(usageRes.body.sources.limit).toBe(config.MAX_SOURCES_PER_KB);
    });
  });
});
