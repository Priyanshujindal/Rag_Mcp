import { connectDb, disconnectDb } from "./connection.js";
import logger from "../utils/logger.js";
import * as models from "./models/index.js";

/**
 * Synchronizes all Mongoose model indexes with MongoDB
 */
export async function syncAllIndexes() {
  logger.info("[db:indexes] Synchronizing indexes for all models...");
  const results = {};

  for (const [modelName, model] of Object.entries(models)) {
    if (model && typeof model.syncIndexes === "function") {
      try {
        await model.syncIndexes();
        results[modelName] = "synced";
        logger.info(`[db:indexes] ✓ Synced indexes for ${modelName}`);
      } catch (err) {
        results[modelName] = `error: ${err.message}`;
        logger.error(`[db:indexes] ✗ Failed syncing indexes for ${modelName}: ${err.message}`);
        throw err;
      }
    }
  }

  logger.info("[db:indexes] All model indexes synchronized successfully.");
  return results;
}

// Execute directly if run via CLI
if (process.argv[1] && process.argv[1].endsWith("indexes.js")) {
  (async () => {
    try {
      await connectDb();
      await syncAllIndexes();
      await disconnectDb();
      process.exit(0);
    } catch (err) {
      logger.error(`[db:indexes] Fatal error: ${err.message}`);
      await disconnectDb();
      process.exit(1);
    }
  })();
}

export default syncAllIndexes;

