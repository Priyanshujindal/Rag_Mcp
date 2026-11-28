import mongoose from "mongoose";
import { applyToJSONTransform } from "./plugins.js";

const mcpToolSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    description: { type: String, default: "" },
    inputSchema: { type: mongoose.Schema.Types.Mixed, default: {} },
    enabled: { type: Boolean, default: true },
    permission: {
      type: String,
      enum: ["always_ask", "auto", "deny"],
      default: "auto",
    },
    requiresApproval: { type: Boolean, default: false },
    lastExecutionStatus: { type: String, default: null },
    lastExecutedAt: { type: Date, default: null },
    lastDiscoveredAt: { type: Date, default: Date.now },
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
    ownerUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      default: "",
      trim: true,
    },
    url: {
      type: String,
      default: null,
      trim: true,
    },
    command: {
      type: String,
      default: null,
      trim: true,
    },
    args: {
      type: [String],
      default: [],
    },
    rawConfig: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    type: {
      type: String,
      enum: ["custom", "builtin", "integration"],
      default: "custom",
    },
    transport: {
      type: String,
      enum: ["STREAMABLE_HTTP", "HTTP", "SSE", "STDIO"],
      default: "STREAMABLE_HTTP",
    },
    headers: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    env: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    status: {
      type: String,
      enum: ["CONNECTED", "CONNECTING", "DISCONNECTED", "ERROR"],
      default: "DISCONNECTED",
    },
    healthStatus: {
      type: String,
      enum: ["healthy", "degraded", "offline"],
      default: "offline",
    },
    enabled: {
      type: Boolean,
      default: true,
    },
    tools: {
      type: [mcpToolSchema],
      default: [],
    },
    capabilities: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    lastConnectedAt: {
      type: Date,
      default: null,
    },
    lastError: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

mcpServerSchema.index({ workspaceId: 1, createdAt: -1 });

// Redact sensitive authorization headers and environment variables from JSON output
mcpServerSchema.methods.toJSON = function () {
  const obj = this.toObject();
  if (obj.headers && typeof obj.headers === "object") {
    const masked = {};
    for (const [k, v] of Object.entries(obj.headers)) {
      if (
        k.toLowerCase().includes("auth") ||
        k.toLowerCase().includes("key") ||
        k.toLowerCase().includes("secret") ||
        k.toLowerCase().includes("token")
      ) {
        masked[k] = v ? "••••••••" : "";
      } else {
        masked[k] = v;
      }
    }
    obj.headers = masked;
  }
  if (obj.env && typeof obj.env === "object") {
    const maskedEnv = {};
    for (const [k, v] of Object.entries(obj.env)) {
      if (
        k.toLowerCase().includes("key") ||
        k.toLowerCase().includes("secret") ||
        k.toLowerCase().includes("token") ||
        k.toLowerCase().includes("pass") ||
        k.toLowerCase().includes("auth")
      ) {
        maskedEnv[k] = v ? "••••••••" : "";
      } else {
        maskedEnv[k] = v;
      }
    }
    obj.env = maskedEnv;
  }
  return obj;
};

applyToJSONTransform(mcpServerSchema);

export const McpServer =
  mongoose.models.McpServer || mongoose.model("McpServer", mcpServerSchema);
export default McpServer;
