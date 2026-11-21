import mongoose from "mongoose";
import { applyToJSONTransform } from "./plugins.js";

const usageEventSchema = new mongoose.Schema(
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
    eventType: {
      type: String,
      required: true,
      index: true,
    },
    category: {
      type: String,
      enum: ["ai", "chat", "rag", "storage", "mcp", "public_api", "file"],
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ["success", "failed", "rate_limited", "blocked"],
      default: "success",
      index: true,
    },
    tokens: {
      promptTokens: { type: Number, default: 0 },
      completionTokens: { type: Number, default: 0 },
      totalTokens: { type: Number, default: 0 },
      isEstimated: { type: Boolean, default: false },
    },
    storageBytes: {
      type: Number,
      default: 0,
    },
    provider: {
      type: String,
      default: null,
    },
    model: {
      type: String,
      default: null,
    },
    chatbotId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Chatbot",
      default: null,
      index: true,
    },
    apiKeyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ApiKey",
      default: null,
      index: true,
    },
    mcpServerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "McpServer",
      default: null,
    },
    toolName: {
      type: String,
      default: null,
    },
    fileType: {
      type: String,
      default: null,
    },
    durationMs: {
      type: Number,
      default: 0,
    },
    costUsd: {
      type: Number,
      default: 0,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
  }
);

// Compound indexes for performant aggregation and time-range filtering
usageEventSchema.index({ workspaceId: 1, createdAt: -1 });
usageEventSchema.index({ workspaceId: 1, category: 1, createdAt: -1 });
usageEventSchema.index({ workspaceId: 1, eventType: 1, createdAt: -1 });
usageEventSchema.index({ workspaceId: 1, status: 1, createdAt: -1 });

applyToJSONTransform(usageEventSchema);

export const UsageEvent =
  mongoose.models.UsageEvent || mongoose.model("UsageEvent", usageEventSchema);
export default UsageEvent;
