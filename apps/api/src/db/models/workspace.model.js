import mongoose from "mongoose";
import { applyToJSONTransform } from "./plugins.js";

const workspaceSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

applyToJSONTransform(workspaceSchema);

export const Workspace = mongoose.models.Workspace || mongoose.model("Workspace", workspaceSchema);
export default Workspace;

