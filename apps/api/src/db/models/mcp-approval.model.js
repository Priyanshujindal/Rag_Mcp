import mongoose from "mongoose";
import { applyToJSONTransform } from "./plugins.js";

const mcpApprovalSchema = new mongoose.Schema(
  {
    approvalId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
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
    toolCallId: {
      type: String,
      required: true,
    },
    serverName: {
      type: String,
      default: "MCP Server",
    },
    toolName: {
      type: String,
      required: true,
    },
    args: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected", "expired"],
      default: "pending",
      index: true,
    },
    resolvedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

mcpApprovalSchema.index({ workspaceId: 1, status: 1 });

applyToJSONTransform(mcpApprovalSchema);

export const McpApproval =
  mongoose.models.McpApproval || mongoose.model("McpApproval", mcpApprovalSchema);
export default McpApproval;
