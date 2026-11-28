import {
  mockUser,
  mockRecents,
  mockChatbots,
  mockKnowledgeBases,
  mockMcpServers,
  mockApiKeys,
  mockUsageMetrics,
  mockEvalRuns,
} from "./data.js";

const delay = (ms = 50) => new Promise((resolve) => setTimeout(resolve, ms));

// Deep-clone all initial mock fixtures into an in-memory mutable session state
const state = {
  user: structuredClone(mockUser),
  recents: structuredClone(mockRecents),
  chatbots: structuredClone(mockChatbots),
  knowledgeBases: structuredClone(mockKnowledgeBases),
  mcpServers: structuredClone(mockMcpServers),
  apiKeys: structuredClone(mockApiKeys),
  usageMetrics: structuredClone(mockUsageMetrics),
  evalRuns: structuredClone(mockEvalRuns),
};

// ── Query Mock Implementations ──

export async function getMockUser() {
  await delay();
  return state.user;
}

export async function getMockRecents() {
  await delay();
  return state.recents;
}

export async function getMockChatbots() {
  await delay();
  return state.chatbots;
}

export async function getMockChatbotById(id) {
  await delay();
  const bot = state.chatbots.find((b) => b.id === id);
  if (!bot) return null;
  return {
    ...bot,
    config: bot.config || {},
    publicId: bot.publicId || bot.id,
  };
}

export async function getMockKnowledgeBases() {
  await delay();
  return state.knowledgeBases;
}

export async function getMockMcpServers() {
  await delay();
  return state.mcpServers;
}

export async function getMockApiKeys() {
  await delay();
  return state.apiKeys;
}

export async function getMockUsageMetrics() {
  await delay();
  return state.usageMetrics;
}

export async function getUsageOverview() {
  await delay();
  return {
    plan: {
      id: "developer",
      name: "Developer Plan (Local)",
      description: "Local development limits",
      isBillingActive: false,
      period: {
        type: "month",
        start: new Date(Date.now() - 30 * 86400000).toISOString(),
        end: new Date().toISOString(),
        resetAt: new Date(Date.now() + 15 * 86400000).toISOString(),
      },
    },
    metrics: {
      chatRequests: { key: "chatRequests", label: "AI Chat Requests", used: 124, limit: 5000, remaining: 4876, percentConsumed: 2, status: "normal", unit: "requests" },
      aiTokens: { key: "aiTokens", label: "AI Tokens Consumed", used: 412000, limit: 2000000, remaining: 1588000, percentConsumed: 21, status: "normal", unit: "tokens" },
      knowledgeBases: { key: "knowledgeBases", label: "Knowledge Bases", used: 2, limit: 10, remaining: 8, percentConsumed: 20, status: "normal", unit: "KBs" },
      documents: { key: "documents", label: "Document Sources", used: 14, limit: 100, remaining: 86, percentConsumed: 14, status: "normal", unit: "documents" },
      storage: { key: "storage", label: "Storage Space", used: 2.69, limit: 50, remaining: 47.31, percentConsumed: 5, status: "normal", unit: "MB" },
      chatbots: { key: "chatbots", label: "Chatbots", used: 3, limit: 20, remaining: 17, percentConsumed: 15, status: "normal", unit: "chatbots" },
      publicApiRequests: { key: "publicApiRequests", label: "Public API Requests", used: 85, limit: 10000, remaining: 9915, percentConsumed: 1, status: "normal", unit: "requests" },
      mcpToolCalls: { key: "mcpToolCalls", label: "MCP Tool Executions", used: 48, limit: 2000, remaining: 1952, percentConsumed: 2, status: "normal", unit: "executions" },
      mcpServers: { key: "mcpServers", label: "MCP Servers", used: 2, limit: 20, remaining: 18, percentConsumed: 10, status: "normal", unit: "servers" },
      fileGenerations: { key: "fileGenerations", label: "File & Deck Generations", used: 6, limit: 500, remaining: 494, percentConsumed: 1, status: "normal", unit: "files" },
    },
    warnings: [],
    storageDetails: { usedMb: 2.69, limitMb: 50, sourceCharBytes: 1500000, artifactBytes: 2500000, aiCachedMb: 38 },
  };
}

