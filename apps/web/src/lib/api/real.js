import api, { setAccessToken, setActiveWorkspaceId } from "./client.js";

/**
 * Real API integration layer communicating with apps/api via HTTP
 */

export async function getMockUser() {
  try {
    const data = await api.get("/auth/me");
    const user = data.user;
    const workspaces = data.workspaces || [];
    const activeWorkspace = workspaces[0]?.workspace;

    if (activeWorkspace) {
      setActiveWorkspaceId(activeWorkspace.id);
    }

    const initials = user.name
      ? user.name
          .split(" ")
          .map((n) => n[0])
          .join("")
          .toUpperCase()
          .slice(0, 2)
      : "U";

    return {
      id: user.id,
      name: user.name,
      email: user.email,
      initials,
      plan: "Go",
      workspace: activeWorkspace?.name || "My Workspace",
    };
  } catch {
    return {
      id: "anon",
      name: "Anonymous User",
      email: "user@rag-mcp.ai",
      initials: "AU",
      plan: "Free",
      workspace: "Default Workspace",
    };
  }
}

export async function getMockRecents() {
  const { mockRecents } = await import("../mock/data.js");
  return mockRecents;
}

export async function getMockChatbots() {
  const data = await api.get("/chatbots");
  const items = Array.isArray(data) ? data : data.items || [];
  return items.map((bot) => ({
    id: bot.id,
    name: bot.name,
    description: bot.description || `Chatbot assistant for workspace`,
    status: (bot.status || "active").toLowerCase(),
    model: "gpt-4o",
    temperature: 0.2,
    systemPrompt: bot.config?.systemPrompt || "You are a helpful assistant.",
    knowledgeBaseIds: bot.knowledgeBaseId ? [bot.knowledgeBaseId] : [],
    conversationsCount: 0,
    messagesCount: 0,
    config: bot.config || {},
    publicId: bot.publicId,
    createdAt: bot.createdAt,
  }));
}

export async function getMockChatbotById(id) {
  const bot = await api.get(`/chatbots/${id}`);
  return {
    id: bot.id,
    name: bot.name,
    description: bot.description || `Chatbot assistant`,
    status: (bot.status || "active").toLowerCase(),
    model: "gpt-4o",
    temperature: 0.2,
    systemPrompt: bot.config?.systemPrompt || "You are a helpful assistant.",
    knowledgeBaseIds: bot.knowledgeBaseId ? [bot.knowledgeBaseId] : [],
    conversationsCount: 0,
    messagesCount: 0,
    config: bot.config || {},
    publicId: bot.publicId,
    createdAt: bot.createdAt,
  };
}

export async function getMockKnowledgeBases() {
  const [kbData, sourcesData] = await Promise.all([
    api.get("/knowledge-bases"),
    api.get("/sources?limit=100").catch(() => ({ items: [] })),
  ]);

  const items = Array.isArray(kbData) ? kbData : kbData?.items || [];
  const rawSources = Array.isArray(sourcesData) ? sourcesData : sourcesData?.items || [];

  // Group sources by knowledgeBaseId
  const sourcesByKb = {};
  for (const s of rawSources) {
    const rawKbId = s.knowledgeBaseId;
    const kbId =
      typeof rawKbId === "object" && rawKbId !== null
        ? String(rawKbId.id || rawKbId._id || rawKbId)
        : String(rawKbId || "");
    if (!sourcesByKb[kbId]) {
      sourcesByKb[kbId] = [];
    }
    sourcesByKb[kbId].push({
      id: s.id || s._id,
      knowledgeBaseId: kbId,
      title: s.name || s.url || "Untitled source",
      name: s.name || s.url || "Untitled source",
      url: s.url || "",
      type: (s.type || "file").toLowerCase(),
      status: (s.status || "queued").toLowerCase(),
      chunksCount: s.chunkCount || 0,
      chunkCount: s.chunkCount || 0,
      chunks: s.chunkCount || 0,
      error: s.error || null,
      lastIndexedAt: s.lastIndexedAt || null,
      createdAt: s.createdAt || null,
    });
  }

  return items.map((kb) => {
    const targetKbId = String(kb.id || kb._id || "");
    const kbSources = sourcesByKb[targetKbId] || [];
    const sourcesCount = kbSources.length;
    const totalChunks = kbSources.reduce(
      (acc, s) => acc + (s.chunkCount || s.chunksCount || 0),
      0
    );

    const sourceIndexedTimes = kbSources
      .map((s) => s.lastIndexedAt)
      .filter(Boolean)
      .map((d) => new Date(d).getTime())
      .filter((t) => !isNaN(t));

    const newestIndexed =
      sourceIndexedTimes.length > 0
        ? new Date(Math.max(...sourceIndexedTimes)).toISOString()
        : null;

    const lastIndexedAt = newestIndexed || kb.updatedAt || kb.createdAt || null;

    return {
      id: kb.id,
      name: kb.name,
      description: kb.description || "",
      status: (kb.status || "ready").toLowerCase(),
      sourcesCount,
      totalChunks,
      lastIndexedAt,
      sources: kbSources,
      createdAt: kb.createdAt,
      updatedAt: kb.updatedAt,
    };
  });
}

