/**
 * Custom API Error containing status code and structured backend details
 */
export class ApiError extends Error {
  constructor(code, message, status = 400, details = undefined) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.details = details;
    this.isServiceUnavailable =
      status === 503 || code === "DB_UNAVAILABLE" || code === "API_UNAVAILABLE";
  }
}

const BASE_URL =
  (typeof import.meta !== "undefined" && import.meta.env && import.meta.env.VITE_API_URL) ||
  "/api/v1";

/**
 * Access token kept in module-level memory only.
 * NEVER written to localStorage, sessionStorage, IndexedDB or cookies.
 */
let memoryAccessToken = null;

// Clean up any legacy tokens left in browser storage by earlier versions
try {
  if (typeof localStorage !== "undefined") {
    localStorage.removeItem("ragmcp_access_token");
    localStorage.removeItem("ask0_access_token");
    localStorage.removeItem("access_token");
  }
  if (typeof sessionStorage !== "undefined") {
    sessionStorage.removeItem("ragmcp_access_token");
    sessionStorage.removeItem("ask0_access_token");
    sessionStorage.removeItem("access_token");
  }
} catch {
  // Ignore storage errors in restricted contexts
}

export function getAccessToken() {
  return memoryAccessToken;
}

export function setAccessToken(token) {
  memoryAccessToken = token || null;
}

export function getActiveWorkspaceId() {
  try {
    const id = localStorage.getItem("ragmcp_active_workspace_id");
    if (!id || id === "null" || id === "undefined" || id === "anon") {
      return null;
    }
    return id;
  } catch {
    return null;
  }
}

export function setActiveWorkspaceId(id) {
  try {
    if (id && id !== "null" && id !== "undefined" && id !== "anon") {
      localStorage.setItem("ragmcp_active_workspace_id", id);
    } else {
      localStorage.removeItem("ragmcp_active_workspace_id");
    }
  } catch {
    // Ignore storage errors
  }
}

/**
 * Single-flight refresh token coordinator.
 * Several concurrent 401s or bootstrap calls share exactly ONE in-flight promise.
 */
let inFlightRefreshPromise = null;

export async function refreshAccessToken() {
  if (inFlightRefreshPromise) {
    return inFlightRefreshPromise;
  }

  inFlightRefreshPromise = (async () => {
    try {
      const res = await fetch(`${BASE_URL}/auth/refresh`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
      });

      if (!res.ok) {
        setAccessToken(null);
        return null;
      }

      const data = await res.json();
      const newToken = data.accessToken || null;
      setAccessToken(newToken);
      return newToken;
    } catch {
      setAccessToken(null);
      return null;
    } finally {
      inFlightRefreshPromise = null;
    }
  })();

  return inFlightRefreshPromise;
}

/**
 * Multi-tab logout synchronization via BroadcastChannel (with localStorage event fallback)
 */
const LOGOUT_CHANNEL = "ragmcp_auth_channel";
let authBroadcastChannel = null;

try {
  if (typeof window !== "undefined" && typeof BroadcastChannel !== "undefined") {
    authBroadcastChannel = new BroadcastChannel(LOGOUT_CHANNEL);
    if (typeof authBroadcastChannel.unref === "function") {
      authBroadcastChannel.unref();
    }
  }
} catch {
  authBroadcastChannel = null;
}

export function broadcastLogout() {
  setAccessToken(null);
  try {
    if (authBroadcastChannel) {
      authBroadcastChannel.postMessage({ type: "LOGOUT" });
    } else if (typeof localStorage !== "undefined") {
      localStorage.setItem("ragmcp_logged_out", Date.now().toString());
    }
  } catch {
    // Degrade silently
  }
}

export function subscribeToLogout(callback) {
  const cleanups = [];

  if (authBroadcastChannel) {
    const handler = (event) => {
      if (event.data?.type === "LOGOUT") {
        setAccessToken(null);
        callback();
      }
    };
    authBroadcastChannel.addEventListener("message", handler);
    cleanups.push(() => authBroadcastChannel.removeEventListener("message", handler));
  }

  if (typeof window !== "undefined") {
    const storageHandler = (event) => {
      if (event.key === "ragmcp_logged_out") {
        setAccessToken(null);
        callback();
      }
    };
    window.addEventListener("storage", storageHandler);
    cleanups.push(() => window.removeEventListener("storage", storageHandler));
  }

  return () => {
    cleanups.forEach((fn) => fn());
  };
}

/**
 * Lightweight fetch client with JWT attachment, active workspace header, and automatic 401 retry
 */
export async function apiClient(endpoint, options = {}, isRetry = false) {
  const url = endpoint.startsWith("http") ? endpoint : `${BASE_URL}${endpoint}`;
  const headers = new Headers(options.headers || {});

  const token = getAccessToken();
  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const workspaceId = getActiveWorkspaceId();
  if (workspaceId && !headers.has("X-Workspace-Id")) {
    headers.set("X-Workspace-Id", workspaceId);
  }

  if (options.body && !(options.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const fetchOptions = {
    ...options,
    headers,
    credentials: "include",
  };

  let response;
  try {
    response = await fetch(url, fetchOptions);
  } catch (netErr) {
    if (netErr instanceof ApiError) throw netErr;
    const err = new ApiError("NETWORK_ERROR", "Cannot reach the API server. Is it running?", 503);
    err.isServiceUnavailable = true;
    throw err;
  }

  // If 401 Unauthorized and haven't retried yet, coordinate single-flight token refresh
  if (
    response.status === 401 &&
    !isRetry &&
    !endpoint.includes("/auth/login") &&
    !endpoint.includes("/auth/register") &&
    !endpoint.includes("/auth/refresh")
  ) {
    const newToken = await refreshAccessToken();
    if (newToken) {
      return apiClient(endpoint, options, true);
    }
    throw new ApiError("UNAUTHORIZED", "Session expired. Please sign in again.", 401);
  }

  // Parse JSON response
  let data;
  const contentType = response.headers.get("content-type");
  if (contentType && contentType.includes("application/json")) {
    data = await response.json();
  } else {
    data = await response.text();
  }

  if (!response.ok) {
    const errorObj = data && typeof data === "object" && data.error ? data.error : {};
    const code = errorObj.code || `HTTP_${response.status}`;
    const message = errorObj.message || response.statusText || "Request failed";
    const details = errorObj.details;

    throw new ApiError(code, message, response.status, details);
  }

  return data;
}

export const api = {
  get: (endpoint, options) => apiClient(endpoint, { ...options, method: "GET" }),
  post: (endpoint, body, options) =>
    apiClient(endpoint, {
      ...options,
      method: "POST",
      body: body instanceof FormData ? body : JSON.stringify(body),
    }),
  patch: (endpoint, body, options) =>
    apiClient(endpoint, {
      ...options,
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  delete: (endpoint, options) => apiClient(endpoint, { ...options, method: "DELETE" }),
};

export default api;