export async function getUsageLimits() {
  const overview = await getUsageOverview();
  return { plan: overview.plan, limits: overview.metrics, warnings: overview.warnings };
}

export async function getUsageAnalytics() {
  await delay();
  return {
    dailyMetrics: state.usageMetrics || [],
    breakdown: {
      providers: [{ provider: "google", requests: 110, tokens: 380000 }, { provider: "openrouter", requests: 14, tokens: 32000 }],
      models: [{ model: "gemini-3.8-flash", requests: 110, tokens: 380000 }, { model: "anthropic/claude-3-haiku", requests: 14, tokens: 32000 }],
    },
  };
}

export async function getUsageHistory() {
  await delay();
  return {
    data: [
      { id: "ev_1", eventType: "ai.chat", category: "ai", status: "success", tokens: { totalTokens: 1450 }, model: "gemini-3.8-flash", durationMs: 420, createdAt: new Date().toISOString() },
      { id: "ev_2", eventType: "public_api.request", category: "public_api", status: "success", tokens: { totalTokens: 820 }, durationMs: 310, createdAt: new Date(Date.now() - 3600000).toISOString() },
      { id: "ev_3", eventType: "document.upload", category: "storage", status: "success", storageBytes: 524288, createdAt: new Date(Date.now() - 7200000).toISOString() },
    ],
    pagination: { page: 1, limit: 50, total: 3, totalPages: 1 },
  };
}

export async function getMockEvalRuns() {
  await delay();
  return state.evalRuns;
}

export async function runEvaluation(payload) {
  await delay();
  const newRun = {
    id: `eval_${Date.now()}`,
    testSuite: payload.testSuite || "RAG Golden Q&A Benchmark",
    model: payload.model || "gemini-3.8-flash",
    samplesCount: 4,
    faithfulnessScore: 0.94,
    relevanceScore: 0.91,
    contextRecallScore: 0.88,
    hallucinationRate: 0.05,
    status: "completed",
    runAt: new Date().toISOString(),
    samples: [
      {
        id: "q1",
        question: "What is the primary architecture and system purpose?",
        hit: true,
        faithfulnessScore: 0.95,
        relevanceScore: 0.92,
        contextRecallScore: 1.0,
        isHallucinated: false,
      },
      {
        id: "q2",
        question: "How is authentication or access control managed?",
        hit: true,
        faithfulnessScore: 0.93,
        relevanceScore: 0.90,
        contextRecallScore: 0.85,
        isHallucinated: false,
      },
    ],
  };
  state.evalRuns = [newRun, ...state.evalRuns];
  return newRun;
}

export async function getEvalRunDetails(id) {
  await delay();
  const run = state.evalRuns.find((r) => r.id === id);
  return run || state.evalRuns[0];
}

export async function deleteEvalRun(id) {
  await delay();
  state.evalRuns = state.evalRuns.filter((r) => r.id !== id);
  return { success: true };
}

// ── Mutation Mock Implementations ──

export async function loginUser({ email, password: _password }) {
  await delay();
  const user = {
    ...state.user,
    email: email || state.user.email,
  };
  return {
    user,
    accessToken: "mock_access_token_jwt",
  };
}

export async function getGoogleAuthUrl(_redirectUri) {
  await delay(100);
  return { authUrl: null, state: "mock_google_state" };
}

export async function loginWithGoogle() {
  await delay();
  return {
    user: state.user,
    accessToken: "mock_access_token_jwt",
  };
}

export async function registerUser({ email, password: _password, name }) {
  await delay();
  const user = {
    ...state.user,
    name: name || state.user.name,
    email: email || state.user.email,
  };
  state.user = user;
  return {
    user,
    workspace: { id: "ws_mock_personal", name: `${user.name}'s Workspace` },
    accessToken: "mock_access_token_jwt",
  };
}

