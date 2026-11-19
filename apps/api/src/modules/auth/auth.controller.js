import config from "../../config/index.js";
import AppError from "../../utils/app-error.js";
import authService from "./auth.service.js";

/**
 * Returns standard cookie options for refresh token cookies
 * @returns {import('express').CookieOptions}
 */
export function getCookieOptions() {
  const isProd = config.NODE_ENV === "production";
  const sameSite = config.COOKIE_SAMESITE || "lax";
  const secure = isProd || sameSite === "none";

  return {
    httpOnly: true,
    secure,
    sameSite,
    path: "/api/v1/auth",
  };
}

/**
 * Attaches the HttpOnly refresh token cookie to the response
 * @param {import('express').Response} res
 * @param {string} refreshToken
 */
export function setRefreshTokenCookie(res, refreshToken) {
  res.cookie("refreshToken", refreshToken, {
    ...getCookieOptions(),
    maxAge: config.REFRESH_TOKEN_TTL * 1000,
  });
}

/**
 * Clears the refresh token cookie
 * @param {import('express').Response} res
 */
export function clearRefreshTokenCookie(res) {
  res.clearCookie("refreshToken", getCookieOptions());
}

export const authController = {
  async register(req, res, next) {
    try {
      const metadata = {
        userAgent: req.headers["user-agent"],
        ip: req.ip,
      };
      const result = await authService.register(req.body, metadata);
      setRefreshTokenCookie(res, result.refreshToken);

      res.status(201).json({
        user: result.user,
        workspace: result.workspace,
        accessToken: result.accessToken,
      });
    } catch (err) {
      next(err);
    }
  },

  async login(req, res, next) {
    try {
      const metadata = {
        userAgent: req.headers["user-agent"],
        ip: req.ip,
      };
      const result = await authService.login(req.body, metadata);
      setRefreshTokenCookie(res, result.refreshToken);

      res.status(200).json({
        user: result.user,
        accessToken: result.accessToken,
      });
    } catch (err) {
      next(err);
    }
  },

  async refresh(req, res, next) {
    try {
      const rawToken = req.cookies?.refreshToken;
      if (!rawToken) {
        throw AppError.unauthorized("Authentication required");
      }
      const metadata = {
        userAgent: req.headers["user-agent"],
        ip: req.ip,
      };
      const result = await authService.refresh(rawToken, metadata);
      setRefreshTokenCookie(res, result.refreshToken);

      res.status(200).json({
        accessToken: result.accessToken,
      });
    } catch (err) {
      clearRefreshTokenCookie(res);
      next(err);
    }
  },

  async logout(req, res, next) {
    try {
      const rawToken = req.cookies?.refreshToken;
      if (!rawToken) {
        clearRefreshTokenCookie(res);
        throw AppError.unauthorized("Authentication required");
      }
      await authService.logout(rawToken);
      clearRefreshTokenCookie(res);
      res.status(200).json({ success: true });
    } catch (err) {
      clearRefreshTokenCookie(res);
      next(err);
    }
  },

  async me(req, res, next) {
    try {
      const result = await authService.me(req.user.id);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },
};

export default authController;
