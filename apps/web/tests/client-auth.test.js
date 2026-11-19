import test from "node:test";
import assert from "node:assert/strict";

// Create minimal in-memory storage mock
function createMockStorage() {
  const store = new Map();
  return {
    getItem: (key) => store.get(key) || null,
    setItem: (key, val) => store.set(key, String(val)),
    removeItem: (key) => store.delete(key),
    clear: () => store.clear(),
    get size() {
      return store.size;
    },
  };
}

test("In-memory access token security & single-flight refresh", async (t) => {
  const originalFetch = globalThis.fetch;
  const originalLocalStorage = globalThis.localStorage;
  const originalSessionStorage = globalThis.sessionStorage;
  const originalWindow = globalThis.window;

  const mockLocal = createMockStorage();
  const mockSession = createMockStorage();

  globalThis.localStorage = mockLocal;
  globalThis.sessionStorage = mockSession;
  globalThis.window = {
    addEventListener: () => {},
    removeEventListener: () => {},
  };

  t.after(() => {
    globalThis.fetch = originalFetch;
    globalThis.localStorage = originalLocalStorage;
    globalThis.sessionStorage = originalSessionStorage;
    globalThis.window = originalWindow;
  });

  const {
    getAccessToken,
    setAccessToken,
    apiClient,
    refreshAccessToken,
  } = await import("../src/lib/api/client.js");
  const { loginUser, logoutUser } = await import("../src/lib/api/real.js");

  // 1. In-memory token storage (never in localStorage or sessionStorage)
  await t.test("Access token is kept strictly in memory and never written to storage", async () => {
    globalThis.fetch = async (url) => {
      if (url.includes("/auth/login")) {
        return {
          ok: true,
          status: 200,
          headers: new Headers({ "Content-Type": "application/json" }),
          json: async () => ({
            accessToken: "super_secret_jwt_access_token_12345",
            user: { id: "user_1", email: "user@rag-mcp.ai", name: "User One" },
          }),
        };
      }
      return { ok: true, status: 200, headers: new Headers(), json: async () => ({}) };
    };

    // Pre-populate legacy tokens
    mockLocal.setItem("ragmcp_access_token", "legacy_token");
    mockSession.setItem("ragmcp_access_token", "legacy_token");

    // Login via real.js
    await loginUser({ email: "user@rag-mcp.ai", password: "Password123!" });

    // In-memory token is set
    assert.strictEqual(getAccessToken(), "super_secret_jwt_access_token_12345");

    // Storage does NOT contain token
    assert.notStrictEqual(mockLocal.getItem("ragmcp_access_token"), "super_secret_jwt_access_token_12345");
    assert.notStrictEqual(mockSession.getItem("ragmcp_access_token"), "super_secret_jwt_access_token_12345");
    assert.strictEqual(mockLocal.getItem("access_token"), null);
    assert.strictEqual(mockSession.getItem("access_token"), null);
  });

  // 2. Single-flight token refresh
  await t.test("Two simultaneous 401s produce exactly ONE refresh call", async () => {
    let refreshCallCount = 0;
    let dataCallCount = 0;

    setAccessToken("expired_token");

    globalThis.fetch = async (url, options) => {
      if (url.includes("/auth/refresh")) {
        refreshCallCount++;
        // Add artificial delay to guarantee overlapping in-flight state
        await new Promise((r) => setTimeout(r, 20));
        return {
          ok: true,
          status: 200,
          headers: new Headers({ "Content-Type": "application/json" }),
          json: async () => ({ accessToken: "fresh_new_jwt_access_token_67890" }),
        };
      }

      if (url.includes("/protected-resource")) {
        dataCallCount++;
        const authHeader = options?.headers?.get("Authorization") || "";
        // First requests fail with 401
        if (authHeader === "Bearer expired_token") {
          return {
            ok: false,
            status: 401,
            headers: new Headers({ "Content-Type": "application/json" }),
            json: async () => ({ error: { code: "UNAUTHORIZED", message: "Token expired" } }),
          };
        }
        // Retried requests with new token succeed
        if (authHeader === "Bearer fresh_new_jwt_access_token_67890") {
          return {
            ok: true,
            status: 200,
            headers: new Headers({ "Content-Type": "application/json" }),
            json: async () => ({ data: "secret_data" }),
          };
        }
      }

      return { ok: false, status: 404, headers: new Headers(), json: async () => ({}) };
    };

    // Dispatch two concurrent calls that both get 401
    const [res1, res2] = await Promise.all([
      apiClient("/protected-resource"),
      apiClient("/protected-resource"),
    ]);

    assert.strictEqual(res1.data, "secret_data");
    assert.strictEqual(res2.data, "secret_data");
    assert.strictEqual(refreshCallCount, 1, "Expected exactly ONE /auth/refresh call despite concurrent 401s");
    assert.strictEqual(getAccessToken(), "fresh_new_jwt_access_token_67890");
  });

  // 3. Bootstrap failure
  await t.test("Bootstrap failure when refresh token is invalid returns null", async () => {
    setAccessToken("some_token");

    globalThis.fetch = async (url) => {
      if (url.includes("/auth/refresh")) {
        return {
          ok: false,
          status: 401,
          headers: new Headers({ "Content-Type": "application/json" }),
          json: async () => ({ error: { code: "UNAUTHORIZED", message: "Invalid refresh token" } }),
        };
      }
      return { ok: false, status: 500, headers: new Headers(), json: async () => ({}) };
    };

    const token = await refreshAccessToken();
    assert.strictEqual(token, null);
    assert.strictEqual(getAccessToken(), null, "Access token is cleared when refresh fails");
  });

  // 4. Logout clears everything
  await t.test("Logout clears in-memory access token and storage state", async () => {
    setAccessToken("active_token");
    mockLocal.setItem("ragmcp_active_workspace_id", "ws_123");

    let logoutCalled = false;
    globalThis.fetch = async (url) => {
      if (url.includes("/auth/logout")) {
        logoutCalled = true;
        return {
          ok: true,
          status: 200,
          headers: new Headers({ "Content-Type": "application/json" }),
          json: async () => ({ success: true }),
        };
      }
      return { ok: true, status: 200, headers: new Headers(), json: async () => ({}) };
    };

    await logoutUser();

    assert.strictEqual(logoutCalled, true);
    assert.strictEqual(getAccessToken(), null, "In-memory token must be null after logout");
    assert.strictEqual(mockLocal.getItem("ragmcp_active_workspace_id"), null);
  });
});