export async function logoutUser() {
  await delay();
  return { success: true };
}

export async function createChatbot(data) {
  await delay();
  const id = `bot_${Math.random().toString(36).slice(2, 10)}`;
  const publicId = `bot_${Math.random().toString(36).slice(2, 10)}`;
  const newBot = {
    id,
    publicId,
    name: data.name || "New Chatbot",
    description: data.description || "Workspace assistant",
    status: (data.status || "active").toLowerCase(),
    model: data.model || "gpt-4o",
    temperature: data.temperature ?? 0.2,
    systemPrompt: data.config?.systemPrompt || data.systemPrompt || "You are a helpful assistant.",
    knowledgeBaseIds: data.knowledgeBaseId ? [data.knowledgeBaseId] : data.knowledgeBaseIds || [],
    conversationsCount: 0,
    messagesCount: 0,
    config: data.config || {},
    createdAt: new Date().toISOString(),
  };
  state.chatbots.unshift(newBot);
  return newBot;
}

export async function updateChatbot(id, data) {
  await delay();
  const index = state.chatbots.findIndex((b) => b.id === id);
  if (index === -1) {
    throw new Error(`Chatbot with id ${id} not found`);
  }
  const updated = {
    ...state.chatbots[index],
    ...data,
    config: {
      ...(state.chatbots[index].config || {}),
      ...(data.config || {}),
    },
    updatedAt: new Date().toISOString(),
  };
  state.chatbots[index] = updated;
  return updated;
}

export async function deleteChatbot(id) {
  await delay();
  state.chatbots = state.chatbots.filter((b) => b.id !== id);
  return { message: "Chatbot deleted successfully" };
}

