import mongoose from "mongoose";
import { applyToJSONTransform } from "./plugins.js";

const conversationSchema = new mongoose.Schema(
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
      default: null,
      index: true,
    },
    chatbotId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Chatbot",
      default: null,
      index: true,
    },
    title: {
      type: String,
      default: "New Conversation",
      trim: true,
    },
    isPinned: {
      type: Boolean,
      default: false,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

conversationSchema.index({ workspaceId: 1, createdAt: -1 });
conversationSchema.index({ chatbotId: 1, createdAt: -1 });

applyToJSONTransform(conversationSchema);

export const Conversation =
  mongoose.models.Conversation || mongoose.model("Conversation", conversationSchema);
export default Conversation;

