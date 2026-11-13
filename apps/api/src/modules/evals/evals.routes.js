import { Router } from "express";
import { authenticate } from "../../middleware/auth.middleware.js";
import { tenantGuard } from "../../middleware/tenant-guard.middleware.js";
import { EvalRun, KnowledgeBase, Membership } from "../../db/models/index.js";
import { aiClient } from "../../services/ai-client.js";
import { AppError } from "../../utils/app-error.js";
import logger from "../../utils/logger.js";

const router = Router();

// Standard golden Q&A evaluation benchmark queries
const DEFAULT_BENCHMARK_QUERIES = [
  {
    id: "q1",
    question: "What is the primary architecture and system purpose described in the knowledge base?",
    expected_keywords: ["architecture", "system", "service", "data", "api"],
  },
  {
    id: "q2",
    question: "How is authentication, authorization, or access control managed?",
    expected_keywords: ["auth", "token", "permission", "role", "key", "access"],
  },
  {
    id: "q3",
    question: "What are the core technical workflows, indexing steps, or data pipelines?",
    expected_keywords: ["workflow", "pipeline", "index", "vector", "chunk", "process"],
  },
  {
    id: "q4",
    question: "What error handling, fallback strategies, or rate limiting mechanisms are in place?",
    expected_keywords: ["error", "limit", "retry", "fallback", "status", "exception"],
  },
];

/**
 * GET /api/v1/evals
 * List all evaluation runs for the current workspace
 */
