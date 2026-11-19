import pino from "pino";
import config from "../config/index.js";

const isDev = config.NODE_ENV === "development";
const isTest = config.NODE_ENV === "test";

export const logger = pino({
  level: isTest ? "silent" : (process.env.LOG_LEVEL || "info"),
  transport: isDev
    ? {
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "SYS:standard",
          ignore: "pid,hostname",
        },
      }
    : undefined,
});

export default logger;

