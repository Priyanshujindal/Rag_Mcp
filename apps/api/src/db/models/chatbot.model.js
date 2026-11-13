import mongoose from "mongoose";
import { applyToJSONTransform } from "./plugins.js";

const chatbotConfigSchema = new mongoose.Schema(
  {
    theme: {
      type: String,
      default: "dark",
    },
    welcomeMessage: {
      type: String,
      default: "Hello! How can I help you today?",
    },
    systemPrompt: {
      type: String,
      default: "You are a helpful assistant.",
    },
    suggestedQuestions: {
      type: [String],
      default: [],
    },
    position: {
      type: String,
      enum: ["bottom-right", "bottom-left"],
      default: "bottom-right",
    },
    primaryColor: {
      type: String,
      default: "#10a37f",
    },
  },
  { _id: false }
);

const chatbotSchema = new mongoose.Schema(
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
      default: null,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    status: {
      type: String,
      enum: ["ACTIVE", "PAUSED", "DRAFT"],
      default: "DRAFT",
    },
    publicId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    config: {
      type: chatbotConfigSchema,
      default: () => ({}),
    },
    allowedOrigins: {
      type: [String],
      default: ["*"],
    },
  },
  {
    timestamps: true,
  }
);

chatbotSchema.index({ workspaceId: 1, createdAt: -1 });

applyToJSONTransform(chatbotSchema);

export const Chatbot = mongoose.models.Chatbot || mongoose.model("Chatbot", chatbotSchema);
export default Chatbot;