export async function createKnowledgeBase(data) {
  await delay();
  const id = `kb_${Math.random().toString(36).slice(2, 10)}`;
  const newKb = {
    id,
    name: data.name || "Untitled Knowledge Base",
    description: data.description || "",
    status: "ready",
    sourcesCount: 0,
    totalChunks: 0,
    lastIndexedAt: new Date().toISOString(),
    sources: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  state.knowledgeBases.unshift(newKb);
  return newKb;
}

export async function deleteKnowledgeBase(id) {
  await delay();
  state.knowledgeBases = state.knowledgeBases.filter((kb) => kb.id !== id);
  return { message: "Knowledge base deleted successfully" };
}

export async function createUrlSource({ knowledgeBaseId, name, url }) {
  await delay();
  const id = `src_${Math.random().toString(36).slice(2, 10)}`;
  const newSource = {
    id,
    knowledgeBaseId,
    name: name || url,
    url,
    type: "URL",
    status: "INDEXED",
    chunkCount: 14,
    lastIndexedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  };
  const kb = state.knowledgeBases.find((k) => k.id === knowledgeBaseId);
  if (kb) {
    kb.sourcesCount = (kb.sourcesCount || 0) + 1;
    kb.totalChunks = (kb.totalChunks || 0) + 14;
    if (!kb.sources) kb.sources = [];
    kb.sources.push(newSource);
  }
  return newSource;
}

export async function uploadSourceFile(knowledgeBaseId, file) {
  await delay();
  const fileName = file?.name || "document.pdf";
  const ext = fileName.split(".").pop().toUpperCase();
  const validTypes = ["PDF", "DOCX", "TXT", "CSV"];
  const type = validTypes.includes(ext) ? ext : "TXT";

  const id = `src_${Math.random().toString(36).slice(2, 10)}`;
  const newSource = {
    id,
    knowledgeBaseId,
    name: fileName,
    type,
    status: "QUEUED",
    chunkCount: 0,
    lastIndexedAt: null,
    createdAt: new Date().toISOString(),
  };

  const kb = state.knowledgeBases.find((k) => k.id === knowledgeBaseId);
  if (kb) {
    kb.sourcesCount = (kb.sourcesCount || 0) + 1;
    if (!kb.sources) kb.sources = [];
    kb.sources.push(newSource);
  }
  return newSource;
}

export async function deleteSource(id) {
  await delay();
  for (const kb of state.knowledgeBases) {
    if (kb.sources) {
      const origLen = kb.sources.length;
      kb.sources = kb.sources.filter((s) => s.id !== id);
      if (kb.sources.length < origLen) {
        kb.sourcesCount = Math.max(0, (kb.sourcesCount || 1) - 1);
      }
    }
  }
  return { message: "Source deleted successfully" };
}

export async function listSources(knowledgeBaseId) {
  await delay();
  const allSources = [];
  for (const kb of state.knowledgeBases) {
    if (knowledgeBaseId && kb.id !== knowledgeBaseId) continue;
    if (Array.isArray(kb.sources)) {
      for (const s of kb.sources) {
        allSources.push({
          id: s.id,
          knowledgeBaseId: s.knowledgeBaseId || kb.id,
          title: s.title || s.name || "Untitled source",
          name: s.name || s.title || "Untitled source",
          url: s.url || "",
          type: (s.type || "file").toLowerCase(),
          status: (s.status || "queued").toLowerCase(),
          chunksCount: s.chunksCount ?? s.chunkCount ?? s.chunks ?? 0,
          chunkCount: s.chunkCount ?? s.chunksCount ?? s.chunks ?? 0,
          chunks: s.chunks ?? s.chunkCount ?? s.chunksCount ?? 0,
          error: s.error || null,
          lastIndexedAt: s.lastIndexedAt || null,
          createdAt: s.createdAt || null,
        });
      }
    }
  }
  return allSources;
}

export async function getSource(id) {
  await delay();
  for (const kb of state.knowledgeBases) {
    if (Array.isArray(kb.sources)) {
      const s = kb.sources.find((item) => item.id === id);
      if (s) {
        return {
          id: s.id,
          knowledgeBaseId: s.knowledgeBaseId || kb.id,
          title: s.title || s.name || "Untitled source",
          name: s.name || s.title || "Untitled source",
          url: s.url || "",
          type: (s.type || "file").toLowerCase(),
          status: (s.status || "queued").toLowerCase(),
          chunksCount: s.chunksCount ?? s.chunkCount ?? s.chunks ?? 0,
          chunkCount: s.chunkCount ?? s.chunksCount ?? s.chunks ?? 0,
          chunks: s.chunks ?? s.chunkCount ?? s.chunksCount ?? 0,
          error: s.error || null,
          lastIndexedAt: s.lastIndexedAt || null,
          createdAt: s.createdAt || null,
          updatedAt: s.updatedAt || null,
          // In mock mode, no fabricated details:
          extractedText: s.extractedText || null,
          chunkItems: Array.isArray(s.chunkItems) ? s.chunkItems : null,
          embeddingStatus: s.embeddingStatus || null,
          embeddingsGenerated: s.embeddingsGenerated ?? null,
          indexingStartedAt: s.indexingStartedAt || null,
          indexingCompletedAt: s.indexingCompletedAt || null,
          indexingDurationMs: s.indexingDurationMs ?? null,
        };
      }
    }
  }
  return null;
}

export async function reindexSource(id) {
  await delay();
  for (const kb of state.knowledgeBases) {
    if (kb.sources) {
      const source = kb.sources.find((s) => s.id === id);
      if (source) {
        source.status = "queued";
        return { message: "Source queued for re-indexing", source };
      }
    }
  }
  return { message: "Source queued for re-indexing" };
}

export async function createApiKey(data) {
  await delay();
  const rand = Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);
  const secret = `ragmcp_live_${rand}`;
  const prefix = secret.slice(0, 16);
  const id = `key_${Math.random().toString(36).slice(2, 10)}`;

  const keyRecord = {
    id,
    name: data.name || "Default Secret Key",
    prefix,
    lastUsedAt: null,
    createdAt: new Date().toISOString(),
  };

  state.apiKeys.unshift(keyRecord);

  // Return the full secret plain key once upon creation
  return {
    ...keyRecord,
    key: secret,
  };
}

