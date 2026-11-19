/**
 * apps/api/tests/stage6-wire.test.js
 * ===================================
 * Unit tests for Stage 6: Wiring Node API to Python ai-service.
 */

import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import mongoose from "mongoose";

import app from "../src/app.js";
import config from "../src/config/index.js";
import aiClient from "../src/services/ai-client.js";
import { Chatbot } from "../src/db/models/index.js";
import chatService from "../src/modules/chatbots/chat.service.js";

describe("Stage 6: Wire Node API to ai-service", () => {
  const dummyWorkspaceId = new mongoose.Types.ObjectId().toString();
  const dummyKbId = new mongoose.Types.ObjectId().toString();

  describe("AiServiceClient", () => {
    it("attaches X-Internal-Key and X-Workspace-Id headers to requests", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ status: "ok" }),
      });

      const originalFetch = global.fetch;
      global.fetch = mockFetch;

      try {
        await aiClient.ingest(dummyWorkspaceId, {
          knowledgeBaseId: dummyKbId,
          sourceId: "src_1",
          sourceType: "URL",
          url: "https://example.com",
        });

        expect(mockFetch).toHaveBeenCalledTimes(1);
        const [url, options] = mockFetch.mock.calls[0];
        expect(url).toBe(`${config.AI_SERVICE_URL}/ingest`);
        expect(options.headers["X-Internal-Key"]).toBe(config.INTERNAL_API_KEY);
        expect(options.headers["X-Workspace-Id"]).toBe(dummyWorkspaceId);
      } finally {
        global.fetch = originalFetch;
      }
    });

    it("falls back to zero metrics when getUsage fails", async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error("Connection refused"));
      const originalFetch = global.fetch;
      global.fetch = mockFetch;

      try {
        const usage = await aiClient.getUsage(dummyWorkspaceId);
        expect(usage).toHaveProperty("totalChunks", 0);
        expect(usage).toHaveProperty("estimatedMb", 0);
        expect(usage).toHaveProperty("maxChunks", 5000);
      } finally {
        global.fetch = originalFetch;
      }
    });
  });

  describe("Public Widget Chat API", () => {
    it("returns 404 for unknown chatbot publicId", async () => {
      vi.spyOn(Chatbot, "findOne").mockResolvedValue(null);

      const res = await request(app)
        .post("/api/v1/public/chatbots/non_existent_bot/chat")
        .send({ message: "Hello" });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("CHATBOT_NOT_FOUND");
    });

    it("returns 403 when chatbot is not ACTIVE", async () => {
      const pausedBot = {
        _id: new mongoose.Types.ObjectId(),
        publicId: "bot_paused",
        status: "PAUSED",
        allowedOrigins: ["*"],
      };
      vi.spyOn(Chatbot, "findOne").mockResolvedValue(pausedBot);

      const res = await request(app)
        .post("/api/v1/public/chatbots/bot_paused/chat")
        .send({ message: "Hello" });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("CHATBOT_NOT_ACTIVE");
    });

    it("returns 403 when request origin is not in allowedOrigins", async () => {
      const restrictedBot = {
        _id: new mongoose.Types.ObjectId(),
        publicId: "bot_restricted",
        status: "ACTIVE",
        allowedOrigins: ["https://allowed.example.com"],
      };
      vi.spyOn(Chatbot, "findOne").mockResolvedValue(restrictedBot);

      const res = await request(app)
        .post("/api/v1/public/chatbots/bot_restricted/chat")
        .set("Origin", "https://unauthorized.attacker.com")
        .send({ message: "Hello" });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("ORIGIN_FORBIDDEN");
    });

    it("validates empty message and returns 422", async () => {
      const res = await request(app)
        .post("/api/v1/public/chatbots/bot_123/chat")
        .send({ message: "" });

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe("UNPROCESSABLE_ENTITY");
    });

    it("streams SSE response when valid public chat request is processed", async () => {
      const activeBot = {
        _id: new mongoose.Types.ObjectId(),
        workspaceId: new mongoose.Types.ObjectId(),
        knowledgeBaseId: new mongoose.Types.ObjectId(),
        publicId: "bot_active",
        status: "ACTIVE",
        allowedOrigins: ["*"],
        config: { systemPrompt: "You are helpful." },
      };
      vi.spyOn(Chatbot, "findOne").mockResolvedValue(activeBot);

      vi.spyOn(chatService, "streamChatTurn").mockImplementation(async (params, res) => {
        res.setHeader("Content-Type", "text/event-stream");
        res.write("event: token\ndata: {\"delta\": \"Hi!\"}\n\n");
        res.write("event: done\ndata: {}\n\n");
        res.end();
      });

      const res = await request(app)
        .post("/api/v1/public/chatbots/bot_active/chat")
        .send({ message: "Hello there" });

      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toContain("text/event-stream");
      expect(res.text).toContain("event: token");
      expect(res.text).toContain("event: done");
    });
  });
});
