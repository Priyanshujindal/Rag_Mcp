import mongoose from "mongoose";
import { applyToJSONTransform } from "./plugins.js";

const evalSampleSchema = new mongoose.Schema(
  {
    id: { type: String },
    question: { type: String, required: true },
    groundTruth: { type: String, default: "" },
    hit: { type: Boolean, default: false },
    firstHitRank: { type: Number, default: null },
    faithfulnessScore: { type: Number, default: 0 },
    relevanceScore: { type: Number, default: 0 },
    contextRecallScore: { type: Number, default: 0 },
    isHallucinated: { type: Boolean, default: false },
    retrievedChunkIds: [{ type: String }],
  },
  { _id: false }
);

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
    testSuite: {
      type: String,
      default: "RAG Golden Q&A Benchmark",
    },
    model: {
      type: String,
      default: "gemini-3.8-flash",
    },
    samplesCount: {
      type: Number,
      default: 0,
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
    mrr: {
      type: Number,
      default: 0,
    },
    hallucinationRate: {
      type: Number,
      default: 0,
    },
    samples: {
      type: [evalSampleSchema],
      default: [],
    },
    status: {
      type: String,
      enum: ["PENDING", "RUNNING", "COMPLETED", "FAILED"],
      default: "PENDING",
      index: true,
    },
    error: {
      type: String,
      default: null,
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