export async function rotateApiKey(id) {
  await delay();
  const key = state.apiKeys.find((k) => k.id === id);
  const rand = Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);
  const isPub = key?.keyType === "publishable";
  const prefix = isPub ? "rag_pk_live_" : "rag_sk_live_";
  const secret = `${prefix}${rand}`;
  if (key) {
    key.prefix = prefix;
    key.maskedKey = `${prefix}${"•".repeat(12)}${rand.slice(-4)}`;
    key.status = "active";
    key.revokedAt = null;
  }
  return { apiKey: key, secret };
}

export async function updateApiKey(id, data) {
  await delay();
  const key = state.apiKeys.find((k) => k.id === id);
  if (key) {
    Object.assign(key, data);
  }
  return key;
}

export async function getApiKeyUsage(id) {
  await delay();
  const key = state.apiKeys.find((k) => k.id === id);
  return {
    summary: key?.usage || { totalRequests: 42, successfulRequests: 41, totalInputTokens: 1200, totalOutputTokens: 850 },
    lastUsedAt: key?.lastUsedAt || new Date().toISOString(),
    recentLogs: [],
  };
}

export async function revokeApiKey(id) {
  await delay();
  const key = state.apiKeys.find((k) => k.id === id);
  if (key) {
    key.revokedAt = new Date().toISOString();
  }
  return key || { id, revokedAt: new Date().toISOString() };
}

export async function deleteApiKey(id) {
  await delay();
  state.apiKeys = state.apiKeys.filter((k) => k.id !== id);
  return { message: "API key deleted successfully" };
}

export async function createMcpServer(data) {
  await delay();
  const id = `mcp_${Math.random().toString(36).slice(2, 10)}`;
  const newServer = {
    id,
    name: data.name || "Custom MCP Server",
    command: data.command || "npx -y @modelcontextprotocol/server-fetch",
    transport: data.transport || "stdio",
    status: "connected",
    tools: [
      { id: "tool_query", name: "query", description: "Query external source", enabled: true, requiresApproval: false },
    ],
  };
  state.mcpServers.push(newServer);
  return newServer;
}

export async function toggleMcpTool(serverId, toolName, { enabled, requiresApproval }) {
  await delay();
  const server = state.mcpServers.find((s) => s.id === serverId);
  let updatedTool = null;
  if (server?.tools) {
    const tool = server.tools.find((t) => t.name === toolName || t.id === toolName);
    if (tool) {
      if (typeof enabled === "boolean") tool.enabled = enabled;
      if (typeof requiresApproval === "boolean") tool.requiresApproval = requiresApproval;
      updatedTool = tool;
    }
  }
  return { success: true, tool: updatedTool };
}

export async function updateMcpServer(id, data) {
  await delay();
  const server = state.mcpServers.find((s) => s.id === id);
  if (server) {
    Object.assign(server, data);
  }
  return server || { id, ...data };
}

export async function deleteMcpServer(id) {
  await delay();
  state.mcpServers = state.mcpServers.filter((s) => s.id !== id);
  return { success: true };
}

export async function refreshMcpTools(id) {
  await delay();
  const server = state.mcpServers.find((s) => s.id === id);
  return server || { id, tools: [] };
}

export async function batchUpdateMcpTools(id, action) {
  await delay();
  const server = state.mcpServers.find((s) => s.id === id);
  if (server?.tools) {
    const isEnable = action === "enable_all";
    server.tools.forEach((t) => {
      t.enabled = isEnable;
      if (!isEnable) t.permission = "deny";
      else if (t.permission === "deny") t.permission = "auto";
    });
  }
  return { success: true, count: server?.tools?.length || 0 };
}

