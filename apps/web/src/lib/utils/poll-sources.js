/**
 * Returns true if any source in any KB has an in-progress status,
 * indicating that polling should continue.
 *
 * @param {Array} kbs - Array of knowledge base objects
 * @returns {boolean}
 */
export function shouldPollSources(kbs) {
  if (!Array.isArray(kbs)) return false;
  return kbs.some((kb) =>
    (kb.sources || []).some((s) => {
      const st = s?.status?.toLowerCase();
      return st === "queued" || st === "crawling" || st === "indexing";
    })
  );
}

/**
 * Sanitizes and extracts a clean URL from user input,
 * handling accidental markdown links (e.g. `[label](url)` or `url](url?query`).
 *
 * @param {string} input
 * @returns {string}
 */
export function cleanUrlInput(input) {
  if (!input || typeof input !== "string") return "";
  let str = input.trim();

  // If user pasted something like `label](https://...` or `https://...](https://...`
  if (str.includes("](")) {
    const parts = str.split("](");
    // Take the target URL in the second part, stripping trailing ')' or ']'
    const candidate = parts[1].replace(/[)\]]+$/, "").trim();
    if (/^https?:\/\//i.test(candidate)) {
      return candidate;
    }
    const first = parts[0].replace(/^\[+/, "").trim();
    if (/^https?:\/\//i.test(first)) {
      return first;
    }
  }

  // Strip wrapping markdown brackets or angle brackets: [https://...] or <https://...>
  str = str.replace(/^\[/, "").replace(/\]$/, "");
  str = str.replace(/^</, "").replace(/>$/, "");

  // Strip trailing markdown closing parenthesis if present without opening
  if (!str.includes("(") && str.endsWith(")")) {
    str = str.slice(0, -1);
  }

  return str.trim();
}


