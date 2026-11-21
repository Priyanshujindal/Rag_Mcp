import rateLimit from "express-rate-limit";

/**
 * Standard HTTP 429 response handler matching the platform API error schema
 */
function publicRateLimitHandler(req, res, _next, opts) {
  const retryAfterSeconds = req.rateLimit?.resetTime
    ? Math.max(1, Math.ceil((req.rateLimit.resetTime.getTime() - Date.now()) / 1000))
    : Math.ceil(opts.windowMs / 1000);

  res.setHeader("Retry-After", retryAfterSeconds);

  return res.status(429).json({
    error: {
      code: "RATE_LIMITED",
      message: "Public API rate limit exceeded. Please slow down your requests.",
      details: {
        retryAfterSeconds,
      },
    },
  });
}

/**
 * Rate limiter middleware for public chatbot endpoints.
 * Automatically respects per-API-key configured requestsPerMinute, falling back to 60 req/min.
 */
export const publicApiRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: (req) => {
    if (req.apiKey?.rateLimit?.requestsPerMinute) {
      return req.apiKey.rateLimit.requestsPerMinute;
    }
    return 60;
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    if (req.apiKey?._id) {
      return `pub_rl:key:${req.apiKey._id}`;
    }
    return `pub_rl:ip:${req.ip || req.socket?.remoteAddress || "127.0.0.1"}`;
  },
  handler: publicRateLimitHandler,
});

export default publicApiRateLimiter;
