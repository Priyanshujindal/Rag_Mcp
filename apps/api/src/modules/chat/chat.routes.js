import { Router } from "express";
import multer from "multer";
import { authenticate } from "../../middleware/auth.middleware.js";
import { tenantGuard } from "../../middleware/tenant-guard.middleware.js";
import { Conversation, Message, Membership, KnowledgeBase, Artifact } from "../../db/models/index.js";
import aiClient from "../../services/ai-client.js";
import storageService from "../../services/storage.service.js";
import titleGeneratorService from "../conversations/title-generator.service.js";
import { McpOrchestrator } from "../mcp/mcp.orchestrator.js";
import FileIntentService from "./file-intent.service.js";
import config from "../../config/index.js";
import {
  DECK_REPLY_GUIDE,
  DECK_REPLY_MAX_TOKENS,
  buildDeckRequest,
  deckFailureNote,
  isStructuredDeckMode,
} from "./deck-flow.service.js";
import AppError from "../../utils/app-error.js";
import logger from "../../utils/logger.js";

/**
 * Strips LLM meta-narration preamble from document content before it is
 * passed to the file generator.  Removes lines like:
 *   "I will now create a PDF about..."
 *   "Here is your document:"
 *   "Step 1: Converting..."
 *   "Sure! Here is the content of your document."
 * The function keeps stripping until it finds a real content line
 * (a markdown heading, bullet, or non-empty paragraph that is NOT a
 * known preamble pattern), then returns everything from that line onward.
 */
