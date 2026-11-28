/**
 * apps/api/src/modules/mcp/mcp.agent-loop.js
 * ==========================================
 * Multi-Turn Dynamic Agent Tool Execution Engine:
 * - Dynamically evaluates user prompt & conversation against all enabled MCP tools
 * - Uses provider function calling (Gemini & OpenAI) or schema-matching fallback
 * - Dispatches execution through McpOrchestrator to the owning MCP connection
 * - Supports multi-tool execution in a single agent turn (e.g. Calculator + Notion)
 * - Emits real-time SSE events (tool_call, tool_result, tool_approval)
 * - Enforces per-tool permissions and human-in-the-loop approval pauses
 */

import crypto from "crypto";
import { McpOrchestrator } from "./mcp.orchestrator.js";
import { Message } from "../../db/models/index.js";
import logger from "../../utils/logger.js";

/**
 * Runs the dynamic MCP tool calling loop before or during chat response generation.
 * @param {object} params
 * @returns {Promise<{ toolResults: Array, pausedForApproval: boolean, promptContext: string }>}
 */
export async function runAgentToolLoop({
  workspaceId,
  userId,
  conversationId,
  message,
  history = [],
  enabledTools = [],
  res,
  model = "gemini-3.8-flash",
}) {
  if (!enabledTools || enabledTools.length === 0) {
    return { toolResults: [], pausedForApproval: false, promptContext: "" };
  }

  const toolResults = [];
  const MAX_ITERATIONS = 4;
  let currentPromptContext = "";

  // 1. Try LLM-driven tool calling if an API key is available
  const geminiKey = process.env.GEMINI_API_KEY;
  const groqKey = process.env.GROQ_API_KEY;
  const openRouterKey = process.env.OPENROUTER_API_KEY;

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    let plannedToolCalls = [];

    if (geminiKey && (model?.includes("gemini") || !groqKey)) {
      try {
        plannedToolCalls = await planWithGemini({
          apiKey: geminiKey,
          model: model.includes("gemini") ? model : "gemini-2.5-flash",
          message,
          history,
          tools: enabledTools,
          previousResults: toolResults,
        });
      } catch (err) {
        logger.warn({ err: err.message }, "Gemini function-call planning failed, trying fallback");
      }
    } else if (groqKey || openRouterKey) {
      try {
        plannedToolCalls = await planWithOpenAICompatible({
          apiKey: groqKey || openRouterKey,
          baseUrl: groqKey ? "https://api.groq.com/openai/v1" : "https://openrouter.ai/api/v1",
          model: groqKey ? "llama-3.3-70b-versatile" : "openai/gpt-4o-mini",
          message,
          history,
          tools: enabledTools,
          previousResults: toolResults,
        });
      } catch (err) {
        logger.warn({ err: err.message }, "OpenAI-compatible function-call planning failed");
      }
    }

    // Heuristic schema-matcher fallback if LLM returned no tool calls on iteration 0
    if (iteration === 0 && (!plannedToolCalls || plannedToolCalls.length === 0)) {
      plannedToolCalls = heuristicToolMatch(message, enabledTools);
    }

    // If no tool calls planned, we are done with tool execution
    if (!plannedToolCalls || plannedToolCalls.length === 0) {
      break;
    }

    let executedInThisIteration = 0;

    for (const toolCall of plannedToolCalls) {
      const toolName = toolCall.name;
      const toolArgs = toolCall.args || {};

      const matched = enabledTools.find(
        (t) =>
          t.name === toolName ||
          t.originalName === toolName ||
          t.id === toolName ||
          (typeof toolName === "string" && t.id?.endsWith(`:${toolName}`))
      );

      if (!matched || !matched.enabled || matched.permission === "deny") {
        logger.warn({ toolName }, "Planned tool call skipped: tool is not enabled or does not exist");
        continue;
      }

      const callId = `call_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;

      // Check Human-in-the-loop approval requirement
      if (matched.requiresApproval || matched.permission === "always_ask") {
        logger.info({ toolName: matched.name, serverName: matched.serverName }, "Tool requires human approval");

        const approval = await McpOrchestrator.executeTool({
          workspaceId,
          userId,
          conversationId,
          toolCallId: callId,
          toolName: matched.name,
          args: toolArgs,
          isApproved: false,
        });

        if (res && !res.writableEnded) {
          res.write(
            `event: tool_approval\ndata: ${JSON.stringify({
              toolCallId: approval.approvalId || callId,
              toolName: matched.name,
              serverName: matched.serverName,
              args: toolArgs,
              status: "pending",
              requiresApproval: true,
            })}\n\n`
          );

          await Message.create({
            workspaceId,
            conversationId,
            role: "ASSISTANT",
            content: `I've prepared a tool execution: **${matched.name}** from **${matched.serverName}**. Please confirm approval to proceed.`,
            toolCalls: [
              {
                id: approval.approvalId || callId,
                toolName: matched.name,
                serverName: matched.serverName,
                args: toolArgs,
                status: "pending",
                requiresApproval: true,
              },
            ],
          });

          res.write(`event: done\ndata: {}\n\n`);
          res.end();
        }

        return {
          toolResults,
          pausedForApproval: true,
          promptContext: currentPromptContext,
        };
      }

      // Auto execution
      if (res && !res.writableEnded) {
        res.write(
          `event: tool_call\ndata: ${JSON.stringify({
            toolCallId: callId,
            toolName: matched.name,
            serverName: matched.serverName,
            args: toolArgs,
            status: "executing",
          })}\n\n`
        );
      }

      logger.info({ toolName: matched.name, serverName: matched.serverName }, "Executing auto MCP tool");
      const execResult = await McpOrchestrator.executeTool({
        workspaceId,
        userId,
        conversationId,
        toolCallId: callId,
        toolName: matched.name,
        args: toolArgs,
        isApproved: true,
      });

      if (res && !res.writableEnded) {
        res.write(
          `event: tool_result\ndata: ${JSON.stringify({
            toolCallId: callId,
            toolName: matched.name,
            serverName: matched.serverName,
            status: execResult.status === "error" ? "error" : "completed",
            result: execResult.result,
          })}\n\n`
        );
      }

      toolResults.push({
        toolName: matched.name,
        serverName: matched.serverName,
        args: toolArgs,
        result: execResult.result,
        status: execResult.status,
      });

      currentPromptContext += `\n[VERIFIED DATA from ${matched.serverName} / ${matched.name}]:\nInput Arguments: ${JSON.stringify(toolArgs)}\nExecution Output: ${typeof execResult.result === "string" ? execResult.result : JSON.stringify(execResult.result, null, 2)}\n`;

      executedInThisIteration++;
    }

    // If nothing was executed in this turn, stop looping
    if (executedInThisIteration === 0) {
      break;
    }
  }

  let promptContext = "";
  if (toolResults.length > 0) {
    promptContext = `\n\n[VERIFIED REAL-TIME MCP TOOL RESULTS]:
The AI Agent executed the following ${toolResults.length} tool(s) via connected MCP servers:
${currentPromptContext}

INSTRUCTIONS FOR FINAL ANSWER:
1. Directly answer the user's prompt incorporating the verified tool output above.
2. Confirm which actions were completed and state the key values or outcomes clearly.
3. Never claim you lack access to tools or external systems, as the tools were executed successfully.`;
  }

  return {
    toolResults,
    pausedForApproval: false,
    promptContext,
  };
}

