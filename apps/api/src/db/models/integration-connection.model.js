import mongoose from "mongoose";
import { encryptToken, decryptToken } from "../../utils/encryption.js";

const toolSettingSchema = new mongoose.Schema(
  {
    enabled: { type: Boolean, default: true },
    permission: {
      type: String,
      enum: ["auto", "always_ask", "deny"],
      default: "auto",
    },
  },
  { _id: false }
);

const integrationConnectionSchema = new mongoose.Schema(
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
      required: true,
      index: true,
    },
    integrationId: {
      type: String,
      required: true,
      index: true,
      // e.g. "gmail", "google_drive", "google_calendar", "notion", "github", "slack", "linear"
    },
    providerAccountId: {
      type: String,
      default: "",
    },
    accountDisplayName: {
      type: String,
      required: true,
      trim: true,
    },
    accountEmail: {
      type: String,
      default: "",
      trim: true,
    },
    avatarUrl: {
      type: String,
      default: "",
    },
    status: {
      type: String,
      enum: ["connected", "expired", "revoked", "error", "disconnected"],
      default: "connected",
      index: true,
    },
    authType: {
      type: String,
      enum: ["oauth2", "token", "api_key"],
      default: "oauth2",
    },
    grantedScopes: {
      type: [String],
      default: [],
    },
    encryptedAccessToken: {
      type: String,
      default: "",
    },
    encryptedRefreshToken: {
      type: String,
      default: "",
    },
    tokenExpiresAt: {
      type: Date,
      default: null,
    },
    toolSettings: {
      type: Map,
      of: toolSettingSchema,
      default: () => new Map(),
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({}),
    },
    enabled: {
      type: Boolean,
      default: true,
    },
    lastConnectedAt: {
      type: Date,
      default: Date.now,
    },
    lastUsedAt: {
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

// Compound indexes for tenant queries
integrationConnectionSchema.index({ workspaceId: 1, userId: 1, integrationId: 1 });
integrationConnectionSchema.index({ workspaceId: 1, userId: 1, status: 1 });

// Helper methods to set and get tokens
integrationConnectionSchema.methods.setTokens = function ({ accessToken, refreshToken, expiresAt }) {
  if (accessToken) {
    this.encryptedAccessToken = encryptToken(accessToken);
  }
  if (refreshToken) {
    this.encryptedRefreshToken = encryptToken(refreshToken);
  }
  if (expiresAt) {
    this.tokenExpiresAt = expiresAt instanceof Date ? expiresAt : new Date(expiresAt);
  }
};

integrationConnectionSchema.methods.getAccessToken = function () {
  return decryptToken(this.encryptedAccessToken);
};

integrationConnectionSchema.methods.getRefreshToken = function () {
  return decryptToken(this.encryptedRefreshToken);
};

// Mask sensitive credentials in JSON serialization
integrationConnectionSchema.methods.toJSON = function () {
  const obj = this.toObject();
  delete obj.encryptedAccessToken;
  delete obj.encryptedRefreshToken;
  obj.hasAccessToken = Boolean(this.encryptedAccessToken);
  obj.hasRefreshToken = Boolean(this.encryptedRefreshToken);
  return obj;
};

export const IntegrationConnection = mongoose.models.IntegrationConnection || mongoose.model("IntegrationConnection", integrationConnectionSchema);
export default IntegrationConnection;
