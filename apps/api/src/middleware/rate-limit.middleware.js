import rateLimit from "express-rate-limit";
import config from "../config/index.js";

/**
 * Factory for rate-limiter storage engine.
 * Currently returns undefined to use express-rate-limit's default in-memory store.
 * Can be swapped for a distributed Redis store (e.g. rate-limit-redis) when scaling horizontally.
 * @param {string} _prefix - Key prefix namespace for the store
 * @returns {undefined | object}
 */
export function createLimiterStore(_prefix) {
  // Can be swapped for Redis: return new RedisStore({ prefix: _prefix, ... })
  return undefined;
}

/**
 * Standard HTTP 429 response handler matching the application error envelope
 */
function standardRateLimitHandler(req, res, _next, opts) {
  const retryAfterSeconds = req.rateLimit?.resetTime
    ? Math.max(1, Math.ceil((req.rateLimit.resetTime.getTime() - Date.now()) / 1000))
    : Math.ceil(opts.windowMs / 1000);

  res.setHeader("Retry-After", retryAfterSeconds);

  return res.status(429).json({
    error: {
      code: "RATE_LIMITED",
      message: "Too many requests. Please try again later.",
      details: {
        retryAfterSeconds,
      },
    },
  });
}

/**
 * 1. Login Limiter (Per IP + Email):
 * Only failed logins count (skipSuccessfulRequests: true).
 * Prevents rapid password guessing against an account from a single IP.
 */
export function createLoginLimiter(options = {}) {
  const windowMs =
    options.windowMs ??
    (config.AUTH_RATE_LIMIT_WINDOW_MINUTES || 15) * 60 * 1000;

  const defaultMax =
    config.NODE_ENV === "test"
      ? (config.AUTH_RATE_LIMIT_MAX ?? 1000)
      : (config.AUTH_RATE_LIMIT_MAX ?? 10);

  const max = options.max ?? defaultMax;

  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    store: createLimiterStore("rl:login:"),
    keyGenerator: (req) => {
      const clientIp = req.ip || req.socket?.remoteAddress || "127.0.0.1";
      const email = typeof req.body?.email === "string" ? req.body.email.toLowerCase().trim() : "";
      return email ? `${clientIp}:${email}` : clientIp;
    },
    handler: standardRateLimitHandler,
  });
}

/**
 * 2. Login Email-Only Limiter (Across IPs):
 * Keyed by lowercased trimmed email only (20 failed attempts per hour).
 *
 * Trade-off: An attacker can make a victim's email temporarily rate-limited
 * across all IPs by deliberately failing logins. That is why the cap is generous
 * (20 failed attempts) and the window is kept relatively short (60 minutes).
 */
export function createLoginEmailLimiter(options = {}) {
  const windowMs =
    options.windowMs ??
    (config.LOGIN_EMAIL_RATE_LIMIT_WINDOW_MINUTES || 60) * 60 * 1000;

  const defaultMax =
    config.NODE_ENV === "test"
      ? (config.LOGIN_EMAIL_RATE_LIMIT_MAX ?? 1000)
      : (config.LOGIN_EMAIL_RATE_LIMIT_MAX ?? 20);

  const max = options.max ?? defaultMax;

  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    store: createLimiterStore("rl:email:"),
    keyGenerator: (req) => {
      const email = typeof req.body?.email === "string" ? req.body.email.toLowerCase().trim() : "anonymous";
      return `email:${email}`;
    },
    handler: standardRateLimitHandler,
  });
}

/**
 * 3. Register Limiter (Per IP):
 * Counts all registration attempts to throttle bot spam.
 */
export function createRegisterLimiter(options = {}) {
  const windowMs =
    options.windowMs ??
    (config.AUTH_RATE_LIMIT_WINDOW_MINUTES || 15) * 60 * 1000;

  const defaultMax =
    config.NODE_ENV === "test"
      ? (config.AUTH_RATE_LIMIT_MAX ?? 1000)
      : (config.AUTH_RATE_LIMIT_MAX ?? 10);

  const max = options.max ?? defaultMax;

  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    store: createLimiterStore("rl:register:"),
    keyGenerator: (req) => req.ip || req.socket?.remoteAddress || "127.0.0.1",
    handler: standardRateLimitHandler,
  });
}

/**
 * 4. Refresh Limiter (Per IP):
 * Allows page refreshes and multi-tab usage without spurious lockouts.
 * Default: 60 per 15 minutes per IP.
 */
export function createRefreshLimiter(options = {}) {
  const windowMs =
    options.windowMs ??
    (config.AUTH_RATE_LIMIT_WINDOW_MINUTES || 15) * 60 * 1000;

  const defaultMax =
    config.NODE_ENV === "test"
      ? (config.AUTH_REFRESH_RATE_LIMIT_MAX ?? 1000)
      : (config.AUTH_REFRESH_RATE_LIMIT_MAX ?? 60);

  const max = options.max ?? defaultMax;

  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    store: createLimiterStore("rl:refresh:"),
    keyGenerator: (req) => req.ip || req.socket?.remoteAddress || "127.0.0.1",
    handler: standardRateLimitHandler,
  });
}

// Singleton instances for route attachment
export const loginLimiter = createLoginLimiter();
export const loginEmailLimiter = createLoginEmailLimiter();
export const registerLimiter = createRegisterLimiter();
export const refreshLimiter = createRefreshLimiter();

// Backward compatibility alias
export const authLimiter = loginLimiter;
export const createAuthLimiter = createLoginLimiter;
