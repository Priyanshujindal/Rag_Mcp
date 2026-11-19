import mongoose from "mongoose";
import { applyToJSONTransform } from "./plugins.js";

const membershipSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    workspaceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Workspace",
      required: true,
      index: true,
    },
    role: {
      type: String,
      enum: ["OWNER", "ADMIN", "MEMBER"],
      default: "MEMBER",
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

membershipSchema.index({ userId: 1, workspaceId: 1 }, { unique: true });
membershipSchema.index({ workspaceId: 1, role: 1 });

applyToJSONTransform(membershipSchema);

export const Membership = mongoose.models.Membership || mongoose.model("Membership", membershipSchema);
export default Membership;