/**
 * Plans tool calls using Google Gemini function calling.
 */
async function planWithGemini({ apiKey, model, message, history, tools, previousResults }) {
  const geminiTools = McpOrchestrator.formatToolsForGemini(tools);
  if (!geminiTools) return [];

  // Build simple conversation contents
  const contents = [];

  // Add previous turns
  for (const h of (history || []).slice(-4)) {
    contents.push({
      role: h.role?.toLowerCase() === "user" ? "user" : "model",
      parts: [{ text: h.content || "" }],
    });
  }

  // Add current message
  let currentMsg = message;
  if (previousResults && previousResults.length > 0) {
    currentMsg += `\n\n[Completed Tool Results so far]:\n${JSON.stringify(previousResults, null, 2)}`;
  }
  contents.push({
    role: "user",
    parts: [{ text: currentMsg }],
  });

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "x-goog-api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      contents,
      tools: geminiTools,
      toolConfig: {
        functionCallingConfig: {
          mode: "AUTO",
        },
      },
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    logger.warn({ status: res.status, errText: errText.slice(0, 200) }, "Gemini function call planning API error");
    return [];
  }

  const data = await res.json();
  const candidate = data.candidates?.[0];
  const parts = candidate?.content?.parts || [];

  const toolCalls = [];
  for (const p of parts) {
    if (p.functionCall) {
      toolCalls.push({
        name: p.functionCall.name,
        args: p.functionCall.args || {},
      });
    }
  }

  return toolCalls;
}

