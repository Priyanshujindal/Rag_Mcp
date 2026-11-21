import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import mongoose from "mongoose";
import app from "../src/app.js";
import { apiKeysService, hashApiKey } from "../src/modules/api-keys/api-keys.service.js";
import { ApiKey, Chatbot, Conversation, Message } from "../src/db/models/index.js";
import aiClient from "../src/services/ai-client.js";
import usageService from "../src/modules/usage/usage.service.js";

describe("Platform API Keys & Public Chatbot API", () => {
  const mockWorkspaceId = new mongoose.Types.ObjectId();
  const mockChatbotId = new mongoose.Types.ObjectId();
  const mockChatbot2Id = new mongoose.Types.ObjectId();
  const mockKbId = new mongoose.Types.ObjectId();

  const mockChatbot = {
    _id: mockChatbotId,
    workspaceId: mockWorkspaceId,
    name: "Customer Support Agent",
    publicId: "bot_cust_support",
    knowledgeBaseId: mockKbId,
    status: "ACTIVE",
    externalApiEnabled: true,
    allowedOrigins: ["*"],
    description: "Internal description",
    publicDescription: "Public customer support bot",
    config: {
      welcomeMessage: "Hello! How can I assist you?",
      theme: "dark",
      primaryColor: "#10a37f",
      position: "bottom-right",
      suggestedQuestions: ["How to reset password?", "Pricing info"],
      systemPrompt: "You are a helpful assistant.",
    },
  };

  const mockChatbot2 = {
    _id: mockChatbot2Id,
    workspaceId: mockWorkspaceId,
    name: "Internal HR Bot",
    publicId: "bot_hr_internal",
    knowledgeBaseId: mockKbId,
    status: "ACTIVE",
    externalApiEnabled: true,
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(usageService, "assertQuota").mockResolvedValue();
    vi.spyOn(usageService, "recordEvent").mockResolvedValue();
  });

  describe("Cryptographic Key Generation and Hashing", () => {
    it("generates publishable key with rag_pk_live_ prefix and sufficient entropy", () => {
      const keyData = apiKeysService.generateKey("publishable");
      expect(keyData.prefix).toBe("rag_pk_live_");
      expect(keyData.secret.startsWith("rag_pk_live_")).toBe(true);
      expect(keyData.secret.length).toBeGreaterThanOrEqual(40);
      expect(keyData.maskedKey).toContain("••••");
      expect(keyData.keyHash).toBe(hashApiKey(keyData.secret));
    });

    it("generates secret key with rag_sk_live_ prefix", () => {
      const keyData = apiKeysService.generateKey("secret");
      expect(keyData.prefix).toBe("rag_sk_live_");
      expect(keyData.secret.startsWith("rag_sk_live_")).toBe(true);
      expect(keyData.maskedKey).toContain("••••");
      expect(keyData.keyHash).toBe(hashApiKey(keyData.secret));
    });

    it("HMAC-SHA-256 hash is deterministic and never equals plaintext", () => {
      const secret = "rag_sk_live_1234567890abcdef1234567890abcdef";
      const hash1 = hashApiKey(secret);
      const hash2 = hashApiKey(secret);
      expect(hash1).toBe(hash2);
      expect(hash1).not.toBe(secret);
    });
  });

  describe("Public Health Check Endpoint", () => {
    it("GET /api/v1/public/health returns 200 status", async () => {
      const res = await request(app).get("/api/v1/public/health");
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("ok");
      expect(res.body.service).toBe("public-chatbot-api");
    });
  });

  describe("Chatbot-Specific Scoping & Authorization", () => {
    it("rejects request if API key is missing", async () => {
      const res = await request(app).get(`/api/v1/public/chatbots/${mockChatbotId}`);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("UNAUTHORIZED");
    });

    it("rejects request if API key format is invalid", async () => {
      const res = await request(app)
        .get(`/api/v1/public/chatbots/${mockChatbotId}`)
        .set("Authorization", "Bearer invalid_key_format");
      expect(res.status).toBe(401);
    });

    it("rejects request when key does not match target chatbot (1 Key -> 1 Chatbot)", async () => {
      const keyData = apiKeysService.generateKey("secret");
      const keyDoc = {
        _id: new mongoose.Types.ObjectId(),
        workspaceId: mockWorkspaceId,
        chatbotId: mockChatbotId,
        keyType: "secret",
        status: "active",
        allowedOrigins: ["*"],
        rateLimit: { requestsPerMinute: 60 },
      };

      vi.spyOn(ApiKey, "findOne").mockResolvedValue(keyDoc);
      vi.spyOn(Chatbot, "findById").mockResolvedValue(mockChatbot);

      // Request bot_hr_internal using key bound to Customer Support
      const res = await request(app)
        .get(`/api/v1/public/chatbots/${mockChatbot2Id}`)
        .set("Authorization", `Bearer ${keyData.secret}`);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("FORBIDDEN");
    });

    it("allows request when key chatbot matches by MongoDB _id or publicId", async () => {
      const keyData = apiKeysService.generateKey("publishable");
      const keyDoc = {
        _id: new mongoose.Types.ObjectId(),
        workspaceId: mockWorkspaceId,
        chatbotId: mockChatbotId,
        keyType: "publishable",
        status: "active",
        allowedOrigins: ["*"],
        rateLimit: { requestsPerMinute: 60 },
      };

      vi.spyOn(ApiKey, "findOne").mockResolvedValue(keyDoc);
      vi.spyOn(Chatbot, "findById").mockResolvedValue(mockChatbot);

      // Access by publicId
      const res = await request(app)
        .get(`/api/v1/public/chatbots/${mockChatbot.publicId}`)
        .set("Authorization", `Bearer ${keyData.secret}`);

      expect(res.status).toBe(200);
      expect(res.body.data.name).toBe("Customer Support Agent");
      expect(res.body.data.greeting).toBe("Hello! How can I assist you?");
      // Internal secrets must not be exposed
      expect(res.body.data).not.toHaveProperty("systemPrompt");
      expect(res.body.data).not.toHaveProperty("config");
    });

    it("rejects publishable key from unauthorized origin", async () => {
      const keyData = apiKeysService.generateKey("publishable");
      const keyDoc = {
        _id: new mongoose.Types.ObjectId(),
        workspaceId: mockWorkspaceId,
        chatbotId: mockChatbotId,
        keyType: "publishable",
        status: "active",
        allowedOrigins: ["https://allowed-domain.com"],
        rateLimit: { requestsPerMinute: 60 },
      };

      vi.spyOn(ApiKey, "findOne").mockResolvedValue(keyDoc);
      vi.spyOn(Chatbot, "findById").mockResolvedValue(mockChatbot);

      const res = await request(app)
        .get(`/api/v1/public/chatbots/${mockChatbotId}`)
        .set("Authorization", `Bearer ${keyData.secret}`)
        .set("Origin", "https://unauthorized-domain.com");

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("FORBIDDEN");
    });

    it("permits publishable key when origin is in allowedOrigins list", async () => {
      const keyData = apiKeysService.generateKey("publishable");
      const keyDoc = {
        _id: new mongoose.Types.ObjectId(),
        workspaceId: mockWorkspaceId,
        chatbotId: mockChatbotId,
        keyType: "publishable",
        status: "active",
        allowedOrigins: ["https://allowed-domain.com"],
        rateLimit: { requestsPerMinute: 60 },
      };

      vi.spyOn(ApiKey, "findOne").mockResolvedValue(keyDoc);
      vi.spyOn(Chatbot, "findById").mockResolvedValue(mockChatbot);

      const res = await request(app)
        .get(`/api/v1/public/chatbots/${mockChatbotId}`)
        .set("Authorization", `Bearer ${keyData.secret}`)
        .set("Origin", "https://allowed-domain.com");

      expect(res.status).toBe(200);
    });

    it("rejects revoked key with 401 Unauthorized", async () => {
      const keyData = apiKeysService.generateKey("secret");
      const keyDoc = {
        _id: new mongoose.Types.ObjectId(),
        workspaceId: mockWorkspaceId,
        chatbotId: mockChatbotId,
        keyType: "secret",
        status: "revoked",
      };

      vi.spyOn(ApiKey, "findOne").mockResolvedValue(keyDoc);

      const res = await request(app)
        .get(`/api/v1/public/chatbots/${mockChatbotId}`)
        .set("Authorization", `Bearer ${keyData.secret}`);

      expect(res.status).toBe(401);
      expect(res.body.error.message).toContain("revoked");
    });
  });

  describe("Public Chatbot Messages API", () => {
    it("POST /api/v1/public/chatbots/:chatbotId/messages returns complete assistant response", async () => {
      const keyData = apiKeysService.generateKey("secret");
      const keyDoc = {
        _id: new mongoose.Types.ObjectId(),
        workspaceId: mockWorkspaceId,
        chatbotId: mockChatbotId,
        keyType: "secret",
        status: "active",
        allowedOrigins: ["*"],
        rateLimit: { requestsPerMinute: 60 },
      };

      const mockConversationId = new mongoose.Types.ObjectId();
      const mockAssistantMsgId = new mongoose.Types.ObjectId();

      vi.spyOn(ApiKey, "findOne").mockResolvedValue(keyDoc);
      vi.spyOn(Chatbot, "findById").mockResolvedValue(mockChatbot);
      vi.spyOn(Conversation, "create").mockResolvedValue({ _id: mockConversationId });
      vi.spyOn(Message, "find").mockReturnValue({
        sort: () => ({
          limit: () => Promise.resolve([]),
        }),
      });
      vi.spyOn(Message, "create").mockResolvedValue({
        _id: mockAssistantMsgId,
        role: "ASSISTANT",
        content: "Our return policy allows returns within 30 days.",
        citations: [],
      });

      // Mock AI client stream
      vi.spyOn(aiClient, "streamChat").mockImplementation(async (_wsId, _payload, callbacks) => {
        callbacks.onToken("Our return policy allows returns within 30 days.");
        callbacks.onUsage({ prompt_tokens: 15, completion_tokens: 10, total_tokens: 25 });
        callbacks.onDone();
      });

      const res = await request(app)
        .post(`/api/v1/public/chatbots/${mockChatbotId}/messages`)
        .set("Authorization", `Bearer ${keyData.secret}`)
        .send({
          message: "What is your return policy?",
          visitorId: "visitor_abc_123",
        });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("message");
      expect(res.body.message.content).toBe("Our return policy allows returns within 30 days.");
      expect(res.body).toHaveProperty("conversationId");
      expect(res.body.usage.inputTokens).toBe(15);
      expect(res.body.usage.outputTokens).toBe(10);
    });

    it("POST /api/v1/public/chatbots/:chatbotId/messages/stream returns SSE streaming headers", async () => {
      const keyData = apiKeysService.generateKey("publishable");
      const keyDoc = {
        _id: new mongoose.Types.ObjectId(),
        workspaceId: mockWorkspaceId,
        chatbotId: mockChatbotId,
        keyType: "publishable",
        status: "active",
        allowedOrigins: ["*"],
        rateLimit: { requestsPerMinute: 60 },
      };

      const mockConversationId = new mongoose.Types.ObjectId();

      vi.spyOn(ApiKey, "findOne").mockResolvedValue(keyDoc);
      vi.spyOn(Chatbot, "findById").mockResolvedValue(mockChatbot);
      vi.spyOn(Conversation, "create").mockResolvedValue({ _id: mockConversationId });
      vi.spyOn(Message, "find").mockReturnValue({
        sort: () => ({
          limit: () => Promise.resolve([]),
        }),
      });
      vi.spyOn(Message, "create").mockResolvedValue({ _id: new mongoose.Types.ObjectId() });

      vi.spyOn(aiClient, "streamChat").mockImplementation(async (_wsId, _payload, callbacks) => {
        callbacks.onToken("Hello!");
        callbacks.onDone();
      });

      const res = await request(app)
        .post(`/api/v1/public/chatbots/${mockChatbotId}/messages/stream`)
        .set("Authorization", `Bearer ${keyData.secret}`)
        .send({
          message: "Hello",
        });

      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toContain("text/event-stream");
    });
  });
});
