import logger from "./logger.js";

let sentryClient = null;
let initialized = false;

/**
 * Initializes Sentry error tracking if SENTRY_DSN is configured and @sentry/node is installed.
 * Safe no-op when SENTRY_DSN is not provided.
 */
export async function initObservability() {
  if (initialized) return;
  initialized = true;

  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;

  try {
    const Sentry = await import("@sentry/node");
    Sentry.init({
      dsn,
      environment: process.env.NODE_ENV || "development",
      tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE || 0.1),
    });
    sentryClient = Sentry;
    logger.info("Sentry observability initialized for Node API");
  } catch (err) {
    logger.warn(
      { err: err.message },
      "SENTRY_DSN is set but @sentry/node is not installed; skipping Sentry SDK init"
    );
  }
}

/**
 * Captures an unexpected exception with request/workspace context.
 * @param {Error} err
 * @param {object} context
 */
export function captureException(err, context = {}) {
  if (!sentryClient) return;
  try {
    sentryClient.withScope((scope) => {
      if (context.reqId) scope.setTag("request_id", context.reqId);
      if (context.workspaceId) scope.setTag("workspace_id", String(context.workspaceId));
      if (context.path) scope.setExtra("path", context.path);
      sentryClient.captureException(err);
    });
  } catch {
    // Never let observability throw
  }
}

export default { initObservability, captureException };