export async function listSources(knowledgeBaseId) {
  const query = knowledgeBaseId
    ? `?knowledgeBaseId=${encodeURIComponent(knowledgeBaseId)}&limit=100`
    : "?limit=100";
  const data = await api.get(`/sources${query}`);
  const items = Array.isArray(data) ? data : data?.items || [];
  return items.map((s) => ({
    id: s.id,
    knowledgeBaseId: s.knowledgeBaseId,
    title: s.name || s.url || "Untitled source",
    name: s.name || s.url || "Untitled source",
    url: s.url || "",
    type: (s.type || "file").toLowerCase(),
    status: (s.status || "queued").toLowerCase(),
    chunksCount: s.chunkCount || 0,
    chunkCount: s.chunkCount || 0,
    chunks: s.chunkCount || 0,
    error: s.error || null,
    lastIndexedAt: s.lastIndexedAt || null,
    createdAt: s.createdAt || null,
  }));
}

export async function getSource(id) {
  const data = await api.get(`/sources/${encodeURIComponent(id)}`);
  return {
    id: data.id,
    knowledgeBaseId: data.knowledgeBaseId,
    title: data.name || data.url || "Untitled source",
    name: data.name || data.url || "Untitled source",
    url: data.url || "",
    type: (data.type || "file").toLowerCase(),
    status: (data.status || "queued").toLowerCase(),
    chunksCount: data.chunkCount || 0,
    chunkCount: data.chunkCount || 0,
    chunks: data.chunkCount || 0,
    error: data.error || null,
    lastIndexedAt: data.lastIndexedAt || null,
    createdAt: data.createdAt || null,
    updatedAt: data.updatedAt || null,
    extractedText: data.extractedTextPreview || data.extractedText || null,
    extractedCharCount: data.extractedCharCount ?? null,
    chunkItems: Array.isArray(data.chunkItems)
      ? data.chunkItems
      : Array.isArray(data.chunks)
      ? data.chunks
      : null,
    embeddingStatus: data.embeddingStatus || null,
    embeddingsGenerated: data.embeddingsGenerated ?? null,
    indexingStartedAt: data.indexingStartedAt || null,
    indexingCompletedAt: data.indexingCompletedAt || null,
    indexingDurationMs: data.indexingDurationMs ?? null,
  };
}

export async function getMockMcpServers() {
  const data = await api.get("/mcp");
  return Array.isArray(data) ? data : data.items || [];
}

export async function getMockApiKeys() {
  const data = await api.get("/api-keys");
  return Array.isArray(data) ? data : [];
}

export async function getUsageOverview(params = {}) {
  const query = new URLSearchParams(params).toString();
  return api.get(`/usage/overview${query ? `?${query}` : ""}`);
}

export async function getUsageLimits() {
  return api.get("/usage/limits");
}

