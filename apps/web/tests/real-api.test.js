/**
 * Tests for:
 *  1. getMockKnowledgeBases() — groups sources by KB, computes totals, returns same key-set as mock
 *  2. shouldPollSources() helper — returns true only when a source is queued/crawling/indexing
 *  3. listSources() mock — works offline, returns correctly shaped objects
 *
 * All tests use a stubbed fetch; NO live network calls are made.
 */
import test from "node:test";
import assert from "node:assert/strict";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeKb(id, name) {
  return { id, name, description: "", status: "active", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
}

function makeSrc(id, kbId, { status = "INDEXED", chunkCount = 10, lastIndexedAt = new Date().toISOString() } = {}) {
  return { id, knowledgeBaseId: kbId, name: `Source ${id}`, url: `https://example.com/${id}`, type: "URL", status, chunkCount, lastIndexedAt, createdAt: new Date().toISOString() };
}

// Dynamically build a minimal fetch stub for the real API module
function makeFetchStub(kbItems, sourceItems) {
  return async (url) => {
    const urlStr = String(url);
    let body;
    if (urlStr.includes("/sources")) {
      body = { items: sourceItems };
    } else if (urlStr.includes("/knowledge-bases")) {
      body = { items: kbItems };
    } else {
      body = {};
    }
    const bodyText = JSON.stringify(body);
    return {
      ok: true,
      status: 200,
      headers: { get: (name) => (name === "content-type" ? "application/json" : null) },
      json: async () => body,
      text: async () => bodyText,
    };
  };
}

// ── Test 1: getMockKnowledgeBases groups sources and computes totals ──────────

test("getMockKnowledgeBases groups sources by KB and computes totals correctly", async () => {
  const kb1 = makeKb("kb_1", "Alpha");
  const kb2 = makeKb("kb_2", "Beta");

  const src1a = makeSrc("s1", "kb_1", { chunkCount: 5 });
  const src1b = makeSrc("s2", "kb_1", { chunkCount: 8, lastIndexedAt: "2025-01-02T00:00:00.000Z" });
  const src2a = makeSrc("s3", "kb_2", { chunkCount: 20, lastIndexedAt: "2025-06-01T00:00:00.000Z" });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = makeFetchStub([kb1, kb2], [src1a, src1b, src2a]);

  try {
    // We need to import AFTER setting up the stub so the module uses our stub.
    // Because Node caches modules, we work around this by calling the function
    // directly after patching globalThis.fetch (the api client reads it at call time).
    const { getMockKnowledgeBases } = await import("../src/lib/api/real.js");

    const result = await getMockKnowledgeBases();

    assert.ok(Array.isArray(result), "Result must be an array");
    assert.strictEqual(result.length, 2, "Must return 2 KBs");

    const alpha = result.find((k) => k.id === "kb_1");
    const beta  = result.find((k) => k.id === "kb_2");
    assert.ok(alpha, "KB 1 must be in result");
    assert.ok(beta,  "KB 2 must be in result");

    // Sources grouping
    assert.strictEqual(alpha.sources.length, 2, "KB 1 must have 2 sources");
    assert.strictEqual(beta.sources.length,  1, "KB 2 must have 1 source");

    // Counts
    assert.strictEqual(alpha.sourcesCount, 2,  "KB 1 sourcesCount must be 2");
    assert.strictEqual(alpha.totalChunks,  13, "KB 1 totalChunks must be 5+8=13");
    assert.strictEqual(beta.sourcesCount,  1,  "KB 2 sourcesCount must be 1");
    assert.strictEqual(beta.totalChunks,   20, "KB 2 totalChunks must be 20");

    // lastIndexedAt = newest source date
    // kb_1 sources: src1a uses now, src1b uses "2025-01-02". Newest = src1a (now > 2025).
    // kb_2 source lastIndexedAt is "2025-06-01"
    assert.ok(beta.lastIndexedAt === "2025-06-01T00:00:00.000Z", "KB 2 lastIndexedAt must be the source date");

    // Status lowercase
    assert.ok(alpha.sources.every((s) => s.status === s.status.toLowerCase()), "Source statuses must be lowercase");

    // Required key set matching mock shape
    const requiredKeys = ["id", "name", "description", "status", "sourcesCount", "totalChunks", "lastIndexedAt", "sources"];
    for (const key of requiredKeys) {
      assert.ok(key in alpha, `KB must have key: ${key}`);
    }

    // Source shape keys
    const srcRequiredKeys = ["id", "knowledgeBaseId", "title", "name", "url", "type", "status", "chunksCount", "lastIndexedAt"];
    for (const key of srcRequiredKeys) {
      assert.ok(key in alpha.sources[0], `Source must have key: ${key}`);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ── Test 2: shouldPollSources helper ─────────────────────────────────────────

test("shouldPollSources returns true only when a source is queued/crawling/indexing", async () => {
  // Import from the plain JS utility — no JSX loader needed
  const { shouldPollSources } = await import("../src/lib/utils/poll-sources.js");

  // All indexed → false
  assert.strictEqual(
    shouldPollSources([{ sources: [{ status: "indexed" }, { status: "indexed" }] }]),
    false,
    "All indexed → no polling"
  );

  // One queued → true
  assert.strictEqual(
    shouldPollSources([{ sources: [{ status: "indexed" }, { status: "queued" }] }]),
    true,
    "One queued → poll"
  );

  // One crawling → true
  assert.strictEqual(
    shouldPollSources([{ sources: [{ status: "crawling" }] }]),
    true,
    "crawling → poll"
  );

  // One indexing → true
  assert.strictEqual(
    shouldPollSources([{ sources: [{ status: "indexing" }] }]),
    true,
    "indexing → poll"
  );

  // One failed → false
  assert.strictEqual(
    shouldPollSources([{ sources: [{ status: "failed" }] }]),
    false,
    "failed → no polling"
  );

  // Empty sources → false
  assert.strictEqual(
    shouldPollSources([{ sources: [] }]),
    false,
    "empty sources → no polling"
  );

  // No sources key → false
  assert.strictEqual(
    shouldPollSources([{}]),
    false,
    "missing sources → no polling"
  );

  // Not an array → false
  assert.strictEqual(shouldPollSources(null),   false, "null → false");
  assert.strictEqual(shouldPollSources({}),     false, "object → false");
  assert.strictEqual(shouldPollSources([]),     false, "empty array → false");
});

// ── Test 3: listSources mock works offline ────────────────────────────────────

test("listSources mock is offline and returns correctly shaped sources", async () => {
  let fetchCalled = false;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => {
    fetchCalled = true;
    throw new Error("listSources mock must NOT call fetch");
  };

  try {
    const mockApi = await import("../src/lib/mock/api.js");

    // Create a fresh KB and add a source to it
    const newKb = await mockApi.createKnowledgeBase({ name: "Test KB for listSources" });
    await mockApi.createUrlSource({
      knowledgeBaseId: newKb.id,
      name: "My URL",
      url: "https://example.com/test",
    });

    // Unfiltered — returns all sources
    const all = await mockApi.listSources();
    assert.ok(Array.isArray(all), "listSources returns array");

    // Filtered by KB
    const filtered = await mockApi.listSources(newKb.id);
    assert.ok(Array.isArray(filtered), "listSources(kbId) returns array");
    assert.ok(filtered.length >= 1, "At least 1 source for the new KB");

    const src = filtered[0];
    const requiredKeys = ["id", "knowledgeBaseId", "title", "name", "url", "type", "status", "chunksCount", "lastIndexedAt"];
    for (const key of requiredKeys) {
      assert.ok(key in src, `Source shape must have key: ${key}`);
    }

    // Status must be lowercase
    assert.strictEqual(src.status, src.status.toLowerCase(), "status must be lowercase");

    assert.strictEqual(fetchCalled, false, "Zero network requests in mock mode");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ── Test 4: cleanUrlInput extracts valid URL from markdown links or raw strings ──

test("cleanUrlInput sanitizes plain URLs and markdown formatted links", async () => {
  const { cleanUrlInput } = await import("../src/lib/utils/poll-sources.js");

  // Standard plain URL
  assert.strictEqual(
    cleanUrlInput("https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide"),
    "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide"
  );

  // Markdown broken paste with query param (user case)
  assert.strictEqual(
    cleanUrlInput(
      "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide?utm_source=chatgpt.com"
    ),
    "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide?utm_source=chatgpt.com"
  );

  // Full markdown link format
  assert.strictEqual(
    cleanUrlInput("[MDN Guide](https://developer.mozilla.org/en-US/docs/Web/JavaScript)"),
    "https://developer.mozilla.org/en-US/docs/Web/JavaScript"
  );

  // Angle bracket format
  assert.strictEqual(
    cleanUrlInput("<https://developer.mozilla.org/en-US/docs>"),
    "https://developer.mozilla.org/en-US/docs"
  );

  // Bracket enclosed
  assert.strictEqual(
    cleanUrlInput("[https://developer.mozilla.org/en-US/docs]"),
    "https://developer.mozilla.org/en-US/docs"
  );

  // Empty or invalid input
  assert.strictEqual(cleanUrlInput(""), "");
  assert.strictEqual(cleanUrlInput(null), "");
  assert.strictEqual(cleanUrlInput(undefined), "");
});


test("getSourceChunks returns paginated actual chunk payload from API", async () => {
  const originalFetch = globalThis.fetch;
  const payload = {
    items: [{ id: "chunk_1", index: 0, content: "Real chunk text", characterCount: 15 }],
    pagination: { page: 2, limit: 5, total: 919, totalPages: 184 },
  };
  globalThis.fetch = async (url) => ({
    ok: true,
    status: 200,
    headers: { get: (name) => (name === "content-type" ? "application/json" : null) },
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  });
  try {
    const { getSourceChunks } = await import("../src/lib/api/real.js");
    const result = await getSourceChunks("source_1", 2, 5);
    assert.equal(result.items[0].content, "Real chunk text");
    assert.equal(result.pagination.total, 919);
    assert.equal(result.pagination.page, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
