import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import mongoose from "mongoose";
import app from "../src/app.js";
import { usageService } from "../src/modules/usage/usage.service.js";
import {
  UsageEvent,
  Workspace,
  Membership,
  KnowledgeBase,
  Source,
  Chatbot,
  McpServer,
  McpExecution,
  ApiKeyUsageLog,
  Artifact,
  Message,
} from "../src/db/models/index.js";
import { getWorkspacePlan, PLANS } from "../src/config/plans.config.js";
import aiClient from "../src/services/ai-client.js";
import jwt from "jsonwebtoken";
import config from "../src/config/index.js";

describe("Usage & Limits System Tests", () => {
  const mockWorkspaceId = new mongoose.Types.ObjectId();
  const mockUserId = new mongoose.Types.ObjectId();

  const token = jwt.sign(
    { sub: mockUserId.toString(), email: "tester@ragmcp.dev" },
    config.JWT_ACCESS_SECRET
  );

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(aiClient, "getUsage").mockResolvedValue({
      workspaceId: mockWorkspaceId.toString(),
      totalChunks: 0,
      estimatedMb: 0,
      maxChunks: 5000,
      capacityMb: 400,
      chunkCapacityPercent: 0,
    });
    const mockMembership = {
      workspaceId: mockWorkspaceId,
      userId: mockUserId,
      role: "OWNER",
    };
    vi.spyOn(Membership, "findOne").mockImplementation(() => ({
      sort: () => Promise.resolve(mockMembership),
      then: (resolve) => resolve(mockMembership),
      catch: () => {},
    }));
    vi.spyOn(ApiKeyUsageLog, "countDocuments").mockResolvedValue(0);
    vi.spyOn(McpExecution, "countDocuments").mockResolvedValue(0);
    vi.spyOn(Artifact, "countDocuments").mockResolvedValue(0);
    vi.spyOn(McpServer, "countDocuments").mockResolvedValue(0);
    vi.spyOn(Chatbot, "countDocuments").mockResolvedValue(0);
    vi.spyOn(Message, "aggregate").mockResolvedValue([]);
    vi.spyOn(Source, "aggregate").mockResolvedValue([]);
    vi.spyOn(Artifact, "aggregate").mockResolvedValue([]);
  });

  describe("Plan Architecture & Configuration", () => {
    it("provides default developer plan for local development", () => {
      const plan = getWorkspacePlan(null);
      expect(plan.id).toBe("developer");
      expect(plan.limits.chatRequests).toBe(5000);
      expect(plan.limits.aiTokens).toBe(2000000);
      expect(plan.thresholds.warning).toBe(0.7);
      expect(plan.thresholds.nearLimit).toBe(0.9);
      expect(plan.thresholds.hardLimit).toBe(1.0);
    });

    it("applies workspace-level limit overrides if configured", () => {
      const customWorkspace = {
        _id: mockWorkspaceId,
        planConfig: {
          limits: {
            chatRequests: 10000,
            storage: 1000,
          },
        },
      };
      const plan = getWorkspacePlan(customWorkspace);
      expect(plan.limits.chatRequests).toBe(10000);
      expect(plan.limits.storage).toBe(1000);
      expect(plan.limits.aiTokens).toBe(2000000); // untouched default preserved
    });
  });

  describe("Usage Event Recording", () => {
    it("creates a canonical UsageEvent without throwing", async () => {
      const createSpy = vi.spyOn(UsageEvent, "create").mockResolvedValue({});

      usageService.recordEvent({
        workspaceId: mockWorkspaceId,
        userId: mockUserId,
        eventType: "ai.chat",
        category: "ai",
        tokens: {
          promptTokens: 120,
          completionTokens: 80,
          totalTokens: 200,
        },
        model: "gemini-1.5-flash",
        durationMs: 350,
      });

      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: mockWorkspaceId,
          eventType: "ai.chat",
          category: "ai",
          tokens: expect.objectContaining({
            promptTokens: 120,
            completionTokens: 80,
            totalTokens: 200,
          }),
        })
      );
    });
  });

  describe("Quota Checks and Enforcement", () => {
    it("allows operations below configured quota limit", async () => {
      vi.spyOn(Workspace, "findById").mockResolvedValue({ _id: mockWorkspaceId });
      vi.spyOn(KnowledgeBase, "countDocuments").mockResolvedValue(2);
      vi.spyOn(Source, "countDocuments").mockResolvedValue(10);
      vi.spyOn(Chatbot, "countDocuments").mockResolvedValue(3);
      vi.spyOn(McpServer, "countDocuments").mockResolvedValue(1);
      vi.spyOn(UsageEvent, "aggregate").mockResolvedValue([]);
      vi.spyOn(Source, "aggregate").mockResolvedValue([]);
      vi.spyOn(Artifact, "aggregate").mockResolvedValue([]);
      vi.spyOn(Message, "aggregate").mockResolvedValue([{ count: 50, tokens: 10000 }]);

      const check = await usageService.checkQuota(mockWorkspaceId, "chatRequests", 1);
      expect(check.allowed).toBe(true);
      expect(check.current).toBe(50);
      expect(check.limit).toBe(5000);
    });

    it("blocks operations when quota limit is reached or exceeded", async () => {
      vi.spyOn(Workspace, "findById").mockResolvedValue({ _id: mockWorkspaceId });
      vi.spyOn(KnowledgeBase, "countDocuments").mockResolvedValue(10);
      vi.spyOn(Source, "countDocuments").mockResolvedValue(100);
      vi.spyOn(Chatbot, "countDocuments").mockResolvedValue(20);
      vi.spyOn(McpServer, "countDocuments").mockResolvedValue(20);
      vi.spyOn(UsageEvent, "aggregate").mockResolvedValue([
        {
          _id: "ai",
          totalEvents: 5000,
          totalTokens: 2000000,
        },
      ]);
      vi.spyOn(Source, "aggregate").mockResolvedValue([]);
      vi.spyOn(Artifact, "aggregate").mockResolvedValue([]);

      const check = await usageService.checkQuota(mockWorkspaceId, "chatRequests", 1);
      expect(check.allowed).toBe(false);
      expect(check.current).toBe(5000);
      expect(check.message).toContain("quota reached");
    });

    it("assertQuota throws AppError with QUOTA_EXCEEDED when exhausted", async () => {
      vi.spyOn(usageService, "checkQuota").mockResolvedValue({
        allowed: false,
        current: 5000,
        limit: 5000,
        metricKey: "chatRequests",
        message: "AI Chat Requests quota reached",
      });

      await expect(
        usageService.assertQuota(mockWorkspaceId, "chatRequests", 1)
      ).rejects.toThrow("quota reached");
    });
  });

  describe("Backend Usage Endpoints (Phase 11)", () => {
    it("GET /api/v1/usage/overview returns plan, metrics, and warnings", async () => {
      vi.spyOn(Workspace, "findById").mockResolvedValue({ _id: mockWorkspaceId });
      vi.spyOn(KnowledgeBase, "countDocuments").mockResolvedValue(2);
      vi.spyOn(Source, "countDocuments").mockResolvedValue(5);
      vi.spyOn(Chatbot, "countDocuments").mockResolvedValue(1);
      vi.spyOn(McpServer, "countDocuments").mockResolvedValue(1);
      vi.spyOn(UsageEvent, "aggregate").mockResolvedValue([]);
      vi.spyOn(Source, "aggregate").mockResolvedValue([]);
      vi.spyOn(Artifact, "aggregate").mockResolvedValue([]);
      vi.spyOn(Message, "aggregate").mockResolvedValue([]);

      const res = await request(app)
        .get("/api/v1/usage/overview")
        .set("Authorization", `Bearer ${token}`)
        .set("x-workspace-id", mockWorkspaceId.toString());

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("plan");
      expect(res.body.plan.id).toBe("developer");
      expect(res.body).toHaveProperty("metrics");
      expect(res.body.metrics).toHaveProperty("chatRequests");
      expect(res.body.metrics).toHaveProperty("aiTokens");
      expect(res.body.metrics).toHaveProperty("storage");
      expect(res.body).toHaveProperty("warnings");
    });

    it("GET /api/v1/usage/limits returns limit breakdown", async () => {
      vi.spyOn(Workspace, "findById").mockResolvedValue({ _id: mockWorkspaceId });
      vi.spyOn(KnowledgeBase, "countDocuments").mockResolvedValue(1);
      vi.spyOn(Source, "countDocuments").mockResolvedValue(1);
      vi.spyOn(Chatbot, "countDocuments").mockResolvedValue(1);
      vi.spyOn(McpServer, "countDocuments").mockResolvedValue(1);
      vi.spyOn(UsageEvent, "aggregate").mockResolvedValue([]);
      vi.spyOn(Source, "aggregate").mockResolvedValue([]);
      vi.spyOn(Artifact, "aggregate").mockResolvedValue([]);

      const res = await request(app)
        .get("/api/v1/usage/limits")
        .set("Authorization", `Bearer ${token}`)
        .set("x-workspace-id", mockWorkspaceId.toString());

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("limits");
      expect(res.body.limits.knowledgeBases.limit).toBe(10);
      expect(res.body.limits.documents.limit).toBe(100);
    });

    it("GET /api/v1/usage/analytics returns time-series daily metrics", async () => {
      vi.spyOn(UsageEvent, "aggregate")
        .mockResolvedValueOnce([
          {
            _id: new Date().toISOString().split("T")[0],
            messages: 25,
            tokens: 45000,
            inputTokens: 30000,
            outputTokens: 15000,
            publicApiRequests: 10,
            mcpCalls: 5,
            costUsd: 0.08,
            avgLatencyMs: 320,
          },
        ])
        .mockResolvedValueOnce([{ _id: "google", requests: 20, tokens: 40000 }])
        .mockResolvedValueOnce([{ _id: "gemini-1.5-flash", requests: 20, tokens: 40000 }]);

      const res = await request(app)
        .get("/api/v1/usage/analytics?days=7")
        .set("Authorization", `Bearer ${token}`)
        .set("x-workspace-id", mockWorkspaceId.toString());

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("dailyMetrics");
      expect(res.body.dailyMetrics.length).toBe(7);
      expect(res.body).toHaveProperty("breakdown");
    });

    it("GET /api/v1/usage/history returns paginated events with sensitive data redacted", async () => {
      const mockEvent = {
        _id: new mongoose.Types.ObjectId(),
        workspaceId: mockWorkspaceId,
        eventType: "ai.chat",
        category: "ai",
        status: "success",
        tokens: { totalTokens: 1500 },
        metadata: {
          prompt: "SECRET PROMPT SHOULD BE STRIPPED",
          safeInfo: "ok",
        },
        toJSON() {
          return { ...this };
        },
      };

      vi.spyOn(UsageEvent, "find").mockReturnValue({
        populate: () => ({
          populate: () => ({
            sort: () => ({
              skip: () => ({
                limit: () => Promise.resolve([mockEvent]),
              }),
            }),
          }),
        }),
      });
      vi.spyOn(UsageEvent, "countDocuments").mockResolvedValue(1);

      const res = await request(app)
        .get("/api/v1/usage/history")
        .set("Authorization", `Bearer ${token}`)
        .set("x-workspace-id", mockWorkspaceId.toString());

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(1);
      // Verify prompt is redacted
      expect(res.body.data[0].metadata).not.toHaveProperty("prompt");
      expect(res.body.data[0].metadata.safeInfo).toBe("ok");
    });

    it("legacy GET /api/v1/usage returns backward-compatible format", async () => {
      vi.spyOn(KnowledgeBase, "countDocuments").mockResolvedValue(3);
      vi.spyOn(Source, "countDocuments").mockResolvedValue(12);
      vi.spyOn(Chatbot, "countDocuments").mockResolvedValue(2);
      vi.spyOn(Workspace, "findById").mockResolvedValue({ _id: mockWorkspaceId });
      vi.spyOn(UsageEvent, "aggregate").mockResolvedValue([]);
      vi.spyOn(Source, "aggregate").mockResolvedValue([]);
      vi.spyOn(Artifact, "aggregate").mockResolvedValue([]);

      const res = await request(app)
        .get("/api/v1/usage")
        .set("Authorization", `Bearer ${token}`)
        .set("x-workspace-id", mockWorkspaceId.toString());

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("knowledgeBases");
      expect(res.body.knowledgeBases.count).toBe(3);
      expect(res.body).toHaveProperty("sources");
      expect(res.body.sources.count).toBe(12);
      expect(res.body).toHaveProperty("chatbots");
      expect(res.body).toHaveProperty("storage");
      expect(res.body).toHaveProperty("dailyMetrics");
    });
  });
});
