import jwt from "jsonwebtoken";
import config from "../config/index.js";
import AppError from "../utils/app-error.js";

/**
 * Authentication middleware to verify JWT access tokens
 */
export function authenticate(req, _res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return next(AppError.unauthorized("Missing or invalid authorization header"));
  }

  const token = authHeader.split(" ")[1];
  try {
    const payload = jwt.verify(token, config.JWT_ACCESS_SECRET);
    req.user = {
      id: payload.sub,
      email: payload.email,
    };
    next();
  } catch (err) {
    if (err.name === "TokenExpiredError") {
      return next(AppError.unauthorized("Access token has expired"));
    }
    return next(AppError.unauthorized("Invalid access token"));
  }
}

export default authenticate;

