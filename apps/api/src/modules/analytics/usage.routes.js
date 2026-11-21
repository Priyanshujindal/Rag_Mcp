import { Router } from "express";
import { authenticate } from "../../middleware/auth.middleware.js";
import { tenantGuard } from "../../middleware/tenant-guard.middleware.js";
import config from "../../config/index.js";
import { KnowledgeBase, Source, Chatbot } from "../../db/models/index.js";
import aiClient from "../../services/ai-client.js";
import usageService from "../usage/usage.service.js";

const router = Router();

router.use(authenticate, tenantGuard);

/**
 * GET /api/v1/usage/overview
 * Comprehensive dashboard summary of current usage, limits, plan, and warnings.
 */
router.get("/overview", async (req, res, next) => {
  try {
    const summary = await usageService.getWorkspaceUsageSummary(req.workspaceId, {
      period: req.query.period,
      startDate: req.query.startDate,
      endDate: req.query.endDate,
    });
    res.status(200).json(summary);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/usage/limits
 * Detailed limit breakdown with percentage consumed and threshold statuses.
 */
router.get("/limits", async (req, res, next) => {
  try {
    const summary = await usageService.getWorkspaceUsageSummary(req.workspaceId, {
      period: req.query.period,
    });
    res.status(200).json({
      plan: summary.plan,
      limits: summary.metrics,
      warnings: summary.warnings,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/usage/analytics
 * Time-series daily metrics for charts, token breakdown, and provider/model distributions.
 */
router.get("/analytics", async (req, res, next) => {
  try {
    const analytics = await usageService.getUsageAnalytics(req.workspaceId, {
      days: req.query.days || 7,
    });
    res.status(200).json(analytics);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/usage/history
 * Paginated, searchable event audit log with redacted safe metadata.
 */
router.get("/history", async (req, res, next) => {
  try {
    const history = await usageService.getUsageHistory(req.workspaceId, req.query);
    res.status(200).json(history);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/usage
 * Backward-compatible root endpoint supporting legacy dashboard and test suites.
 */
router.get("/", async (req, res, next) => {
  try {
    const workspaceId = req.workspaceId;

    const [kbCount, sourceCount, botCount, aiUsage, analyticsData, summary] = await Promise.all([
      KnowledgeBase.countDocuments({ workspaceId }),
      Source.countDocuments({ workspaceId }),
      Chatbot.countDocuments({ workspaceId }),
      aiClient.getUsage(workspaceId),
      usageService.getUsageAnalytics(workspaceId, { days: 7 }),
      usageService.getWorkspaceUsageSummary(workspaceId),
    ]);

    const dailyMetrics =
      Array.isArray(analyticsData?.dailyMetrics) && analyticsData.dailyMetrics.length > 0
        ? analyticsData.dailyMetrics
        : [];

    res.status(200).json({
      knowledgeBases: {
        count: kbCount,
        limit: config.MAX_KBS_PER_WORKSPACE,
      },
      sources: {
        count: sourceCount,
        limit: config.MAX_SOURCES_PER_KB,
      },
      chatbots: {
        count: botCount,
        limit: 0, // unlimited
      },
      storage: {
        usedMb: summary.storageDetails?.usedMb || aiUsage?.estimatedMb || 0,
        limitMb: config.MAX_UPLOAD_MB,
        totalChunks: aiUsage?.totalChunks || 0,
        maxChunks: aiUsage?.maxChunks || 5000,
        capacityMb: aiUsage?.capacityMb || 400,
        chunkCapacityPercent: aiUsage?.chunkCapacityPercent || 0,
      },
      dailyMetrics,
      plan: summary.plan,
      metrics: summary.metrics,
      warnings: summary.warnings,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
