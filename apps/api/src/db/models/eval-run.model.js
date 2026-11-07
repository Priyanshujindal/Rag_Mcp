import mongoose from "mongoose";
import { applyToJSONTransform } from "./plugins.js";

const evalRunSchema = new mongoose.Schema(
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
    relevance: {
      type: Number,
      default: 0,
    },
    faithfulness: {
      type: Number,
      default: 0,
    },
    retrievalAccuracy: {
      type: Number,
      default: 0,
    },
    status: {
      type: String,
      enum: ["PENDING", "RUNNING", "COMPLETED", "FAILED"],
      default: "PENDING",
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

evalRunSchema.index({ workspaceId: 1, createdAt: -1 });
evalRunSchema.index({ knowledgeBaseId: 1, createdAt: -1 });

applyToJSONTransform(evalRunSchema);

export const EvalRun = mongoose.models.EvalRun || mongoose.model("EvalRun", evalRunSchema);
export default EvalRun;

