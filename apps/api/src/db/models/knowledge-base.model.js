import mongoose from "mongoose";
import { applyToJSONTransform } from "./plugins.js";

const knowledgeBaseSchema = new mongoose.Schema(
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
    description: {
      type: String,
      default: "",
    },
    status: {
      type: String,
      enum: ["ACTIVE", "INDEXING", "PAUSED", "FAILED"],
      default: "ACTIVE",
    },
  },
  {
    timestamps: true,
  }
);

knowledgeBaseSchema.index({ workspaceId: 1, createdAt: -1 });

applyToJSONTransform(knowledgeBaseSchema);

export const KnowledgeBase =
  mongoose.models.KnowledgeBase || mongoose.model("KnowledgeBase", knowledgeBaseSchema);
export default KnowledgeBase;

