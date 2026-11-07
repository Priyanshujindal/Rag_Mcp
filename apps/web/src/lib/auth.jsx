import React, { createContext, useContext, useState, useEffect } from "react";
import { loginUser, registerUser, logoutUser, getMockUser, isMock } from "./api/index.js";
import { refreshAccessToken, broadcastLogout, subscribeToLogout } from "./api/client.js";

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

  useEffect(() => {
    if (isMock) {
      getMockUser().then((userData) => setUser(userData));
      return;
    }

    let isMounted = true;

    // Listen for logout broadcasts across tabs
    const unsubscribe = subscribeToLogout(() => {
      if (isMounted) {
        setIsAuthenticated(false);
        setUser(null);
      }
    });

    performBootstrap().then((bootstrapUser) => {
      if (!isMounted) return;
      if (bootstrapUser) {
        setIsAuthenticated(true);
        setUser(bootstrapUser);
      } else {
        setIsAuthenticated(false);
        setUser(null);
      }
      setIsLoading(false);
    });

    return () => {
      isMounted = false;
      unsubscribe();
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
  };

  const logout = async () => {
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
