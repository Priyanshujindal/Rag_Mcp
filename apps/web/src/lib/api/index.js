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
export const getUsageOverview = dispatch("getUsageOverview");
export const getUsageLimits = dispatch("getUsageLimits");
export const getUsageAnalytics = dispatch("getUsageAnalytics");
export const getUsageHistory = dispatch("getUsageHistory");
export const getMockEvalRuns = dispatch("getMockEvalRuns");
export const getEvalRunDetails = dispatch("getEvalRunDetails");
export const runEvaluation = dispatch("runEvaluation");
export const deleteEvalRun = dispatch("deleteEvalRun");

// Mutations
export const loginUser = dispatch("loginUser");
export const registerUser = dispatch("registerUser");
export const getGoogleAuthUrl = dispatch("getGoogleAuthUrl");
export const loginWithGoogle = dispatch("loginWithGoogle");
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
export const rotateApiKey = dispatch("rotateApiKey");
export const updateApiKey = dispatch("updateApiKey");
export const getApiKeyUsage = dispatch("getApiKeyUsage");
export const revokeApiKey = dispatch("revokeApiKey");
export const deleteApiKey = dispatch("deleteApiKey");
export const createMcpServer = dispatch("createMcpServer");
export const updateMcpServer = dispatch("updateMcpServer");
export const deleteMcpServer = dispatch("deleteMcpServer");
export const refreshMcpTools = dispatch("refreshMcpTools");
export const testMcpConnection = dispatch("testMcpConnection");
export const toggleMcpTool = dispatch("toggleMcpTool");
export const batchUpdateMcpTools = dispatch("batchUpdateMcpTools");
export const importMcpConfig = dispatch("importMcpConfig");
export const connectMcpServer = dispatch("connectMcpServer");
export const disconnectMcpServer = dispatch("disconnectMcpServer");
export const getMcpConfig = dispatch("getMcpConfig");
export const updateMcpConfig = dispatch("updateMcpConfig");
export const getMcpServerLogs = dispatch("getMcpServerLogs");
export const getMcpExecutions = dispatch("getMcpExecutions");
export const getActiveMcpTools = dispatch("getActiveMcpTools");
export const getIntegrationsCatalog = dispatch("getIntegrationsCatalog");
export const getConnectedAccounts = dispatch("getConnectedAccounts");
export const authorizeIntegration = dispatch("authorizeIntegration");
export const callbackIntegration = dispatch("callbackIntegration");
export const connectIntegrationToken = dispatch("connectIntegrationToken");
export const demoConnectIntegration = dispatch("demoConnectIntegration");
export const updateConnectedAccount = dispatch("updateConnectedAccount");
export const testConnectedAccount = dispatch("testConnectedAccount");
export const disconnectAccount = dispatch("disconnectAccount");
export const getTeamMembers = dispatch("getTeamMembers");
export const inviteTeamMember = dispatch("inviteTeamMember");
export const updateTeamMemberRole = dispatch("updateTeamMemberRole");
export const removeTeamMember = dispatch("removeTeamMember");
export const revokeTeamInvite = dispatch("revokeTeamInvite");
export const resendTeamInvite = dispatch("resendTeamInvite");
export const leaveWorkspace = dispatch("leaveWorkspace");

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

export { getApiOrigin } from "./client.js";
