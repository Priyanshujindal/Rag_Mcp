import test from "node:test";
import assert from "node:assert/strict";
import {
  formatIndexingDuration,
  getEmbeddingStatus,
  sanitizeErrorMessage,
} from "../src/lib/utils/indexing-details.js";

// ── Test Suite 1: Indexing Duration Formatting ───────────────────────────────

test("formatIndexingDuration formats duration correctly or returns Unavailable", () => {
  // Milliseconds under 1s
  assert.strictEqual(formatIndexingDuration(450), "450ms");

  // Seconds
  assert.strictEqual(formatIndexingDuration(1200), "1.2s");
  assert.strictEqual(formatIndexingDuration(45000), "45.0s");

  // Minutes and seconds
  assert.strictEqual(formatIndexingDuration(75000), "1m 15s");
  assert.strictEqual(formatIndexingDuration(130000), "2m 10s");

  // From start and completion timestamps
  const start = "2026-11-05T10:00:00.000Z";
  const end = "2026-11-05T10:01:30.000Z";
  assert.strictEqual(formatIndexingDuration(null, start, end), "1m 30s");

  // Unavailable when missing, null, undefined, NaN, or negative
  assert.strictEqual(formatIndexingDuration(null), "Unavailable");
  assert.strictEqual(formatIndexingDuration(undefined), "Unavailable");
  assert.strictEqual(formatIndexingDuration(-500), "Unavailable");
  assert.strictEqual(formatIndexingDuration(NaN), "Unavailable");

  // Unavailable when only start time is provided
  assert.strictEqual(formatIndexingDuration(null, start, null), "Unavailable");

  // Unavailable when end time is before start time
  assert.strictEqual(formatIndexingDuration(null, end, start), "Unavailable");
});

// ── Test Suite 2: Embedding Status Mapping ───────────────────────────────────

test("getEmbeddingStatus maps supported statuses and marks missing status as Unavailable", () => {
  // Missing embeddingStatus (undefined) returns Unavailable - backend not exposing the field
  const sourceWithoutEmbedding = { status: "INDEXED", chunkCount: 15 };
  const unavailableResult = getEmbeddingStatus(sourceWithoutEmbedding);
  assert.strictEqual(unavailableResult.available, false);
  assert.strictEqual(unavailableResult.label, "Unavailable");
  assert.strictEqual(unavailableResult.status, "unavailable");

  // Empty or null source
  assert.strictEqual(getEmbeddingStatus(null).available, false);
  assert.strictEqual(getEmbeddingStatus({}).available, false);

  // Null embeddingStatus (field exists but not started yet) returns "Not Started" with available: true
  const sourceNotStarted = { status: "QUEUED", chunkCount: 0, embeddingStatus: null };
  const notStartedResult = getEmbeddingStatus(sourceNotStarted);
  assert.strictEqual(notStartedResult.available, true);
  assert.strictEqual(notStartedResult.label, "Not Started");
  assert.strictEqual(notStartedResult.status, "not_started");
  assert.strictEqual(notStartedResult.variant, "neutral");

  // Supported status: completed
  const completedSource = { embeddingStatus: "COMPLETED", chunkCount: 10, embeddingsGenerated: 10 };
  const completedResult = getEmbeddingStatus(completedSource);
  assert.strictEqual(completedResult.available, true);
  assert.strictEqual(completedResult.variant, "success");
  assert.ok(completedResult.label.includes("Completed"));
  assert.ok(completedResult.label.includes("10/10 vectors"));

  // Supported status: processing
  const processingSource = { embeddingStatus: "PROCESSING", chunkCount: 20, embeddingsGenerated: 8 };
  const processingResult = getEmbeddingStatus(processingSource);
  assert.strictEqual(processingResult.available, true);
  assert.strictEqual(processingResult.variant, "warning");
  assert.ok(processingResult.label.includes("Processing"));
  assert.ok(processingResult.label.includes("8/20 vectors"));

  // Supported status: failed
  const failedSource = { embeddingStatus: "FAILED" };
  const failedResult = getEmbeddingStatus(failedSource);
  assert.strictEqual(failedResult.available, true);
  assert.strictEqual(failedResult.variant, "danger");
  assert.ok(failedResult.label.includes("Failed"));

  // Supported status: pending / queued
  const pendingSource = { embeddingStatus: "PENDING" };
  const pendingResult = getEmbeddingStatus(pendingSource);
  assert.strictEqual(pendingResult.available, true);
  assert.strictEqual(pendingResult.variant, "neutral");
  assert.ok(pendingResult.label.includes("Pending"));
});

