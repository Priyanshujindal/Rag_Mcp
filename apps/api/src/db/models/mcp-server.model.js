import mongoose from "mongoose";
import { applyToJSONTransform } from "./plugins.js";

const mcpToolSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    description: { type: String, default: "" },
    enabled: { type: Boolean, default: true },
    requiresApproval: { type: Boolean, default: false },
  },
  { _id: false }
);

const mcpServerSchema = new mongoose.Schema(
  {
    workspaceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Workspace",
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    url: {
      type: String,
      default: null,
    },
    command: {
      type: String,
      default: null,
    },
    transport: {
      type: String,
      enum: ["SSE", "STDIO", "HTTP"],
      default: "SSE",
    },
    status: {
      type: String,
      enum: ["CONNECTED", "DISCONNECTED", "ERROR"],
      default: "DISCONNECTED",
    },
    tools: {
      type: [mcpToolSchema],
      default: [],
    },
  },
  {
    timestamps: true,
  }
);

mcpServerSchema.index({ workspaceId: 1, createdAt: -1 });

applyToJSONTransform(mcpServerSchema);

export const McpServer =
  mongoose.models.McpServer || mongoose.model("McpServer", mcpServerSchema);
export default McpServer;

