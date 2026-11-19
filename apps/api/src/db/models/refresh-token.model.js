import mongoose from "mongoose";
import { applyToJSONTransform } from "./plugins.js";

const refreshTokenSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    tokenHash: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    expiresAt: {
      type: Date,
      required: true,
    },
    revokedAt: {
      type: Date,
      default: null,
    },
    rotatedAt: {
      type: Date,
      default: null,
    },
    userAgent: {
      type: String,
      default: null,
    },
    ip: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// TTL index to automatically expire MongoDB document when expiresAt arrives
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Exclude sensitive hash and internal rotatedAt timestamp from JSON outputs
applyToJSONTransform(refreshTokenSchema, ["rotatedAt"]);

export const RefreshToken =
  mongoose.models.RefreshToken || mongoose.model("RefreshToken", refreshTokenSchema);
export default RefreshToken;
