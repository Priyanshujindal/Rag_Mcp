import rateLimit from "express-rate-limit";
import config from "../config/index.js";
import { getRedisClient } from "../lib/redis.js";

/**
 * Hybrid rate-limiter store for express-rate-limit v7.
 * Uses Redis (atomic INCR + PEXPIRE) when connected, and automatically falls back
 * to an in-memory window map when Redis is offline or in test mode.
 */
class HybridRedisRateLimitStore {
  constructor(prefix, windowMs = 15 * 60 * 1000) {
    this.prefix = prefix;
    this.windowMs = windowMs;
    this.localHits = new Map();
  }

  init(options) {
    if (options?.windowMs) {
      this.windowMs = options.windowMs;
    }
  }

  _fullKey(key) {
    return `${this.prefix}${key}`;
  }

  async increment(key) {
    const fullKey = this._fullKey(key);
    const client = getRedisClient();

    if (client) {
      try {
        const results = await client.multi().incr(fullKey).pttl(fullKey).exec();
        const totalHits = Number(results?.[0]?.[1] ?? 1);
        let pttl = Number(results?.[1]?.[1] ?? -1);

        if (pttl < 0) {
          await client.pexpire(fullKey, this.windowMs);
          pttl = this.windowMs;
        }

        return {
          totalHits,
          resetTime: new Date(Date.now() + pttl),
        };
      } catch {
        // Fall through to in-memory store if Redis command fails
      }
    }

    const now = Date.now();
    const existing = this.localHits.get(fullKey);
    if (!existing || existing.resetAt <= now) {
      const entry = { count: 1, resetAt: now + this.windowMs };
      this.localHits.set(fullKey, entry);
      return { totalHits: 1, resetTime: new Date(entry.resetAt) };
    }

    existing.count += 1;
    return { totalHits: existing.count, resetTime: new Date(existing.resetAt) };
  }

  async decrement(key) {
    const fullKey = this._fullKey(key);
    const client = getRedisClient();

    if (client) {
      try {
        await client.decr(fullKey);
        return;
      } catch {
        // Fall through to in-memory store
      }
    }

    const existing = this.localHits.get(fullKey);
    if (existing && existing.count > 0) {
      existing.count -= 1;
    }
  }

  async resetKey(key) {
    const fullKey = this._fullKey(key);
    this.localHits.delete(fullKey);
    const client = getRedisClient();
    if (client) {
      try {
        await client.del(fullKey);
      } catch {
        // Ignore
      }
    }
  }
}

/**
 * Factory for rate-limiter storage engine.
 * Uses Redis when connected and falls back cleanly to in-memory storage.
 * @param {string} prefix - Key prefix namespace for the store
 * @returns {HybridRedisRateLimitStore | undefined}
 */
export function createLimiterStore(prefix) {
  if (config.NODE_ENV === "test") {
    return undefined;
  }
  return new HybridRedisRateLimitStore(prefix);
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