router.get("/", authenticate, tenantGuard, async (req, res, next) => {
  try {
    let workspaceId = req.workspaceId || req.headers["x-workspace-id"];
    if (!workspaceId && req.user?.id) {
      const m = await Membership.findOne({ userId: req.user.id });
      if (m) workspaceId = m.workspaceId;
    }

    if (!workspaceId) {
      return next(AppError.badRequest("Workspace ID required"));
    }

    const runs = await EvalRun.find({ workspaceId })
      .populate("knowledgeBaseId", "name description")
      .sort({ createdAt: -1 })
      .limit(50);

    const formatted = runs.map((r) => {
      const kb = r.knowledgeBaseId || {};
      return {
        id: r._id.toString(),
        testSuite: r.testSuite,
        model: r.model,
        knowledgeBaseId: kb._id ? kb._id.toString() : r.knowledgeBaseId?.toString(),
        knowledgeBaseName: kb.name || "Default Knowledge Base",
        samplesCount: r.samplesCount || r.samples?.length || 0,
        faithfulnessScore: r.faithfulness || 0,
        relevanceScore: r.relevance || 0,
        contextRecallScore: r.retrievalAccuracy || 0,
        hallucinationRate: r.hallucinationRate || 0,
        status: (r.status || "COMPLETED").toLowerCase(),
        runAt: r.createdAt,
      };
    });

    res.json(formatted);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/evals/:id
 * Get single eval run with sample-level breakdown
 */
router.get("/:id", authenticate, tenantGuard, async (req, res, next) => {
  try {
    let workspaceId = req.workspaceId || req.headers["x-workspace-id"];
    if (!workspaceId && req.user?.id) {
      const m = await Membership.findOne({ userId: req.user.id });
      if (m) workspaceId = m.workspaceId;
    }

    const run = await EvalRun.findOne({
      _id: req.params.id,
      ...(workspaceId && { workspaceId }),
    }).populate("knowledgeBaseId", "name description");

    if (!run) {
      throw AppError.notFound("Evaluation run not found");
    }

    res.json(run);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/evals/run
 * Trigger an automated RAG evaluation run
 */
router.post("/run", authenticate, tenantGuard, async (req, res, next) => {
  try {
    const {
      knowledgeBaseId,
      testSuite = "RAG Golden Q&A Benchmark",
      model = "gemini-3.8-flash",
      queries,
      top_k = 5,
      strategy = "auto",
    } = req.body;

    let workspaceId = req.workspaceId || req.headers["x-workspace-id"];
    if (!workspaceId && req.user?.id) {
      const m = await Membership.findOne({ userId: req.user.id });
      if (m) workspaceId = m.workspaceId;
    }

    if (!workspaceId) {
      return next(AppError.badRequest("Workspace ID required"));
    }

    if (!knowledgeBaseId) {
      return next(AppError.badRequest("Knowledge Base ID is required to run evaluation"));
    }

    const kb = await KnowledgeBase.findById(knowledgeBaseId);
    if (!kb) {
      throw AppError.notFound("Knowledge Base not found");
    }

    // 1. Create initial PENDING record
    const evalRun = await EvalRun.create({
      workspaceId,
      knowledgeBaseId,
      testSuite,
      model,
      status: "RUNNING",
    });

    const evalQueries = Array.isArray(queries) && queries.length > 0 ? queries : DEFAULT_BENCHMARK_QUERIES;

    try {
      // 2. Call AI service to benchmark retrieval and answer generation
      const aiResponse = await aiClient.evaluate(workspaceId.toString(), {
        knowledgeBaseId,
        queries: evalQueries,
        top_k: Number(top_k),
        strategy,
      });

      // 3. Process results and calculate hallucination indicators
      const samples = (aiResponse.results || []).map((item) => {
        const isHallucinated = item.faithfulness_score < 0.6;
        return {
          id: item.id,
          question: item.question,
          groundTruth: "",
          hit: Boolean(item.hit),
          firstHitRank: item.first_hit_rank || null,
          faithfulnessScore: item.faithfulness_score || 0,
          relevanceScore: item.relevance_score || 0,
          contextRecallScore: item.hit ? 1.0 : (item.reciprocal_rank || 0),
          isHallucinated,
          retrievedChunkIds: item.retrieved_chunk_ids || [],
        };
      });

      const hallucinationCount = samples.filter((s) => s.isHallucinated).length;
      const hallucinationRate = samples.length > 0 ? round(hallucinationCount / samples.length, 3) : 0;

      evalRun.relevance = aiResponse.avg_relevance || 0;
      evalRun.faithfulness = aiResponse.avg_faithfulness || 0;
      evalRun.retrievalAccuracy = aiResponse.hit_rate_at_k || 0;
      evalRun.mrr = aiResponse.mrr || 0;
      evalRun.samplesCount = samples.length;
      evalRun.hallucinationRate = hallucinationRate;
      evalRun.samples = samples;
      evalRun.status = "COMPLETED";
      await evalRun.save();

      logger.info({
        evalRunId: evalRun._id.toString(),
        faithfulness: evalRun.faithfulness,
        relevance: evalRun.relevance,
        accuracy: evalRun.retrievalAccuracy,
        msg: "Evaluation run completed successfully",
      });

      return res.status(201).json({
        id: evalRun._id.toString(),
        testSuite: evalRun.testSuite,
        model: evalRun.model,
        knowledgeBaseId: kb._id.toString(),
        knowledgeBaseName: kb.name,
        samplesCount: evalRun.samplesCount,
        faithfulnessScore: evalRun.faithfulness,
        relevanceScore: evalRun.relevance,
        contextRecallScore: evalRun.retrievalAccuracy,
        hallucinationRate: evalRun.hallucinationRate,
        status: "completed",
        runAt: evalRun.createdAt,
        samples,
      });
    } catch (evalErr) {
      logger.error({ err: evalErr.message, msg: "AI evaluation execution failed" });
      evalRun.status = "FAILED";
      evalRun.error = evalErr.message;
      await evalRun.save();
      throw evalErr;
    }
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/v1/evals/:id
 * Delete an evaluation run
 */
router.delete("/:id", authenticate, tenantGuard, async (req, res, next) => {
  try {
    let workspaceId = req.workspaceId || req.headers["x-workspace-id"];
    const run = await EvalRun.findOneAndDelete({
      _id: req.params.id,
      ...(workspaceId && { workspaceId }),
    });

    if (!run) {
      throw AppError.notFound("Evaluation run not found");
    }

    res.json({ success: true, message: "Evaluation run deleted" });
  } catch (err) {
    next(err);
  }
});

function round(val, dec = 3) {
  const factor = Math.pow(10, dec);
  return Math.round(val * factor) / factor;
}

export default router;