/**
 * Plans tool calls using OpenAI-compatible function calling (Groq / OpenRouter).
 */
async function planWithOpenAICompatible({ apiKey, baseUrl, model, message, history, tools, previousResults }) {
  const formattedTools = McpOrchestrator.formatToolsForOpenAI(tools);
  if (!formattedTools || formattedTools.length === 0) return [];

  const messages = [
    { role: "system", content: "You are an intelligent assistant with access to tools. Call the appropriate tools when needed." },
  ];

  for (const h of (history || []).slice(-4)) {
    messages.push({
      role: h.role?.toLowerCase() === "user" ? "user" : "assistant",
      content: h.content || "",
    });
  }

  let userContent = message;
  if (previousResults && previousResults.length > 0) {
    userContent += `\n\n[Completed Tool Results]:\n${JSON.stringify(previousResults, null, 2)}`;
  }
  messages.push({ role: "user", content: userContent });

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages,
      tools: formattedTools,
      tool_choice: "auto",
    }),
  });

  if (!res.ok) {
    return [];
  }

  const data = await res.json();
  const choice = data.choices?.[0];
  const calls = choice?.message?.tool_calls || [];

  return calls.map((c) => ({
    name: c.function?.name,
    args: safeParseJson(c.function?.arguments),
  }));
}

/**
 * Heuristic fallback matching query keywords against tool names and parameter descriptions.
 */
function heuristicToolMatch(message, tools) {
  const q = message.toLowerCase();
  const planned = [];

  for (const t of tools) {
    const tName = t.name.toLowerCase();
    const tOrig = (t.originalName || "").toLowerCase();

    // SQL query
    if ((tOrig === "execute_readonly_sql" || tName.includes("sql")) && (q.includes("select ") || q.includes("from ") || q.includes("sql"))) {
      const sqlMatch = message.match(/select[\s\S]*?(?:;|$)/i);
      planned.push({
        name: t.name,
        args: { query: sqlMatch ? sqlMatch[0].trim() : "SELECT * FROM orders LIMIT 5;" },
      });
      break;
    }

    // Calculator / Math
    if (
      (tOrig === "calculate_metrics" || tName.includes("calc") || tName.includes("add") || tOrig === "add") &&
      (q.includes("calculate") || q.includes("add ") || q.match(/\b\d+\s*[\+\-\*\/]\s*\d+\b/))
    ) {
      const mathMatch = message.match(/\d[\d\.\(\)\+\-\*\/\s\%\,]*\d|\d+/);
      const nums = message.match(/\d+/g);
      const args = t.inputSchema?.properties?.a
        ? { a: nums?.[0] ? Number(nums[0]) : 0, b: nums?.[1] ? Number(nums[1]) : 0 }
        : { expression: mathMatch ? mathMatch[0].replace(/,/g, "").trim() : "100 + 200" };

      planned.push({
        name: t.name,
        args,
      });
      continue;
    }

    // Web Search
    if ((tOrig === "web_search_mcp" || tName.includes("web_search") || tName.includes("search_web")) && (q.includes("search web") || q.includes("search online") || q.includes("google search"))) {
      const cleanQ = message.replace(/(?:search|look up)\s+(?:the\s+)?(?:web|online)\s+(?:for\s+)?/i, "").trim();
      planned.push({
        name: t.name,
        args: { query: cleanQ || message.trim() },
      });
      continue;
    }

    // File inspection
    if ((tOrig === "read_file_snippet" || tName.includes("read_file")) && (q.includes("read file") || q.includes("package.json") || q.includes("readme"))) {
      planned.push({
        name: t.name,
        args: { path: q.includes("package.json") ? "package.json" : "README.md", maxLines: 50 },
      });
      continue;
    }
  }

  return planned;
}

function safeParseJson(str) {
  if (!str) return {};
  if (typeof str === "object") return str;
  try {
    return JSON.parse(str);
  } catch {
    return {};
  }
}
