import { z } from "zod";
import AppError from "../utils/app-error.js";

/**
 * Zod schema for 24-character hex MongoDB ObjectId.
 */
export const objectIdSchema = z
  .string()
  .regex(/^[0-9a-fA-F]{24}$/, "Invalid ObjectId format");

/**
 * Helper to extract clean field-level error messages
 * @param {z.ZodIssue[]} issues
 */
function formatZodIssues(issues) {
  return issues.map((issue) => ({
    field: issue.path.join("."),
    message: issue.message,
    code: issue.code,
  }));
}

/**
 * Validates request body, query, and params using Zod schemas.
 * @param {object} schemas
 * @param {z.ZodTypeAny} [schemas.body]
 * @param {z.ZodTypeAny} [schemas.query]
 * @param {z.ZodTypeAny} [schemas.params]
 */
export function validate(schemas = {}) {
  return (req, _res, next) => {
    // 1. Validate route params
    if (schemas.params) {
      const result = schemas.params.safeParse(req.params);
      if (!result.success) {
        // Rule: an invalid id in a path must return 404, not 500
        const isIdIssue = result.error.issues.some((issue) =>
          issue.path.some((p) => String(p).toLowerCase().includes("id"))
        );
        if (isIdIssue) {
          return next(AppError.notFound("Resource not found"));
        }
        return next(
          AppError.unprocessable("Validation failed", formatZodIssues(result.error.issues))
        );
      }
      req.params = result.data;
    }

    // 2. Validate query string
    if (schemas.query) {
      const result = schemas.query.safeParse(req.query);
      if (!result.success) {
        return next(
          AppError.unprocessable("Validation failed", formatZodIssues(result.error.issues))
        );
      }
      req.query = result.data;
    }

    // 3. Validate request body
    if (schemas.body) {
      const result = schemas.body.safeParse(req.body);
      if (!result.success) {
        return next(
          AppError.unprocessable("Validation failed", formatZodIssues(result.error.issues))
        );
      }
      req.body = result.data;
    }

    next();
  };
}

export default { validate, objectIdSchema };