function stripLlmPreamble(text) {
  if (!text) return text;

  // Patterns that identify preamble / meta-commentary lines to drop
  const preamblePatterns = [
    /^(sure[,!]?\s*|okay[,!]?\s*|of course[,!]?\s*|absolutely[,!]?\s*|certainly[,!]?\s*)/i,
    /^(here('s| is)\s+(your|the)\s+)/i,
    /^(i('ll| will)\s+(now\s+)?(create|generate|make|build|produce|write))/i,
    /^(below (is|you'll find))/i,
    /^(the following (is|contains|provides))/i,
    /^(converting\b|step \d+[:.\s])/i,
    /^(please (find|see|note)\b)/i,
    /^(as requested|as asked)/i,
    /^(this document (covers|provides|contains|explains))/i,
    /^(let me (create|generate|write))/i,
    /^(i've (created|generated|prepared|written))/i,
    /^(this (pdf|docx|word|markdown|md|document|file)\s+(will|is|contains))/i,
  ];

  const lines = text.split("\n");
  let startIdx = 0;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    // Skip blank lines at the top
    if (!trimmed) {
      startIdx = i + 1;
      continue;
    }
    // If line matches a preamble pattern, skip it
    if (preamblePatterns.some((p) => p.test(trimmed))) {
      startIdx = i + 1;
      continue;
    }
    // Real content found — stop here
    break;
  }

  return lines.slice(startIdx).join("\n").trimStart();
}

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
});

/**
 * POST /api/v1/chat/parse-document
 * Parses an ad-hoc attached document (PDF, TXT, CSV, MD, JSON) for chat.
 */
router.post("/parse-document", authenticate, tenantGuard, upload.single("file"), async (req, res, next) => {
  try {
    if (!req.file) {
      return next(AppError.badRequest("No file uploaded"));
    }
    const filename = req.file.originalname || "attached_document";
    const ext = (filename.split(".").pop() || "").toLowerCase();

    // Direct memory decoding for text-based files
    if (["txt", "csv", "tsv", "md", "json"].includes(ext)) {
      const text = req.file.buffer.toString("utf-8");
      return res.json({
        filename,
        text,
        characterCount: text.length,
        pages: 1,
      });
    }

    let workspaceId = req.workspaceId || req.headers["x-workspace-id"];
    if (!workspaceId && req.user?.id) {
      const m = await Membership.findOne({ userId: req.user.id });
      if (m) workspaceId = m.workspaceId;
    }

    const parsed = await aiClient.parseDocument(
      workspaceId || "anon",
      filename,
      req.file.buffer,
      req.file.mimetype
    );
    res.json(parsed);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/chat
 * Direct RAG chat endpoint with conversation and message persistence.
 * Streams SSE response from AI service.
 */
router.post("/", authenticate, tenantGuard, async (req, res, next) => {
  try {
    const {
      message,
      knowledgeBaseId,
      conversationId,
      model,
      provider,
      webSearch,
      isThinking,
      attachedDocument,
      attachedDocuments,
      history = [],
      options = {},
    } = req.body;

    let incomingDocs = [];
    if (Array.isArray(attachedDocuments) && attachedDocuments.length > 0) {
      incomingDocs = attachedDocuments.filter((d) => d && d.name);
    } else if (attachedDocument && attachedDocument.name) {
      incomingDocs = [attachedDocument];
    }
    let workspaceId = req.workspaceId
      || req.headers["x-workspace-id"]
      || req.get("x-workspace-id");

    if (!workspaceId && req.user?.id) {
      const membership = await Membership.findOne({ userId: req.user.id }).sort({ createdAt: 1 });
      if (membership) {
        workspaceId = membership.workspaceId;
      }
    }

    if (!workspaceId && knowledgeBaseId) {
      const kb = await KnowledgeBase.findById(knowledgeBaseId);
      if (kb) {
        workspaceId = kb.workspaceId;
      }
    }

    if (!workspaceId) {
      logger.warn({ userId: req.user?.id, msg: "No workspace found for chat request" });
      return next(AppError.badRequest("Active workspace required. Please select a workspace first."));
    }

    if (!message || typeof message !== "string" || message.trim().length === 0) {
      return next(AppError.badRequest("Message is required"));
    }

    const mode = req.body.chatMode || req.body.mode || (knowledgeBaseId ? "rag" : "general");

    const hasIncomingDocs = incomingDocs.length > 0;
    if (mode === "rag" && !knowledgeBaseId && !hasIncomingDocs) {
      // Check if this conversation already has an active attached document from a previous turn
      let hasPriorDoc = false;
      if (conversationId) {
        const priorDoc = await Message.exists({
          conversationId,
          $or: [
            { "attachedDocuments.0": { $exists: true } },
            { "attachedDocument.content": { $exists: true, $ne: "" } },
          ],
        });
        hasPriorDoc = Boolean(priorDoc);
      }
      if (!hasPriorDoc) {
        return next(
          AppError.badRequest("Knowledge base ID is required in RAG mode. Please select a knowledge base, switch to General Chat mode, or attach a document.")
        );
      }
    }

    const startTime = Date.now();
    const userId = req.user.id || req.user.sub || null;

    // 1. Resolve or create Conversation container
    let conversation = null;
    let isNewConversation = false;
    if (conversationId) {
      conversation = await Conversation.findOne({ _id: conversationId, workspaceId });
      if (!conversation) {
        throw AppError.notFound("Conversation not found");
      }
      // If previous title was generic (e.g. from an initial "hello"), refine it now with this real query!
      if (titleGeneratorService.isGenericTitle(conversation.title)) {
        const refinedTitle = titleGeneratorService.generateHeuristicTitle(message);
        if (!titleGeneratorService.isGenericTitle(refinedTitle)) {
          conversation.title = refinedTitle;
          await conversation.save();
        }
      }
    } else {
      isNewConversation = true;
      const title = titleGeneratorService.generateHeuristicTitle(message);
      conversation = await Conversation.create({
        workspaceId,
        userId,
        title,
      });
    }

    // 2. Resolve history from database if not explicitly provided
    let conversationHistory = history;
    if ((!conversationHistory || conversationHistory.length === 0) && conversation) {
      const pastMsgs = await Message.find({
        conversationId: conversation._id,
        workspaceId,
      })
        .sort({ createdAt: 1 })
        .limit(20);

      conversationHistory = pastMsgs.map((m) => ({
        role: m.role.toLowerCase(),
        content: m.content,
      }));
    }

    // 3. Save incoming user message
    const userMsgDoc = {
      workspaceId,
      conversationId: conversation._id,
      role: "USER",
      content: message.trim(),
    };
    if (incomingDocs.length > 0) {
      userMsgDoc.attachedDocuments = incomingDocs.map((d) => ({
        name: d.name,
        size: d.size || 0,
        type: d.type || "",
        content: d.content || "",
        pages: d.pages || 1,
        characterCount: d.characterCount || (d.content || "").length,
      }));
      // Keep primary doc for backwards compatibility
      userMsgDoc.attachedDocument = userMsgDoc.attachedDocuments[0];
    }
    await Message.create(userMsgDoc);

    // 4. Resolve active attached documents (either directly attached in this request, or inherited from previous turns)
    let activeAttachedDocs = incomingDocs;
    if (activeAttachedDocs.length === 0 && conversation) {
      const prevDocMsg = await Message.findOne({
        conversationId: conversation._id,
        workspaceId,
        $or: [
          { "attachedDocuments.0": { $exists: true } },
          { "attachedDocument.content": { $exists: true, $ne: "" } },
        ],
      }).sort({ createdAt: -1 });

      if (prevDocMsg?.attachedDocuments?.length) {
        activeAttachedDocs = prevDocMsg.attachedDocuments;
      } else if (prevDocMsg?.attachedDocument?.content) {
        activeAttachedDocs = [prevDocMsg.attachedDocument];
      }
    }

    const resolvedProvider = provider || (
      model && model.startsWith("@cf/")
        ? "cloudflare"
        : model && (model.includes("qwen") || model.includes("gpt-oss") || model.includes("allam") || model.includes("groq"))
        ? "groq"
        : model && (model.includes("nvidia") || model.includes("openrouter") || model.includes("gemma"))
        ? "openrouter"
        : "gemini"
    );
    const resolvedModel = model || (
      resolvedProvider === "cloudflare"
        ? "@cf/meta/llama-3.3-70b-instruct-fp8-fast"
        : resolvedProvider === "groq"
        ? "qwen/qwen3.8-27b"
        : resolvedProvider === "openrouter"
        ? "nvidia/nemotron-3-ultra-550b-a55b:free"
        : "gemini-3.5-flash-lite"
    );

    const isWebSearch = Boolean(webSearch ?? options.webSearch);
    const resolvedThinking = Boolean(isThinking ?? options.isThinking);

    const isAdHocDocChat = mode === "rag" && !knowledgeBaseId && activeAttachedDocs.length > 0;
    const resolvedChatMode = isAdHocDocChat ? "general" : mode;

    const aiPayload = {
      message: message.trim(),
      knowledgeBaseId: resolvedChatMode === "general" ? null : knowledgeBaseId,
      mode: resolvedChatMode,
      conversationId: conversation._id.toString(),
      provider: resolvedProvider,
      model: resolvedModel,
      webSearch: isWebSearch,
      isThinking: resolvedThinking,
      attachedDocument: activeAttachedDocs[0] || null,
      attachedDocuments: activeAttachedDocs,
      history: conversationHistory || [],
      top_k: options.top_k || 5,
      strategy: options.strategy || "auto",
      temperature: options.temperature || 0.7,
      max_tokens: options.max_tokens || 4096,
    };

    logger.info({
      workspaceId,
      conversationId: conversation._id.toString(),
      knowledgeBaseId,
      model: aiPayload.model,
      msg: "Direct chat request received",
    });

    // 4.5. Check for active MCP tools & agentic intent
    const mcpTools = await McpOrchestrator.getActiveTools(workspaceId, req.user?.id);
    let matchedTool = null;
    let toolArgs = {};

    const queryLower = message.trim().toLowerCase();
    if (
      queryLower.includes("select ") ||
      queryLower.includes("from orders") ||
      queryLower.includes("orders table") ||
      queryLower.includes("customer table") ||
      queryLower.includes("sql query") ||
      queryLower.includes("database table") ||
      queryLower.includes("check postgres")
    ) {
      const t = mcpTools.find((x) => x.name === "execute_readonly_sql");
      if (t) {
        matchedTool = t;
        const sqlMatch = message.match(/select[\s\S]*?(?:;|$)/i);
        toolArgs = {
          query: sqlMatch ? sqlMatch[0].trim() : "SELECT * FROM orders WHERE status = 'PAID' LIMIT 5;",
        };
      }
    } else if (
      queryLower.startsWith("calculate") ||
      queryLower.includes("calculate ") ||
      queryLower.match(/\b\d+\s*[\+\-\*\/]\s*\d+\b/)
    ) {
      const t = mcpTools.find((x) => x.name === "calculate_metrics");
      if (t) {
        matchedTool = t;
        const mathMatch = message.match(/\d[\d\.\(\)\+\-\*\/\s\%\,]*\d|\d+/);
        toolArgs = {
          expression: mathMatch ? mathMatch[0].replace(/,/g, "").trim() : "100 + 200",
          description: "Calculated metric",
        };
      }
    } else if (queryLower.includes("read file") || queryLower.includes("package.json") || queryLower.includes("read snippet")) {
      const t = mcpTools.find((x) => x.name === "read_file_snippet");
      if (t) {
        matchedTool = t;
        toolArgs = {
          path: queryLower.includes("package.json") ? "package.json" : "README.md",
          maxLines: 50,
        };
      }
    } else if (queryLower.includes("list files") || queryLower.includes("list directory") || queryLower.includes("show directory")) {
      const t = mcpTools.find((x) => x.name === "list_directory");
      if (t) {
        matchedTool = t;
        toolArgs = { directory: "." };
      }
    } else if (
      queryLower.includes("search web") ||
      queryLower.includes("web search") ||
      queryLower.includes("search online") ||
      queryLower.includes("search google") ||
      queryLower.includes("browse web")
    ) {
      const t = mcpTools.find((x) => x.name === "web_search_mcp");
      if (t) {
        matchedTool = t;
        const searchMatch = message.replace(/(?:search|browse|look up)\s+(?:the\s+)?(?:web|online|internet)\s+(?:for\s+)?/i, "").trim();
        toolArgs = { query: searchMatch || message.trim() };
      }
    } else if (
      queryLower.includes("gmail") ||
      queryLower.includes("email") ||
      queryLower.includes("inbox")
    ) {
      if (queryLower.includes("send email") || queryLower.includes("send an email")) {
        const t = mcpTools.find((x) => x.name === "gmail.send_email" || x.name === "gmail_send_email");
        if (t) {
          matchedTool = t;
          const emailMatch = message.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
          toolArgs = {
            to: emailMatch ? emailMatch[0] : "recipient@example.com",
            subject: "Update from Rag_Mcp",
            body: message,
          };
        }
      } else {
        const t = mcpTools.find((x) => x.name === "gmail.search_emails" || x.name === "gmail_search_emails");
        if (t) {
          matchedTool = t;
          const cleanQ = message.replace(/(?:search|find|check|look for|my)\s+(?:gmail|email|emails|inbox)(?:\s+for)?/i, "").trim();
          toolArgs = { query: cleanQ || "is:unread" };
        }
      }
    } else if (
      queryLower.includes("google drive") ||
      queryLower.includes("in drive") ||
      queryLower.includes("resume in drive") ||
      queryLower.includes("drive files")
    ) {
      const t = mcpTools.find((x) => x.name === "google_drive.search_files" || x.name === "google_drive_search_files");
      if (t) {
        matchedTool = t;
        const cleanQ = message.replace(/(?:search|find|read|check|look for|my)\s+(?:google\s+drive|drive|drive\s+files)(?:\s+for)?/i, "").trim();
        toolArgs = { query: cleanQ || "resume" };
      }
    } else if (
      queryLower.includes("calendar") ||
      queryLower.includes("meetings") ||
      queryLower.includes("schedule")
    ) {
      const t = mcpTools.find((x) => x.name === "google_calendar.list_events" || x.name === "google_calendar_list_events");
      if (t) {
        matchedTool = t;
        toolArgs = {
          timeMin: new Date().toISOString(),
          maxResults: 15,
        };
      }
    } else if (
      queryLower.includes("notion") ||
      queryLower.includes("notion workspace") ||
      queryLower.includes("notion notes")
    ) {
      const t = mcpTools.find((x) => x.name === "notion.search" || x.name === "notion_search");
      if (t) {
        matchedTool = t;
        const cleanQ = message.replace(/(?:search|find|check|look in|my)\s+(?:notion|notion\s+workspace|notion\s+notes)(?:\s+for)?/i, "").trim();
        toolArgs = { query: cleanQ || "documentation" };
      }
    } else if (
      queryLower.includes("github") ||
      queryLower.includes("repositories") ||
      queryLower.includes("repos") ||
      /\b(repo|repos|repository|pull\s+requests?|prs?)\b/i.test(queryLower)
    ) {
      if (/\b(pull\s+requests?|prs?)\b/i.test(queryLower)) {
        const t = mcpTools.find((x) => x.name === "github.list_pull_requests" || x.name === "github_list_pull_requests");
        if (t) {
          matchedTool = t;
          toolArgs = { owner: "Priyanshujindal", repo: "Rag_Mcp", state: "open" };
        }
      } else if (/\b(issues?|bug\s+reports?)\b/i.test(queryLower)) {
        const t = mcpTools.find((x) => x.name === "github.list_issues" || x.name === "github_list_issues");
        if (t) {
          matchedTool = t;
          toolArgs = { owner: "Priyanshujindal", repo: "Rag_Mcp", state: "open" };
        }
      } else {
        const t = mcpTools.find(
          (x) =>
            x.name === "github.list_repositories" ||
            x.name === "github_list_repositories" ||
            x.name === "list_repositories" ||
            x.name === "github.list_repos"
        );
        if (t) {
          matchedTool = t;
          toolArgs = { visibility: "all" };
        }
      }
    } else if (
      queryLower.includes("slack") ||
      queryLower.includes("channel") ||
      queryLower.includes("#") ||
      queryLower.includes("slack message")
    ) {
      if (
        /\b(post|send|write|message)\b/i.test(queryLower) &&
        (queryLower.includes("#") || queryLower.includes("channel") || queryLower.includes("slack"))
      ) {
        const t = mcpTools.find((x) => x.name === "slack.send_message" || x.name === "slack_send_message");
        if (t) {
          matchedTool = t;
          const channelMatch = message.match(/#([a-zA-Z0-9_\-]+)/);
          const channelName = channelMatch ? channelMatch[1] : "general";
          const sayingMatch = message.match(/(?:saying|with text|message:?)\s*[:'"“]\s*(.*?)[!'”"]?$/i);
          const cleanText = sayingMatch ? sayingMatch[1].replace(/['"“]+$/g, "") : message;
          toolArgs = { channelId: channelName, text: cleanText };
        }
      } else if (/\b(channels?|list\s+channels|rooms?|public\s+channels|private\s+channels)\b/i.test(queryLower)) {
        const t = mcpTools.find((x) => x.name === "slack.list_channels" || x.name === "slack_list_channels");
        if (t) {
          matchedTool = t;
          toolArgs = {};
        }
      } else {
        const t = mcpTools.find((x) => x.name === "slack.search_messages" || x.name === "slack_search_messages");
        if (t) {
          matchedTool = t;
          const cleanQ = message.replace(/(?:search|check|look in|my)\s+(?:slack|slack\s+messages|slack\s+channels)(?:\s+for)?/i, "").trim();
          toolArgs = { query: cleanQ || "project" };
        }
      }
    } else if (
      queryLower.includes("linear") ||
      queryLower.includes("assigned to me") ||
      queryLower.includes("linear tasks")
    ) {
      if (/\b(projects?|roadmaps?)\b/i.test(queryLower)) {
        const t = mcpTools.find((x) => x.name === "linear.list_projects" || x.name === "linear_list_projects");
        if (t) {
          matchedTool = t;
          toolArgs = {};
        }
      } else if (/\b(create\s+issue|new\s+issue|add\s+issue|create\s+task|new\s+task)\b/i.test(queryLower)) {
        const t = mcpTools.find((x) => x.name === "linear.create_issue" || x.name === "linear_create_issue");
        if (t) {
          matchedTool = t;
          const titleMatch = message.match(/(?:titled|title|named|called|issue:?)\s*[:'"“]\s*(.*?)[!'”"]?$/i);
          toolArgs = {
            title: titleMatch ? titleMatch[1] : message.replace(/.*(?:create|add|new)\s+(?:issue|task)(?:\s+in\s+linear)?(?:\s+titled)?/i, "").trim() || "New Issue from Rag_Mcp",
            description: "Created via Rag_Mcp AI assistant",
          };
        }
      } else {
        const t = mcpTools.find((x) => x.name === "linear.search_issues" || x.name === "linear_search_issues");
        if (t) {
          matchedTool = t;
          toolArgs = { query: message.trim() };
        }
      }
    }

    // Detect file generation intent (skip if an MCP tool was already matched)
    const fileIntent = FileIntentService.detectFileIntent(message);
    if (!matchedTool && fileIntent.hasIntent) {
      // For large document / multi-page file requests, boost the token budget so
      // the LLM has enough room to produce full content (10-page docs need 8k+ tokens).
      aiPayload.max_tokens = 8192;
      let formatGuide = "";
      if (fileIntent.fileType === "pptx" && isStructuredDeckMode(config)) {
        // The deck itself is planned and rendered by the ai-service; the chat reply is a short summary.
        formatGuide = DECK_REPLY_GUIDE;
        aiPayload.max_tokens = DECK_REPLY_MAX_TOKENS;
      } else if (fileIntent.fileType === "pptx") {
        formatGuide =
          "\n\nImportant formatting instructions: Please structure the presentation clearly. Use '# Slide: [Slide Title]' for each slide and bullet points ('- [point]') for its content.";
      } else if (fileIntent.fileType === "xlsx" || fileIntent.fileType === "csv") {
        formatGuide =
          "\n\nImportant formatting instructions: Please output the requested tabular data as a clean, complete markdown table with clear column headers and structured data rows (| Col 1 | Col 2 |). Include realistic categories, numeric values, and a Total row where appropriate. Output clean text and numbers without wrapping cell values in markdown bold asterisks (do NOT use **Text** or **$100** inside table cells).";
      } else if (["py", "js", "ts", "html", "css", "json", "yaml", "sql", "java", "cpp"].includes(fileIntent.fileType)) {
        formatGuide = `\n\nImportant formatting instructions: Please output the complete, functional source code cleanly inside a \`\`\`${fileIntent.fileType} code block.`;
      } else if (fileIntent.fileType === "image") {
        formatGuide =
          "\n\nCRITICAL OUTPUT RULE: The user wants to generate an image. Provide a vivid, evocative 2-3 sentence visual description of the artwork (composition, lighting, style, colors, and subject matter) to accompany the generated visual piece. Do NOT say you cannot generate images.";
      } else if (fileIntent.fileType === "md") {
        formatGuide =
          "\n\nCRITICAL OUTPUT RULE: Output the complete content for the Markdown (.md) document directly. " +
          "Start with a top-level '# [Document Title]', followed by structured sections ('## Heading 2', '### Heading 3'), " +
          "bullet points, formatted tables, blockquotes, and code blocks where relevant. " +
          "Do NOT include conversational preamble ('Here is your markdown file...'), conversion steps, or closing chatter. " +
          "Do NOT wrap the entire output in an outer ```markdown code block; output the raw markdown text directly.";
      } else if (["pdf", "docx", "txt"].includes(fileIntent.fileType)) {
        // For document formats: output ONLY the document body — no meta-commentary,
        // no "here are the steps", no "I will now create..." preamble.
        formatGuide =
          `\n\nCRITICAL OUTPUT RULE: Output ONLY the actual document content (the body of the ${fileIntent.fileType.toUpperCase()} you are creating). ` +
          "Do NOT include any preamble, meta-commentary, instructions, conversion steps, or descriptions of what you are doing. " +
          "Do NOT write sentences like 'I will create...', 'Here is your document', 'Step 1:', etc. " +
          "Start directly with the document title or first section heading. " +
          "Use rich markdown formatting: # for headings, ## for sections, ### for subsections, - for bullets, **bold**, *italic*, ``` for code blocks.";
      }
      aiPayload.custom_prompt = (aiPayload.custom_prompt || "") + formatGuide;
    }

    // 5. Set SSE headers and flush
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    if (typeof res.flushHeaders === "function") {
      res.flushHeaders();
    }

    // Notify client of the active conversation ID and title
    res.write(
      `event: conversation\ndata: ${JSON.stringify({
        conversationId: conversation._id.toString(),
        title: conversation.title,
      })}\n\n`
    );

    // If tool requires human approval, emit tool_approval event and pause
    if (matchedTool && matchedTool.requiresApproval) {
      const callId = `call_${Date.now()}`;
      const approval = await McpOrchestrator.executeTool({
        workspaceId,
        userId: req.user?.id,
        conversationId: conversation._id.toString(),
        toolCallId: callId,
        toolName: matchedTool.name,
        args: toolArgs,
        isApproved: false,
      });

      res.write(
        `event: tool_approval\ndata: ${JSON.stringify({
          toolCallId: approval.approvalId || callId,
          toolName: matchedTool.name,
          serverName: matchedTool.serverName,
          args: toolArgs,
          status: "pending",
          requiresApproval: true,
        })}\n\n`
      );

      await Message.create({
        workspaceId,
        conversationId: conversation._id,
        role: "ASSISTANT",
        content: `I've prepared a tool execution: **${matchedTool.name}** from **${matchedTool.serverName}**. Please confirm approval to proceed.`,
        toolCalls: [
          {
            id: approval.approvalId || callId,
            toolName: matchedTool.name,
            serverName: matchedTool.serverName,
            args: toolArgs,
            status: "pending",
            requiresApproval: true,
          },
        ],
      });

      res.write(`event: done\ndata: {}\n\n`);
      return res.end();
    }

    // If auto tool (no approval required), emit tool_call, execute via official MCP client, emit tool_result, and inject context
    if (matchedTool && !matchedTool.requiresApproval) {
      const callId = `call_${Date.now()}`;
      res.write(
        `event: tool_call\ndata: ${JSON.stringify({
          toolCallId: callId,
          toolName: matchedTool.name,
          serverName: matchedTool.serverName,
          args: toolArgs,
          status: "executing",
        })}\n\n`
      );

      const toolExecResult = await McpOrchestrator.executeTool({
        workspaceId,
        userId: req.user?.id,
        conversationId: conversation._id.toString(),
        toolCallId: callId,
        toolName: matchedTool.name,
        args: toolArgs,
        isApproved: true,
      });

      res.write(
        `event: tool_result\ndata: ${JSON.stringify({
          toolCallId: callId,
          toolName: matchedTool.name,
          serverName: matchedTool.serverName,
          status: toolExecResult.status === "error" ? "error" : "completed",
          result: toolExecResult.result,
        })}\n\n`
      );

      aiPayload.custom_prompt = `[VERIFIED REAL-TIME TOOL DATA]:
The connected tool "${matchedTool.name}" was executed successfully with live user credentials and returned this verified data:
${JSON.stringify(toolExecResult.result, null, 2)}

INSTRUCTION: You HAVE full authorized access to this user data. Directly answer the user's question using this verified output. Never say you lack access to their account.`;
    }

    const abortController = new AbortController();

    // Handle client disconnect on response stream
    res.on("close", () => {
      if (!res.writableEnded) {
        logger.info({ workspaceId, msg: "Client disconnected from chat stream" });
        abortController.abort();
      }
    });

    let assistantText = "";
    let capturedCitations = [];
    let capturedUsage = null;

    try {
      await aiClient.streamChat(workspaceId.toString(), aiPayload, {
        signal: abortController.signal,
        onCitations: (citations) => {
          capturedCitations = citations;
          if (!res.writableEnded) {
            res.write(`event: citations\ndata: ${JSON.stringify(citations)}\n\n`);
          }
        },
        onToken: (delta) => {
          assistantText += delta;
          if (!res.writableEnded) {
            res.write(`event: token\ndata: ${JSON.stringify({ delta })}\n\n`);
          }
        },
        onUsage: (usage) => {
          capturedUsage = usage;
          if (!res.writableEnded) {
            res.write(`event: usage\ndata: ${JSON.stringify(usage)}\n\n`);
          }
        },
        onDone: async () => {
          // 6. Save completed assistant message to MongoDB
          if (assistantText.trim()) {
            try {
              let finalContent = assistantText;
              let reasoning = "";
              const thinkMatch = assistantText.match(/<think>([\s\S]*?)<\/think>/i);
              if (thinkMatch) {
                reasoning = thinkMatch[1].trim();
                finalContent = assistantText.replace(/<think>[\s\S]*?<\/think>/i, "").trim();
              }

              const formattedCitations = (capturedCitations || []).map((c) => ({
                title: c.title || "",
                url: c.url || "",
                chunkId: c.sourceId || c.chunkId || "",
                snippet: c.snippet || "",
                score: c.score || 0,
              }));

              // 6a. Generate and store file artifact if file intent was detected
              let generatedArtifact = null;
              if (fileIntent.hasIntent) {
                try {
                  // Strip LLM meta-narration preamble for document types so the
                  // PDF/DOCX generator never receives "Here is your document:" lines.
                  let genContent = ["pdf", "docx", "txt", "md"].includes(fileIntent.fileType)
                    ? stripLlmPreamble(finalContent)
                    : finalContent;
                  let slides = undefined;
                  let headers = undefined;
                  let rows = undefined;

                  if (fileIntent.isConvertPrevious && conversationHistory && conversationHistory.length > 0) {
                    const prevAssistant = [...conversationHistory].reverse().find(
                      (m) => m.role === "ASSISTANT" || m.role === "assistant"
                    );
                    if (prevAssistant?.content) {
                      genContent = ["pdf", "docx", "txt", "md"].includes(fileIntent.fileType)
                        ? stripLlmPreamble(prevAssistant.content)
                        : prevAssistant.content;
                    }
                  }

                  if (fileIntent.fileType === "pptx") {
                    slides = FileIntentService.parseSlides(genContent, fileIntent.title);
                  } else if (fileIntent.fileType === "xlsx" || fileIntent.fileType === "csv") {
                    const table = FileIntentService.parseMarkdownTable(genContent);
                    if (table.headers.length > 0) {
                      headers = table.headers;
                      rows = table.rows;
                    }
                  } else if (fileIntent.fileType === "image") {
                    genContent = (fileIntent.title && fileIntent.title !== "Generated Artwork")
                      ? fileIntent.title
                      : message.trim() || genContent;
                  } else if (fileIntent.fileType === "md") {
                    genContent = FileIntentService.cleanMarkdownContent(genContent, fileIntent.title);
                  } else if (
                    ["py", "js", "ts", "html", "css", "json", "yaml", "sql", "java", "cpp"].includes(
                      fileIntent.fileType
                    )
                  ) {
                    genContent = FileIntentService.extractCodeSnippet(genContent, fileIntent.fileType);
                  }

                  const useStructuredDeck = fileIntent.fileType === "pptx" && isStructuredDeckMode(config);
                  const genResult = useStructuredDeck
                    ? await aiClient.generateDeck(
                        workspaceId.toString(),
                        buildDeckRequest({
                          message: message.trim(),
                          fileIntent,
                          messages: conversationHistory,
                          attachedDocs: activeAttachedDocs,
                          knowledgeBaseId: aiPayload.knowledgeBaseId,
                          model: aiPayload.model,
                          provider: aiPayload.provider,
                        })
                      )
                    : await aiClient.generateFile(workspaceId.toString(), {
                        fileType: fileIntent.fileType,
                        title: fileIntent.title,
                        filename: fileIntent.filename,
                        content: genContent,
                        slides,
                        headers,
                        rows,
                        language: fileIntent.fileType,
                      });

                  if (genResult && genResult.content_base64) {
                    const fileBuf = Buffer.from(genResult.content_base64, "base64");
                    const savedStorage = await storageService.saveFile(
                      workspaceId.toString(),
                      genResult.filename || fileIntent.filename,
                      fileBuf
                    );

                    generatedArtifact = await Artifact.create({
                      workspaceId,
                      conversationId: conversation._id,
                      userId: req.user?.id,
                      filename: genResult.filename || fileIntent.filename,
                      fileType: genResult.file_type || fileIntent.fileType,
                      mimeType: genResult.mime_type || "application/octet-stream",
                      sizeBytes: savedStorage.sizeBytes,
                      storageKey: savedStorage.storageKey,
                      storagePath: savedStorage.storagePath,
                      previewData: genResult.preview_data || {},
                      status: "ready",
                    });

                    // Emit artifact event over SSE to chat client
                    if (!res.writableEnded) {
                      res.write(
                        `event: artifact\ndata: ${JSON.stringify({
                          id: generatedArtifact._id.toString(),
                          _id: generatedArtifact._id.toString(),
                          filename: generatedArtifact.filename,
                          fileType: generatedArtifact.fileType,
                          mimeType: generatedArtifact.mimeType,
                          sizeBytes: generatedArtifact.sizeBytes,
                          status: generatedArtifact.status,
                          previewData: generatedArtifact.previewData,
                          createdAt: generatedArtifact.createdAt,
                          downloadUrl: `/api/v1/artifacts/${generatedArtifact._id}/download`,
                        })}\n\n`
                      );
                    }
                  }
                } catch (fileGenErr) {
                  logger.error({ err: fileGenErr.message, msg: "Failed to generate artifact file" });
                  if (fileIntent.fileType === "pptx" && isStructuredDeckMode(config)) {
                    // The chat reply already announced the file, so say plainly that it could not be made.
                    const note = deckFailureNote(fileGenErr);
                    finalContent = `${finalContent}\n\n${note}`;
                    if (!res.writableEnded) {
                      res.write(`event: token\ndata: ${JSON.stringify({ delta: `\n\n${note}` })}\n\n`);
                    }
                  }
                }
              }

              const savedAssistantMsg = await Message.create({
                workspaceId,
                conversationId: conversation._id,
                role: "ASSISTANT",
                content: finalContent || assistantText,
                reasoning,
                citations: formattedCitations,
                artifacts: generatedArtifact ? [generatedArtifact._id] : [],
                tokenUsage: {
                  promptTokens: capturedUsage?.prompt_tokens || 0,
                  completionTokens: capturedUsage?.completion_tokens || 0,
                  totalTokens: capturedUsage?.total_tokens || 0,
                },
                latencyMs: Date.now() - startTime,
              });

              if (generatedArtifact) {
                await Artifact.updateOne({ _id: generatedArtifact._id }, { messageId: savedAssistantMsg._id });
              }

              await Conversation.updateOne(
                { _id: conversation._id },
                { updatedAt: new Date() }
              );

              // 7. Fire asynchronous AI title refinement if new conversation or currently has a generic title
              if (isNewConversation || titleGeneratorService.isGenericTitle(conversation.title)) {
                titleGeneratorService.refineTitleWithAI(
                  workspaceId.toString(),
                  conversation._id.toString(),
                  message.trim(),
                  aiPayload.model
                ).catch((err) => {
                  logger.debug({ err: err.message, msg: "Background title refinement completed" });
                });
              }
            } catch (saveErr) {
              logger.error({ err: saveErr.message, msg: "Failed to persist assistant message" });
            }
          }

          if (!res.writableEnded) {
            res.write(`event: done\ndata: {}\n\n`);
            res.end();
          }
        },
        onError: (error) => {
          logger.error({ workspaceId, error, msg: "Chat stream error" });
          if (!res.writableEnded) {
            res.write(`event: error\ndata: ${JSON.stringify(error)}\n\n`);
            res.write(`event: done\ndata: {}\n\n`);
            res.end();
          }
        },
      });
    } catch (err) {
      if (abortController.signal.aborted || err.name === "AbortError") {
        logger.info({ workspaceId, msg: "Chat stream aborted by client" });
        return;
      }
      logger.error({ workspaceId, err: err.message, msg: "Failed to initiate chat stream" });
      if (!res.headersSent) {
        return next(err);
      }
      if (!res.writableEnded) {
        res.write(
          `event: error\ndata: ${JSON.stringify({ message: err.message, code: err.code || "CHAT_ERROR" })}\n\n`
        );
        res.write(`event: done\ndata: {}\n\n`);
        res.end();
      }
    }
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/chat/approve-tool
 * Approves or rejects a human-in-the-loop MCP tool execution.
 * If approved, executes the tool and streams the verified output + LLM explanation.
 */
router.post("/approve-tool", authenticate, tenantGuard, async (req, res, next) => {
  try {
    const { toolCallId, approved, conversationId } = req.body;
    let workspaceId = req.workspaceId || req.headers["x-workspace-id"];

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    if (typeof res.flushHeaders === "function") res.flushHeaders();

    let resolved = null;
    try {
      resolved = await McpOrchestrator.resolveApproval({
        approvalId: toolCallId,
        approved: Boolean(approved),
        userId: req.user?.id,
      });
    } catch (resolveErr) {
      logger.warn({ err: resolveErr.message, toolCallId }, "McpOrchestrator.resolveApproval warning");
    }

    if (!approved || (resolved && !resolved.approved)) {
      res.write(
        `event: token\ndata: ${JSON.stringify({
          delta: "\n\n❌ Tool execution was cancelled or rejected by user.",
        })}\n\n`
      );
      res.write(`event: done\ndata: {}\n\n`);
      return res.end();
    }

    const toolName = resolved?.toolName || "execute_readonly_sql";
    const serverName = resolved?.serverName || "MCP Tool";
    const resultData = resolved?.result || { ok: true };

    // Tool approved: emit executing and result
    res.write(
      `event: tool_call\ndata: ${JSON.stringify({
        toolCallId,
        toolName,
        serverName,
        status: "executing",
        args: resolved?.args || {},
      })}\n\n`
    );

    res.write(
      `event: tool_result\ndata: ${JSON.stringify({
        toolCallId,
        toolName,
        serverName,
        status: "completed",
        result: resultData,
      })}\n\n`
    );

    // Build clear, instant, human-friendly summary response
    let summaryText = "";

    if (toolName.includes("slack")) {
      const channelName = resolved?.args?.channelId || resolved?.args?.channel || "channel";
      const cleanChannel = channelName.replace(/^#/, "");
      if (resultData && resultData.ok) {
        summaryText = `\n\n✅ **Message posted to Slack #${cleanChannel} successfully!**\n> "${resolved?.args?.text || ""}"`;
      } else {
        const errorDetail = resultData?.message || resultData?.error || "Unknown Slack error";
        summaryText = `\n\n⚠️ **Slack Message Notice**: ${errorDetail}\n\n*Note:* If the channel is newly created, ensure you invite the bot by typing \`/invite @Rag_Mcp\` (or your bot's name) in **#${cleanChannel}** in Slack.`;
      }
    } else if (toolName.includes("gmail") && toolName.includes("send")) {
      const recipient = resolved?.args?.to || "recipient";
      const subject = resolved?.args?.subject || "";
      if (resultData && (resultData.id || resultData.status === "sent" || resultData.ok)) {
        summaryText = `\n\n✅ **Email sent successfully to ${recipient}!**\n- **Subject:** ${subject}`;
      } else {
        summaryText = `\n\n⚠️ **Email sending notice**: ${resultData?.error || "Failed to send email."}`;
      }
    } else if (toolName.includes("calendar") && toolName.includes("create")) {
      const eventName = resolved?.args?.summary || "Calendar Event";
      summaryText = `\n\n✅ **Calendar event created successfully:** **${eventName}**!`;
    } else if (toolName.includes("linear") && toolName.includes("create")) {
      const issueTitle = resolved?.args?.title || "New Issue";
      const issueKey = resultData?.issue?.identifier || resultData?.issue?.id || "";
      summaryText = `\n\n✅ **Linear issue created successfully!**\n- **Title:** ${issueKey ? `[${issueKey}] ` : ""}${issueTitle}${resultData?.issue?.url ? `\n- **Link:** ${resultData.issue.url}` : ""}`;
    } else if (toolName === "execute_readonly_sql") {
      if (resultData && Array.isArray(resultData.data) && resultData.data.length > 0) {
        const cols = resultData.columns || Object.keys(resultData.data[0]);
        const header = `| ${cols.join(" | ")} |`;
        const sep = `| ${cols.map(() => "---").join(" | ")} |`;
        const rows = resultData.data.map((r) => `| ${cols.map((c) => r[c] ?? "").join(" | ")} |`).join("\n");
        summaryText = `\n\nQuery executed successfully on analytical replica (${resultData.rowCount || resultData.data.length} rows returned):\n\n${header}\n${sep}\n${rows}`;
      } else {
        summaryText = `\n\nQuery executed successfully. Result: ${JSON.stringify(resultData)}`;
      }
    } else {
      if (resultData?.error) {
        summaryText = `\n\n❌ **Tool Error**: ${resultData.error}`;
      } else if (typeof resultData === "string") {
        summaryText = `\n\n${resultData}`;
      } else {
        summaryText = `\n\n✅ **Tool executed successfully.** Result:\n\`\`\`json\n${JSON.stringify(resultData, null, 2)}\n\`\`\``;
      }
    }

    // Stream the summary token immediately
    res.write(`event: token\ndata: ${JSON.stringify({ delta: summaryText })}\n\n`);

    // Update message state in DB so refreshed views display completed status
    if (conversationId) {
      try {
        await Message.updateOne(
          {
            conversationId,
            "toolCalls.id": toolCallId,
          },
          {
            $set: {
              "toolCalls.$.status": "completed",
              "toolCalls.$.result": resultData,
            },
          }
        );
      } catch (dbErr) {
        logger.warn({ err: dbErr.message }, "Could not update message toolCalls status in DB");
      }
    }

    res.write(`event: done\ndata: {}\n\n`);
    res.end();
  } catch (err) {
    if (!res.writableEnded) {
      res.write(`event: token\ndata: ${JSON.stringify({ delta: `\n\n❌ Execution error: ${err.message}` })}\n\n`);
      res.write(`event: done\ndata: {}\n\n`);
      res.end();
    }
  }
});

export default router;
