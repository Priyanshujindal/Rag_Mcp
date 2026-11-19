import mongoose from "mongoose";
import { applyToJSONTransform } from "./plugins.js";

const apiKeySchema = new mongoose.Schema(
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
    prefix: {
      type: String,
      required: true,
    },
    keyHash: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    lastUsedAt: {
      type: Date,
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

applyToJSONTransform(apiKeySchema);

export const ApiKey = mongoose.models.ApiKey || mongoose.model("ApiKey", apiKeySchema);
export default ApiKey;

