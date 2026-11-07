import config from "../config/index.js";
import AppError from "../utils/app-error.js";
import { KnowledgeBase, Source } from "../db/models/index.js";

/**
 * Checks if workspace has reached maximum allowed knowledge bases
 * @param {import('mongoose').Types.ObjectId} workspaceId
 */
export async function assertKbQuota(workspaceId) {
  if (config.MAX_KBS_PER_WORKSPACE > 0) {
    const count = await KnowledgeBase.countDocuments({ workspaceId });
    if (count >= config.MAX_KBS_PER_WORKSPACE) {
      throw AppError.conflict(
        `Quota exceeded: This workspace has reached the maximum limit of ${config.MAX_KBS_PER_WORKSPACE} knowledge bases.`
      );
    }
  }
}

/**
 * Checks if knowledge base has reached maximum allowed sources
 * @param {import('mongoose').Types.ObjectId} workspaceId
 * @param {import('mongoose').Types.ObjectId} knowledgeBaseId
 */
export async function assertSourceQuota(workspaceId, knowledgeBaseId) {
  if (config.MAX_SOURCES_PER_KB > 0) {
    const count = await Source.countDocuments({ workspaceId, knowledgeBaseId });
    if (count >= config.MAX_SOURCES_PER_KB) {
      throw AppError.conflict(
        `Quota exceeded: This knowledge base has reached the maximum limit of ${config.MAX_SOURCES_PER_KB} sources.`
      );
    }
  }
}

export default { assertKbQuota, assertSourceQuota };

