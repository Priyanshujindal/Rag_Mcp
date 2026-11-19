import aiClient from "../../services/ai-client.js";
import { Conversation } from "../../db/models/index.js";
import logger from "../../utils/logger.js";

// Specialized dictionary of case-sensitive technical terms & acronyms
const TECH_TERMS = {
  html: "HTML",
  css: "CSS",
  js: "JS",
  ts: "TypeScript",
  javascript: "JavaScript",
  typescript: "TypeScript",
  node: "Node.js",
  nodejs: "Node.js",
  "node.js": "Node.js",
  react: "React",
  nextjs: "Next.js",
  vue: "Vue",
  api: "API",
  apis: "APIs",
  sdk: "SDK",
  rag: "RAG",
  mcp: "MCP",
  pm2: "PM2",
  mongodb: "MongoDB",
  mongo: "MongoDB",
  bge: "BGE",
  bm25: "BM25",
  fastembed: "FastEmbed",
  vultr: "Vultr",
  npm: "NPM",
  pnpm: "PNPM",
  eperm: "EPERM",
  llm: "LLM",
  llms: "LLMs",
  hmac: "HMAC",
  jwt: "JWT",
  sse: "SSE",
  rest: "REST",
  aws: "AWS",
  docker: "Docker",
  k8s: "Kubernetes",
  kubernetes: "Kubernetes",
  sql: "SQL",
  nosql: "NoSQL",
  db: "Database",
  gemini: "Gemini",
  openai: "OpenAI",
  ai: "AI",
  ui: "UI",
  ux: "UX",
  url: "URL",
  urls: "URLs",
  http: "HTTP",
  https: "HTTPS",
  cors: "CORS",
  mr: "Mr",
  "mr.": "Mr.",
  mrs: "Mrs",
  "mrs.": "Mrs.",
  dr: "Dr",
  "dr.": "Dr.",
  mrbeast: "MrBeast",
};

// Lowercase conjunctions, prepositions, articles (unless at start or end)
const MINOR_WORDS = new Set([
  "a",
  "an",
  "the",
  "and",
  "but",
  "or",
  "for",
  "nor",
  "on",
  "at",
  "to",
  "from",
  "by",
  "over",
  "in",
  "with",
  "of",
  "vs",
]);

/**
 * Capitalizes string according to English Title Case and technical glossary rules.
 * @param {string} text
 * @returns {string}
 */
