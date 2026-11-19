/**
 * Custom application error class
 */
export class AppError extends Error {
  /**
   * @param {string} code - Machine-readable error code (e.g. BAD_REQUEST, NOT_FOUND)
   * @param {string} message - Human-readable error message
   * @param {number} statusCode - HTTP status code
   * @param {any} [details] - Optional structured validation/error details
   */
  constructor(code, message, statusCode = 400, details = undefined) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }

  static badRequest(message = "Bad request", details = undefined) {
    return new AppError("BAD_REQUEST", message, 400, details);
  }

  static unauthorized(message = "Unauthorized", details = undefined) {
    return new AppError("UNAUTHORIZED", message, 401, details);
  }

  static forbidden(message = "Forbidden", details = undefined) {
    return new AppError("FORBIDDEN", message, 403, details);
  }

  static notFound(message = "Resource not found", details = undefined) {
    return new AppError("NOT_FOUND", message, 404, details);
  }

  static conflict(message = "Resource conflict", details = undefined) {
    return new AppError("CONFLICT", message, 409, details);
  }

  static unprocessable(message = "Validation failed", details = undefined) {
    return new AppError("UNPROCESSABLE_ENTITY", message, 422, details);
  }
}

export default AppError;

