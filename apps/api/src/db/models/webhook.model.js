import mongoose from "mongoose";
import { applyToJSONTransform } from "./plugins.js";

const webhookSchema = new mongoose.Schema(
  {
    workspaceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Workspace",
      required: true,
      index: true,
    },
    url: {
      type: String,
      required: true,
      trim: true,
    },
    events: {
      type: [String],
      default: [],
    },
    secretHash: {
      type: String,
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

webhookSchema.index({ workspaceId: 1, createdAt: -1 });

applyToJSONTransform(webhookSchema);

export const Webhook = mongoose.models.Webhook || mongoose.model("Webhook", webhookSchema);
export default Webhook;

