/**
 * apps/api/src/modules/chat/file-intent.service.js
 * ==================================================
 * Detects file generation intent from natural language,
 * generates sensible filenames, and parses structured content
 * (tables for spreadsheets, slides for presentations, code blocks).
 */

const FILE_TYPE_MAP = [
  { type: "pdf", ext: "pdf", patterns: [/\bpdf\b/i, /\bpdf document\b/i, /\.pdf\b/i] },
  { type: "docx", ext: "docx", patterns: [/\bword\b/i, /\bdocx\b/i, /\bword document\b/i, /\.docx?\b/i] },
  { type: "pptx", ext: "pptx", patterns: [/\bpowerpoint\b/i, /\bpresentation\b/i, /\bpptx?\b/i, /\bslides?\b/i, /\bslide deck\b/i] },
  { type: "xlsx", ext: "xlsx", patterns: [/\bexcel\b/i, /\bspreadsheet\b/i, /\bxlsx?\b/i, /\bexcel sheet\b/i] },
  { type: "csv", ext: "csv", patterns: [/\bcsv\b/i, /\bcomma separated\b/i, /\.csv\b/i] },
  { type: "py", ext: "py", patterns: [/\bpython\b/i, /\b\.py\b/i, /\bpython script\b/i] },
  { type: "js", ext: "js", patterns: [/\bjavascript\b/i, /\bjs script\b/i, /\breact component\b/i, /\b\.jsx?\b/i] },
  { type: "ts", ext: "ts", patterns: [/\btypescript\b/i, /\bts script\b/i, /\b\.tsx?\b/i] },
  { type: "html", ext: "html", patterns: [/\bhtml\b/i, /\bwebpage\b/i, /\bweb page\b/i, /\.html\b/i] },
  { type: "css", ext: "css", patterns: [/\bcss\b/i, /\bstylesheet\b/i, /\.css\b/i] },
  { type: "json", ext: "json", patterns: [/\bjson\b/i, /\.json\b/i] },
  { type: "yaml", ext: "yaml", patterns: [/\byaml\b/i, /\byml\b/i, /\.ya?ml\b/i] },
  { type: "sql", ext: "sql", patterns: [/\bsql\b/i, /\bsql query\b/i, /\bsql script\b/i, /\.sql\b/i] },
  { type: "java", ext: "java", patterns: [/\bjava\b/i, /\.java\b/i] },
  { type: "cpp", ext: "cpp", patterns: [/\bc\+\+\b/i, /\bcpp\b/i, /\.cpp\b/i] },
  {
    type: "image",
    ext: "webp",
    patterns: [
      /\bimages?\b/i,
      /\bpictures?\b/i,
      /\bphotos?\b/i,
      /\billustrations?\b/i,
      /\bdrawings?\b/i,
      /\bartworks?\b/i,
      /\bwallpapers?\b/i,
      /\.png\b/i,
      /\.jpe?g\b/i,
      /\.webp\b/i,
    ],
  },
  {
    type: "md",
    ext: "md",
    patterns: [
      /\bmarkdown\b/i,
      /\bmd\b/i,
      /\.md\b/i,
      /\bmd file\b/i,
      /\bmarkdown file\b/i,
      /\bmd document\b/i,
      /\bmarkdown document\b/i,
    ],
  },
  {
    type: "txt",
    ext: "txt",
    patterns: [/\bplain text\b/i, /\btext file\b/i, /\btxt\b/i, /\.txt\b/i, /\btxt file\b/i],
  },
];

const TRIGGER_VERBS = [
  "create",
  "generate",
  "make",
  "build",
  "export",
  "convert",
  "download",
  "save",
  "produce",
  "write",
  "draw",
  "paint",
  "render",
  "illustrate",
  "sketch",
  "give me a",
  "give me an",
];

