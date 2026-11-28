import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../../middleware/auth.middleware.js";
import { tenantGuard } from "../../middleware/tenant-guard.middleware.js";
import { requireRole } from "../../middleware/rbac.middleware.js";
import { validate, objectIdSchema } from "../../middleware/validation.middleware.js";
import { Membership, User, Workspace } from "../../db/models/index.js";
import { WorkspaceInvite } from "../../db/models/workspace-invite.model.js";
import AppError from "../../utils/app-error.js";

const router = Router();

export const ROLE_PERMISSIONS_MATRIX = [
  {
    capability: "View dashboards, analytics, and conversations",
    OWNER: true,
    ADMIN: true,
    MEMBER: true,
    VIEWER: true,
  },
  {
    capability: "Chat with AI assistant and knowledge bases",
    OWNER: true,
    ADMIN: true,
    MEMBER: true,
    VIEWER: true,
  },
  {
    capability: "Create, edit, and delete Chatbots & Knowledge Bases",
    OWNER: true,
    ADMIN: true,
    MEMBER: true,
    VIEWER: false,
  },
  {
    capability: "Connect apps & approve human-in-the-loop MCP tool calls",
    OWNER: true,
    ADMIN: true,
    MEMBER: true,
    VIEWER: false,
  },
  {
    capability: "Add, configure, and delete Custom MCP Servers",
    OWNER: true,
    ADMIN: true,
    MEMBER: false,
    VIEWER: false,
  },
  {
    capability: "Create, rotate, and revoke Platform API Keys",
    OWNER: true,
    ADMIN: true,
    MEMBER: false,
    VIEWER: false,
  },
  {
    capability: "Invite teammates and manage Member/Viewer roles",
    OWNER: true,
    ADMIN: true,
    MEMBER: false,
    VIEWER: false,
  },
  {
    capability: "Assign or modify OWNER role & workspace ownership",
    OWNER: true,
    ADMIN: false,
    MEMBER: false,
    VIEWER: false,
  },
];

const inviteSchema = z
  .object({
    email: z.string().email("Valid email is required").trim().toLowerCase(),
    role: z.enum(["ADMIN", "MEMBER", "VIEWER"]).default("MEMBER"),
  })
  .strict();

const updateRoleSchema = z
  .object({
    role: z.enum(["OWNER", "ADMIN", "MEMBER", "VIEWER"]),
  })
  .strict();

const membershipIdParams = z
  .object({
    membershipId: objectIdSchema,
  })
  .strict();

const inviteIdParams = z
  .object({
    inviteId: objectIdSchema,
  })
  .strict();

router.use(authenticate, tenantGuard);

/**
 * GET /api/v1/team/members
 * Lists workspace info, all active members, pending invitations, and RBAC matrix.
 */
