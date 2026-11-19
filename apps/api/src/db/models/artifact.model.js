import mongoose from "mongoose";
import { applyToJSONTransform } from "./plugins.js";

const artifactSchema = new mongoose.Schema(
  {
    workspaceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Workspace",
      required: true,
      index: true,
    },
    conversationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Conversation",
      required: true,
      index: true,
    },
    messageId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Message",
      required: false,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: false,
    },
    filename: {
      type: String,
      required: true,
    },
    fileType: {
      type: String,
      required: true,
      lowercase: true,
    },
    mimeType: {
      type: String,
      required: true,
    },
    sizeBytes: {
      type: Number,
      required: true,
      default: 0,
    },
    storageKey: {
      type: String,
      required: true,
    },
    storagePath: {
      type: String,
      required: true,
    },
    previewData: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    status: {
      type: String,
      enum: ["generating", "ready", "failed"],
      default: "ready",
    },
  },
  {
    timestamps: true,
  }
);

artifactSchema.index({ workspaceId: 1, createdAt: -1 });

applyToJSONTransform(artifactSchema);

export const Artifact = mongoose.models.Artifact || mongoose.model("Artifact", artifactSchema);
export default Artifact;

