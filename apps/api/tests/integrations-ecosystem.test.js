import { describe, it, expect, vi, beforeEach } from "vitest";
import { INTEGRATIONS_CATALOG, getIntegrationById } from "../src/modules/integrations/catalog.js";
import { encryptToken, decryptToken } from "../src/utils/encryption.js";
import { IntegrationConnection } from "../src/db/models/integration-connection.model.js";
import { getConnector } from "../src/modules/integrations/connectors/index.js";
import { IntegrationsAdapter } from "../src/modules/integrations/integrations.adapter.js";
import { McpOrchestrator } from "../src/modules/mcp/mcp.orchestrator.js";

describe("Connected Apps & Integrations Ecosystem", () => {
  // -------------------------------------------------------------------------
  // 1. Catalog & Connector Definitions
  // -------------------------------------------------------------------------
  describe("Catalog & Connector Specifications", () => {
    it("defines all core Tier 1 and Tier 2 integrations", () => {
      const ids = INTEGRATIONS_CATALOG.map((c) => c.id);
      expect(ids).toContain("gmail");
      expect(ids).toContain("google_drive");
      expect(ids).toContain("google_calendar");
      expect(ids).toContain("notion");
      expect(ids).toContain("github");
      expect(ids).toContain("slack");
      expect(ids).toContain("linear");
    });

    it("verifies every integration has valid metadata, capabilities, and tools", () => {
      for (const item of INTEGRATIONS_CATALOG) {
        expect(item.id).toBeDefined();
        expect(item.name).toBeDefined();
        expect(item.category).toBeDefined();
        expect(item.description).toBeDefined();
        expect(Array.isArray(item.capabilities)).toBe(true);
        expect(Array.isArray(item.tools)).toBe(true);

        for (const tool of item.tools) {
          expect(tool.name).toBeDefined();
          expect(tool.fullName).toContain(item.id);
          expect(tool.description).toBeDefined();
          expect(tool.inputSchema).toBeDefined();
          expect(typeof tool.writeOperation).toBe("boolean");
        }
      }
    });

    it("retrieves integration details by ID", () => {
      const gmail = getIntegrationById("gmail");
      expect(gmail).toBeDefined();
      expect(gmail.name).toBe("Gmail");
      expect(gmail.oauth.authUrl).toContain("accounts.google.com");
    });
  });

  // -------------------------------------------------------------------------
  // 2. AES-256-GCM Token Encryption at Rest
  // -------------------------------------------------------------------------
  describe("Security & Token Encryption at Rest (AES-256-GCM)", () => {
    it("encrypts and decrypts OAuth tokens successfully", () => {
      const secretToken = "ya29.a0AfH6SMD_very_secret_oauth_bearer_token_123456";
      const encrypted = encryptToken(secretToken);

      expect(encrypted).not.toEqual(secretToken);
      expect(encrypted).toContain(":"); // iv:authTag:ciphertext format

      const decrypted = decryptToken(encrypted);
      expect(decrypted).toEqual(secretToken);
    });

    it("uses unique initialization vectors for every encryption call", () => {
      const token = "ghp_static_token_value_abc123";
      const enc1 = encryptToken(token);
      const enc2 = encryptToken(token);

      expect(enc1).not.toEqual(enc2);
      expect(decryptToken(enc1)).toEqual(token);
      expect(decryptToken(enc2)).toEqual(token);
    });

    it("model methods mask credentials on serialization to JSON", () => {
      const conn = new IntegrationConnection({
        workspaceId: "65f000000000000000000001",
        userId: "65f000000000000000000002",
        integrationId: "gmail",
        accountDisplayName: "Work Gmail",
        accountEmail: "user@work.com",
      });

      conn.setTokens({
        accessToken: "secret_access_token",
        refreshToken: "secret_refresh_token",
      });

      expect(conn.getAccessToken()).toBe("secret_access_token");
      expect(conn.getRefreshToken()).toBe("secret_refresh_token");

      const json = conn.toJSON();
      expect(json.encryptedAccessToken).toBeUndefined();
      expect(json.encryptedRefreshToken).toBeUndefined();
      expect(json.hasAccessToken).toBe(true);
      expect(json.hasRefreshToken).toBe(true);
      expect(json.accountEmail).toBe("user@work.com");
    });
  });

  // -------------------------------------------------------------------------
  // 3. OAuth URL Construction & Connectors
  // -------------------------------------------------------------------------
  describe("OAuth URL & State Generation", () => {
    it("builds valid Google OAuth authorization URL with required scopes", () => {
      const conn = getConnector("gmail");
      const url = conn.getAuthUrl({
        state: "state_12345",
        redirectUri: "http://localhost:8000/api/v1/integrations/gmail/callback",
      });

      expect(url).toContain("https://accounts.google.com/o/oauth2/v2/auth");
      expect(url).toContain("state_12345");
      expect(url).toContain("access_type=offline");
      expect(url).toContain("gmail.readonly");
    });

    it("builds valid GitHub OAuth authorization URL", () => {
      const conn = getConnector("github");
      const url = conn.getAuthUrl({
        state: "github_state_789",
        redirectUri: "http://localhost:8000/api/v1/integrations/github/callback",
      });

      expect(url).toContain("https://github.com/login/oauth/authorize");
      expect(url).toContain("github_state_789");
      expect(url).toContain("scope=repo");
    });

    it("builds valid Notion and Slack authorization URLs", () => {
      const notion = getConnector("notion");
      const notionUrl = notion.getAuthUrl({
        state: "notion_state",
        redirectUri: "http://localhost:8000/api/v1/integrations/notion/callback",
      });
      expect(notionUrl).toContain("https://api.notion.com/v1/oauth/authorize");

      const slack = getConnector("slack");
      const slackUrl = slack.getAuthUrl({
        state: "slack_state",
        redirectUri: "http://localhost:8000/api/v1/integrations/slack/callback",
      });
      expect(slackUrl).toContain("https://slack.com/oauth/v2/authorize");
    });
  });

  // -------------------------------------------------------------------------
  // 4. Connector Tool Execution
  // -------------------------------------------------------------------------
  describe("Connector Tool Execution & Operations", () => {
    const mockConn = {
      getAccessToken: () => "mock_token_test_123",
      accountEmail: "developer@rag-mcp.ai",
      accountDisplayName: "Rag_Mcp Dev",
    };

    it("executes Gmail email search tool", async () => {
      const connector = getConnector("gmail");
      const res = await connector.executeTool(
        "gmail.search_emails",
        { query: "subject:internship" },
        mockConn
      );

      expect(res.messages).toBeDefined();
      expect(res.messages.length).toBeGreaterThan(0);
      expect(res.messages[0].subject).toContain("Internship");
    });

    it("executes Gmail read email details tool", async () => {
      const connector = getConnector("gmail");
      const res = await connector.executeTool(
        "gmail.get_email",
        { messageId: "msg_12345" },
        mockConn
      );

      expect(res.id).toBe("msg_12345");
      expect(res.body).toContain("onboarding documentation");
      expect(res.hasAttachments).toBe(true);
    });

    it("executes Google Drive search files tool", async () => {
      const connector = getConnector("google_drive");
      const res = await connector.executeTool(
        "google_drive.search_files",
        { query: "resume" },
        mockConn
      );

      expect(res.files).toBeDefined();
      expect(res.files.some((f) => f.name.includes("Resume"))).toBe(true);
    });

    it("executes Google Drive read file content tool", async () => {
      const connector = getConnector("google_drive");
      const res = await connector.executeTool(
        "google_drive.read_file_content",
        { fileId: "file_drive_01" },
        mockConn
      );

      expect(res.content).toContain("PRIYANSHU JINDAL");
      expect(res.content).toContain("Rag_Mcp");
    });

    it("executes GitHub list repositories tool", async () => {
      const connector = getConnector("github");
      const res = await connector.executeTool(
        "github.list_repositories",
        { visibility: "all" },
        mockConn
      );

      expect(res.repositories).toBeDefined();
      expect(res.repositories.some((r) => r.name === "Rag_Mcp")).toBe(true);
    });

    it("executes GitHub read repository file tool", async () => {
      const connector = getConnector("github");
      const res = await connector.executeTool(
        "github.read_file",
        { owner: "Priyanshujindal", repo: "Rag_Mcp", path: "README.md" },
        mockConn
      );

      expect(res.content).toContain("Rag_Mcp");
      expect(res.content).toContain("Model Context Protocol");
    });

    it("executes Notion search workspace tool", async () => {
      const connector = getConnector("notion");
      const res = await connector.executeTool(
        "notion.search",
        { query: "documentation" },
        mockConn
      );

      expect(res.results).toBeDefined();
      expect(res.results.some((p) => p.title.includes("Rag_Mcp"))).toBe(true);
    });

    it("executes Slack search messages tool", async () => {
      const connector = getConnector("slack");
      const res = await connector.executeTool(
        "slack.search_messages",
        { query: "marketplace" },
        mockConn
      );

      expect(res.messages).toBeDefined();
      expect(res.messages[0].channel).toBe("#general-dev");
      expect(res.messages[0].text).toContain("Connected Apps Marketplace");
    });

    it("executes Linear search issues tool", async () => {
      const connector = getConnector("linear");
      const res = await connector.executeTool(
        "linear.search_issues",
        { query: "Marketplace" },
        mockConn
      );

      expect(res.issues).toBeDefined();
      expect(res.issues.some((i) => i.id === "LIN-101")).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // 5. Unified MCP Tool Orchestrator Integration
  // -------------------------------------------------------------------------
  describe("Unified MCP Orchestrator & Permissions", () => {
    it("formats app tools into OpenAI and Gemini function schemas", () => {
      const tools = [
        {
          name: "gmail.search_emails",
          description: "Search emails",
          inputSchema: {
            type: "object",
            properties: { query: { type: "string" } },
            required: ["query"],
          },
        },
      ];

      const openAiFormat = McpOrchestrator.formatToolsForOpenAI(tools);
      expect(openAiFormat[0].type).toBe("function");
      expect(openAiFormat[0].function.name).toBe("gmail.search_emails");

      const geminiFormat = McpOrchestrator.formatToolsForGemini(tools);
      expect(geminiFormat[0].functionDeclarations[0].name).toBe("gmail.search_emails");
    });
  });
});
