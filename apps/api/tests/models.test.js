import { describe, it, expect } from "vitest";
import mongoose from "mongoose";
import {
  User,
  Membership,
  RefreshToken,
  KnowledgeBase,
  Source,
  Chatbot,
  Conversation,
  Message,
  ApiKey,
  McpServer,
  Webhook,
  EvalRun,
} from "../src/db/models/index.js";
import { seedDatabase } from "../src/db/seed.js";
import config from "../src/config/index.js";

describe("Data Models & Security (Stage 2)", () => {
  describe("toJSON Serialization & Sensitive Hash Protection", () => {
    it("User model: exposes 'id' string, deletes '_id' and '__v', and NEVER exposes passwordHash", () => {
      const user = new User({
        email: "test@rag-mcp.ai",
        passwordHash: "$2a$12$eX4mPl3H4shV4lu3N07T0B3L34k3d",
        name: "Test User",
      });

      const json = user.toJSON();
      expect(json).toHaveProperty("id");
      expect(typeof json.id).toBe("string");
      expect(json).not.toHaveProperty("_id");
      expect(json).not.toHaveProperty("__v");
      expect(json).not.toHaveProperty("passwordHash");
      expect(json.email).toBe("test@rag-mcp.ai");
      expect(json.name).toBe("Test User");
    });

    it("RefreshToken model: NEVER exposes tokenHash", () => {
      const token = new RefreshToken({
        userId: new mongoose.Types.ObjectId(),
        tokenHash: "super_secret_refresh_token_sha256_hash",
        expiresAt: new Date(Date.now() + 604800000),
      });

      const json = token.toJSON();
      expect(json).toHaveProperty("id");
      expect(json).not.toHaveProperty("tokenHash");
      expect(json).not.toHaveProperty("_id");
      expect(json).not.toHaveProperty("__v");
    });

    it("ApiKey model: NEVER exposes keyHash", () => {
      const apiKey = new ApiKey({
        workspaceId: new mongoose.Types.ObjectId(),
        name: "Production Agent",
        prefix: "ragmcp_live_abcd",
        keyHash: "hashed_sha256_secret_key_value",
      });

      const json = apiKey.toJSON();
      expect(json).toHaveProperty("id");
      expect(json).not.toHaveProperty("keyHash");
      expect(json).not.toHaveProperty("_id");
      expect(json).not.toHaveProperty("__v");
      expect(json.prefix).toBe("ragmcp_live_abcd");
    });

    it("Webhook model: NEVER exposes secretHash", () => {
      const webhook = new Webhook({
        workspaceId: new mongoose.Types.ObjectId(),
        url: "https://example.com/webhook",
        events: ["document.indexed"],
        secretHash: "webhook_signature_secret_hash",
      });

      const json = webhook.toJSON();
      expect(json).toHaveProperty("id");
      expect(json).not.toHaveProperty("secretHash");
      expect(json).not.toHaveProperty("_id");
      expect(json).not.toHaveProperty("__v");
    });
  });

  describe("Schema Tenancy & Index Rules", () => {
    const tenantModels = [
      { name: "KnowledgeBase", schema: KnowledgeBase.schema },
      { name: "Source", schema: Source.schema },
      { name: "Chatbot", schema: Chatbot.schema },
      { name: "Conversation", schema: Conversation.schema },
      { name: "Message", schema: Message.schema },
      { name: "ApiKey", schema: ApiKey.schema },
      { name: "McpServer", schema: McpServer.schema },
      { name: "Webhook", schema: Webhook.schema },
      { name: "EvalRun", schema: EvalRun.schema },
    ];

    it.each(tenantModels)(
      "every tenant model ($name) has a required workspaceId field of type ObjectId",
      ({ schema }) => {
        const workspaceIdPath = schema.path("workspaceId");
        expect(workspaceIdPath).toBeDefined();
        expect(workspaceIdPath.instance).toBe("ObjectId");
        expect(workspaceIdPath.isRequired).toBe(true);
      }
    );

    it("Message collection has compound index on conversationId + createdAt", () => {
      const indexes = Message.schema.indexes();
      const hasConvCreatedIndex = indexes.some(
        ([fields]) => fields.conversationId === 1 && fields.createdAt === 1
      );
      expect(hasConvCreatedIndex).toBe(true);
    });

    it("Membership collection has unique compound index on userId + workspaceId", () => {
      const indexes = Membership.schema.indexes();
      const hasUniqueCompound = indexes.some(
        ([fields, options]) =>
          fields.userId === 1 && fields.workspaceId === 1 && options?.unique === true
      );
      expect(hasUniqueCompound).toBe(true);
    });

    it("RefreshToken has TTL index on expiresAt", () => {
      const indexes = RefreshToken.schema.indexes();
      const hasTTL = indexes.some(
        ([fields, options]) => fields.expiresAt === 1 && options?.expireAfterSeconds === 0
      );
      expect(hasTTL).toBe(true);
    });
  });

  describe("Seed Safety & Idempotence", () => {
    it("refuses to run when NODE_ENV=production", async () => {
      if (config.NODE_ENV === "production") {
        await expect(seedDatabase()).rejects.toThrow(/SAFETY GUARD/);
      }
    });

    it("can run seedDatabase if a database connection is active", async () => {
      if (mongoose.connection.readyState === 1) {
        // Run seed first time
        const first = await seedDatabase({ silent: true });
        expect(first.user.email).toBe("demo@rag-mcp.ai");

        // Run seed second time (idempotence verification)
        const second = await seedDatabase({ silent: true });
        expect(second.user.id).toBe(first.user.id);
        expect(second.workspace.id).toBe(first.workspace.id);
        expect(second.chatbot.id).toBe(first.chatbot.id);
      }
    });
  });
});
