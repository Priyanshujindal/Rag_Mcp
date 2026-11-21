import mongoose from "mongoose";
import { applyToJSONTransform } from "./plugins.js";

const mcpExecutionSchema = new mongoose.Schema(
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
      index: true,
    },
    conversationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Conversation",
      index: true,
    },
    serverId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "McpServer",
      index: true,
    },
    serverName: {
      type: String,
      default: "MCP Server",
    },
    toolName: {
      type: String,
      required: true,
      index: true,
    },
    args: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    resultSummary: {
      type: String,
      default: "",
    },
    status: {
      type: String,
      enum: ["success", "error", "rejected", "timed_out"],
      default: "success",
    },
    durationMs: {
      type: Number,
      default: 0,
    },
    error: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

mcpExecutionSchema.index({ workspaceId: 1, createdAt: -1 });

applyToJSONTransform(mcpExecutionSchema);

export const McpExecution =
  mongoose.models.McpExecution || mongoose.model("McpExecution", mcpExecutionSchema);
export default McpExecution;
