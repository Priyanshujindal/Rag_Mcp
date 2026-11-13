/**
 * Joins class name strings, filtering out falsy values.
 * Pure vanilla — no clsx, no tailwind-merge.
 */
export function cn(...classes) {
  return classes.filter(Boolean).join(" ");
}

/**
 * Format a number with k/M suffix
 */
export function formatNumber(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

/**
 * Format ISO date string
 */
export function formatDate(iso, opts = {}) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    ...opts,
  });
}

/**
 * Truncate text to max length
 */
export function truncate(str, max = 60) {
  if (!str) return "";
  return str.length > max ? str.slice(0, max) + "…" : str;
}
