import mongoose from "mongoose";
import { applyToJSONTransform } from "./plugins.js";

const workspaceInviteSchema = new mongoose.Schema(
  {
    workspaceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Workspace",
      required: true,
      index: true,
    },
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    role: {
      type: String,
      enum: ["ADMIN", "MEMBER", "VIEWER"],
      default: "MEMBER",
      required: true,
    },
    invitedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    status: {
      type: String,
      enum: ["pending", "accepted", "revoked"],
      default: "pending",
    },
  },
  {
    timestamps: true,
  }
);

workspaceInviteSchema.index({ workspaceId: 1, email: 1, status: 1 });
applyToJSONTransform(workspaceInviteSchema);

export const WorkspaceInvite =
  mongoose.models.WorkspaceInvite || mongoose.model("WorkspaceInvite", workspaceInviteSchema);
export default WorkspaceInvite;
