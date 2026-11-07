import mongoose from "mongoose";
import AppError from "../utils/app-error.js";
import { Membership } from "../db/models/index.js";

/**
 * Tenant guard middleware
 * Resolves active workspace, verifies membership, and attaches req.workspaceId and req.user.role.
 */
export async function tenantGuard(req, _res, next) {
  try {
    if (!req.user || !req.user.id) {
      return next(AppError.unauthorized("Authentication required"));
    }

    const customWorkspaceId = req.headers["x-workspace-id"];
    let targetWorkspaceId = null;

    if (
      customWorkspaceId &&
      customWorkspaceId !== "null" &&
      customWorkspaceId !== "undefined" &&
      customWorkspaceId.trim() !== ""
    ) {
      if (!mongoose.Types.ObjectId.isValid(customWorkspaceId)) {
        return next(AppError.notFound("Workspace not found"));
      }
      targetWorkspaceId = new mongoose.Types.ObjectId(customWorkspaceId);
    }

    let membership;
    if (targetWorkspaceId) {
      membership = await Membership.findOne({
        userId: req.user.id,
        workspaceId: targetWorkspaceId,
      });
    } else {
      // Default to user's first/personal workspace membership
      membership = await Membership.findOne({
        userId: req.user.id,
      }).sort({ createdAt: 1 });
    }

    if (!membership) {
      // Isolation rule: return 404 if workspace does not exist or user has no membership
      return next(AppError.notFound("Workspace not found"));
    }

    req.workspaceId = membership.workspaceId;
    req.user.role = membership.role;
    req.membership = membership;

    next();
  } catch (err) {
    next(err);
  }
}

export default tenantGuard;

