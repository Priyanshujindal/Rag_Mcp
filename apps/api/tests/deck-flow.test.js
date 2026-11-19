/**
 * Tests for the structured PowerPoint flow helpers, the ai-client deck call, file-intent filename
 * detection and the PPTX_MODE config switch. No database or AI service is needed.
 */
import { describe, it, expect, vi } from "vitest";
import { validateEnv } from "../src/config/index.js";
import aiClient from "../src/services/ai-client.js";
import config from "../src/config/index.js";
import FileIntentService from "../src/modules/chat/file-intent.service.js";
import {
  DECK_REPLY_GUIDE,
  DECK_REPLY_MAX_TOKENS,
  buildDeckRequest,
  collectDeckSource,
  deckFailureNote,
  isStructuredDeckMode,
} from "../src/modules/chat/deck-flow.service.js";

const KB_ID = "6aec3f2631f96d832ca52b84";

describe("PPTX mode switch", () => {
  it("defaults to structured and accepts legacy", () => {
    expect(isStructuredDeckMode(undefined)).toBe(true);
    expect(isStructuredDeckMode({})).toBe(true);
    expect(isStructuredDeckMode({ PPTX_MODE: "structured" })).toBe(true);
    expect(isStructuredDeckMode({ PPTX_MODE: "legacy" })).toBe(false);
  });

  it("is validated by the environment schema", () => {
    const base = { NODE_ENV: "development", MONGODB_URI: "mongodb://localhost:27017/x" };
    expect(validateEnv(base).PPTX_MODE).toBe("structured");
    expect(validateEnv({ ...base, PPTX_MODE: "legacy" }).PPTX_MODE).toBe("legacy");
    expect(() => validateEnv({ ...base, PPTX_MODE: "fancy" })).toThrow();
  });

  it("keeps the chat reply short and tells the model not to write the slides", () => {
    expect(DECK_REPLY_GUIDE).toMatch(/Do NOT write out the slides/);
    expect(DECK_REPLY_MAX_TOKENS).toBeLessThan(1500);
  });
});

describe("collectDeckSource", () => {
  const messages = [
    { role: "USER", content: "Explain RAG" },
    { role: "ASSISTANT", content: "RAG retrieves documents first." },
    { role: "USER", content: "thanks" },
  ];

  it("uses the previous assistant answer only when the user asked to convert it", () => {
    expect(collectDeckSource({ isConvertPrevious: true, messages })).toBe("RAG retrieves documents first.");
    expect(collectDeckSource({ isConvertPrevious: false, messages })).toBe("");
  });

  it("includes attached documents and clips very long material", () => {
    const docs = [{ name: "notes.txt", content: "Alpha beta" }];
    expect(collectDeckSource({ attachedDocs: docs })).toContain('Document "notes.txt"');
    const huge = [{ name: "big", content: "x".repeat(80000) }];
    expect(collectDeckSource({ attachedDocs: huge }).length).toBeLessThanOrEqual(50000);
  });

  it("ignores empty or malformed input", () => {
    expect(collectDeckSource()).toBe("");
    expect(collectDeckSource({ attachedDocs: [null, {}, { name: "x", content: "  " }] })).toBe("");
  });
});

describe("buildDeckRequest", () => {
  it("passes the filename only when the user named the file", () => {
    const named = buildDeckRequest({ message: "make a deck named talk.pptx", fileIntent: { explicitFilename: true, filename: "talk.pptx" } });
    expect(named.filename).toBe("talk.pptx");
    const unnamed = buildDeckRequest({ message: "make a deck", fileIntent: { explicitFilename: false, filename: "presentation_overview.pptx" } });
    expect(unnamed.filename).toBeUndefined();
  });

  it("only forwards a valid knowledge base id and the model settings", () => {
    const ok = buildDeckRequest({ message: "deck", knowledgeBaseId: KB_ID, model: "gemini-3.8-flash", provider: "gemini" });
    expect(ok).toMatchObject({ knowledgeBaseId: KB_ID, model: "gemini-3.8-flash", provider: "gemini" });
    expect(buildDeckRequest({ message: "deck", knowledgeBaseId: "not-an-id" }).knowledgeBaseId).toBeUndefined();
    expect(buildDeckRequest({ message: "deck", knowledgeBaseId: null }).knowledgeBaseId).toBeUndefined();
  });

  it("limits the request length and never sends an empty request", () => {
    expect(buildDeckRequest({ message: "a".repeat(9000) }).request.length).toBe(4000);
    expect(buildDeckRequest({ message: "   " }).request).toBe("Create a presentation");
  });
});

describe("deckFailureNote", () => {
  it("explains overload, timeouts and generic failures differently", () => {
    expect(deckFailureNote({ code: "AI_SERVICE_TIMEOUT" })).toMatch(/too long/);
    expect(deckFailureNote({ code: "DECK_PLANNING_FAILED", message: "The AI model is busy right now" })).toMatch(/busy/);
    expect(deckFailureNote(new Error("boom"))).toMatch(/couldn't create the presentation file/);
  });
});

describe("file intent filename detection", () => {
  it("flags an explicit filename", () => {
    const intent = FileIntentService.detectFileIntent("create a presentation about AI named ai_talk.pptx");
    expect(intent.hasIntent).toBe(true);
    expect(intent.fileType).toBe("pptx");
    expect(intent.explicitFilename).toBe(true);
    expect(intent.filename).toBe("ai_talk.pptx");
  });

  it("does not flag a generated default name", () => {
    const intent = FileIntentService.detectFileIntent("make a powerpoint presentation about climate change");
    expect(intent.hasIntent).toBe(true);
    expect(intent.explicitFilename).toBe(false);
  });
});

describe("aiClient.generateDeck", () => {
  it("posts to /files/deck with the tenant headers, a long timeout and no automatic retry", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ filename: "x.pptx", file_type: "pptx", content_base64: "AAAA" }),
    });
    const original = global.fetch;
    global.fetch = mockFetch;
    try {
      const result = await aiClient.generateDeck(KB_ID, {
        request: "deck about RAG",
        sourceText: "notes",
        knowledgeBaseId: KB_ID,
        model: "gemini-3.8-flash",
      });
      expect(result.filename).toBe("x.pptx");
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe(`${config.AI_SERVICE_URL}/files/deck`);
      expect(options.headers["X-Internal-Key"]).toBe(config.INTERNAL_API_KEY);
      expect(options.headers["X-Workspace-Id"]).toBe(KB_ID);
      const body = JSON.parse(options.body);
      expect(body).toMatchObject({
        request: "deck about RAG",
        source_text: "notes",
        knowledge_base_id: KB_ID,
        model: "gemini-3.8-flash",
        include_notes: true,
      });
      expect(body.filename).toBeUndefined();
    } finally {
      global.fetch = original;
    }
  });

  it("does not retry a failed plan (it already retried inside the ai-service)", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => ({ error: { code: "DECK_PLANNING_FAILED", message: "The AI model is busy right now" } }),
    });
    const original = global.fetch;
    global.fetch = mockFetch;
    try {
      await expect(aiClient.generateDeck(KB_ID, { request: "deck" })).rejects.toMatchObject({
        code: "DECK_PLANNING_FAILED",
      });
      expect(mockFetch).toHaveBeenCalledTimes(1);
    } finally {
      global.fetch = original;
    }
  });
});
