import mongoose from "mongoose";
import { applyToJSONTransform } from "./plugins.js";

const apiKeyRateLimitSchema = new mongoose.Schema(
  {
    requestsPerMinute: {
      type: Number,
      default: 60,
    },
    requestsPerHour: {
      type: Number,
      default: 1000,
    },
  },
  { _id: false }
);

const apiKeyUsageSchema = new mongoose.Schema(
  {
    totalRequests: {
      type: Number,
      default: 0,
    },
    successfulRequests: {
      type: Number,
      default: 0,
    },
    failedRequests: {
      type: Number,
      default: 0,
    },
    rateLimitedRequests: {
      type: Number,
      default: 0,
    },
    totalInputTokens: {
      type: Number,
      default: 0,
    },
    totalOutputTokens: {
      type: Number,
      default: 0,
    },
  },
  { _id: false }
);

const apiKeySchema = new mongoose.Schema(
  {
    workspaceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Workspace",
      required: true,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },
    chatbotId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Chatbot",
      default: null,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    keyType: {
      type: String,
      enum: ["publishable", "secret"],
      default: "secret",
      index: true,
    },
    prefix: {
      type: String,
      required: true,
    },
    maskedKey: {
      type: String,
      default: "",
    },
    keyHash: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    allowedOrigins: {
      type: [String],
      default: [],
    },
    permissions: {
      type: [String],
      default: ["chat:read", "chat:write"],
    },
    status: {
      type: String,
      enum: ["active", "revoked", "disabled"],
      default: "active",
      index: true,
    },
    rateLimit: {
      type: apiKeyRateLimitSchema,
      default: () => ({ requestsPerMinute: 60, requestsPerHour: 1000 }),
    },
    usage: {
      type: apiKeyUsageSchema,
      default: () => ({
        totalRequests: 0,
        successfulRequests: 0,
        failedRequests: 0,
        rateLimitedRequests: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
      }),
    },
    expiresAt: {
      type: Date,
      default: null,
    },
    lastUsedAt: {
      type: Date,
      default: null,
    },
    lastUsedIp: {
      type: String,
      default: null,
    },
    lastUsedOrigin: {
      type: String,
      default: null,
    },
    revokedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

apiKeySchema.index({ workspaceId: 1, createdAt: -1 });
apiKeySchema.index({ chatbotId: 1, status: 1 });
apiKeySchema.index({ keyHash: 1, status: 1 });

applyToJSONTransform(apiKeySchema);

export const ApiKey = mongoose.models.ApiKey || mongoose.model("ApiKey", apiKeySchema);
export default ApiKey;