export async function importMcpConfig(config, options = {}) {
  await delay();
  const servers = [];
  const entries = config?.mcpServers ? Object.entries(config.mcpServers) : [["custom-mcp", config]];
  for (const [name, cfg] of entries) {
    const id = `mcp_${Math.random().toString(36).slice(2, 9)}`;
    const srv = {
      id,
      name,
      transport: cfg.transport || "stdio",
      command: cfg.command || "",
      args: cfg.args || [],
      env: cfg.env || {},
      status: "connected",
      tools: [
        { id: `${id}_t1`, name: "custom_tool", description: `Discovered tool from ${name}`, enabled: true, permission: "auto", requiresApproval: false }
      ],
      createdAt: new Date().toISOString(),
    };
    state.mcpServers.unshift(srv);
    servers.push(srv);
  }
  return { importedCount: servers.length, servers };
}

export async function connectMcpServer(id) {
  await delay();
  const server = state.mcpServers.find((s) => s.id === id);
  if (server) server.status = "connected";
  return { success: true, status: "connected" };
}

export async function disconnectMcpServer(id) {
  await delay();
  const server = state.mcpServers.find((s) => s.id === id);
  if (server) server.status = "disconnected";
  return { success: true, status: "disconnected" };
}

export async function getMcpConfig(id) {
  await delay();
  const server = state.mcpServers.find((s) => s.id === id);
  return {
    rawConfig: {
      mcpServers: {
        [server?.name || "server"]: {
          command: server?.command || "npx",
          args: server?.args || [],
          env: {},
        }
      }
    }
  };
}

export async function updateMcpConfig(id, config) {
  await delay();
  const server = state.mcpServers.find((s) => s.id === id);
  if (server) {
    server.rawConfig = config;
  }
  return { success: true, server };
}

export async function getMcpServerLogs(id) {
  await delay();
  return {
    serverId: id,
    logs: [
      {
        timestamp: new Date().toISOString(),
        level: "info",
        text: "Mock MCP server running normally (no stderr errors).",
      },
    ],
  };
}

export async function getTeamMembers() {
  await delay();
  return {
    currentUserRole: "OWNER",
    members: [
      {
        id: "mem_1",
        userId: "user_1",
        name: "Demo User",
        email: "demo@rag-mcp.ai",
        role: "OWNER",
        joinedAt: new Date().toISOString(),
        isCurrentUser: true,
      },
    ],
    invites: [],
  };
}

export async function inviteTeamMember(data) {
  await delay();
  return { status: "invited", message: `Mock invite sent to ${data.email} (${data.role})` };
}

export async function updateTeamMemberRole() {
  await delay();
  return { success: true };
}

export async function removeTeamMember() {
  await delay();
  return { success: true };
}

export async function revokeTeamInvite() {
  await delay();
  return { success: true };
}

export async function resendTeamInvite() {
  await delay();
  return { success: true, message: "Mock invitation refreshed." };
}

export async function leaveWorkspace() {
  await delay();
  return { success: true };
}

export async function testMcpConnection(_id, _data) {
  await delay();
  return {
    success: true,
    toolCount: 5,
    resourceCount: 2,
    promptCount: 1,
    tools: [
      { name: "execute_readonly_sql", description: "Database SQL query" },
      { name: "calculate_metrics", description: "Calculates KPIs" },
    ],
  };
}

export async function getMcpExecutions() {
  await delay();
  return [
    {
      id: "exec_1",
      toolName: "calculate_metrics",
      serverName: "Builtin System Tools",
      status: "success",
      durationMs: 42,
      createdAt: new Date().toISOString(),
      args: { expression: "(4800 + 1200 + 9600) / 3" },
      resultSummary: '{"metric":"Calculation","value":5200}',
    },
  ];
}

