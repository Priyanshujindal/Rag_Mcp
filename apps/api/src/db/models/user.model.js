import mongoose from "mongoose";
import { applyToJSONTransform } from "./plugins.js";

const userSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    passwordHash: {
      type: String,
      required: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    avatarUrl: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

applyToJSONTransform(userSchema);

export const User = mongoose.models.User || mongoose.model("User", userSchema);
export default User;