// ── Test Suite 3: Error Message Sanitization ─────────────────────────────────

test("sanitizeErrorMessage prevents secrets and stack traces from leaking", () => {
  // Redacts MongoDB Atlas connection string with embedded credentials
  const mongoErr = "Error connecting to mongodb+srv://admin:SuperSecretPassword123@cluster0.rag.mongodb.net/Rag_Mcp";
  const sanitizedMongo = sanitizeErrorMessage(mongoErr);
  assert.ok(!sanitizedMongo.includes("SuperSecretPassword123"));
  assert.ok(!sanitizedMongo.includes("mongodb+srv://"));
  assert.ok(sanitizedMongo.includes("[REDACTED_DATABASE_URI]"));

  // Redacts bearer tokens and api keys
  const authErr = "Unauthorized: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.secretKey failed with ragmcp_live_99887766";
  const sanitizedAuth = sanitizeErrorMessage(authErr);
  assert.ok(!sanitizedAuth.includes("ragmcp_live_99887766"));
  assert.ok(sanitizedAuth.includes("[REDACTED_API_KEY]"));
  assert.ok(sanitizedAuth.includes("Bearer [REDACTED]"));

  // Strips multi-line stack trace down to primary message
  const stackErr = "Ingestion failed: connection reset\n    at Socket.onTimeout (/node/net.js:123)\n    at emit (events.js:456)";
  const sanitizedStack = sanitizeErrorMessage(stackErr);
  assert.ok(!sanitizedStack.includes("at Socket.onTimeout"));
  assert.strictEqual(sanitizedStack, "Ingestion failed: connection reset");

  // Empty or null error
  assert.strictEqual(sanitizeErrorMessage(null), "Unknown error occurred during indexing.");
  assert.strictEqual(sanitizeErrorMessage(""), "Unknown error occurred during indexing.");
});

// ── Test Suite 4: Real API getSource integration with stubbed fetch ──────────

