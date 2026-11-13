import mongoose from "mongoose";
import config from "../config/index.js";
import logger from "../utils/logger.js";

/**
 * Extracts only the cluster host name for safe logging, never leaking credentials or passwords.
 * @param {string} uri
 * @returns {string} Safe host representation
 */
export function extractSafeHost(uri) {
  try {
    const atIndex = uri.indexOf("@");
    if (atIndex !== -1) {
      const rest = uri.slice(atIndex + 1);
      const slashIndex = rest.indexOf("/");
      const qIndex = rest.indexOf("?");
      let end = rest.length;
      if (slashIndex !== -1) end = slashIndex;
      else if (qIndex !== -1) end = qIndex;
      return rest.slice(0, end);
    }
    const match = uri.match(/mongodb(?:\+srv)?:\/\/([^/?]+)/);
    return match ? match[1] : "unknown-host";
  } catch {
    return "unknown-host";
  }
}

/**
 * Connect to MongoDB Atlas (or local during tests)
 * @param {object} [options]
 * @param {string} [options.dbName] - Override database name
 * @param {number} [options.maxRetries=3] - Maximum retry attempts
 */
export async function connectDb(options = {}) {
  const isTest = config.NODE_ENV === "test";
  const targetDbName = options.dbName || (isTest ? config.MONGODB_TEST_DB_NAME : config.MONGODB_DB_NAME);

  // Safety checks for test database
  if (isTest) {
    if (!targetDbName.endsWith("_test") || targetDbName === config.MONGODB_DB_NAME) {
      throw new Error(
        `SAFETY VIOLATION: Test suite can only connect to databases ending with "_test" and distinct from main DB. Attempted: "${targetDbName}"`
      );
    }
  }

  // Safety warning for development
  if (config.NODE_ENV === "development") {
    if (targetDbName !== "Rag_Mcp" && targetDbName !== "Rag_Mcp_test") {
      logger.warn(
        `[db] Warning: Connected database name is "${targetDbName}". Expected "Rag_Mcp" or "Rag_Mcp_test".`
      );
    }
  }

  mongoose.set("strictQuery", true);
  mongoose.set("autoIndex", config.NODE_ENV !== "production");

  const safeHost = extractSafeHost(config.MONGODB_URI);
  const maxRetries = options.maxRetries ?? 3;
  let attempt = 0;

  while (attempt < maxRetries) {
    try {
      attempt++;
      logger.info(`[db] Connecting to MongoDB host "${safeHost}" (db: ${targetDbName}, attempt: ${attempt})`);
      await mongoose.connect(config.MONGODB_URI, {
        dbName: targetDbName,
        serverSelectionTimeoutMS: 10000,
      });
      logger.info(`[db] Connected successfully to host "${safeHost}" (db: ${targetDbName})`);
      return mongoose.connection;
    } catch (err) {
      logger.error(`[db] Connection attempt ${attempt} failed: ${err.message}`);
      if (attempt >= maxRetries) {
        throw err;
      }
      const delay = Math.pow(2, attempt) * 500; // 1s, 2s, 4s...
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

/**
 * Disconnect cleanly from MongoDB
 */
export async function disconnectDb() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
    logger.info("[db] Disconnected from MongoDB");
  }
}

export default { connectDb, disconnectDb, extractSafeHost };

