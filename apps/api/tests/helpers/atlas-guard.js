import mongoose from "mongoose";
import config from "../../src/config/index.js";
import { connectDb, disconnectDb } from "../../src/db/connection.js";

let probeResult = null;

/**
 * Checks whether a live MongoDB Atlas cluster is reachable within 3 seconds.
 * Skips gracefully if unconfigured, or throws hard if REQUIRE_LIVE_TESTS=true.
 */
export async function checkLiveAtlasAvailability() {
  if (probeResult) {
    return probeResult;
  }

  const uri = config.MONGODB_URI || "";
  const isPlaceholder =
    !uri ||
    uri.includes("<password>") ||
    uri.includes("YOURPASSWORD") ||
    uri.includes("cluster0.xxxxx") ||
    uri.includes("<cluster>") ||
    uri.includes("<user>");

  if (isPlaceholder) {
    const reason = `MONGODB_URI is unconfigured or contains placeholder values.`;
    handleUnreachable(reason);
    probeResult = { available: false, reason };
    return probeResult;
  }

  try {
    // 3-second quick probe timeout
    const connectPromise = connectDb({
      maxRetries: 1,
    });

    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error("Connection probe timed out after 3000ms")), 3000);
    });

    await Promise.race([connectPromise, timeoutPromise]);

    if (mongoose.connection.readyState === 1) {
      probeResult = { available: true };
      return probeResult;
    }

    throw new Error(`Connection readyState is ${mongoose.connection.readyState}`);
  } catch (err) {
    const reason = `Live MongoDB Atlas connection failed (${err.message}).`;
    handleUnreachable(reason);
    probeResult = { available: false, reason };
    return probeResult;
  }
}

function handleUnreachable(reason) {
  const requireLive =
    process.env.REQUIRE_LIVE_TESTS === "true" ||
    config.REQUIRE_LIVE_TESTS === "true";

  if (requireLive) {
    throw new Error(
      `\n❌ REQUIRE_LIVE_TESTS=true is set, but live MongoDB Atlas is unreachable:\n   ${reason}\n`
    );
  }

  console.warn(
    `\n` +
    `====================================================================================\n` +
    `⚠️  LOUD WARNING: Skipping Live MongoDB Atlas Test Suites\n` +
    `   Reason: ${reason}\n` +
    `   Skipped suite: "Auth, Tenancy, and Core CRUD (Stage 3)" (tests/stage3-crud.test.js)\n` +
    `   All unit, model, validation, and rate limiter tests will continue running.\n` +
    `====================================================================================\n`
  );
}

export { disconnectDb };