export class FileIntentService {
  /**
   * Detects if the prompt asks to create/generate/export a file.
   * @param {string} message
   * @returns {{ hasIntent: boolean, fileType: string, filename: string, title: string, isConvertPrevious: boolean }}
   */
  static detectFileIntent(message = "") {
    const raw = message.trim();
    const lower = raw.toLowerCase();

    // Check if user is asking to convert the previous answer/response
    const isConvertPrevious =
      lower.includes("convert this") ||
      lower.includes("convert the above") ||
      lower.includes("convert response") ||
      lower.includes("download this") ||
      lower.includes("download the answer") ||
      lower.includes("make this a") ||
      lower.includes("save this as");

    // Check trigger verb or direct file request
    const hasTriggerVerb = TRIGGER_VERBS.some((verb) => lower.includes(verb));
    const hasFileKeyword =
      lower.includes("file") ||
      lower.includes("document") ||
      lower.includes("sheet") ||
      lower.includes("presentation") ||
      lower.includes("slide") ||
      lower.includes("script") ||
      lower.includes("downloadable");

    let matchedType = null;
    for (const item of FILE_TYPE_MAP) {
      if (item.patterns.some((pattern) => pattern.test(lower))) {
        matchedType = item;
        break;
      }
    }

    // If no specific extension matched but user asked for "downloadable file" or "create a file"
    if (!matchedType && (hasTriggerVerb || isConvertPrevious) && hasFileKeyword) {
      // Default to PDF for generic document/file requests
      matchedType = { type: "pdf", ext: "pdf" };
    }

    if (!matchedType) {
      return { hasIntent: false, fileType: null, filename: null, title: null, isConvertPrevious: false };
    }

    // Only consider it an intent if there's a trigger verb, file keyword, or convert phrase
    if (!hasTriggerVerb && !hasFileKeyword && !isConvertPrevious) {
      // Just mentioning "python" or "pdf" casually without wanting a file
      return { hasIntent: false, fileType: null, filename: null, title: null, isConvertPrevious: false };
    }

    // Extract explicit filename if provided (e.g. "named report.pdf" or "as my_notes.docx")
    let filename = null;
    const nameMatch = raw.match(/(?:named|called|as|filename:?)\s+["']?([a-zA-Z0-9_\-\.]+?\.[a-zA-Z0-9]{2,5})["']?/i);
    if (nameMatch) {
      filename = nameMatch[1];
    }

    // Extract title or topic
    let title = "Generated Document";
    const topicMatch = raw.match(
      /(?:containing|explaining|about|for|of)\s+([^.,\n]+)/i
    );
    if (topicMatch) {
      title = topicMatch[1]
        .replace(/["']/g, "")
        .trim()
        .slice(0, 60);
      // Capitalize title
      title = title.charAt(0).toUpperCase() + title.slice(1);
    } else {
      // Infer title from file type
      if (matchedType.type === "pdf") title = "Project Report";
      else if (matchedType.type === "docx") title = "Document Report";
      else if (matchedType.type === "pptx") title = "Presentation Overview";
      else if (matchedType.type === "xlsx" || matchedType.type === "csv") title = "Data Table";
      else if (matchedType.type === "md") title = "Markdown Document";
      else if (matchedType.type === "txt") title = "Text Document";
      else if (matchedType.type === "image") title = "Generated Artwork";
      else title = "Generated Code";
    }

    // Fallback filename if not explicitly named
    if (!filename) {
      const slug = title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 40) || "document";
      filename = `${slug}.${matchedType.ext}`;
    }

    return {
      hasIntent: true,
      fileType: matchedType.type,
      filename,
      title,
      isConvertPrevious,
      // true only when the user actually named the file ("... named report.pptx")
      explicitFilename: Boolean(nameMatch),
    };
  }

  /**
   * Parses markdown tables into headers and rows.
   * @param {string} text
   * @returns {{ headers: string[], rows: any[][] }}
   */
  static parseMarkdownTable(text = "") {
    const lines = text.split("\n").map((l) => l.trim());
    const tableLines = lines.filter((l) => l.startsWith("|") && l.endsWith("|"));

    if (tableLines.length < 2) {
      return { headers: [], rows: [] };
    }

    const cleanCell = (str) => {
      if (typeof str !== "string") return str;
      return str
        .replace(/\*\*(.*?)\*\*/g, "$1")
        .replace(/__(.*?)__/g, "$1")
        .replace(/(?<!\w)\*(.*?)\*(?!\w)/g, "$1")
        .replace(/(?<!\w)_(.*?)_(?!\w)/g, "$1")
        .replace(/`([^`]+)`/g, "$1")
        .trim();
    };

    const parseRow = (line) =>
      line
        .slice(1, -1)
        .split("|")
        .map((cell) => cell.trim());

    const headers = parseRow(tableLines[0]).map(cleanCell);
    // Skip separator line (e.g. |---|---|)
    const dataLines = tableLines.slice(1).filter((l) => !/^\|[\s\-:|]+\|$/.test(l));

    const rows = dataLines.map((line) => {
      return parseRow(line).map((val) => {
        const cleaned = cleanCell(val);
        // Check if numeric / currency / percentage (e.g. "$1,500", "1,500.50", "(250)", "-$50", "15.5%")
        const isNegative = /^\(.*\)$/.test(cleaned) || /^-\$?[0-9]/.test(cleaned);
        const numStr = cleaned.replace(/[$,%()]/g, "").trim();
        const num = Number(numStr);
        if (!isNaN(num) && numStr !== "") {
          const finalNum = isNegative ? -Math.abs(num) : num;
          return cleaned.endsWith("%") ? finalNum / 100 : finalNum;
        }
        return cleaned;
      });
    });

    return { headers, rows };
  }

  /**
   * Extracts code blocks from markdown.
   * @param {string} text
   * @param {string} targetLang
   * @returns {string}
   */
  static extractCodeSnippet(text = "", targetLang = "") {
    const codeBlockRegex = /```(?:[a-zA-Z0-9_\-]+)?\n([\s\S]*?)```/g;
    const matches = [...text.matchAll(codeBlockRegex)];

    if (matches.length > 0) {
      // If multiple code blocks, join them or pick the largest
      return matches.map((m) => m[1].trim()).join("\n\n");
    }

    return text.trim();
  }

  /**
   * Parses markdown text into presentation slides.
   * @param {string} text
   * @param {string} defaultTitle
   * @returns {Array<{ title: string, points: string[] }>}
   */
  static parseSlides(text = "", defaultTitle = "Presentation") {
    const slides = [];
    let currentSlide = null;

    const lines = text.split("\n");
    for (const line of lines) {
      const s = line.trim();
      if (!s) continue;

      if (s.startsWith("# ") || s.startsWith("## ") || s.startsWith("### Slide")) {
        if (currentSlide) {
          slides.push(currentSlide);
        }
        currentSlide = {
          title: s.replace(/^#+\s*/, "").replace(/Slide \d+:\s*/i, "").trim(),
          points: [],
        };
      } else if (currentSlide) {
        if (s.startsWith("- ") || s.startsWith("* ") || s.startsWith("• ")) {
          currentSlide.points.push(s.replace(/^[-*•]\s*/, ""));
        } else if (/^\d+\.\s/.test(s)) {
          currentSlide.points.push(s.replace(/^\d+\.\s*/, ""));
        } else if (s.length > 3) {
          currentSlide.points.push(s);
        }
      }
    }

    if (currentSlide) {
      slides.push(currentSlide);
    }

    if (slides.length === 0) {
      slides.push({
        title: defaultTitle,
        points: ["Key concepts and overview", "Detailed implementation steps", "Conclusions and next actions"],
      });
    }

    return slides;
  }

  /**
   * Cleans and normalizes generated Markdown content.
   * Strips conversational preamble/postamble, unwraps top-level markdown code blocks if present,
   * and ensures a top-level H1 title exists.
   * @param {string} text
   * @param {string} [fallbackTitle]
   * @returns {string}
   */
  static cleanMarkdownContent(text = "", fallbackTitle = "") {
    if (!text) return text;
    let content = text.trim();

    // 1. Strip common LLM chat preamble
    const preamblePatterns = [
      /^(here('s| is)\s+(your|the)\s+)/i,
      /^(sure[,!]?\s*|okay[,!]?\s*|certainly[,!]?\s*)/i,
      /^(below (is|you'll find))/i,
      /^(the following (is|contains|provides))/i,
      /^(i('ve| have)\s+(created|generated|written|prepared))/i,
      /^(this (markdown|md|document|file)\s+(covers|explains|contains|provides))/i,
    ];

    const lines = content.split("\n");
    let startIdx = 0;
    while (startIdx < lines.length) {
      const line = lines[startIdx].trim();
      if (!line) {
        startIdx++;
        continue;
      }
      if (preamblePatterns.some((p) => p.test(line)) && !line.startsWith("#")) {
        startIdx++;
        continue;
      }
      break;
    }

    content = lines.slice(startIdx).join("\n").trim();

    // 2. Unwrap if wrapped in ```markdown ... ``` or ```md ... ```
    const codeBlockMatch = content.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```\s*$/i);
    if (codeBlockMatch) {
      content = codeBlockMatch[1].trim();
    } else {
      const innerMatch = content.match(/```(?:markdown|md)\s*\n([\s\S]*?)\n```/i);
      if (innerMatch) {
        content = innerMatch[1].trim();
      }
    }

    // 3. Strip trailing conversational closing remarks
    const postamblePatterns = [
      /^(hope this (helps|is useful)|let me know if|feel free to|if you (have|need))/i,
    ];

    const remainingLines = content.split("\n");
    let endIdx = remainingLines.length;
    while (endIdx > 0) {
      const line = remainingLines[endIdx - 1].trim();
      if (!line) {
        endIdx--;
        continue;
      }
      if (postamblePatterns.some((p) => p.test(line)) && !line.startsWith("#")) {
        endIdx--;
        continue;
      }
      break;
    }

    content = remainingLines.slice(0, endIdx).join("\n").trim();

    // Ensure document has top-level # heading if fallbackTitle provided
    if (fallbackTitle && !content.startsWith("#")) {
      content = `# ${fallbackTitle}\n\n${content}`;
    }

    return content;
  }
}

export default FileIntentService;