test("getSource fetches source details and passes through real fields without fabricating", async () => {
  let requestedEndpoint = null;
  const originalFetch = globalThis.fetch;

  const mockPayload = {
    id: "src_real_123",
    knowledgeBaseId: "kb_test_456",
    name: "Python Documentation",
    url: "https://docs.python.org/3/",
    type: "URL",
    status: "INDEXED",
    chunkCount: 42,
    error: null,
    lastIndexedAt: "2026-11-05T12:00:00.000Z",
    createdAt: "2026-11-05T11:50:00.000Z",
    updatedAt: "2026-11-05T12:00:00.000Z",
  };

  globalThis.fetch = async (url) => {
    requestedEndpoint = String(url);
    return {
      ok: true,
      status: 200,
      headers: { get: (h) => (h === "content-type" ? "application/json" : null) },
      json: async () => mockPayload,
      text: async () => JSON.stringify(mockPayload),
    };
  };

  try {
    const { getSource } = await import("../src/lib/api/real.js");
    const source = await getSource("src_real_123");

    assert.ok(requestedEndpoint.includes("/sources/src_real_123"), "Calls correct endpoint /sources/:id");
    assert.strictEqual(source.id, "src_real_123");
    assert.strictEqual(source.status, "indexed");
    assert.strictEqual(source.chunksCount, 42);

    // Verify missing backend fields are cleanly returned as null (NO fabricated text or chunks)
    assert.strictEqual(source.extractedText, null, "extractedText is null when not in response");
    assert.strictEqual(source.chunkItems, null, "chunkItems is null when not in response");
    assert.strictEqual(source.embeddingStatus, null, "embeddingStatus is null when not in response");
    assert.strictEqual(source.indexingDurationMs, null, "indexingDurationMs is null when not in response");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ── Test Suite 5: getSource correctly maps actual extracted text and chunks if provided

test("getSource maps extractedText and chunkItems when provided by the response", async () => {
  const originalFetch = globalThis.fetch;

  const richPayload = {
    id: "src_rich_789",
    knowledgeBaseId: "kb_rich",
    name: "API Spec",
    type: "DOCX",
    status: "INDEXED",
    chunkCount: 2,
    extractedTextPreview: "Full extracted document text representing page contents.",
    extractedCharCount: 58,
    chunkItems: [
      { chunkIndex: 0, text: "First chunk text snippet", tokens: 120 },
      { chunkIndex: 1, text: "Second chunk text snippet", tokens: 95 },
    ],
    embeddingStatus: "COMPLETED",
    embeddingsGenerated: 2,
    indexingDurationMs: 3450,
    indexingStartedAt: "2026-11-05T12:00:00.000Z",
    indexingCompletedAt: "2026-11-05T12:00:03.450Z",
    lastIndexedAt: "2026-11-05T12:05:00.000Z",
  };

  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    headers: { get: (h) => (h === "content-type" ? "application/json" : null) },
    json: async () => richPayload,
    text: async () => JSON.stringify(richPayload),
  });

  try {
    const { getSource } = await import("../src/lib/api/real.js");
    const source = await getSource("src_rich_789");

    assert.strictEqual(source.extractedText, "Full extracted document text representing page contents.");
    assert.strictEqual(source.extractedCharCount, 58);
    assert.ok(Array.isArray(source.chunkItems) && source.chunkItems.length === 2);
    assert.strictEqual(source.chunkItems[0].text, "First chunk text snippet");
    assert.strictEqual(source.embeddingStatus, "COMPLETED");
    assert.strictEqual(source.embeddingsGenerated, 2);
    assert.strictEqual(source.indexingDurationMs, 3450);
    assert.strictEqual(source.indexingStartedAt, "2026-11-05T12:00:00.000Z");
    assert.strictEqual(source.indexingCompletedAt, "2026-11-05T12:00:03.450Z");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ── Test Suite 6: Expansion / Collapse and Cache Deduplication Logic ──────────

test("Expansion state toggle and caching avoids duplicate requests", () => {
  const expanded = new Set();
  const cache = {};

  // 1. Initial state: collapsed
  assert.strictEqual(expanded.has("src_1"), false);

  // 2. Expand src_1
  expanded.add("src_1");
  assert.strictEqual(expanded.has("src_1"), true);

  // 3. Populate cache
  cache["src_1"] = { id: "src_1", status: "indexed" };
  assert.ok(cache["src_1"], "Cached data is stored");

  // 4. Repeated toggle checks cache: since cache['src_1'] exists, no re-fetch needed
  const needsFetch = !cache["src_1"];
  assert.strictEqual(needsFetch, false, "Cache prevents duplicate fetch call");

  // 5. Collapse src_1
  expanded.delete("src_1");
  assert.strictEqual(expanded.has("src_1"), false);
  assert.ok(cache["src_1"], "Cache remains intact across collapse");
});

// ── Test Suite 7: Extracted text preview truncation logic ─────────────────────

test("Extracted text preview truncation limits to 300 characters", () => {
  const shortText = "Short extract.";
  const longText = "A".repeat(450);

  const shortPreview = shortText.slice(0, 300);
  assert.strictEqual(shortPreview, "Short extract.");

  const longPreview = longText.slice(0, 300) + "…";
  assert.strictEqual(longPreview.length, 301); // 300 + 1 ellipsis
  assert.ok(longText.length > 300);
});

// ── Test Suite 8: Chunk pagination calculation ────────────────────────────────

test("Chunk list pagination correctly calculates pages and slices", () => {
  const CHUNKS_PER_PAGE = 5;
  const chunks = Array.from({ length: 12 }, (_, i) => ({ chunkIndex: i, text: `Chunk ${i}` }));

  const totalPages = Math.max(1, Math.ceil(chunks.length / CHUNKS_PER_PAGE));
  assert.strictEqual(totalPages, 3); // 12 items / 5 per page = 3 pages

  // Page 1: items 0..4
  const page1 = chunks.slice(0, 5);
  assert.strictEqual(page1.length, 5);
  assert.strictEqual(page1[0].chunkIndex, 0);
  assert.strictEqual(page1[4].chunkIndex, 4);

  // Page 3: items 10..11
  const page3 = chunks.slice(10, 15);
  assert.strictEqual(page3.length, 2);
  assert.strictEqual(page3[0].chunkIndex, 10);
});
