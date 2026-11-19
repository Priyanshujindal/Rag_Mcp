import crypto from "crypto";
import AppError from "../../utils/app-error.js";
import { ApiKey } from "../../db/models/index.js";

export const apiKeysService = {
  async list(workspaceId) {
    const keys = await ApiKey.find({ workspaceId }).sort("-createdAt");
    return keys.map((key) => key.toJSON());
  },

  async create(workspaceId, { name }) {
    // Generate secret: ragmcp_live_ + 32 random chars (16 bytes hex)
    const randomPart = crypto.randomBytes(16).toString("hex");
    const secret = `ragmcp_live_${randomPart}`;
    const prefix = `${secret.slice(0, 14)}...`;
    const keyHash = crypto.createHash("sha256").update(secret).digest("hex");

    const apiKey = await ApiKey.create({
      workspaceId,
      name,
      prefix,
      keyHash,
    });

    const keyJson = apiKey.toJSON();

    // Secret is returned ONCE only at creation
    return {
      apiKey: keyJson,
      secret,
    };
  },

  async revoke(workspaceId, id) {
    const key = await ApiKey.findOneAndUpdate(
      { _id: id, workspaceId },
      { $set: { revokedAt: new Date() } },
      { new: true }
    );
    if (!key) {
      throw AppError.notFound("API key not found");
    }
    return key.toJSON();
  },

  async delete(workspaceId, id) {
    const key = await ApiKey.findOneAndDelete({ _id: id, workspaceId });
    if (!key) {
      throw AppError.notFound("API key not found");
    }
    return { success: true };
  },
};

export default apiKeysService;

