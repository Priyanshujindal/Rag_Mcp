import { Router } from "express";
import { authenticate } from "../../middleware/auth.middleware.js";
import { tenantGuard } from "../../middleware/tenant-guard.middleware.js";
import config from "../../config/index.js";
import { KnowledgeBase, Source, Chatbot } from "../../db/models/index.js";
import aiClient from "../../services/ai-client.js";

const router = Router();

router.get("/", authenticate, tenantGuard, async (req, res, next) => {
  try {
    const workspaceId = req.workspaceId;

    const [kbCount, sourceCount, botCount, aiUsage] = await Promise.all([
      KnowledgeBase.countDocuments({ workspaceId }),
      Source.countDocuments({ workspaceId }),
      Chatbot.countDocuments({ workspaceId }),
      aiClient.getUsage(workspaceId),
    ]);

    res.status(200).json({
      knowledgeBases: {
        count: kbCount,
        limit: config.MAX_KBS_PER_WORKSPACE,
      },
      sources: {
        count: sourceCount,
        limit: config.MAX_SOURCES_PER_KB,
      },
      chatbots: {
        count: botCount,
        limit: 0, // unlimited
      },
      storage: {
        usedMb: aiUsage?.estimatedMb || 0,
        limitMb: config.MAX_UPLOAD_MB,
        totalChunks: aiUsage?.totalChunks || 0,
        maxChunks: aiUsage?.maxChunks || 5000,
        capacityMb: aiUsage?.capacityMb || 400,
        chunkCapacityPercent: aiUsage?.chunkCapacityPercent || 0,
      },
    });
  } catch (err) {
    next(err);
  }
});

export default router;

