import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { z } from "zod";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load root .env first, then local apps/api/.env if present
dotenv.config({ path: path.resolve(__dirname, "../../../../.env") });
dotenv.config({ path: path.resolve(__dirname, "../../.env") });
dotenv.config();

/**
 * Pure function to validate environment variables against schema and security rules.
 * @param {Record<string, any>} rawEnv - Environment variables object to parse
 * @returns {Readonly<object>} Frozen configuration object
 */
export function validateEnv(rawEnv = {}) {
  const errors = [];
  const nodeEnv = rawEnv.NODE_ENV || "development";

  // 1. MONGODB_URI is strictly required in all environments (no default).
  const mongoUri = rawEnv.MONGODB_URI;
  if (
    !mongoUri ||
    typeof mongoUri !== "string" ||
    (!mongoUri.startsWith("mongodb://") && !mongoUri.startsWith("mongodb+srv://"))
  ) {
    errors.push(
      'MONGODB_URI is required and must start with "mongodb://" or "mongodb+srv://". See docs/atlas-setup.md for setup instructions.'
    );
  }

  // 2. Production strict security validation
  if (nodeEnv === "production") {
    const accessSecret = rawEnv.JWT_ACCESS_SECRET;
    const refreshSecret = rawEnv.JWT_REFRESH_SECRET;
    const internalKey = rawEnv.INTERNAL_API_KEY;
    const webOrigin = rawEnv.WEB_ORIGIN;

    if (!accessSecret) {
      errors.push("JWT_ACCESS_SECRET is required in production.");
    } else {
      if (accessSecret.length < 32) {
        errors.push("JWT_ACCESS_SECRET must be at least 32 characters long in production.");
      }
      if (accessSecret.includes("change_me")) {
        errors.push("JWT_ACCESS_SECRET must not contain 'change_me' in production.");
      }
      if (accessSecret.startsWith("dev_")) {
        errors.push("JWT_ACCESS_SECRET must not start with 'dev_' in production.");
      }
    }

    if (!refreshSecret) {
      errors.push("JWT_REFRESH_SECRET is required in production.");
    } else {
      if (refreshSecret.length < 32) {
        errors.push("JWT_REFRESH_SECRET must be at least 32 characters long in production.");
      }
      if (refreshSecret.includes("change_me")) {
        errors.push("JWT_REFRESH_SECRET must not contain 'change_me' in production.");
      }
      if (refreshSecret.startsWith("dev_")) {
        errors.push("JWT_REFRESH_SECRET must not start with 'dev_' in production.");
      }
    }

    if (accessSecret && refreshSecret && accessSecret === refreshSecret) {
      errors.push("JWT_ACCESS_SECRET must differ from JWT_REFRESH_SECRET.");
    }

    if (!internalKey) {
      errors.push("INTERNAL_API_KEY is required in production.");
    } else {
      if (internalKey.length < 32) {
        errors.push("INTERNAL_API_KEY must be at least 32 characters long in production.");
      }
      if (internalKey.includes("change_me")) {
        errors.push("INTERNAL_API_KEY must not contain 'change_me' in production.");
      }
      if (internalKey.startsWith("dev_")) {
        errors.push("INTERNAL_API_KEY must not start with 'dev_' in production.");
      }
    }

    if (!webOrigin) {
      errors.push("WEB_ORIGIN must be set explicitly in production.");
    } else if (webOrigin === "*" || webOrigin.includes("localhost")) {
      errors.push("WEB_ORIGIN must not be '*' or include 'localhost' in production.");
    }
  }

  // Schema for parsing and defaults
  const envSchema = z.object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().default(8000),
    MONGODB_DB_NAME: z.string().default("Rag_Mcp"),
    MONGODB_TEST_DB_NAME: z.string().default("Rag_Mcp_test"),
    REDIS_URL: z.string().default("redis://localhost:6379"),
    WEB_ORIGIN: z.string().default("http://localhost:3000"),
    WIDGET_URL: z.string().default("http://localhost:5174"),
    TRUST_PROXY: z.string().default("false"),
    AUTH_RATE_LIMIT_MAX: z.coerce.number().default(10),
    AUTH_RATE_LIMIT_WINDOW_MINUTES: z.coerce.number().default(15),
    AUTH_REFRESH_RATE_LIMIT_MAX: z.coerce.number().default(60),
    LOGIN_EMAIL_RATE_LIMIT_MAX: z.coerce.number().default(20),
    LOGIN_EMAIL_RATE_LIMIT_WINDOW_MINUTES: z.coerce.number().default(60),
    REFRESH_GRACE_SECONDS: z.coerce.number().default(10),
    REQUIRE_LIVE_TESTS: z.string().default("false"),
    COOKIE_SAMESITE: z.enum(["lax", "strict", "none"]).default("lax"),
    JWT_ACCESS_SECRET: z.string().default("dev_access_secret_rag_mcp_test_only_min_32_chars"),
    JWT_REFRESH_SECRET: z.string().default("dev_refresh_secret_rag_mcp_test_only_min_32_chars"),
    ACCESS_TOKEN_TTL: z.coerce.number().default(900),
    REFRESH_TOKEN_TTL: z.coerce.number().default(604800),
    AI_SERVICE_URL: z.string().default("http://localhost:8001"),
    INTERNAL_API_KEY: z.string().default("dev_internal_api_key_rag_mcp_test_only"),
    EMBEDDING_DIMENSIONS: z.coerce.number().default(384),
    MAX_KBS_PER_WORKSPACE: z.coerce.number().default(10),
    MAX_SOURCES_PER_KB: z.coerce.number().default(50),
    MAX_UPLOAD_MB: z.coerce.number().default(20),
  });

  const parsed = envSchema.safeParse(rawEnv);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      errors.push(`${issue.path.join(".")}: ${issue.message}`);
    }
  }

  if (errors.length > 0) {
    const errorDetails = errors.map((e) => `  - ${e}`).join("\n");
    throw new Error(`Invalid environment configuration:\n${errorDetails}`);
  }

  const data = parsed.data;
  data.MONGODB_URI = mongoUri;

  // Enforce test database safety rule
  if (data.NODE_ENV === "test") {
    if (!data.MONGODB_TEST_DB_NAME.endsWith("_test")) {
      throw new Error(
        `SAFETY VIOLATION: MONGODB_TEST_DB_NAME must end with "_test". Received: "${data.MONGODB_TEST_DB_NAME}"`
      );
    }
    if (data.MONGODB_TEST_DB_NAME === data.MONGODB_DB_NAME) {
      throw new Error(
        `SAFETY VIOLATION: MONGODB_TEST_DB_NAME cannot equal MONGODB_DB_NAME ("${data.MONGODB_DB_NAME}")`
      );
    }
  }

  return Object.freeze(data);
}

// Module-level config initialization
let config;
try {
  config = validateEnv(process.env);
  if (config.NODE_ENV !== "production") {
    const isUsingDevSecrets =
      config.JWT_ACCESS_SECRET.startsWith("dev_") ||
      config.JWT_REFRESH_SECRET.startsWith("dev_") ||
      config.INTERNAL_API_KEY.startsWith("dev_");
    if (isUsingDevSecrets) {
      console.warn("⚠️  Warning: Insecure development secrets are in use. These will be rejected when NODE_ENV=production.");
    }
  }
} catch (err) {
  if (process.env.NODE_ENV !== "test") {
    console.error(`\n❌ ${err.message}\n`);
    process.exit(1);
  }
  // When running under test without MONGODB_URI set, export a safe fallback mock config
  // so static imports don't throw during config unit tests
  try {
    config = validateEnv({
      ...process.env,
      MONGODB_URI: "mongodb://localhost:27017",
      MONGODB_DB_NAME: "Rag_Mcp",
      MONGODB_TEST_DB_NAME: "Rag_Mcp_test",
    });
  } catch {
    throw err;
  }
}

export default config;
