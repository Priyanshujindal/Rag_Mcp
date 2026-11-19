import AppError from "../utils/app-error.js";
import logger from "../utils/logger.js";
import config from "../config/index.js";

/**
 * 404 Not Found Middleware
 */
export function notFoundHandler(req, _res, next) {
  next(AppError.notFound(`Route ${req.method} ${req.originalUrl} not found`));
}

/**
 * Centralized Error Handling Middleware
 */
export function errorHandler(err, _req, res, _next) {
  let statusCode = 500;
  let code = "INTERNAL_SERVER_ERROR";
  let message = "Internal server error";
  let details = undefined;

  // 1. Mongoose ValidationError -> 422
  if (err.name === "ValidationError") {
    statusCode = 422;
    code = "VALIDATION_ERROR";
    message = "Database validation failed";
    details = Object.keys(err.errors || {}).map((field) => ({
      field,
      message: err.errors[field]?.message || "Invalid value",
    }));
  }
  // 2. Mongoose Duplicate Key Error (11000) -> 409
  else if (err.code === 11000) {
    statusCode = 409;
    code = "CONFLICT";
    const duplicateFields = Object.keys(err.keyPattern || err.keyValue || {});
    message = duplicateFields.length > 0
      ? `A resource with that ${duplicateFields.join(", ")} already exists.`
      : "Resource already exists.";
    details = err.keyValue;
  }
  // 3. Mongoose CastError (e.g. invalid ObjectId) -> 404
  else if (err.name === "CastError") {
    statusCode = 404;
    code = "NOT_FOUND";
    message = "Resource not found";
    details = {
      path: err.path,
      value: err.value,
    };
  }
  // 4. Custom AppError instances
  else if (err instanceof AppError) {
    statusCode = err.statusCode;
    code = err.code;
    message = err.message;
    details = err.details;
  }
  // 5. Body parser syntax error
  else if (err instanceof SyntaxError && "body" in err) {
    statusCode = 400;
    code = "BAD_REQUEST";
    message = "Malformed JSON payload";
  } else if (err.statusCode || err.status) {
    statusCode = err.statusCode || err.status;
    code = err.code || "REQUEST_ERROR";
    message = err.message || "Request failed";
  }

  // Log internal server errors
  if (statusCode >= 500) {
    logger.error({ err }, `[Server Error 500] ${err.message}`);
  }

  const response = {
    error: {
      code,
      message,
      ...(details !== undefined ? { details } : {}),
      ...(config.NODE_ENV !== "production" && err.stack ? { stack: err.stack } : {}),
    },
  };

  res.status(statusCode).json(response);
}

export default { notFoundHandler, errorHandler };

