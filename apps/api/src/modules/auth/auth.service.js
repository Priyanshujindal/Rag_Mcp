import crypto from "crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import config from "../../config/index.js";
import AppError from "../../utils/app-error.js";
import { User, Workspace, Membership, RefreshToken } from "../../db/models/index.js";

/**
 * Creates SHA-256 hash of a raw token string
 * @param {string} token
 */
export function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/**
 * Generates JWT access token
 * @param {object} user
 */
export function generateAccessToken(user) {
  return jwt.sign(
    {
      sub: user.id || user._id.toString(),
      email: user.email,
    },
    config.JWT_ACCESS_SECRET,
    {
      expiresIn: config.ACCESS_TOKEN_TTL,
    }
  );
}

/**
 * Generates a random 256-bit refresh token and stores its hash in MongoDB
 * @param {string} userId
 * @param {object} [metadata]
 * @param {object} [options]
 * @param {import('mongoose').ClientSession} [options.session]
 */
export async function createRefreshToken(userId, metadata = {}, options = {}) {
  const rawToken = crypto.randomBytes(32).toString("hex");
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + config.REFRESH_TOKEN_TTL * 1000);

  const doc = {
    userId,
    tokenHash,
    expiresAt,
    userAgent: metadata.userAgent || null,
    ip: metadata.ip || null,
  };

  if (options.session) {
    await RefreshToken.create([doc], { session: options.session });
  } else {
    await RefreshToken.create(doc);
  }

  return { rawToken, expiresAt };
}

export const authService = {
  /**
   * Register a new user, their personal workspace, and owner membership
   */
  async register({ email, password, name }, metadata = {}) {
    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) {
      throw AppError.conflict("An account with this email address already exists.");
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await User.create({
      email: email.toLowerCase(),
      passwordHash,
      name,
    });

    // Create personal workspace with unique slug
    const baseSlug = name
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "-")
      .replace(/-+/g, "-")
      .slice(0, 30);
    const uniqueSlug = `${baseSlug}-${crypto.randomBytes(4).toString("hex")}`;

    const workspace = await Workspace.create({
      name: `${name}'s Workspace`,
      slug: uniqueSlug,
    });

    await Membership.create({
      userId: user._id,
      workspaceId: workspace._id,
      role: "OWNER",
    });

    const accessToken = generateAccessToken(user);
    const { rawToken: refreshToken } = await createRefreshToken(user._id, metadata);

    return {
      user: user.toJSON(),
      workspace: workspace.toJSON(),
      accessToken,
      refreshToken,
    };
  },

  /**
   * Authenticate with email and password
   */
  async login({ email, password }, metadata = {}) {
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      throw AppError.unauthorized("Invalid email or password.");
    }

    const isValid = await bcrypt.compare(password, user.passwordHash);
    if (!isValid) {
      throw AppError.unauthorized("Invalid email or password.");
    }

    const accessToken = generateAccessToken(user);
    const { rawToken: refreshToken } = await createRefreshToken(user._id, metadata);

    return {
      user: user.toJSON(),
      accessToken,
      refreshToken,
    };
  },

  /**
   * Rotate refresh token atomically and issue a fresh access token (with race grace window & reuse detection)
   */
  async refresh(rawToken, metadata = {}) {
    if (!rawToken) {
      throw AppError.unauthorized("Refresh token is required.");
    }

    const tokenHash = hashToken(rawToken);
    const now = new Date();

    let session = null;
    try {
      session = await mongoose.startSession();
      session.startTransaction();
    } catch {
      session = null;
    }

    try {
      // 1. Claim the token ATOMICALLY with one query
      const claimed = await RefreshToken.findOneAndUpdate(
        {
          tokenHash,
          revokedAt: null,
          expiresAt: { $gt: now },
        },
        {
          $set: {
            revokedAt: now,
            rotatedAt: now,
          },
        },
        {
          new: true,
          ...(session ? { session } : {}),
        }
      );

      // 2. If nothing returned, investigate the state of the token
      if (!claimed) {
        if (session) {
          await session.abortTransaction();
          await session.endSession();
          session = null;
        }

        const existing = await RefreshToken.findOne({ tokenHash });

        // Not found or expired
        if (!existing || existing.expiresAt <= now) {
          throw AppError.unauthorized("Invalid refresh token.");
        }

        // Found and revoked
        if (existing.revokedAt) {
          const graceSeconds = config.REFRESH_GRACE_SECONDS ?? 10;
          const graceMs = graceSeconds * 1000;
          const isWithinGrace =
            existing.rotatedAt &&
            now.getTime() - new Date(existing.rotatedAt).getTime() <= graceMs;

          if (isWithinGrace) {
            // Harmless race condition (e.g. concurrent tabs, React StrictMode in development)
            // Return 401 generic message, but DO NOT revoke the user's other sessions
            throw AppError.unauthorized("Invalid refresh token.");
          }

          // Beyond grace period: Token theft / reuse detected!
          // Invalidate ALL active sessions for this user.
          await RefreshToken.deleteMany({ userId: existing.userId });
          throw AppError.unauthorized("Refresh token revoked or expired. Please sign in again.");
        }

        throw AppError.unauthorized("Invalid refresh token.");
      }

      // 3. User verification and issuance of new token pair
      const user = await User.findById(claimed.userId).session(session || null);
      if (!user) {
        throw AppError.unauthorized("User no longer exists.");
      }

      const newAccessToken = generateAccessToken(user);
      const { rawToken: newRefreshToken } = await createRefreshToken(user._id, metadata, { session });

      if (session) {
        await session.commitTransaction();
      }

      return {
        accessToken: newAccessToken,
        refreshToken: newRefreshToken,
      };
    } catch (err) {
      if (session) {
        try {
          await session.abortTransaction();
        } catch {
          // ignore abort failures
        }
      }
      throw err;
    } finally {
      if (session) {
        await session.endSession();
      }
    }
  },

  /**
   * Logout user by revoking the refresh token
   */
  async logout(rawToken) {
    if (rawToken) {
      const tokenHash = hashToken(rawToken);
      await RefreshToken.deleteOne({ tokenHash });
    }
  },

  /**
   * Get authenticated user profile and workspaces
   */
  async me(userId) {
    const user = await User.findById(userId);
    if (!user) {
      throw AppError.notFound("User not found.");
    }

    const memberships = await Membership.find({ userId: user._id }).populate("workspaceId");
    const workspaces = memberships
      .filter((m) => m.workspaceId)
      .map((m) => ({
        workspace: m.workspaceId.toJSON(),
        role: m.role,
      }));

    return {
      user: user.toJSON(),
      workspaces,
    };
  },
};

export default authService;
