/**
 * Utility functions for Source Indexing Details inspection
 */

/**
 * Formats indexing duration in milliseconds into a concise human-readable string.
 * Returns "Unavailable" if valid duration is not present or cannot be computed.
 *
 * @param {number|null} durationMs
 * @param {string|Date|null} [startedAt]
 * @param {string|Date|null} [completedAt]
 * @returns {string}
 */
export function formatIndexingDuration(durationMs, startedAt = null, completedAt = null) {
  let ms = typeof durationMs === "number" && !isNaN(durationMs) && durationMs >= 0 ? durationMs : null;

  if (ms === null && startedAt && completedAt) {
    const start = new Date(startedAt).getTime();
    const end = new Date(completedAt).getTime();
    if (!isNaN(start) && !isNaN(end) && end >= start) {
      ms = end - start;
    }
  }

  if (ms === null) {
    return "Unavailable";
  }

  if (ms < 1000) {
    return `${ms}ms`;
  }
  const totalSeconds = ms / 1000;
  if (totalSeconds < 60) {
    return `${totalSeconds.toFixed(1)}s`;
  }
  const minutes = Math.floor(totalSeconds / 60);
  const remainingSeconds = Math.round(totalSeconds % 60);
  return `${minutes}m ${remainingSeconds}s`;
}

/**
 * Maps source embedding status and returns display metadata.
 * Returns available: true if embeddingStatus exists (even if null for QUEUED sources).
 * Only returns available: false if the field is explicitly undefined (backend not exposing it).
 *
 * @param {object} source
 * @returns {{ available: boolean, status: string, label: string, variant: string, detail: string }}
 */
export function getEmbeddingStatus(source) {
  // Check if source exists and has embeddingStatus property (even if null)
  if (!source || source.embeddingStatus === undefined) {
    return {
      available: false,
      status: "unavailable",
      label: "Unavailable",
      variant: "neutral",
      detail: "The backend does not expose separate embedding status per source.",
    };
  }

  // Handle null embeddingStatus (sources in QUEUED state before processing starts)
  if (source.embeddingStatus === null) {
    return {
      available: true,
      status: "not_started",
      label: "Not Started",
      variant: "neutral",
      detail: "Embedding generation has not started yet.",
    };
  }

  const raw = String(source.embeddingStatus).toLowerCase();
  const totalChunks = source.chunkCount ?? source.chunksCount ?? 0;
  const generated = typeof source.embeddingsGenerated === "number" ? source.embeddingsGenerated : null;

  let variant = "neutral";
  let label = "Pending";

  switch (raw) {
    case "completed":
    case "indexed":
    case "ready":
      variant = "success";
      label = "Completed";
      break;
    case "processing":
    case "generating":
    case "indexing":
      variant = "warning";
      label = "Processing";
      break;
    case "failed":
    case "error":
      variant = "danger";
      label = "Failed";
      break;
    case "pending":
    case "queued":
    default:
      variant = "neutral";
      label = "Pending";
      break;
  }

  const countInfo = generated !== null ? ` (${generated}/${totalChunks} vectors)` : "";

  return {
    available: true,
    status: raw,
    label: `${label}${countInfo}`,
    variant,
    detail: `Embedding status: ${label}`,
  };
}

/**
 * Sanitizes error messages to prevent exposing secrets, full connection strings, or internal stack traces.
 *
 * @param {string|null|undefined} err
 * @returns {string}
 */
export function sanitizeErrorMessage(err) {
  if (!err) return "Unknown error occurred during indexing.";
  let msg = String(err).trim();

  // Redact full mongodb connection strings
  msg = msg.replace(/mongodb(\+srv)?:\/\/[^\s]+/gi, "[REDACTED_DATABASE_URI]");

  // Redact potential bearer tokens or secrets
  msg = msg.replace(/bearer\s+[a-zA-Z0-9_\-.]+/gi, "Bearer [REDACTED]");
  msg = msg.replace(/ragmcp_[a-zA-Z0-9_]+/gi, "[REDACTED_API_KEY]");

  // Strip long stack traces
  if (msg.includes(" at ") && msg.includes("\n")) {
    msg = msg.split("\n")[0];
  }

  return msg.slice(0, 500);
}
