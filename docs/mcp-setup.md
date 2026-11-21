# Model Context Protocol (MCP) Ecosystem in Rag_Mcp

## Overview

Rag_Mcp implements a production-grade, official **Model Context Protocol (MCP)** ecosystem powered by the official `@modelcontextprotocol/sdk` (TypeScript/Node.js). It enables LLMs (Gemini, OpenRouter, Groq, Cloudflare Workers AI) to safely discover, inspect, and execute external tools and access live resources across workspaces.

```
       User Chat Request
               │
               ▼
   Node.js API Gateway (apps/api)
               │
     ┌─────────┴─────────┐
     ▼                   ▼
McpOrchestrator    AI Service / LLM Provider
     │             (Gemini / OpenRouter / Groq / Cloudflare)
     ▼                   │
McpClientManager ◄───────┘
     │ (SSRF Guard & Permission Engine)
     ├───────────────────────────┬───────────────────────────┐
     ▼                           ▼                           ▼
Stdio Transport         Streamable HTTP Transport     SSE Transport
(Local Built-in Server) (Remote Cloud Endpoints)     (Legacy Endpoints)
```

---

## 1. Core Architecture Components

### A. MCP Client Manager (`apps/api/src/modules/mcp/mcp.client-manager.js`)
- Manages client lifecycle connections using the official `@modelcontextprotocol/sdk`.
- Supports three transports:
  - `StreamableHTTPClientTransport`: Modern HTTP streaming for remote MCP servers.
  - `SSEClientTransport`: Server-Sent Events transport.
  - `StdioClientTransport`: Local sandboxed child process spawning with an executable binary whitelist (`node`, `python`, `npx`, `uv`).
- Connection timeout handling (`CONNECT_TIMEOUT_MS = 15000`) and automatic error isolation.
- Discovers capabilities, tools (`listTools`), resources (`listResources`), and prompts (`listPrompts`).
- Normalizes tool results into clean text/JSON summaries for LLM consumption.

### B. SSRF Guard (`apps/api/src/utils/ssrf-guard.js`)
Prevents Server-Side Request Forgery when connecting to remote MCP endpoints:
- Blocks loopback addresses (`127.0.0.0/8`, `::1`).
- Blocks RFC 1918 private IPv4 subnets (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`).
- Blocks link-local & cloud metadata services (`169.254.169.254`).
- Verifies domain names via DNS lookup to ensure resolved IP addresses are strictly public.
- Restricts protocols to `http:` and `https:`.

### C. Built-in MCP Server (`packages/mcp-servers/builtin-server.js`)
Provides immediate, production-ready capabilities out-of-the-box:
- **Tools**:
  - `execute_readonly_sql`: Safe, parameterized read-only queries against SQLite/Postgres schemas (blocks destructive DDL/DML like `DROP`, `DELETE`, `UPDATE`, `INSERT`).
  - `calculate_metrics`: Precise mathematical evaluations for business/financial calculations.
  - `read_file_snippet`: Scoped file inspection with line limit restrictions.
  - `list_directory`: Workspace directory inspection.
  - `web_search_mcp`: Live web search tool query with snippet extraction.
- **Resources**:
  - `workspace://schema/orders`: Schema definitions for order data.
  - `workspace://schema/customers`: Schema definitions for customer data.
- **Prompts**:
  - `sql_analytics_prompt`: Template for business analytics and reporting.

### D. Permission & Policy Engine (`McpOrchestrator` & `McpApproval`)
Every tool has a configurable permission policy:
- `always_ask`: Prompts the user in the UI with a confirmation dialog before executing.
- `auto`: Automatically executes without interrupting the chat stream.
- `deny`: Prohibits the tool from being called.

### E. Execution Audit Log (`McpExecution`)
Every tool execution records an audit log entry in MongoDB:
- Tool Name & Server Name
- Workspace ID & Invoking User ID
- Arguments and Normalized Results
- Execution Duration in milliseconds
- Success / Error status and error details

---

## 2. Using the Built-in MCP Server

The built-in server is automatically provisioned for workspaces upon first query or navigation to the MCP Dashboard.

To launch or test it manually:
```bash
node packages/mcp-servers/builtin-server.js
```

---

## 3. Managing Servers via Web UI

Navigate to **Dashboard -> MCP Ecosystem** (`/dashboard/mcp`):
1. **Server Overview**: View active servers, status pills (`Connected`, `Error`, `Connecting`, `Disconnected`), transport badges, and discovered tool counts.
2. **Add Server Dialog**:
   - Provide a Name and Description.
   - Choose Transport: `STREAMABLE_HTTP`, `SSE`, or `STDIO`.
   - Enter Remote URL (with optional Bearer Token or Custom Headers) or Local Command & Args.
3. **Live Diagnostics**:
   - Click **Test Connection** on any server card to perform an immediate roundtrip handshake and capability probe.
4. **Tool Inspector & Permission Control**:
   - Expand any server card to inspect its discovered tools and JSON schemas.
   - Toggle individual tools on/off.
   - Switch permissions between **Required Approval** (Human-in-the-loop) and **Auto**.
5. **Execution Audit History**:
   - Switch to the **Execution Audit History** tab to view historical tool invocations, execution durations, and payloads.

---

## 4. End-to-End Chat Tool Calling Workflow

1. **User asks a question** in chat (e.g., *"Calculate (4800 + 1200 + 9600) / 3"* or *"Query the orders table for paid status"*).
2. `McpOrchestrator` checks available tools and determines policy.
3. **Approval Required Flow**:
   - The server streams `event: tool_approval` over SSE.
   - A modern `McpToolCallCard` renders in the UI showing the pending tool name, server, and parameters.
   - The user clicks **Approve & Run Tool** (or **Reject**).
   - Upon approval, `/api/v1/chat/approve-tool` executes the tool via the official MCP client, captures output, and streams the verified AI interpretation.
4. **Auto-Approved Flow**:
   - The server streams `event: tool_call`, executes via official MCP client, streams `event: tool_result`, and incorporates verified tool output directly into the streaming answer.