export async function getUsageAnalytics(params = {}) {
  const query = new URLSearchParams(params).toString();
  return api.get(`/usage/analytics${query ? `?${query}` : ""}`);
}

export async function getUsageHistory(params = {}) {
  const query = new URLSearchParams(params).toString();
  return api.get(`/usage/history${query ? `?${query}` : ""}`);
}

export async function getMockUsageMetrics() {
  try {
    const data = await api.get("/usage");
    const { mockUsageMetrics } = await import("../mock/data.js");
    const daily = Array.isArray(data?.dailyMetrics) && data.dailyMetrics.length > 0 ? data.dailyMetrics : mockUsageMetrics;
    return {
      dailyMetrics: daily,
      workspaceUsage: data,
      plan: data?.plan,
      metrics: data?.metrics,
      warnings: data?.warnings,
    };
  } catch {
    const { mockUsageMetrics } = await import("../mock/data.js");
    return {
      dailyMetrics: mockUsageMetrics,
      workspaceUsage: null,
    };
  }
}

export async function getMockEvalRuns() {
  try {
    const data = await api.get("/evals");
    if (Array.isArray(data)) {
      return data;
    }
  } catch (err) {
    console.warn("Failed to fetch real evals:", err);
  }
  return [];
}

export async function runEvaluation(payload) {
  return api.post("/evals/run", payload);
}

export async function getEvalRunDetails(id) {
  return api.get(`/evals/${id}`);
}

export async function deleteEvalRun(id) {
  return api.delete(`/evals/${id}`);
}

// ── Real Mutation Functions ──

export async function loginUser({ email, password }) {
  const data = await api.post("/auth/login", { email, password });
  if (data.accessToken) {
    setAccessToken(data.accessToken);
  }
  try {
    const me = await api.get("/auth/me");
    const activeWs = me?.workspaces?.[0]?.workspace;
    if (activeWs?.id || activeWs?._id) {
      setActiveWorkspaceId(activeWs.id || activeWs._id);
    }
  } catch {
    // Non-critical: backend tenantGuard will still resolve workspace
  }
  return data;
}

export async function registerUser({ email, password, name }) {
  const data = await api.post("/auth/register", { email, password, name });
  if (data.accessToken) {
    setAccessToken(data.accessToken);
  }
  if (data.workspace?.id) {
    setActiveWorkspaceId(data.workspace.id);
  }
  return data;
}

export async function logoutUser() {
  try {
    await api.post("/auth/logout", {});
  } finally {
    setAccessToken(null);
    setActiveWorkspaceId(null);
  }
}

export async function createChatbot(data) {
  return api.post("/chatbots", data);
}

export async function updateChatbot(id, data) {
  return api.patch(`/chatbots/${id}`, data);
}

export async function deleteChatbot(id) {
  return api.delete(`/chatbots/${id}`);
}

export async function createKnowledgeBase(data) {
  return api.post("/knowledge-bases", data);
}

export async function deleteKnowledgeBase(id) {
  return api.delete(`/knowledge-bases/${id}`);
}

export async function createUrlSource({ knowledgeBaseId, name, url }) {
  return api.post("/sources", { knowledgeBaseId, name, url });
}

export async function uploadSourceFile(knowledgeBaseId, file) {
  const formData = new FormData();
  formData.append("knowledgeBaseId", knowledgeBaseId);
  formData.append("file", file);
  return api.post("/sources/upload", formData);
}

export async function deleteSource(id) {
  return api.delete(`/sources/${id}`);
}

export async function reindexSource(id) {
  return api.post(`/sources/${id}/reindex`, {});
}

export async function createApiKey(data) {
  return api.post("/api-keys", data);
}

export async function rotateApiKey(id) {
  return api.post(`/api-keys/${id}/rotate`, {});
}

export async function updateApiKey(id, data) {
  return api.patch(`/api-keys/${id}`, data);
}

export async function getApiKeyUsage(id) {
  return api.get(`/api-keys/${id}/usage`);
}

export async function revokeApiKey(id) {
  return api.post(`/api-keys/${id}/revoke`, {});
}

