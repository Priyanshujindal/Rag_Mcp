import * as realApi from "./real.js";

const isMock =
  typeof import.meta !== "undefined" && import.meta.env
    ? import.meta.env.VITE_MOCK_API !== "false"
    : true;

if (typeof import.meta !== "undefined" && import.meta.env?.DEV) {
  console.log(`[Rag_Mcp] API client initialized in ${isMock ? "MOCK (offline)" : "REAL (connected)"} mode.`);
}

let mockApiModule = null;
async function getMockApi() {
  if (!mockApiModule) {
    mockApiModule = await import("../mock/api.js");
  }
  return mockApiModule;
}

function dispatch(fnName) {
  if (!isMock) {
    return realApi[fnName];
  }
  return async (...args) => {
    const mock = await getMockApi();
    return mock[fnName](...args);
  };
}

// Queries
export const getMockUser = dispatch("getMockUser");
export const getMockRecents = dispatch("getMockRecents");
export const getMockChatbots = dispatch("getMockChatbots");
export const getMockChatbotById = dispatch("getMockChatbotById");
export const getMockKnowledgeBases = dispatch("getMockKnowledgeBases");
export const listSources = dispatch("listSources");
export const getSource = dispatch("getSource");
export const getSourceChunks = dispatch("getSourceChunks");
export const getMockMcpServers = dispatch("getMockMcpServers");
export const getMockApiKeys = dispatch("getMockApiKeys");
export const getMockUsageMetrics = dispatch("getMockUsageMetrics");
export const getMockEvalRuns = dispatch("getMockEvalRuns");
export const getEvalRunDetails = dispatch("getEvalRunDetails");
export const runEvaluation = dispatch("runEvaluation");
export const deleteEvalRun = dispatch("deleteEvalRun");

// Mutations
export const loginUser = dispatch("loginUser");
export const registerUser = dispatch("registerUser");
export const logoutUser = dispatch("logoutUser");
export const createChatbot = dispatch("createChatbot");
export const updateChatbot = dispatch("updateChatbot");
export const deleteChatbot = dispatch("deleteChatbot");
export const createKnowledgeBase = dispatch("createKnowledgeBase");
export const deleteKnowledgeBase = dispatch("deleteKnowledgeBase");
export const createUrlSource = dispatch("createUrlSource");
export const uploadSourceFile = dispatch("uploadSourceFile");
export const deleteSource = dispatch("deleteSource");
export const reindexSource = dispatch("reindexSource");
export const createApiKey = dispatch("createApiKey");
export const revokeApiKey = dispatch("revokeApiKey");
export const deleteApiKey = dispatch("deleteApiKey");
export const createMcpServer = dispatch("createMcpServer");
export const toggleMcpTool = dispatch("toggleMcpTool");

export { isMock };
export { ApiError } from "./client.js";
export default {
  getMockUser,
  getMockRecents,
  getMockChatbots,
  getMockChatbotById,
  getMockKnowledgeBases,
  listSources,
  getSource,
  getMockMcpServers,
  getMockApiKeys,
  getMockUsageMetrics,
  getMockEvalRuns,
  loginUser,
  registerUser,
  logoutUser,
  createChatbot,
  updateChatbot,
  deleteChatbot,
  createKnowledgeBase,
  deleteKnowledgeBase,
  createUrlSource,
  uploadSourceFile,
  deleteSource,
  reindexSource,
  createApiKey,
  revokeApiKey,
  deleteApiKey,
  createMcpServer,
  toggleMcpTool,
};
