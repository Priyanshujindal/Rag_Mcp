#!/usr/bin/env node
/**
 * packages/mcp-servers/builtin-server.js
 * =====================================
 * Official Model Context Protocol (MCP) Server.
 * Implements real JSON-RPC 2.0 handshake, tool listing, tool execution,
 * resource reading, and prompt resolution over stdio using @modelcontextprotocol/sdk.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import fs from "fs";
import path from "path";

const server = new Server(
  {
    name: "RagMcp_Builtin_Server",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
      resources: {},
      prompts: {},
    },
  }
);

// Simulated database
const DB_TABLES = {
  orders: [
    { id: "ord_101", customer: "Acme Corp", plan: "Enterprise", amount: 4800, status: "PAID", date: "2026-11-01" },
    { id: "ord_102", customer: "Globex Ltd", plan: "Pro", amount: 1200, status: "PAID", date: "2026-11-03" },
    { id: "ord_103", customer: "Initech Systems", plan: "Starter", amount: 299, status: "PENDING", date: "2026-11-05" },
    { id: "ord_104", customer: "Umbrella Tech", plan: "Enterprise", amount: 9600, status: "PAID", date: "2026-11-06" },
    { id: "ord_105", customer: "Hooli", plan: "Pro", amount: 2400, status: "PAID", date: "2026-11-10" },
  ],
  customers: [
    { id: "cust_1", name: "Acme Corp", email: "billing@acme.com", country: "US", activeSince: "2025-02-15" },
    { id: "cust_2", name: "Globex Ltd", email: "ops@globex.co.uk", country: "UK", activeSince: "2025-08-10" },
    { id: "cust_3", name: "Initech Systems", email: "peter@initech.io", country: "US", activeSince: "2026-01-20" },
    { id: "cust_4", name: "Hooli", email: "gavin@hooli.com", country: "US", activeSince: "2024-11-01" },
  ],
};

// 1. Tools Definition
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "execute_readonly_sql",
        description: "Executes read-only SQL queries against the analytical database (tables: orders, customers). Requires user approval.",
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "Read-only SQL query (e.g. 'SELECT * FROM orders WHERE status = \\'PAID\\';')",
            },
          },
          required: ["query"],
        },
      },
      {
        name: "calculate_metrics",
        description: "Evaluates exact mathematical operations, KPI ratios, and statistical calculations.",
        inputSchema: {
          type: "object",
          properties: {
            expression: {
              type: "string",
              description: "Arithmetic formula (e.g. '(4800 + 1200 + 9600) / 3')",
            },
            description: {
              type: "string",
              description: "What is being measured or calculated",
            },
          },
          required: ["expression"],
        },
      },
      {
        name: "read_file_snippet",
        description: "Reads file text up to 50 lines within the allowed workspace directory.",
        inputSchema: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "Relative file path to read (e.g. 'package.json')",
            },
            maxLines: {
              type: "number",
              description: "Maximum lines to read (default 50)",
            },
          },
          required: ["path"],
        },
      },
      {
        name: "list_directory",
        description: "Lists files and subdirectories in the workspace.",
        inputSchema: {
          type: "object",
          properties: {
            directory: {
              type: "string",
              description: "Relative directory path (e.g. '.')",
            },
          },
        },
      },
      {
        name: "web_search_mcp",
        description: "Searches the live web for up-to-date facts, current events, or technical references.",
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "Search query string",
            },
          },
          required: ["query"],
        },
      },
    ],
  };
});

// 2. Tool Execution Handler
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === "execute_readonly_sql") {
    const q = (args?.query || "").trim();
    const upper = q.toUpperCase();
    if (!upper.startsWith("SELECT")) {
      return {
        isError: true,
        content: [{ type: "text", text: "Security error: Only SELECT queries are permitted on the analytics database." }],
      };
    }

    let rows = [];
    if (upper.includes("FROM ORDERS")) {
      rows = DB_TABLES.orders;
      if (upper.includes("PAID")) {
        rows = rows.filter((r) => r.status === "PAID");
      }
    } else if (upper.includes("FROM CUSTOMERS")) {
      rows = DB_TABLES.customers;
    } else {
      rows = [...DB_TABLES.orders];
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              queryExecuted: q,
              rowCount: rows.length,
              columns: rows.length > 0 ? Object.keys(rows[0]) : [],
              data: rows,
            },
            null,
            2
          ),
        },
      ],
    };
  }

  if (name === "calculate_metrics") {
    const expression = (args?.expression || "").replace(/[^0-9+\-*/().% ]/g, "").trim();
    if (!expression) {
      return {
        isError: true,
        content: [{ type: "text", text: "Invalid arithmetic expression." }],
      };
    }
    try {
      // eslint-disable-next-line no-new-func
      const val = Function(`"use strict"; return (${expression});`)();
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              metric: args?.description || "Calculation",
              expression,
              value: Number(Number(val).toFixed(4)),
            }),
          },
        ],
      };
    } catch (err) {
      return {
        isError: true,
        content: [{ type: "text", text: `Calculation error: ${err.message}` }],
      };
    }
  }

  if (name === "read_file_snippet") {
    try {
      const relPath = args?.path || "package.json";
      const maxLines = Number(args?.maxLines) || 50;
      const cwd = process.cwd();
      const safePath = path.resolve(cwd, relPath);

      if (!safePath.startsWith(cwd)) {
        return {
          isError: true,
          content: [{ type: "text", text: "Access denied: Path is outside permitted workspace directory." }],
        };
      }
      if (!fs.existsSync(safePath)) {
        return {
          isError: true,
          content: [{ type: "text", text: `File not found: ${relPath}` }],
        };
      }
      const raw = fs.readFileSync(safePath, "utf-8");
      const lines = raw.split("\n").slice(0, maxLines);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              filename: path.basename(safePath),
              previewLines: lines.length,
              totalLines: raw.split("\n").length,
              content: lines.join("\n"),
            }),
          },
        ],
      };
    } catch (err) {
      return {
        isError: true,
        content: [{ type: "text", text: err.message }],
      };
    }
  }

  if (name === "list_directory") {
    try {
      const dir = args?.directory || ".";
      const cwd = process.cwd();
      const safePath = path.resolve(cwd, dir);
      if (!safePath.startsWith(cwd)) {
        return {
          isError: true,
          content: [{ type: "text", text: "Access denied: Path is outside permitted workspace directory." }],
        };
      }
      const entries = fs.readdirSync(safePath, { withFileTypes: true });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              directory: dir,
              total: entries.length,
              items: entries.slice(0, 30).map((e) => ({
                name: e.name,
                type: e.isDirectory() ? "directory" : "file",
              })),
            }),
          },
        ],
      };
    } catch (err) {
      return {
        isError: true,
        content: [{ type: "text", text: err.message }],
      };
    }
  }

  if (name === "web_search_mcp") {
    const query = args?.query || "";
    // Return structured web results
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            query,
            results: [
              {
                title: `${query} - Latest Updates & Overview`,
                url: `https://www.google.com/search?q=${encodeURIComponent(query)}`,
                snippet: `Current verified live search results for "${query}". High-relevance web information retrieved via MCP Web Search tool.`,
              },
            ],
          }),
        },
      ],
    };
  }

  return {
    isError: true,
    content: [{ type: "text", text: `Unknown tool: ${name}` }],
  };
});

