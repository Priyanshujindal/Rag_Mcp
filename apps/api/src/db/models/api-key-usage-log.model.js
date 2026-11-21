import mongoose from "mongoose";
import { applyToJSONTransform } from "./plugins.js";

const apiKeyUsageLogSchema = new mongoose.Schema(
  {
    workspaceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Workspace",
      required: true,
      index: true,
    },
    apiKeyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ApiKey",
      required: true,
      index: true,
    },
    chatbotId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Chatbot",
      required: true,
      index: true,
    },
    keyType: {
      type: String,
      enum: ["publishable", "secret"],
      required: true,
    },
    endpoint: {
      type: String,
      required: true,
      trim: true,
    },
    statusCode: {
      type: Number,
      required: true,
    },
    durationMs: {
      type: Number,
      default: 0,
    },
    inputTokens: {
      type: Number,
      default: 0,
    },
    outputTokens: {
      type: Number,
      default: 0,
    },
    origin: {
      type: String,
      default: null,
    },
    ip: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
  }
);

apiKeyUsageLogSchema.index({ workspaceId: 1, createdAt: -1 });
apiKeyUsageLogSchema.index({ apiKeyId: 1, createdAt: -1 });
apiKeyUsageLogSchema.index({ chatbotId: 1, createdAt: -1 });

applyToJSONTransform(apiKeyUsageLogSchema);

export const ApiKeyUsageLog =
  mongoose.models.ApiKeyUsageLog || mongoose.model("ApiKeyUsageLog", apiKeyUsageLogSchema);
export default ApiKeyUsageLog;
