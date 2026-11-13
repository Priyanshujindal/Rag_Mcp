import React, { createContext, useContext, useState, useEffect, useRef } from "react";
import { loginUser, registerUser, logoutUser, getMockUser, isMock } from "./api/index.js";
import { refreshAccessToken, broadcastLogout, subscribeToLogout, getAccessToken } from "./api/client.js";

const AuthContext = createContext({
  isAuthenticated: true,
  isLoading: false,
  user: null,
  login: async () => {},
  register: async () => {},
  logout: async () => {},
});

const AUTH_STORAGE_KEY = "ragmcp_authenticated";

// Module-level bootstrap promise to guard against React StrictMode double invocation in dev
let bootstrapPromise = null;

function performBootstrap() {
  if (!bootstrapPromise) {
    bootstrapPromise = (async () => {
      try {
        const token = await refreshAccessToken();
        if (!token) return null;
        const userData = await getMockUser();
        if (userData && userData.id && userData.id !== "anon") {
          return userData;
        }
        return null;
      } catch {
        return null;
      }
    })();
  }
  return bootstrapPromise;
}

/**
 * Decode a JWT and return its expiry timestamp in milliseconds (or null).
 * Does NOT validate the signature — just reads the payload for scheduling purposes.
 */
function getTokenExpiry(token) {
  try {
    if (!token) return null;
    const payload = JSON.parse(atob(token.split(".")[1]));
    return payload.exp ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }) {
  const [isLoading, setIsLoading] = useState(!isMock);
  const [isAuthenticated, setIsAuthenticated] = useState(() => {
    if (isMock) {
      try {
        const val = localStorage.getItem(AUTH_STORAGE_KEY);
        return val === null ? true : val === "true";
      } catch {
        return true;
      }
    }
    // In real mode, initial state is false until bootstrap resolves
    return false;
  });

  const [user, setUser] = useState(null);
  const refreshTimerRef = useRef(null);

  /**
   * Schedule a silent token refresh 2 minutes before the current access token
   * expires. Clears any previously scheduled timer first.
   */
  const scheduleTokenRefresh = (token) => {
    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }
    if (!token || isMock) return;

    const expiry = getTokenExpiry(token);
    if (!expiry) return;

    // Refresh 2 minutes (120 s) before expiry, minimum 5 s from now
    const delay = Math.max(expiry - Date.now() - 120_000, 5_000);

    refreshTimerRef.current = setTimeout(async () => {
      try {
        const newToken = await refreshAccessToken();
        if (newToken) {
          scheduleTokenRefresh(newToken);   // reschedule with the fresh token
        } else {
          // Refresh failed — session truly expired, log out gracefully
          broadcastLogout();
          setIsAuthenticated(false);
          setUser(null);
        }
      } catch {
        // Network error during background refresh — do not log out yet,
        // the next API call will trigger a fresh 401 → retry cycle.
      }
    }, delay);
  };

  useEffect(() => {
    if (isMock) {
      getMockUser().then((userData) => setUser(userData));
      return;
    }

    let isMounted = true;

    // Listen for logout broadcasts across tabs
    const unsubscribe = subscribeToLogout(() => {
      if (isMounted) {
        if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
        setIsAuthenticated(false);
        setUser(null);
      }
    });

    performBootstrap().then((bootstrapUser) => {
      if (!isMounted) return;
      if (bootstrapUser) {
        setIsAuthenticated(true);
        setUser(bootstrapUser);
        // Schedule proactive refresh using the token already in memory
        scheduleTokenRefresh(getAccessToken());
      } else {
        setIsAuthenticated(false);
        setUser(null);
      }
      setIsLoading(false);
    });

    return () => {
      isMounted = false;
      unsubscribe();
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    };
  }, []);

  const login = async (credentials) => {
    if (isMock) {
      try {
        localStorage.setItem(AUTH_STORAGE_KEY, "true");
      } catch {
        // ignore
      }
      setIsAuthenticated(true);
      return;
    }

    const data = await loginUser(credentials);
    setIsAuthenticated(true);
    setUser(data.user);
    setIsLoading(false);
    scheduleTokenRefresh(data.accessToken);
  };

  const register = async (userData) => {
    if (isMock) {
      try {
        localStorage.setItem(AUTH_STORAGE_KEY, "true");
      } catch {
        // ignore
      }
      setIsAuthenticated(true);
      return;
    }

    const data = await registerUser(userData);
    setIsAuthenticated(true);
    setUser(data.user);
    setIsLoading(false);
    scheduleTokenRefresh(data.accessToken);
  };

  const logout = async () => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);

    if (isMock) {
      try {
        localStorage.setItem(AUTH_STORAGE_KEY, "false");
      } catch {
        // ignore
      }
      setIsAuthenticated(false);
      setUser(null);
      return;
    }

    try {
      await logoutUser();
    } finally {
      broadcastLogout();
      setIsAuthenticated(false);
      setUser(null);
    }
  };

  return (
    <AuthContext.Provider value={{ isAuthenticated, isLoading, user, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}

export default AuthProvider;
