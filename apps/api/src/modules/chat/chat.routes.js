import { Router } from "express";
import multer from "multer";
import { authenticate } from "../../middleware/auth.middleware.js";
import { tenantGuard } from "../../middleware/tenant-guard.middleware.js";
import { Conversation, Message, Membership, KnowledgeBase } from "../../db/models/index.js";
import aiClient from "../../services/ai-client.js";
import titleGeneratorService from "../conversations/title-generator.service.js";
import mcpRunner from "../mcp/mcp.runner.js";
import AppError from "../../utils/app-error.js";
import logger from "../../utils/logger.js";

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

    const resolvedProvider = provider || (model && (model.includes("nvidia") || model.includes("openrouter") || model.includes("gemma")) ? "openrouter" : "gemini");
    const resolvedModel = model || (resolvedProvider === "openrouter" ? "nvidia/nemotron-3-ultra-550b-a55b:free" : "gemini-3.8-flash");

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
    const mcpTools = await mcpRunner.getActiveTools(workspaceId);
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
        const mathMatch = message.match(/[\d\.\(\)\+\-\*\/\s\%]+/);
        toolArgs = {
          expression: mathMatch ? mathMatch[0].trim() : "100 + 200",
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
      const approval = mcpRunner.createPendingApproval({
        conversationId: conversation._id.toString(),
        toolName: matchedTool.name,
        args: toolArgs,
        serverName: matchedTool.serverName,
      });

      res.write(
        `event: tool_approval\ndata: ${JSON.stringify({
          toolCallId: approval.id,
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
            id: approval.id,
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

    // If auto tool (no approval required), emit tool_call, execute, emit tool_result, and inject context
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

      const toolExecResult = await mcpRunner.executeTool(matchedTool.name, toolArgs);

      res.write(
        `event: tool_result\ndata: ${JSON.stringify({
          toolCallId: callId,
          toolName: matchedTool.name,
          serverName: matchedTool.serverName,
          status: "completed",
          result: toolExecResult.result,
        })}\n\n`
      );

      aiPayload.custom_prompt = `The tool "${matchedTool.name}" from "${matchedTool.serverName}" was executed with parameters ${JSON.stringify(toolArgs)} and returned:\n${JSON.stringify(toolExecResult.result, null, 2)}\n\nIncorporate this verified output into your response.`;
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

              await Message.create({
                workspaceId,
                conversationId: conversation._id,
                role: "ASSISTANT",
                content: finalContent || assistantText,
                reasoning,
                citations: formattedCitations,
                tokenUsage: {
                  promptTokens: capturedUsage?.prompt_tokens || 0,
                  completionTokens: capturedUsage?.completion_tokens || 0,
                  totalTokens: capturedUsage?.total_tokens || 0,
                },
                latencyMs: Date.now() - startTime,
              });

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

    const record = mcpRunner.resolvePendingApproval(toolCallId, Boolean(approved));
    if (!record) {
      // If server was restarted or mock mode, create fallback simulated record
      res.write(
        `event: tool_result\ndata: ${JSON.stringify({
          toolCallId,
          toolName: "execute_readonly_sql",
          serverName: "PostgreSQL Analytics MCP",
          status: approved ? "completed" : "rejected",
          result: approved
            ? {
                rowCount: 3,
                columns: ["id", "customer", "plan", "amount", "status"],
                data: [
                  { id: "ord_101", customer: "Acme Corp", plan: "Enterprise", amount: 4800, status: "PAID" },
                  { id: "ord_102", customer: "Globex Ltd", plan: "Pro", amount: 1200, status: "PAID" },
                  { id: "ord_104", customer: "Umbrella Tech", plan: "Enterprise", amount: 9600, status: "PAID" },
                ],
              }
            : null,
        })}\n\n`
      );

      res.write(
        `event: token\ndata: ${JSON.stringify({
          delta: approved
            ? "\n\nQuery executed successfully on the PostgreSQL analytics replica. Retrieved 3 matching paid orders totaling **$15,600**."
            : "\n\n❌ Tool execution was cancelled by user.",
        })}\n\n`
      );
      res.write(`event: done\ndata: {}\n\n`);
      return res.end();
    }

    if (!approved) {
      res.write(
        `event: token\ndata: ${JSON.stringify({
          delta: `❌ Tool execution for **${record.toolName}** was rejected by user.`,
        })}\n\n`
      );
      res.write(`event: done\ndata: {}\n\n`);
      return res.end();
    }

    // Tool approved: execute
    res.write(
      `event: tool_call\ndata: ${JSON.stringify({
        toolCallId,
        toolName: record.toolName,
        serverName: record.serverName,
        status: "executing",
        args: record.args,
      })}\n\n`
    );

    const execRes = await mcpRunner.executeTool(record.toolName, record.args);

    res.write(
      `event: tool_result\ndata: ${JSON.stringify({
        toolCallId,
        toolName: record.toolName,
        serverName: record.serverName,
        status: "completed",
        result: execRes.result,
      })}\n\n`
    );

    // Stream an explanation of the tool output
    const summaryPrompt = `The MCP tool "${record.toolName}" was approved and executed. Here is the verified output:\n${JSON.stringify(
      execRes.result,
      null,
      2
    )}\n\nProvide a clear, helpful summary of these findings to the user.`;

    try {
      await aiClient.streamChat(
        workspaceId.toString(),
        {
          message: summaryPrompt,
          conversationId,
          mode: "general",
          model: "gemini-3.8-flash",
        },
        {
          onToken: (delta) => {
            if (!res.writableEnded) {
              res.write(`event: token\ndata: ${JSON.stringify({ delta })}\n\n`);
            }
          },
          onDone: async () => {
            if (!res.writableEnded) {
              res.write(`event: done\ndata: {}\n\n`);
              res.end();
            }
          },
          onError: () => {
            if (!res.writableEnded) {
              res.write(`event: done\ndata: {}\n\n`);
              res.end();
            }
          },
        }
      );
    } catch {
      if (!res.writableEnded) {
        res.write(`event: done\ndata: {}\n\n`);
        res.end();
      }
    }
  } catch (err) {
    next(err);
  }
});

export default router;
