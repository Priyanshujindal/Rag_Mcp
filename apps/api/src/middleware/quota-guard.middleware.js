/**
 * apps/api/src/middleware/quota-guard.middleware.js
 * ==================================================
 * Server-side quota enforcement middleware:
 * - Checks whether the tenant workspace has remaining quota before executing heavy operations
 * - Rejects exhausted resources with HTTP 403 / QUOTA_EXCEEDED
 */

import usageService from "../modules/usage/usage.service.js";

/**
 * Middleware factory to enforce a specific resource quota on routes.
 * @param {string} metricKey - Key matching METRIC_DEFINITIONS (e.g. 'chatbots', 'knowledgeBases', 'chatRequests')
 * @param {Function} [countResolver] - Optional function (req) => number to determine resource increment
 */
export function enforceQuota(metricKey, countResolver = (_req) => 1) {
  return async (req, _res, next) => {
    try {
      const workspaceId = req.workspaceId;
      if (!workspaceId) {
        return next();
      }

      const increment = countResolver(req);
      await usageService.assertQuota(workspaceId, metricKey, increment);
      next();
    } catch (err) {
      next(err);
    }
  };
}

export default enforceQuota;
