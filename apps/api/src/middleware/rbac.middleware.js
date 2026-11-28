import AppError from "../utils/app-error.js";

/**
 * Role-Based Access Control middleware.
 * Must run after tenantGuard (which populates req.user.role from Membership).
 * @param  {...string} allowedRoles
 */
export function requireRole(...allowedRoles) {
  return (req, _res, next) => {
    const role = req.user?.role;
    if (!role) {
      return next(AppError.forbidden("Workspace role could not be determined"));
    }
    if (!allowedRoles.includes(role)) {
      return next(
        AppError.forbidden(
          `Insufficient permissions. Required role: ${allowedRoles.join(" or ")}. Current role: ${role}.`
        )
      );
    }
    next();
  };
}

export default requireRole;
