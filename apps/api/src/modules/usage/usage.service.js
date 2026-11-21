/**
 * apps/api/src/modules/usage/usage.service.js
 * =============================================
 * Unified Usage Tracking and Limit Enforcement Service:
 * - Records canonical usage events for AI tokens, chat, RAG, storage, MCP, and public APIs
 * - Aggregates period metrics against configured workspace plan limits
 * - Provides server-side quota enforcement before operations execute
 * - Delivers time-series analytics and sanitized audit history
 */

import mongoose from "mongoose";
import {
  UsageEvent,
  Workspace,
  KnowledgeBase,
  Source,
  Chatbot,
  McpServer,
  McpExecution,
  ApiKeyUsageLog,
  Artifact,
  Message,
} from "../../db/models/index.js";
import { PLANS, METRIC_DEFINITIONS, getWorkspacePlan } from "../../config/plans.config.js";
import AppError from "../../utils/app-error.js";
import logger from "../../utils/logger.js";
import aiClient from "../../services/ai-client.js";

export const usageService = {
  /**
   * Asynchronously records a canonical usage event.
   * Runs non-blocking so it never interrupts the main chat/AI stream on telemetry failure.
   */
  recordEvent({
    workspaceId,
    userId = null,
    eventType,
    category,
    status = "success",
    tokens = { promptTokens: 0, completionTokens: 0, totalTokens: 0, isEstimated: false },
    storageBytes = 0,
    provider = null,
    model = null,
    chatbotId = null,
    apiKeyId = null,
    mcpServerId = null,
    toolName = null,
    fileType = null,
    durationMs = 0,
    costUsd = 0,
    metadata = {},
  }) {
    if (!workspaceId || !eventType || !category) {
      return;
    }

    const promptTokens = Number(tokens?.promptTokens) || 0;
    const completionTokens = Number(tokens?.completionTokens) || 0;
    const totalTokens = Number(tokens?.totalTokens) || promptTokens + completionTokens;

    UsageEvent.create({
      workspaceId,
      userId,
      eventType,
      category,
      status,
      tokens: {
        promptTokens,
        completionTokens,
        totalTokens,
        isEstimated: !!tokens?.isEstimated,
      },
      storageBytes: Number(storageBytes) || 0,
      provider,
      model,
      chatbotId,
      apiKeyId,
      mcpServerId,
      toolName,
      fileType,
      durationMs: Number(durationMs) || 0,
      costUsd: Number(costUsd) || 0,
      metadata: typeof metadata === "object" ? metadata : {},
    }).catch((err) => {
      logger.warn({ err: err.message, eventType, workspaceId }, "Failed to write UsageEvent");
    });
  },

  /**
   * Computes UTC date boundaries for a given period window.
   */
  getPeriodBoundaries(period = "month", customStartDate = null, customEndDate = null) {
    const now = new Date();
    let start = new Date();
    let end = now;

    if (customStartDate && customEndDate) {
      start = new Date(customStartDate);
      end = new Date(customEndDate);
      return { start, end };
    }

    switch (period) {
      case "day":
      case "today":
        start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0));
        break;
      case "week":
      case "7d":
        start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case "30d":
        start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      case "month":
      default:
        // Current calendar month UTC
        start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0));
        break;
    }

    return { start, end };
  },

  /**
   * Retrieves comprehensive workspace usage summary against configured limits.
   */
  async getWorkspaceUsageSummary(workspaceId, { period = "month", startDate = null, endDate = null } = {}) {
    const wsObjectId = new mongoose.Types.ObjectId(workspaceId.toString());
    const now = new Date();
    const { start, end } = this.getPeriodBoundaries(period, startDate, endDate);

    // 1. Fetch workspace document and plan
    const workspace = await Workspace.findById(wsObjectId);
    const plan = getWorkspacePlan(workspace);

    // 2. Query static workspace capacity resources in parallel
    const [kbCount, sourceCount, botCount, mcpServerCount, aiUsage] = await Promise.all([
      KnowledgeBase.countDocuments({ workspaceId: wsObjectId }),
      Source.countDocuments({ workspaceId: wsObjectId }),
      Chatbot.countDocuments({ workspaceId: wsObjectId }),
      McpServer.countDocuments({ workspaceId: wsObjectId }),
      aiClient.getUsage(workspaceId.toString()),
    ]);

    // 3. Query actual storage consumption from Sources and Artifacts for this user's workspace
    const [sourceStorageAgg, artifactStorageAgg] = await Promise.all([
      Source.aggregate([
        { $match: { workspaceId: wsObjectId } },
        { $group: { _id: null, totalBytes: { $sum: "$extractedCharCount" } } },
      ]),
      Artifact.aggregate([
        { $match: { workspaceId: wsObjectId } },
        { $group: { _id: null, totalBytes: { $sum: "$sizeBytes" } } },
      ]),
    ]);

    // Calculate logical storage in MB strictly for this workspace / user
    const artifactBytes = artifactStorageAgg[0]?.totalBytes || 0;
    const sourceCharBytes = sourceStorageAgg[0]?.totalBytes || 0;
    const aiStorageMb = aiUsage?.estimatedMb || 0;
    const dbStorageMb = (artifactBytes + sourceCharBytes) / (1024 * 1024);
    const userStorageMb = Number((aiStorageMb + dbStorageMb).toFixed(2));

    // 4. Aggregate period event metrics from UsageEvent collection
    const eventAgg = await UsageEvent.aggregate([
      {
        $match: {
          workspaceId: wsObjectId,
          createdAt: { $gte: start, $lte: end },
        },
      },
      {
        $group: {
          _id: "$category",
          totalEvents: { $sum: 1 },
          successfulEvents: {
            $sum: { $cond: [{ $eq: ["$status", "success"] }, 1, 0] },
          },
          promptTokens: { $sum: "$tokens.promptTokens" },
          completionTokens: { $sum: "$tokens.completionTokens" },
          totalTokens: { $sum: "$tokens.totalTokens" },
          costUsd: { $sum: "$costUsd" },
        },
      },
    ]);

    const eventMetricsMap = {};
    for (const item of eventAgg) {
      eventMetricsMap[item._id] = item;
    }

    // 5. Fallback check on primary collections if UsageEvent has not accumulated yet
    let aiTokensUsed = eventMetricsMap["ai"]?.totalTokens || 0;
    let chatRequestsUsed = eventMetricsMap["chat"]?.totalEvents || eventMetricsMap["ai"]?.totalEvents || 0;
    let publicApiRequestsUsed = eventMetricsMap["public_api"]?.totalEvents || 0;
    let mcpToolCallsUsed = eventMetricsMap["mcp"]?.totalEvents || 0;
    let fileGenerationsUsed = eventMetricsMap["file"]?.totalEvents || 0;

    // Supplement with Message collection if event logging is just starting
    if (aiTokensUsed === 0 && chatRequestsUsed === 0) {
      const msgAgg = await Message.aggregate([
        {
          $match: {
            workspaceId: wsObjectId,
            role: "ASSISTANT",
            createdAt: { $gte: start, $lte: end },
          },
        },
        {
          $group: {
            _id: null,
            count: { $sum: 1 },
            tokens: { $sum: "$tokenUsage.totalTokens" },
          },
        },
      ]);
      if (msgAgg[0]) {
        chatRequestsUsed = msgAgg[0].count;
        aiTokensUsed = msgAgg[0].tokens;
      }
    }

    // Supplement public API count if needed
    if (publicApiRequestsUsed === 0) {
      publicApiRequestsUsed = await ApiKeyUsageLog.countDocuments({
        workspaceId: wsObjectId,
        createdAt: { $gte: start, $lte: end },
      });
    }

    // Supplement MCP tool count if needed
    if (mcpToolCallsUsed === 0) {
      mcpToolCallsUsed = await McpExecution.countDocuments({
        workspaceId: wsObjectId,
        createdAt: { $gte: start, $lte: end },
      });
    }

    // Supplement Artifacts count if needed
    if (fileGenerationsUsed === 0) {
      fileGenerationsUsed = await Artifact.countDocuments({
        workspaceId: wsObjectId,
        createdAt: { $gte: start, $lte: end },
      });
    }

    // 6. Assemble metrics map with limits, percentages, and threshold statuses
    const metrics = {
      chatRequests: this._buildMetricState(
        "chatRequests",
        chatRequestsUsed,
        plan.limits.chatRequests,
        plan.thresholds
      ),
      aiTokens: this._buildMetricState(
        "aiTokens",
        aiTokensUsed,
        plan.limits.aiTokens,
        plan.thresholds
      ),
      knowledgeBases: this._buildMetricState(
        "knowledgeBases",
        kbCount,
        plan.limits.knowledgeBases,
        plan.thresholds
      ),
      documents: this._buildMetricState(
        "documents",
        sourceCount,
        plan.limits.documents,
        plan.thresholds
      ),
      storage: this._buildMetricState(
        "storage",
        userStorageMb,
        plan.limits.storage,
        plan.thresholds
      ),
      chatbots: this._buildMetricState(
        "chatbots",
        botCount,
        plan.limits.chatbots,
        plan.thresholds
      ),
      publicApiRequests: this._buildMetricState(
        "publicApiRequests",
        publicApiRequestsUsed,
        plan.limits.publicApiRequests,
        plan.thresholds
      ),
      mcpToolCalls: this._buildMetricState(
        "mcpToolCalls",
        mcpToolCallsUsed,
        plan.limits.mcpToolCalls,
        plan.thresholds
      ),
      mcpServers: this._buildMetricState(
        "mcpServers",
        mcpServerCount,
        plan.limits.mcpServers,
        plan.thresholds
      ),
      fileGenerations: this._buildMetricState(
        "fileGenerations",
        fileGenerationsUsed,
        plan.limits.fileGenerations,
        plan.thresholds
      ),
    };

    // 7. Collect active warnings (approaching, near-limit, or limit-reached)
    const warnings = [];
    for (const [key, item] of Object.entries(metrics)) {
      if (item.status === "exceeded") {
        warnings.push({
          metric: key,
          label: item.label,
          level: "danger",
          message: `${item.label} quota of ${item.limit.toLocaleString()} ${item.unit} has been reached. Operations are restricted.`,
        });
      } else if (item.status === "near_limit") {
        warnings.push({
          metric: key,
          label: item.label,
          level: "warning",
          message: `${item.label} is at ${item.percentConsumed}% (${item.used.toLocaleString()} / ${item.limit.toLocaleString()} ${item.unit}).`,
        });
      } else if (item.status === "approaching") {
        warnings.push({
          metric: key,
          label: item.label,
          level: "info",
          message: `${item.label} is at ${item.percentConsumed}% of configured monthly capacity.`,
        });
      }
    }

    return {
      plan: {
        id: plan.id,
        name: plan.name,
        description: plan.description,
        isBillingActive: plan.isBillingActive,
        period: {
          type: period,
          start: start.toISOString(),
          end: end.toISOString(),
          resetAt: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0)).toISOString(),
        },
      },
      metrics,
      warnings,
      storageDetails: {
        usedMb: userStorageMb,
        limitMb: plan.limits.storage,
        sourceCharBytes,
        artifactBytes,
        aiCachedMb: aiStorageMb,
        totalChunks: aiUsage?.totalChunks || 0,
      },
    };
  },

  /**
   * Helper to format single metric state with threshold logic.
   */
  _buildMetricState(key, used, limit, thresholds) {
    const def = METRIC_DEFINITIONS[key] || {
      label: key,
      unit: "units",
      period: "month",
      description: "",
    };

    const isUnlimited = limit === null || limit === undefined;
    const safeLimit = isUnlimited ? null : Number(limit);
    const safeUsed = Number(used) || 0;
    const remaining = isUnlimited ? null : Math.max(0, safeLimit - safeUsed);
    const percentConsumed = isUnlimited || safeLimit === 0 ? 0 : Math.min(100, Math.round((safeUsed / safeLimit) * 100));

    let status = "normal";
    if (!isUnlimited && safeLimit > 0) {
      if (safeUsed >= safeLimit) {
        status = "exceeded";
      } else if (safeUsed >= safeLimit * (thresholds?.nearLimit || 0.9)) {
        status = "near_limit";
      } else if (safeUsed >= safeLimit * (thresholds?.warning || 0.7)) {
        status = "approaching";
      }
    }

    return {
      key,
      label: def.label,
      unit: def.unit,
      period: def.period,
      description: def.description,
      used: safeUsed,
      limit: safeLimit,
      remaining,
      percentConsumed,
      isUnlimited,
      status,
    };
  },

  /**
   * Evaluates whether an operation is allowed under the workspace quota.
   * @param {string} workspaceId
   * @param {string} metricKey
   * @param {number} [increment=1]
   * @returns {Promise<{ allowed: boolean, current: number, limit: number|null, metricKey: string, message?: string }>}
   */
  async checkQuota(workspaceId, metricKey, increment = 1) {
    const summary = await this.getWorkspaceUsageSummary(workspaceId);
    const metric = summary.metrics[metricKey];

    if (!metric) {
      return { allowed: true, current: 0, limit: null, metricKey };
    }

    if (metric.isUnlimited) {
      return { allowed: true, current: metric.used, limit: null, metricKey };
    }

    const projected = metric.used + increment;
    if (projected > metric.limit) {
      return {
        allowed: false,
        current: metric.used,
        limit: metric.limit,
        metricKey,
        message: `${metric.label} quota reached: ${metric.used} / ${metric.limit} ${metric.unit}. Limit resets on ${new Date(summary.plan.period.resetAt).toLocaleDateString()}.`,
      };
    }

    return {
      allowed: true,
      current: metric.used,
      limit: metric.limit,
      metricKey,
    };
  },

  /**
   * Asserts quota availability, throwing a structured HTTP 403 AppError if exhausted.
   */
  async assertQuota(workspaceId, metricKey, increment = 1) {
    const check = await this.checkQuota(workspaceId, metricKey, increment);
    if (!check.allowed) {
      throw AppError.forbidden(check.message, {
        code: "QUOTA_EXCEEDED",
        details: {
          metric: metricKey,
          current: check.current,
          limit: check.limit,
        },
      });
    }
  },

  /**
   * Retrieves sanitized, paginated usage history logs.
   */
  async getUsageHistory(
    workspaceId,
    {
      page = 1,
      limit = 50,
      category = null,
      status = null,
      startDate = null,
      endDate = null,
      chatbotId = null,
    } = {}
  ) {
    const wsObjectId = new mongoose.Types.ObjectId(workspaceId.toString());
    const query = { workspaceId: wsObjectId };

    if (category && category !== "all") query.category = category;
    if (status && status !== "all") query.status = status;
    if (chatbotId) query.chatbotId = chatbotId;

    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }

    const pageNum = Math.max(1, Number(page) || 1);
    const limitNum = Math.min(100, Math.max(1, Number(limit) || 50));
    const skip = (pageNum - 1) * limitNum;

    const [events, total] = await Promise.all([
      UsageEvent.find(query)
        .populate("chatbotId", "name publicId")
        .populate("apiKeyId", "name prefix keyType")
        .sort("-createdAt")
        .skip(skip)
        .limit(limitNum),
      UsageEvent.countDocuments(query),
    ]);

    const sanitizedEvents = events.map((ev) => {
      const json = ev.toJSON();
      // Ensure private prompts, secrets, and raw keys are strictly excluded
      delete json.metadata?.prompt;
      delete json.metadata?.secret;
      delete json.metadata?.headers;
      return json;
    });

    return {
      data: sanitizedEvents,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum),
      },
    };
  },

  /**
   * Delivers time-series daily metrics for usage charts and graphs.
   */
  async getUsageAnalytics(workspaceId, { days = 7 } = {}) {
    const wsObjectId = new mongoose.Types.ObjectId(workspaceId.toString());
    const daysNum = Math.min(90, Math.max(1, Number(days) || 7));
    const now = new Date();
    const startDate = new Date(now.getTime() - daysNum * 24 * 60 * 60 * 1000);

    // 1. Daily aggregation from UsageEvent
    const dailyAgg = await UsageEvent.aggregate([
      {
        $match: {
          workspaceId: wsObjectId,
          createdAt: { $gte: startDate },
        },
      },
      {
        $group: {
          _id: {
            $dateToString: { format: "%Y-%m-%d", date: "$createdAt" },
          },
          messages: {
            $sum: { $cond: [{ $in: ["$category", ["ai", "chat"]] }, 1, 0] },
          },
          inputTokens: { $sum: "$tokens.promptTokens" },
          outputTokens: { $sum: "$tokens.completionTokens" },
          tokens: { $sum: "$tokens.totalTokens" },
          publicApiRequests: {
            $sum: { $cond: [{ $eq: ["$category", "public_api"] }, 1, 0] },
          },
          mcpCalls: {
            $sum: { $cond: [{ $eq: ["$category", "mcp"] }, 1, 0] },
          },
          costUsd: { $sum: "$costUsd" },
          avgLatencyMs: { $avg: "$durationMs" },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    // Map by YYYY-MM-DD
    const aggMap = new Map();
    for (const d of dailyAgg) {
      aggMap.set(d._id, d);
    }

    // 2. Generate unbroken array of date points
    const dailyMetrics = [];
    for (let i = daysNum - 1; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      const isoDate = d.toISOString().split("T")[0];
      const dateLabel = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });

      const found = aggMap.get(isoDate);
      dailyMetrics.push({
        date: dateLabel,
        isoDate,
        messages: found?.messages || 0,
        tokens: found?.tokens || 0,
        inputTokens: found?.inputTokens || 0,
        outputTokens: found?.outputTokens || 0,
        publicApiRequests: found?.publicApiRequests || 0,
        mcpCalls: found?.mcpCalls || 0,
        costUsd: Number((found?.costUsd || 0).toFixed(2)),
        avgLatencyMs: Math.round(found?.avgLatencyMs || 0),
      });
    }

    // 3. Provider and Model breakdown
    const [providerBreakdown, modelBreakdown] = await Promise.all([
      UsageEvent.aggregate([
        {
          $match: {
            workspaceId: wsObjectId,
            category: "ai",
            provider: { $ne: null },
            createdAt: { $gte: startDate },
          },
        },
        {
          $group: {
            _id: "$provider",
            requests: { $sum: 1 },
            tokens: { $sum: "$tokens.totalTokens" },
          },
        },
      ]),
      UsageEvent.aggregate([
        {
          $match: {
            workspaceId: wsObjectId,
            category: "ai",
            model: { $ne: null },
            createdAt: { $gte: startDate },
          },
        },
        {
          $group: {
            _id: "$model",
            requests: { $sum: 1 },
            tokens: { $sum: "$tokens.totalTokens" },
          },
        },
      ]),
    ]);

    return {
      dailyMetrics,
      breakdown: {
        providers: providerBreakdown.map((p) => ({ provider: p._id, requests: p.requests, tokens: p.tokens })),
        models: modelBreakdown.map((m) => ({ model: m._id, requests: m.requests, tokens: m.tokens })),
      },
    };
  },
};

export default usageService;
