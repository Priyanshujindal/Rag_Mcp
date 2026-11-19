/**
 * Helpers for the "structured" PowerPoint flow in the chat route.
 *
 * In this mode the chat model only writes a short confirmation message; the slides themselves are
 * planned and rendered by the ai-service (POST /files/deck) from the user's request plus any source
 * material (the previous answer, attached documents, or a knowledge base).
 *
 * Everything here is pure (no I/O) so it can be unit tested without a database or an AI service.
 */

/** Longest request / source text the ai-service accepts. */
const MAX_REQUEST_CHARS = 4000;
const MAX_SOURCE_CHARS = 50000;
const OBJECT_ID_RE = /^[0-9a-fA-F]{24}$/;

/** Token budget for the short confirmation reply. */
export const DECK_REPLY_MAX_TOKENS = 700;

/** Instruction appended to the chat prompt so the reply is a short summary, not the slides themselves. */
export const DECK_REPLY_GUIDE =
  "\n\nIMPORTANT: The PowerPoint file for this request is built automatically by a separate presentation " +
  "designer and will appear as a downloadable file card directly below your message. " +
  "Do NOT write out the slides, an outline, JSON, or the file contents. " +
  "Reply in at most 3 short sentences: say what the presentation covers (its main sections or ideas) and that " +
  "the file is shown below to preview and download. Reply in the same language as the user.";

/**
 * @param {{ PPTX_MODE?: string } | undefined} cfg application config
 * @returns {boolean} true when decks should be planned by the ai-service
 */
export function isStructuredDeckMode(cfg) {
  return (cfg?.PPTX_MODE || "structured") !== "legacy";
}

function clip(text, max) {
  const value = String(text || "").trim();
  return value.length > max ? value.slice(0, max) : value;
}

/**
 * Collect the material a deck should be based on.
 * Priority: attached documents and the previous assistant answer (when the user says "convert this").
 *
 * @param {{ isConvertPrevious?: boolean, messages?: Array<{role: string, content?: string}>, attachedDocs?: Array<{name?: string, content?: string}> }} input
 * @returns {string}
 */
export function collectDeckSource({ isConvertPrevious = false, messages = [], attachedDocs = [] } = {}) {
  const parts = [];

  if (isConvertPrevious && Array.isArray(messages) && messages.length > 0) {
    const previous = [...messages]
      .reverse()
      .find((m) => (m.role === "ASSISTANT" || m.role === "assistant") && m.content && String(m.content).trim());
    if (previous) {
      parts.push(String(previous.content).trim());
    }
  }

  for (const doc of Array.isArray(attachedDocs) ? attachedDocs : []) {
    if (doc && doc.content && String(doc.content).trim()) {
      parts.push(`Document "${doc.name || "attachment"}":\n${String(doc.content).trim()}`);
    }
  }

  return clip(parts.join("\n\n---\n\n"), MAX_SOURCE_CHARS);
}

/**
 * Build the payload for aiClient.generateDeck().
 *
 * @param {{
 *   message: string,
 *   fileIntent: { explicitFilename?: boolean, filename?: string, isConvertPrevious?: boolean },
 *   messages?: Array<{role: string, content?: string}>,
 *   attachedDocs?: Array<{name?: string, content?: string}>,
 *   knowledgeBaseId?: string | null,
 *   model?: string,
 *   provider?: string,
 * }} input
 */
export function buildDeckRequest({ message, fileIntent = {}, messages = [], attachedDocs = [], knowledgeBaseId, model, provider }) {
  const kbId = knowledgeBaseId ? String(knowledgeBaseId) : "";
  return {
    request: clip(message, MAX_REQUEST_CHARS) || "Create a presentation",
    sourceText: collectDeckSource({ isConvertPrevious: fileIntent.isConvertPrevious, messages, attachedDocs }),
    // only when the user named the file; otherwise the deck's own title becomes the file name
    filename: fileIntent.explicitFilename ? fileIntent.filename : undefined,
    knowledgeBaseId: OBJECT_ID_RE.test(kbId) ? kbId : undefined,
    model: model || undefined,
    provider: provider || undefined,
  };
}

/**
 * User-facing note appended to the chat message when the deck could not be created.
 * @param {{ code?: string, message?: string }} err
 */
export function deckFailureNote(err) {
  const code = err?.code || "";
  if (code === "AI_SERVICE_TIMEOUT") {
    return "⚠️ Building the presentation took too long, so no file was created. Please try again.";
  }
  if (code === "DECK_PLANNING_FAILED" && err?.message && /busy|high demand|too long/i.test(err.message)) {
    return "⚠️ The AI model is busy right now, so the presentation file could not be created. Please try again in a moment.";
  }
  return "⚠️ I couldn't create the presentation file this time. Please try again.";
}