export async function deleteApiKey(id) {
  return api.delete(`/api-keys/${id}`);
}

export async function createMcpServer(data) {
  return api.post("/mcp", data);
}

export async function updateMcpServer(id, data) {
  return api.patch(`/mcp/${id}`, data);
}

export async function deleteMcpServer(id) {
  return api.delete(`/mcp/${id}`);
}

export async function refreshMcpTools(id) {
  return api.post(`/mcp/${id}/refresh`);
}

export async function testMcpConnection(id, data) {
  return api.post(id ? `/mcp/${id}/test` : "/mcp/test", data || {});
}

export async function toggleMcpTool(serverId, toolName, { enabled, permission, requiresApproval }) {
  return api.patch(`/mcp/${serverId}/tools/${toolName}`, { enabled, permission, requiresApproval });
}

export async function batchUpdateMcpTools(id, action) {
  return api.patch(`/mcp/${id}/tools`, { action });
}

export async function importMcpConfig(config, options = {}) {
  return api.post("/mcp/import", { config, ...options });
}

export async function connectMcpServer(id) {
  return api.post(`/mcp/${id}/connect`);
}

export async function disconnectMcpServer(id) {
  return api.post(`/mcp/${id}/disconnect`);
}

export async function getMcpConfig(id) {
  return api.get(`/mcp/${id}/config`);
}

export async function updateMcpConfig(id, config) {
  return api.put(`/mcp/${id}/config`, { config });
}

export async function getMcpServerLogs(id) {
  return api.get(`/mcp/${id}/logs`);
}

export async function getMcpExecutions(limit = 50) {
  const data = await api.get(`/mcp/executions?limit=${limit}`);
  return Array.isArray(data) ? data : [];
}

export async function getActiveMcpTools() {
  const data = await api.get("/mcp/tools");
  return Array.isArray(data?.tools) ? data.tools : [];
}


export async function getSourceChunks(sourceId, page = 1, limit = 5) {
  const data = await api.get(
    `/sources/${encodeURIComponent(sourceId)}/chunks?page=${page}&limit=${limit}`
  );
  return {
    items: Array.isArray(data?.items) ? data.items : [],
    pagination: data?.pagination || { page, limit, total: 0, totalPages: 0 },
  };
}

// ----------------- Connected Apps & Integrations Marketplace -----------------
export async function getIntegrationsCatalog() {
  const data = await api.get("/integrations/catalog");
  return data?.catalog || [];
}

export async function getConnectedAccounts() {
  const data = await api.get("/integrations/connections");
  return data?.connections || [];
}

export async function authorizeIntegration(id, data = {}) {
  return api.post(`/integrations/${id}/authorize`, data);
}

export async function callbackIntegration(id, data) {
  return api.post(`/integrations/${id}/callback`, data);
}

export async function connectIntegrationToken(data) {
  return api.post("/integrations/connect-token", data);
}

export async function demoConnectIntegration(id, data = {}) {
  return api.post(`/integrations/${id}/demo-connect`, data);
}

export async function updateConnectedAccount(id, data) {
  return api.patch(`/integrations/connections/${id}`, data);
}

export async function testConnectedAccount(id) {
  return api.post(`/integrations/connections/${id}/test`);
}

export async function disconnectAccount(id) {
  return api.delete(`/integrations/connections/${id}`);
}

// ----------------- Workspace Team & RBAC -----------------
export async function getTeamMembers() {
  return api.get("/team/members");
}

export async function inviteTeamMember(data) {
  return api.post("/team/invite", data);
}

export async function updateTeamMemberRole(membershipId, role) {
  return api.patch(`/team/members/${membershipId}`, { role });
}

export async function removeTeamMember(membershipId) {
  return api.delete(`/team/members/${membershipId}`);
}

export async function revokeTeamInvite(inviteId) {
  return api.delete(`/team/invites/${inviteId}`);
}

export async function resendTeamInvite(inviteId) {
  return api.post(`/team/invites/${inviteId}/resend`);
}

export async function leaveWorkspace() {
  return api.post("/team/leave");
}

