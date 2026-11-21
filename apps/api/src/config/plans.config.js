/**
 * apps/api/src/config/plans.config.js
 * =====================================
 * Centralized Plan and Quota Limit Definitions:
 * - Configurable limits for AI tokens, chat requests, KBs, storage, MCP, and APIs
 * - Thresholds for warning (70%), near-limit (90%), and hard enforcement (100%)
 * - Distinction between local development limits and future commercial tiers
 */

export const METRIC_DEFINITIONS = {
  chatRequests: {
    key: "chatRequests",
    label: "AI Chat Requests",
    unit: "requests",
    period: "month",
    description: "Total user messages processed by the RAG pipeline",
  },
  aiTokens: {
    key: "aiTokens",
    label: "AI Tokens Consumed",
    unit: "tokens",
    period: "month",
    description: "Combined prompt and completion tokens processed by AI models",
  },
  knowledgeBases: {
    key: "knowledgeBases",
    label: "Knowledge Bases",
    unit: "KBs",
    period: "static",
    description: "Active knowledge base collections in the workspace",
  },
  documents: {
    key: "documents",
    label: "Document Sources",
    unit: "documents",
    period: "static",
    description: "Total uploaded or ingested document sources",
  },
  storage: {
    key: "storage",
    label: "Storage Space",
    unit: "MB",
    period: "static",
    description: "Your workspace's uploaded documents, vectors, and generated artifacts",
  },
  chatbots: {
    key: "chatbots",
    label: "Chatbots",
    unit: "chatbots",
    period: "static",
    description: "Created chatbot assistants in the workspace",
  },
  publicApiRequests: {
    key: "publicApiRequests",
    label: "Public API Requests",
    unit: "requests",
    period: "month",
    description: "Requests authenticated using platform API keys (rag_pk_ / rag_sk_)",
  },
  mcpToolCalls: {
    key: "mcpToolCalls",
    label: "MCP Tool Executions",
    unit: "executions",
    period: "month",
    description: "Model Context Protocol tool invocations across connected servers",
  },
  mcpServers: {
    key: "mcpServers",
    label: "MCP Servers",
    unit: "servers",
    period: "static",
    description: "Connected Model Context Protocol servers",
  },
  fileGenerations: {
    key: "fileGenerations",
    label: "File & Deck Generations",
    unit: "files",
    period: "month",
    description: "Generated PowerPoint decks, PDFs, CSVs, and downloadable artifacts",
  },
};

export const PLANS = {
  developer: {
    id: "developer",
    name: "Developer Plan (Local)",
    description: "Application-configured limits for local development and testing.",
    isBillingActive: false,
    limits: {
      chatRequests: 5000,
      aiTokens: 2000000,
      knowledgeBases: 10,
      documents: 100,
      storage: Number(process.env.USER_STORAGE_LIMIT_MB || process.env.WORKSPACE_STORAGE_LIMIT_MB || 50), // per user/workspace
      chatbots: 20,
      publicApiRequests: 10000,
      mcpToolCalls: 2000,
      mcpServers: 20,
      fileGenerations: 500,
      // Per-minute velocity limits
      chatRequestsPerMinute: 60,
      publicApiRequestsPerMinute: 120,
      mcpToolCallsPerMinute: 60,
    },
    enforcement: {
      chatRequests: "block",
      aiTokens: "block",
      knowledgeBases: "block",
      documents: "block",
      storage: "block",
      chatbots: "block",
      publicApiRequests: "block",
      mcpToolCalls: "block",
      mcpServers: "block",
      fileGenerations: "block",
    },
    thresholds: {
      warning: 0.7, // 70%
      nearLimit: 0.9, // 90%
      hardLimit: 1.0, // 100%
    },
  },
  // Future commercial tier templates (configured, not activated)
  unlimited: {
    id: "unlimited",
    name: "Enterprise Unlimited",
    description: "Uncapped resources for high-throughput testing.",
    isBillingActive: false,
    limits: {
      chatRequests: null, // null represents unlimited
      aiTokens: null,
      knowledgeBases: null,
      documents: null,
      storage: null,
      chatbots: null,
      publicApiRequests: null,
      mcpToolCalls: null,
      mcpServers: null,
      fileGenerations: null,
      chatRequestsPerMinute: 1000,
      publicApiRequestsPerMinute: 1000,
      mcpToolCallsPerMinute: 500,
    },
    enforcement: {},
    thresholds: {
      warning: 0.8,
      nearLimit: 0.95,
      hardLimit: 1.0,
    },
  },
};

/**
 * Resolves the active plan configuration for a workspace, applying any workspace-specific limit overrides.
 * @param {object} [workspace] - Workspace document
 * @returns {object} Full resolved plan configuration
 */
export function getWorkspacePlan(workspace = null) {
  const basePlan = PLANS.developer;

  if (!workspace || !workspace.planConfig) {
    return {
      ...basePlan,
      limits: { ...basePlan.limits },
      thresholds: { ...basePlan.thresholds },
    };
  }

  // Merge any workspace-specific limit overrides
  return {
    ...basePlan,
    ...workspace.planConfig,
    limits: {
      ...basePlan.limits,
      ...(workspace.planConfig.limits || {}),
    },
    thresholds: {
      ...basePlan.thresholds,
      ...(workspace.planConfig.thresholds || {}),
    },
  };
}

export default {
  PLANS,
  METRIC_DEFINITIONS,
  getWorkspacePlan,
};