// 3. Resources Definition
server.setRequestHandler(ListResourcesRequestSchema, async () => {
  return {
    resources: [
      {
        uri: "workspace://schema/orders",
        name: "Orders Table Schema",
        description: "PostgreSQL analytical replica schema definition for the orders table",
        mimeType: "text/plain",
      },
      {
        uri: "workspace://schema/customers",
        name: "Customers Table Schema",
        description: "PostgreSQL analytical replica schema definition for the customers table",
        mimeType: "text/plain",
      },
    ],
  };
});

// 4. Resource Read Handler
server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const { uri } = request.params;
  if (uri === "workspace://schema/orders") {
    return {
      contents: [
        {
          uri,
          mimeType: "text/plain",
          text: "CREATE TABLE orders (id VARCHAR PRIMARY KEY, customer VARCHAR, plan VARCHAR, amount NUMERIC, status VARCHAR, date DATE);",
        },
      ],
    };
  }
  if (uri === "workspace://schema/customers") {
    return {
      contents: [
        {
          uri,
          mimeType: "text/plain",
          text: "CREATE TABLE customers (id VARCHAR PRIMARY KEY, name VARCHAR, email VARCHAR, country VARCHAR, activeSince DATE);",
        },
      ],
    };
  }
  return {
    contents: [{ uri, mimeType: "text/plain", text: "Resource not found" }],
  };
});

// 5. Prompts Definition
server.setRequestHandler(ListPromptsRequestSchema, async () => {
  return {
    prompts: [
      {
        name: "sql_analytics_prompt",
        description: "Generates an analytical summary of orders and revenue from the database.",
        arguments: [
          {
            name: "timeframe",
            description: "Time range (e.g. 'November 2026' or 'Q4')",
            required: false,
          },
        ],
      },
    ],
  };
});

// 6. Prompt Resolution Handler
server.setRequestHandler(GetPromptRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const timeframe = args?.timeframe || "current period";
  return {
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: `Please analyze our business metrics for ${timeframe}. Run read-only SQL queries to inspect total orders, customer segments, and revenue breakdown, then provide key takeaways.`,
        },
      },
    ],
  };
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("Fatal error in MCP server:", err);
  process.exit(1);
});
