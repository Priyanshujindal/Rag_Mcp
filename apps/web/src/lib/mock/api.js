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

export async function getSourceChunks(_sourceId, page = 1, limit = 5) {
  await delay();
  return {
    items: [],
    pagination: { page, limit, total: 0, totalPages: 0 },
  };
}
