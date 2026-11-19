import config from "./config/index.js";
import logger from "./utils/logger.js";
import { connectDb, disconnectDb } from "./db/connection.js";
import app from "./app.js";

let server;

async function startServer() {
  try {
    // 1. Connect to MongoDB Atlas
    await connectDb();

    // 2. Start HTTP server
    server = app.listen(config.PORT, () => {
      logger.info(`[api] Rag_Mcp API server listening on http://localhost:${config.PORT} (${config.NODE_ENV})`);
    });
  } catch (err) {
    logger.fatal(`[api] Failed to start server: ${err.message}`);
    process.exit(1);
  }
}

// Graceful shutdown
async function gracefulShutdown(signal) {
  logger.info(`[api] Received ${signal}. Starting graceful shutdown...`);
  if (server) {
    server.close(async () => {
      logger.info("[api] HTTP server closed.");
      try {
        await disconnectDb();
        logger.info("[api] Database connection closed. Exiting process.");
        process.exit(0);
      } catch (err) {
        logger.error(`[api] Error during database disconnect: ${err.message}`);
        process.exit(1);
      }
    });

    // Fallback force shutdown after 10 seconds
    setTimeout(() => {
      logger.error("[api] Force shutdown timeout reached.");
      process.exit(1);
    }, 10000).unref();
  } else {
    process.exit(0);
  }
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

// Start server if run directly
startServer();