export function formatTitleCase(text) {
  if (!text || typeof text !== "string") return "";

  const words = text.trim().split(/\s+/);
  return words
    .map((word, idx, arr) => {
      // Strip outer punctuation for dictionary lookup
      const core = word.replace(/^[^a-zA-Z0-9]+|[^a-zA-Z0-9]+$/g, "").toLowerCase();

      if (TECH_TERMS[core]) {
        // Substitute technical capitalization while preserving attached punctuation (e.g. :not())
        return word.replace(new RegExp(core, "i"), TECH_TERMS[core]);
      }

      const lower = word.toLowerCase();
      // Keep minor prepositions/articles lowercase unless first or last word
      if (idx !== 0 && idx !== arr.length - 1 && MINOR_WORDS.has(lower)) {
        return lower;
      }

      // Standard capitalization
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(" ");
}

/**
 * Cleans an entity candidate by stripping leading articles and trailing context.
 * @param {string} str
 * @returns {string}
 */
function cleanEntity(str) {
  if (!str) return "";
  let s = str
    .trim()
    .replace(/^(?:the|a|an)\s+/i, "")
    .replace(/[\?\.\!\:\;\,]+$/g, "")
    .trim();
  // Strip trailing context phrase if present (e.g. "for web dev", "in 2026")
  s = s.replace(/\s+(?:for|in|on|at|with)\s+.*$/i, "");
  return s.trim();
}

/**
 * Checks whether a conversation title is a generic placeholder or greeting.
 * @param {string} title
 * @returns {boolean}
 */
export function isGenericTitle(title) {
  if (!title || typeof title !== "string") return true;
  const clean = title.trim().toLowerCase();
  return (
    clean === "new conversation" ||
    clean === "general inquiries" ||
    clean === "chat session" ||
    clean === "untitled conversation" ||
    clean.length < 4
  );
}

/**
 * Advanced Semantic NLP chat title generator.
 * Identifies comparisons (with typo tolerance), debugging/error queries,
 * code generation, and topic preambles to generate human-grade, concise titles.
 * @param {string} rawMessage
 * @returns {string}
 */
export function generateHeuristicTitle(rawMessage) {
  if (!rawMessage || typeof rawMessage !== "string") {
    return "New Conversation";
  }

  let text = rawMessage.trim();

  // 1. Strip markdown fences, inline code, and URLs
  text = text.replace(/```[\s\S]*?```/g, "");
  text = text.replace(/`([^`]*)`/g, "$1");
  text = text.replace(/https?:\/\/\S+/gi, "");
  text = text.replace(/[\r\n]+/g, " ").trim();

  // 2. High-signal semantic comparisons (handles typos like 'differnce', 'diffrence', 'differnces', etc.)
  // Matches: "(tell me )?(the )?diff(erence|ernce) between X and Y"
  const diffMatch = text.match(/\bdiff\w*\s+between\s+(.+?)\s+(?:and|&)\s+(.+?)(?:\?|$|\.|\!)/i);
  if (diffMatch && diffMatch[1] && diffMatch[2]) {
    const e1 = cleanEntity(diffMatch[1]);
    const e2 = cleanEntity(diffMatch[2]);
    if (e1 && e2) {
      return formatTitleCase(`${e1} vs ${e2}`);
    }
  }

  // Matches: "(please )?compare X and/with/to Y"
  const compMatch = text.match(/\bcompare\w*\s+(.+?)\s+(?:and|&|with|to)\s+(.+?)(?:\?|$|\.|\!)/i);
  if (compMatch && compMatch[1] && compMatch[2]) {
    const e1 = cleanEntity(compMatch[1]);
    const e2 = cleanEntity(compMatch[2]);
    if (e1 && e2) {
      return formatTitleCase(`${e1} vs ${e2}`);
    }
  }

  // Matches: "which is better X or Y"
  const whichMatch = text.match(/(?:which\s+is\s+better|which\s+one\s+is\s+better)[\s,:]+(.+?)\s+(?:or)\s+(.+?)(?:\?|$|\.|\!)/i);
  if (whichMatch && whichMatch[1] && whichMatch[2]) {
    const e1 = cleanEntity(whichMatch[1]);
    const e2 = cleanEntity(whichMatch[2]);
    if (e1 && e2) {
      return formatTitleCase(`${e1} vs ${e2}`);
    }
  }

  // Matches: "X vs / versus / v/s Y"
  const vsMatch = text.match(/(?:^|\s)(.+?)\s+(?:vs\.?|v\/s|versus)\s+(.+?)(?:\?|$|\.|\!)/i);
  if (vsMatch && vsMatch[1].length < 35 && vsMatch[2].length < 35) {
    const e1 = cleanEntity(vsMatch[1]);
    const e2 = cleanEntity(vsMatch[2]);
    if (e1 && e2) {
      return formatTitleCase(`${e1} vs ${e2}`);
    }
  }

  // 3. Problem solving / Fix / Debug queries
  const fixMatch = text.match(/(?:how\s+(?:to|do\s+i|can\s+i)\s+)?(?:fix|resolve|debug|solve)\s+(?:the\s+)?(.+?)(?:\?|$|\.|\!)/i);
  if (fixMatch && fixMatch[1]) {
    const topic = fixMatch[1].trim();
    return formatTitleCase(`Fix ${topic}`);
  }

  // 4. Code / Script generation queries
  const writeMatch = text.match(
    /(?:write|create|build|generate|make|code)\s+(?:a|an)?\s*(?:[a-zA-Z0-9#+.]+\s+)?(?:script|code|function|program|app|crawler|scraper)?\s*(?:to|for)\s+(.+?)(?:\?|$|\.|\!)/i
  );
  if (writeMatch && writeMatch[1]) {
    return formatTitleCase(`${cleanEntity(writeMatch[1])} Script`);
  }

  // 5. Strip conversational greetings
  text = text.replace(
    /^(?:hey\s+(?:there|assistant)|hello\s+there|hello|hey|hi|good\s+(?:morning|afternoon|evening)|yo|greetings|howdy)[\s,!.-]*/i,
    ""
  );

  // 6. Strip politeness & preambles (including "tell me the difference", "tell me about", etc.)
  text = text.replace(
    /^(?:please\s+|kindly\s+|could\s+you\s+(?:please\s+)?|can\s+you\s+(?:please\s+)?|would\s+you\s+mind\s+(?:telling\s+me|explaining)?|i\s+(?:want|need|would\s+like)\s+to\s+(?:know|understand)?|tell\s+me\s+(?:about\s+|the\s+)?|help\s+me\s+(?:with|to)?|i\s+have\s+a\s+question\s+(?:about)?)\s*/i,
    ""
  );

  // 7. Strip question openers
  text = text.replace(
    /^(?:what\s+(?:is|are|does|were|was)|how\s+(?:to|do\s+i|can\s+i|does|is)|how\b|why\s+(?:is|are|does)|where\s+(?:is|are|can\s+i)|explain\s+(?:to\s+me\s+)?(?:how|what|why)?|summarize\s+(?:the|our)?)\s*/i,
    ""
  );

  // 8. Strip leftover auxiliary verbs or articles at the beginning
  text = text.replace(/^(?:does|do|is|are|did|to|can|could|would|the|a|an)\s+/i, "");

  // 9. Clean trailing punctuation
  text = text.replace(/[\?\.\!\:\;\,]+$/g, "").trim();

  // If message was just greeting or short filler
  if (!text || text.length < 2) {
    return "General Inquiries";
  }

  // 10. Word boundary clean truncation: max 6 words or 42 chars
  const words = text.split(/\s+/);
  let truncated = words.slice(0, 6).join(" ");
  if (truncated.length > 42) {
    truncated = truncated.slice(0, 42).replace(/\s+\S*$/, "");
  }

  // 11. Strip dangling trailing prepositions/conjunctions left after word truncation
  while (/\s+(?:in|on|at|to|for|with|of|the|a|an|and|by|using|from)$/i.test(truncated)) {
    truncated = truncated.replace(/\s+\S+$/, "");
  }

  return formatTitleCase(truncated) || "New Conversation";
}

/**
 * Advanced multi-tier chat naming algorithm:
 * 1. Produces an immediate smart heuristic title (zero latency).
 * 2. Fires an asynchronous background AI summarizer call to refine title if applicable.
 */
export const titleGeneratorService = {
  formatTitleCase,
  isGenericTitle,
  generateHeuristicTitle,

  /**
   * Refines a conversation title using AI in the background.
   * If successful, updates MongoDB and returns refined title.
   * @param {string} workspaceId
   * @param {string} conversationId
   * @param {string} userMessage
   * @param {string} [model]
   * @returns {Promise<string|null>}
   */
  async refineTitleWithAI(workspaceId, conversationId, userMessage, model = "gemini-3.8-flash") {
    if (!workspaceId || !conversationId || !userMessage) return null;

    try {
      const res = await aiClient.generateTitle(workspaceId, {
        message: userMessage,
        model,
      });

      const rawAiTitle = res?.title;
      if (rawAiTitle && typeof rawAiTitle === "string") {
        let clean = rawAiTitle.trim().replace(/^["'`]+|["'`]+$/g, "");
        if (clean.toLowerCase().startsWith("title:")) {
          clean = clean.slice(6).trim();
        }

        const formatted = formatTitleCase(clean);
        if (formatted && formatted.length >= 3 && !isGenericTitle(formatted)) {
          await Conversation.updateOne(
            { _id: conversationId, workspaceId },
            { $set: { title: formatted } }
          );

          logger.info({
            conversationId: conversationId.toString(),
            refinedTitle: formatted,
            msg: "Conversation title refined by AI naming algorithm",
          });

          return formatted;
        }
      }
    } catch (err) {
      logger.debug({
        conversationId: conversationId.toString(),
        err: err.message,
        msg: "Async AI title refinement skipped; heuristic title retained",
      });
    }

    return null;
  },
};

export default titleGeneratorService;
