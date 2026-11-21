import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { validateRemoteMcpUrl } from "../src/utils/ssrf-guard.js";
import { McpClientManager } from "../src/modules/mcp/mcp.client-manager.js";
import { McpOrchestrator } from "../src/modules/mcp/mcp.orchestrator.js";

describe("Model Context Protocol (MCP) Ecosystem Tests", () => {
  describe("Phase 11: Security & SSRF Prevention Guard", () => {
    it("blocks localhost and loopback IP addresses", async () => {
      await expect(validateRemoteMcpUrl("http://localhost:8080/mcp")).rejects.toThrow(/blocked for security/i);
      await expect(validateRemoteMcpUrl("http://127.0.0.1:3000/sse")).rejects.toThrow(/private or reserved/i);
    });

    it("blocks RFC 1918 private IPv4 networks", async () => {
      await expect(validateRemoteMcpUrl("http://10.0.0.1/mcp")).rejects.toThrow(/private or reserved/i);
      await expect(validateRemoteMcpUrl("http://192.168.1.50/mcp")).rejects.toThrow(/private or reserved/i);
      await expect(validateRemoteMcpUrl("http://172.16.0.1/mcp")).rejects.toThrow(/private or reserved/i);
    });

    it("blocks cloud metadata service IP (169.254.169.254)", async () => {
      await expect(validateRemoteMcpUrl("http://169.254.169.254/latest/meta-data")).rejects.toThrow(/private or reserved/i);
    });

    it("blocks forbidden protocols such as file://, gopher://, ftp://", async () => {
      await expect(validateRemoteMcpUrl("file:///etc/passwd")).rejects.toThrow(/Forbidden protocol/i);
      await expect(validateRemoteMcpUrl("ftp://files.example.com/mcp")).rejects.toThrow(/Forbidden protocol/i);
    });

    it("accepts valid public endpoints without private address leakage", async () => {
      // Direct public IP doesn't require DNS resolution in sandboxed offline testing
      const url = "https://93.184.216.34/mcp";
      const validated = await validateRemoteMcpUrl(url);
      expect(validated).toBe("https://93.184.216.34/mcp");
    });
  });

  describe("Phases 2 & 3: Official MCP Client Handshake & Transports", () => {
    const serverConfig = {
      _id: "test_builtin_mcp",
      name: "Builtin Test MCP Server",
      transport: "STDIO",
      command: "node packages/mcp-servers/builtin-server.js",
    };

    afterAll(async () => {
      await McpClientManager.disconnect(serverConfig._id);
    });

    it("successfully connects via official SDK and discovers capabilities", async () => {
      const res = await McpClientManager.connect(serverConfig);
      expect(res.client).toBeDefined();
      expect(Array.isArray(res.tools)).toBe(true);
      expect(res.tools.length).toBeGreaterThanOrEqual(4);

      const toolNames = res.tools.map((t) => t.name);
      expect(toolNames).toContain("calculate_metrics");
      expect(toolNames).toContain("execute_readonly_sql");
      expect(toolNames).toContain("read_file_snippet");
      expect(toolNames).toContain("web_search_mcp");
    });

    it("discovers MCP resources and prompts", async () => {
      const res = await McpClientManager.connect(serverConfig);
      expect(Array.isArray(res.resources)).toBe(true);
      expect(res.resources.length).toBeGreaterThanOrEqual(2);
      expect(res.resources.some((r) => r.uri.includes("orders"))).toBe(true);

      expect(Array.isArray(res.prompts)).toBe(true);
      expect(res.prompts.length).toBeGreaterThanOrEqual(1);
    });

    it("executes a tool using the official JSON-RPC protocol and normalizes output", async () => {
      const result = await McpClientManager.callTool(serverConfig, "calculate_metrics", {
        expression: "(500 * 4) + 120",
        description: "Gross Profit",
      });

      expect(result.isError).toBe(false);
      expect(result.data).toBeDefined();
      expect(result.data.value).toBe(2120);
      expect(result.data.metric).toBe("Gross Profit");
    });

    it("executes read-only SQL tool with safety constraints", async () => {
      const result = await McpClientManager.callTool(serverConfig, "execute_readonly_sql", {
        query: "SELECT * FROM orders WHERE status = 'PAID';",
      });

      expect(result.isError).toBe(false);
      expect(result.data).toBeDefined();
      expect(result.data.queryExecuted).toContain("SELECT");
      expect(Array.isArray(result.data.data)).toBe(true);
      expect(result.data.data.length).toBeGreaterThan(0);
    });

    it("rejects non-SELECT destructive SQL queries at tool level", async () => {
      const result = await McpClientManager.callTool(serverConfig, "execute_readonly_sql", {
        query: "DROP TABLE orders;",
      });

      expect(result.isError).toBe(true);
      expect(result.error).toMatch(/Only SELECT queries are permitted/i);
    });

    it("safely reads file snippets within workspace boundaries", async () => {
      const result = await McpClientManager.callTool(serverConfig, "read_file_snippet", {
        path: "package.json",
        maxLines: 10,
      });

      expect(result.isError).toBe(false);
      expect(result.data.filename).toBe("package.json");
      expect(result.data.content).toContain("name");
    });
  });

  describe("Phases 6 & 8: Dynamic Tool Discovery & Provider Formatting", () => {
    it("formats MCP tools into OpenAI-compatible function calling specifications", () => {
      const sampleTools = [
        {
          name: "calculate_metrics",
          description: "Calculates KPIs",
          inputSchema: {
            type: "object",
            properties: { expression: { type: "string" } },
            required: ["expression"],
          },
        },
      ];

      const formatted = McpOrchestrator.formatToolsForOpenAI(sampleTools);
      expect(formatted).toHaveLength(1);
      expect(formatted[0].type).toBe("function");
      expect(formatted[0].function.name).toBe("calculate_metrics");
      expect(formatted[0].function.parameters.required).toContain("expression");
    });

    it("formats MCP tools into Google Gemini function declarations", () => {
      const sampleTools = [
        {
          name: "web_search_mcp",
          description: "Searches the web",
          inputSchema: {
            type: "object",
            properties: { query: { type: "string" } },
            required: ["query"],
          },
        },
      ];

      const formatted = McpOrchestrator.formatToolsForGemini(sampleTools);
      expect(formatted).toHaveLength(1);
      expect(formatted[0].functionDeclarations).toHaveLength(1);
      expect(formatted[0].functionDeclarations[0].name).toBe("web_search_mcp");
    });
  });
});