router.get("/members", async (req, res, next) => {
  try {
    const [workspace, memberships, invites] = await Promise.all([
      Workspace.findById(req.workspaceId).select("name slug plan"),
      Membership.find({ workspaceId: req.workspaceId })
        .populate("userId", "name email avatarUrl")
        .sort({ createdAt: 1 }),
      WorkspaceInvite.find({
        workspaceId: req.workspaceId,
        status: "pending",
      })
        .populate("invitedBy", "name email")
        .sort({ createdAt: -1 }),
    ]);

    const members = memberships.map((m) => ({
      id: m._id.toString(),
      userId: m.userId?._id?.toString() || m.userId?.toString(),
      name: m.userId?.name || "Workspace Member",
      email: m.userId?.email || "",
      role: m.role,
      joinedAt: m.createdAt,
      isCurrentUser: String(m.userId?._id || m.userId) === String(req.user.id),
    }));

    res.status(200).json({
      workspace: workspace
        ? {
            id: workspace._id.toString(),
            name: workspace.name,
            slug: workspace.slug,
            plan: workspace.plan || "free",
          }
        : null,
      currentUserRole: req.user.role,
      permissionsMatrix: ROLE_PERMISSIONS_MATRIX,
      members,
      invites: invites.map((inv) => ({
        id: inv._id.toString(),
        email: inv.email,
        role: inv.role,
        status: inv.status,
        invitedBy: inv.invitedBy?.name || inv.invitedBy?.email || "Admin",
        createdAt: inv.createdAt,
        updatedAt: inv.updatedAt,
      })),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/team/invite
 * Invites a user by email to the workspace (adds immediately if account exists, or creates pending invite).
 */
router.post(
  "/invite",
  requireRole("OWNER", "ADMIN"),
  validate({ body: inviteSchema }),
  async (req, res, next) => {
    try {
      const { email, role } = req.body;
      const existingUser = await User.findOne({ email });

      if (existingUser) {
        const existingMembership = await Membership.findOne({
          workspaceId: req.workspaceId,
          userId: existingUser._id,
        });

        if (existingMembership) {
          throw AppError.conflict(`${email} is already a member of this workspace.`);
        }

        const membership = await Membership.create({
          workspaceId: req.workspaceId,
          userId: existingUser._id,
          role,
        });

        return res.status(201).json({
          status: "added",
          message: `${existingUser.name || email} has been added to the workspace as ${role}.`,
          member: {
            id: membership._id.toString(),
            userId: existingUser._id.toString(),
            name: existingUser.name,
            email: existingUser.email,
            role: membership.role,
            joinedAt: membership.createdAt,
          },
        });
      }

      // User does not exist yet -> create or update pending invite
      const existingInvite = await WorkspaceInvite.findOne({
        workspaceId: req.workspaceId,
        email,
        status: "pending",
      });

      if (existingInvite) {
        existingInvite.role = role;
        existingInvite.invitedBy = req.user.id;
        await existingInvite.save();
        return res.status(200).json({
          status: "invited",
          message: `Updated pending invitation for ${email} (${role}).`,
          invite: existingInvite,
        });
      }

      const invite = await WorkspaceInvite.create({
        workspaceId: req.workspaceId,
        email,
        role,
        invitedBy: req.user.id,
        status: "pending",
      });

      return res.status(201).json({
        status: "invited",
        message: `Invitation created for ${email}. They will automatically join as ${role} upon registration.`,
        invite,
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/v1/team/invites/:inviteId/resend
 * Refreshes a pending invitation timestamp.
 */
router.post(
  "/invites/:inviteId/resend",
  requireRole("OWNER", "ADMIN"),
  validate({ params: inviteIdParams }),
  async (req, res, next) => {
    try {
      const invite = await WorkspaceInvite.findOneAndUpdate(
        { _id: req.params.inviteId, workspaceId: req.workspaceId, status: "pending" },
        { invitedBy: req.user.id },
        { new: true }
      );
      if (!invite) {
        throw AppError.notFound("Pending invitation not found");
      }
      res.status(200).json({
        success: true,
        message: `Invitation refreshed for ${invite.email}.`,
        invite,
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * PATCH /api/v1/team/members/:membershipId
 * Updates a workspace member's role.
 */
router.patch(
  "/members/:membershipId",
  requireRole("OWNER", "ADMIN"),
  validate({ params: membershipIdParams, body: updateRoleSchema }),
  async (req, res, next) => {
    try {
      const { role } = req.body;
      const membership = await Membership.findOne({
        _id: req.params.membershipId,
        workspaceId: req.workspaceId,
      });

      if (!membership) {
        throw AppError.notFound("Workspace member not found");
      }

      if (String(membership.userId) === String(req.user.id) && role !== membership.role) {
        throw AppError.badRequest("You cannot change your own role.");
      }

      if ((membership.role === "OWNER" || role === "OWNER") && req.user.role !== "OWNER") {
        throw AppError.forbidden("Only a workspace OWNER can assign or modify the OWNER role.");
      }

      if (membership.role === "OWNER" && role !== "OWNER") {
        const ownerCount = await Membership.countDocuments({
          workspaceId: req.workspaceId,
          role: "OWNER",
        });
        if (ownerCount <= 1) {
          throw AppError.badRequest("Cannot demote the last workspace OWNER.");
        }
      }

      membership.role = role;
      await membership.save();

      res.status(200).json({ success: true, membership });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * DELETE /api/v1/team/members/:membershipId
 * Removes a member from the workspace.
 */
router.delete(
  "/members/:membershipId",
  requireRole("OWNER", "ADMIN"),
  validate({ params: membershipIdParams }),
  async (req, res, next) => {
    try {
      const membership = await Membership.findOne({
        _id: req.params.membershipId,
        workspaceId: req.workspaceId,
      });

      if (!membership) {
        throw AppError.notFound("Workspace member not found");
      }

      if (String(membership.userId) === String(req.user.id)) {
        throw AppError.badRequest("Use 'Leave Workspace' to remove yourself.");
      }

      if (membership.role === "OWNER") {
        const ownerCount = await Membership.countDocuments({
          workspaceId: req.workspaceId,
          role: "OWNER",
        });
        if (ownerCount <= 1) {
          throw AppError.badRequest("Cannot remove the last workspace OWNER.");
        }
        if (req.user.role !== "OWNER") {
          throw AppError.forbidden("Only an OWNER can remove another OWNER.");
        }
      }

      await Membership.deleteOne({ _id: membership._id });
      res.status(200).json({ success: true });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/v1/team/leave
 * Allows the current user to leave the active workspace (unless they are the last OWNER).
 */
router.post("/leave", async (req, res, next) => {
  try {
    const membership = await Membership.findOne({
      workspaceId: req.workspaceId,
      userId: req.user.id,
    });
    if (!membership) {
      throw AppError.notFound("Membership not found");
    }

    if (membership.role === "OWNER") {
      const ownerCount = await Membership.countDocuments({
        workspaceId: req.workspaceId,
        role: "OWNER",
      });
      if (ownerCount <= 1) {
        throw AppError.badRequest(
          "You are the last OWNER of this workspace. Promote another member to OWNER before leaving."
        );
      }
    }

    await Membership.deleteOne({ _id: membership._id });
    res.status(200).json({ success: true, message: "You have left the workspace." });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/v1/team/invites/:inviteId
 * Revokes a pending workspace invitation.
 */
router.delete(
  "/invites/:inviteId",
  requireRole("OWNER", "ADMIN"),
  validate({ params: inviteIdParams }),
  async (req, res, next) => {
    try {
      const invite = await WorkspaceInvite.findOneAndUpdate(
        { _id: req.params.inviteId, workspaceId: req.workspaceId },
        { status: "revoked" },
        { new: true }
      );
      if (!invite) {
        throw AppError.notFound("Invitation not found");
      }
      res.status(200).json({ success: true });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
