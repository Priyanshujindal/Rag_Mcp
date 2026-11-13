import AppError from "../utils/app-error.js";

/**
 * Recursively inspects an object for keys starting with '$' or containing '.'
 * @param {any} value
 * @returns {boolean}
 */
export function containsNoSqlInjection(value) {
  if (!value || typeof value !== "object") {
    return false;
  }

  if (Array.isArray(value)) {
    return value.some((item) => containsNoSqlInjection(item));
  }

  for (const key of Object.keys(value)) {
    if (key.startsWith("$") || key.includes(".")) {
      return true;
    }
    if (typeof value[key] === "object" && value[key] !== null) {
      if (containsNoSqlInjection(value[key])) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Middleware preventing NoSQL injection attempts in body, query, and params.
 */
export function noSqlDefenseMiddleware(req, _res, next) {
  if (req.body && containsNoSqlInjection(req.body)) {
    return next(
      AppError.badRequest('Invalid request: keys starting with "$" or containing "." are not allowed')
    );
  }
  if (req.query && containsNoSqlInjection(req.query)) {
    return next(
      AppError.badRequest('Invalid query: keys starting with "$" or containing "." are not allowed')
    );
  }
  if (req.params && containsNoSqlInjection(req.params)) {
    return next(
      AppError.badRequest('Invalid parameters: keys starting with "$" or containing "." are not allowed')
    );
  }
  next();
}

export default noSqlDefenseMiddleware;

