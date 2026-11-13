import test from "node:test";
import assert from "node:assert/strict";
import * as mockApi from "../src/lib/mock/api.js";

test("Mock API operates fully offline with ZERO network fetch calls", async (t) => {
  let fetchCallCount = 0;
  const originalFetch = globalThis.fetch;

  // Stub globalThis.fetch to guarantee zero network traffic
  globalThis.fetch = (..._args) => {
    fetchCallCount++;
    throw new Error("Network request attempted in mock mode!");
  };

  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  // 1. Queries
  const user = await mockApi.getMockUser();
  assert.ok(user && user.id && user.name && user.email, "getMockUser returns valid user shape");

  const recents = await mockApi.getMockRecents();
  assert.ok(Array.isArray(recents), "getMockRecents returns an array");

  const chatbots = await mockApi.getMockChatbots();
  assert.ok(Array.isArray(chatbots) && chatbots.length > 0, "getMockChatbots returns chatbot array");

  const singleBot = await mockApi.getMockChatbotById(chatbots[0].id);
  assert.ok(singleBot && singleBot.id === chatbots[0].id, "getMockChatbotById returns bot with id");

  const kbs = await mockApi.getMockKnowledgeBases();
  assert.ok(Array.isArray(kbs) && kbs.length > 0, "getMockKnowledgeBases returns array");

  const mcps = await mockApi.getMockMcpServers();
  assert.ok(Array.isArray(mcps), "getMockMcpServers returns array");

  const apiKeys = await mockApi.getMockApiKeys();
  assert.ok(Array.isArray(apiKeys), "getMockApiKeys returns array");

  const usage = await mockApi.getMockUsageMetrics();
  assert.ok(Array.isArray(usage), "getMockUsageMetrics returns array");

  const evals = await mockApi.getMockEvalRuns();
  assert.ok(Array.isArray(evals), "getMockEvalRuns returns array");

  // 2. Auth mutations
  const loginRes = await mockApi.loginUser({ email: "test@example.com", password: "Password123!" });
  assert.ok(loginRes.accessToken && loginRes.user, "loginUser return shape matches real.js");
  assert.strictEqual(loginRes.refreshToken, undefined, "loginUser response never exposes refreshToken");

  const regRes = await mockApi.registerUser({
    email: "reg@example.com",
    password: "Password123!",
    name: "Reg User",
  });
  assert.ok(regRes.accessToken && regRes.user && regRes.workspace, "registerUser return shape matches real.js");
  assert.strictEqual(regRes.refreshToken, undefined, "registerUser response never exposes refreshToken");

  const logoutRes = await mockApi.logoutUser();
  assert.ok(logoutRes.success === true, "logoutUser return shape matches real.js");

  // 3. Chatbot mutations
  const newBot = await mockApi.createChatbot({ name: "Offline Bot" });
  assert.ok(newBot.id && newBot.publicId && newBot.name === "Offline Bot", "createChatbot matches real shape");

  const updatedBot = await mockApi.updateChatbot(newBot.id, { name: "Updated Bot" });
  assert.strictEqual(updatedBot.name, "Updated Bot", "updateChatbot reflects updated name");

  const deleteBotRes = await mockApi.deleteChatbot(newBot.id);
  assert.ok(deleteBotRes && deleteBotRes.message, "deleteChatbot returns message");

  // 4. KnowledgeBase & Source mutations
  const newKb = await mockApi.createKnowledgeBase({ name: "Offline KB", description: "Test desc" });
  assert.ok(newKb.id && newKb.name === "Offline KB", "createKnowledgeBase returns KB shape");

  const urlSource = await mockApi.createUrlSource({
    knowledgeBaseId: newKb.id,
    name: "Docs",
    url: "https://example.com/docs",
  });
  assert.ok(urlSource.id && urlSource.type === "URL", "createUrlSource returns source shape");

  const mockFile = { name: "manual.pdf", size: 1024 };
  const fileSource = await mockApi.uploadSourceFile(newKb.id, mockFile);
  assert.ok(fileSource.id && fileSource.type === "PDF" && fileSource.status === "QUEUED", "uploadSourceFile returns queued source shape");

  // Inspect source details via getSource (zero network requests, no fabricated data)
  const fetchedSource = await mockApi.getSource(fileSource.id);
  assert.ok(fetchedSource && fetchedSource.id === fileSource.id, "getSource returns mock source offline");
  assert.strictEqual(fetchedSource.extractedText, null, "Mock mode does not fabricate extracted text");
  assert.strictEqual(fetchedSource.chunkItems, null, "Mock mode does not fabricate chunk items");
  assert.strictEqual(fetchedSource.embeddingStatus, null, "Mock mode does not fabricate embedding status");

  const deleteSrcRes = await mockApi.deleteSource(urlSource.id);
  assert.ok(deleteSrcRes && deleteSrcRes.message, "deleteSource returns message");

  const deleteKbRes = await mockApi.deleteKnowledgeBase(newKb.id);
  assert.ok(deleteKbRes && deleteKbRes.message, "deleteKnowledgeBase returns message");

  // 5. API Key mutations
  const newKey = await mockApi.createApiKey({ name: "Production Key" });
  assert.ok(newKey.id && newKey.prefix && newKey.key, "createApiKey exposes plain key on create");
  assert.ok(newKey.key.startsWith("ragmcp_live_"), "createApiKey generates ragmcp_live_ key");

  const revokedKey = await mockApi.revokeApiKey(newKey.id);
  assert.ok(revokedKey.revokedAt, "revokeApiKey sets revokedAt");

  const deleteKeyRes = await mockApi.deleteApiKey(newKey.id);
  assert.ok(deleteKeyRes && deleteKeyRes.message, "deleteApiKey returns message");

  // 6. MCP mutations
  const newMcp = await mockApi.createMcpServer({ name: "Fetch Tool" });
  assert.ok(newMcp.id && newMcp.tools, "createMcpServer returns server shape");

  const toggleRes = await mockApi.toggleMcpTool(newMcp.id, "query", { enabled: false, requiresApproval: true });
  assert.ok(toggleRes.success === true, "toggleMcpTool returns success");

  // Final assertion: ZERO fetch requests were dispatched
  assert.strictEqual(fetchCallCount, 0, "Expected exactly ZERO network fetch calls in mock mode");
});


test("getSourceChunks mock stays offline and returns empty pagination", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => { fetchCalls += 1; throw new Error("mock mode must not fetch"); };
  try {
    const mockApi = await import("../src/lib/mock/api.js");
    const result = await mockApi.getSourceChunks("mock_source", 2, 5);
    assert.equal(fetchCalls, 0);
    assert.deepEqual(result.items, []);
    assert.equal(result.pagination.page, 2);
    assert.equal(result.pagination.limit, 5);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
