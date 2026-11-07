import mongoose from "mongoose";
import { applyToJSONTransform } from "./plugins.js";

const citationSchema = new mongoose.Schema(
  {
    title: { type: String, default: "" },
    url: { type: String, default: "" },
    chunkId: { type: String, default: "" },
    snippet: { type: String, default: "" },
    score: { type: Number, default: 0 },
  },
  { _id: false }
);

const messageSchema = new mongoose.Schema(
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
    role: {
      type: String,
      enum: ["USER", "ASSISTANT", "SYSTEM"],
      required: true,
    },
    content: {
      type: String,
      required: true,
    },
    reasoning: {
      type: String,
      default: "",
    },
    attachedDocument: {
      name: { type: String },
      size: { type: Number },
      type: { type: String },
      content: { type: String, default: "" },
    },
    attachedDocuments: [
      {
        name: { type: String },
        size: { type: Number },
        type: { type: String },
        content: { type: String, default: "" },
        pages: { type: Number, default: 1 },
        characterCount: { type: Number, default: 0 },
      },
    ],
    citations: {
      type: [citationSchema],
      default: [],
    },
    toolCalls: [
      {
        id: { type: String },
        toolName: { type: String },
        serverName: { type: String },
        args: { type: mongoose.Schema.Types.Mixed },
        status: { type: String, enum: ["pending", "executing", "completed", "rejected"], default: "pending" },
        requiresApproval: { type: Boolean, default: false },
        result: { type: mongoose.Schema.Types.Mixed },
      },
    ],
    tokenUsage: {
      promptTokens: { type: Number, default: 0 },
      completionTokens: { type: Number, default: 0 },
      totalTokens: { type: Number, default: 0 },
    },
    latencyMs: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  }
);

// Compound index for chronological querying within a conversation
messageSchema.index({ conversationId: 1, createdAt: 1 });
messageSchema.index({ workspaceId: 1, conversationId: 1 });

applyToJSONTransform(messageSchema);

export const Message = mongoose.models.Message || mongoose.model("Message", messageSchema);
export default Message;

