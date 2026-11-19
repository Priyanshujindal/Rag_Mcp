import mongoose from "mongoose";
import { applyToJSONTransform } from "./plugins.js";

const sourceSchema = new mongoose.Schema(
  {
    workspaceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Workspace",
      required: true,
      index: true,
    },
    knowledgeBaseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "KnowledgeBase",
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: ["URL", "PDF", "DOCX", "TXT", "CSV"],
      required: true,
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
    fileKey: {
      type: String,
      default: null,
    },
    status: {
      type: String,
      enum: ["QUEUED", "CRAWLING", "PROCESSING", "INDEXING", "INDEXED", "FAILED"],
      default: "QUEUED",
      index: true,
    },
    chunkCount: {
      type: Number,
      default: 0,
    },
    extractedTextPreview: {
      type: String,
      default: null,
    },
    extractedCharCount: {
      type: Number,
      default: 0,
    },
    embeddingStatus: {
      type: String,
      enum: ["PENDING", "PROCESSING", "COMPLETED", "FAILED"],
      default: null,
    },
    embeddingsGenerated: {
      type: Number,
      default: 0,
    },
    indexingStartedAt: {
      type: Date,
      default: null,
    },
    indexingCompletedAt: {
      type: Date,
      default: null,
    },
    indexingDurationMs: {
      type: Number,
      default: null,
    },
    error: {
      type: String,
      default: null,
    },
    lastIndexedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

sourceSchema.index({ workspaceId: 1, knowledgeBaseId: 1 });
sourceSchema.index({ knowledgeBaseId: 1, status: 1 });
sourceSchema.index({ workspaceId: 1, createdAt: -1 });

applyToJSONTransform(sourceSchema);

export const Source = mongoose.models.Source || mongoose.model("Source", sourceSchema);
export default Source;