export async function getActiveMcpTools() {
  await delay();
  return [
    { name: "execute_readonly_sql", serverName: "Builtin System Tools", description: "Read-only SQL queries" },
    { name: "calculate_metrics", serverName: "Builtin System Tools", description: "Evaluate mathematical operations" },
    { name: "read_file_snippet", serverName: "Builtin System Tools", description: "Read file lines" },
    { name: "gmail.search_emails", serverName: "Gmail", description: "Search Gmail messages", isAppIntegration: true },
    { name: "google_drive.search_files", serverName: "Google Drive", description: "Search Drive files", isAppIntegration: true },
    { name: "github.list_repositories", serverName: "GitHub", description: "List repositories", isAppIntegration: true },
    { name: "notion.search", serverName: "Notion", description: "Search Notion workspace", isAppIntegration: true },
  ];
}

export async function getSourceChunks(_sourceId, page = 1, limit = 5) {
  await delay();
  return {
    items: [],
    pagination: { page, limit, total: 0, totalPages: 0 },
  };
}

export async function getIntegrationsCatalog() {
  await delay();
  return [
    {
      id: "gmail",
      name: "Gmail",
      description: "Search, read, summarize, draft, and send emails through your Google Workspace account.",
      category: "Email",
      icon: "Mail",
      status: "available",
      isConnected: false,
      capabilities: ["Search emails", "Read threads", "Draft replies", "Send emails"],
      tools: [{ name: "search_emails" }, { name: "get_email" }, { name: "send_email", writeOperation: true }],
    },
    {
      id: "google_drive",
      name: "Google Drive",
      description: "Search files, read document contents, summarize spreadsheets, and create files.",
      category: "Storage & Docs",
      icon: "HardDrive",
      status: "available",
      isConnected: false,
      capabilities: ["Search Drive", "Read Docs/Sheets", "Create files"],
      tools: [{ name: "search_files" }, { name: "read_file_content" }, { name: "create_file", writeOperation: true }],
    },
    {
      id: "github",
      name: "GitHub",
      description: "Inspect repositories, search code, read files, review pull requests, and manage issues.",
      category: "Development",
      icon: "Github",
      status: "available",
      isConnected: false,
      capabilities: ["List repositories", "Search code", "Read files", "Create issues"],
      tools: [{ name: "list_repositories" }, { name: "read_file" }, { name: "search_code" }],
    },
    {
      id: "notion",
      name: "Notion",
      description: "Search workspace pages, inspect databases, read project documentation, and create pages.",
      category: "Knowledge & Docs",
      icon: "FileText",
      status: "available",
      isConnected: false,
      capabilities: ["Search workspace", "Read pages", "Create pages"],
      tools: [{ name: "search" }, { name: "get_page" }, { name: "create_page", writeOperation: true }],
    },
    {
      id: "slack",
      name: "Slack",
      description: "Search workspace discussions, read channel message history, and post messages.",
      category: "Communication",
      icon: "MessageSquare",
      status: "available",
      isConnected: false,
      capabilities: ["Search messages", "Read channels", "Send messages"],
      tools: [{ name: "search_messages" }, { name: "send_message", writeOperation: true }],
    },
  ];
}

export async function getConnectedAccounts() {
  await delay();
  return [];
}

export async function authorizeIntegration(id) {
  await delay();
  return { authUrl: `https://example.com/oauth/${id}`, state: "mock_state" };
}

export async function callbackIntegration(id) {
  await delay();
  return { success: true };
}

export async function connectIntegrationToken(data) {
  await delay();
  return { success: true, connection: { id: "mock_conn_1", ...data } };
}

export async function demoConnectIntegration(id, data = {}) {
  await delay();
  return { success: true, connection: { id: `mock_conn_${id}`, ...data } };
}

export async function updateConnectedAccount(id, data) {
  await delay();
  return { success: true, id, ...data };
}

export async function testConnectedAccount() {
  await delay();
  return { status: "healthy", message: "Connected successfully." };
}

export async function disconnectAccount(id) {
  await delay();
  return { success: true, id };
}

