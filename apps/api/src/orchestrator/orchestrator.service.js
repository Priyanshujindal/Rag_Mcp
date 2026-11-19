/**
 * Orchestrator service stub (routes queries between RAG knowledge base & MCP tool calling)
 */
export const orchestratorService = {
  async processQuery(_workspaceId, _query) {
    throw new Error("Orchestrator service is not implemented yet (501).");
  },
};

export default orchestratorService;

