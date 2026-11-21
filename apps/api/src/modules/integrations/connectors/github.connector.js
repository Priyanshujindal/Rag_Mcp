import { BaseConnector } from "./base.connector.js";
import { getIntegrationById } from "../catalog.js";

/**
 * GitHub Connector handling repositories, files, issues, code search, and PRs.
 * Supports both GitHub OAuth 2.0 and Personal Access Tokens (PAT).
 */
export class GitHubConnector extends BaseConnector {
  constructor() {
    super("github");
    this.catalog = getIntegrationById("github");
  }

  getAuthUrl({ state, redirectUri, scopes }) {
    const clientId = process.env.GITHUB_CLIENT_ID || "mock_github_client_id";
    const selectedScopes = scopes || this.catalog.oauth.defaultScopes;

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: selectedScopes.join(" "),
      state,
    });

    return `https://github.com/login/oauth/authorize?${params.toString()}`;
  }

  async exchangeCode({ code, redirectUri }) {
    const clientId = process.env.GITHUB_CLIENT_ID || "mock_github_client_id";
    const clientSecret = process.env.GITHUB_CLIENT_SECRET || "mock_github_client_secret";

    if (clientId === "mock_github_client_id") {
      return {
        accessToken: `mock_github_token_${Date.now()}`,
        expiresAt: null, // GitHub user tokens don't expire unless GitHub Apps
        accountEmail: "developer@github.com",
        accountDisplayName: "Priyanshujindal",
        providerAccountId: "github_123456",
      };
    }

    const res = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri,
      }),
    });

    if (!res.ok) throw new Error(`GitHub token exchange failed: ${await res.text()}`);
    const data = await res.json();
    if (data.error) throw new Error(`GitHub OAuth error: ${data.error_description || data.error}`);

    // Fetch user profile
    const userRes = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${data.access_token}`,
        "User-Agent": "Rag_Mcp-Platform",
      },
    });
    const user = userRes.ok ? await userRes.json() : {};

    return {
      accessToken: data.access_token,
      expiresAt: null,
      accountEmail: user.email || `${user.login || "user"}@users.noreply.github.com`,
      accountDisplayName: user.login || "GitHub User",
      providerAccountId: String(user.id || ""),
    };
  }

  async refreshToken(refreshToken) {
    return { accessToken: refreshToken, expiresAt: null };
  }

  async executeTool(toolName, args, connection) {
    const token = connection.getAccessToken();

    if (toolName === "list_repositories" || toolName === "github.list_repositories" || toolName === "list_repos" || toolName === "github.list_repos") {
      if (token.startsWith("mock_")) {
        return {
          total: 2,
          repositories: [
            {
              name: "Rag_Mcp",
              fullName: "Priyanshujindal/Rag_Mcp",
              private: false,
              description: "Production-ready Model Context Protocol (MCP) and hybrid RAG AI platform with real-time SSE streaming.",
              stars: 128,
              language: "JavaScript / Python",
              defaultBranch: "main",
              url: "https://github.com/Priyanshujindal/Rag_Mcp",
            },
            {
              name: "agent-evals",
              fullName: "Priyanshujindal/agent-evals",
              private: true,
              description: "Automated benchmarking and evaluation suite for LLM reasoning and function calling.",
              stars: 45,
              language: "Python",
              defaultBranch: "main",
              url: "https://github.com/Priyanshujindal/agent-evals",
            },
          ],
        };
      }

      const res = await fetch("https://api.github.com/user/repos?sort=updated&per_page=20&affiliation=owner,collaborator,organization_member", {
        headers: { Authorization: `Bearer ${token}`, "User-Agent": "Rag_Mcp" },
      });
      if (!res.ok) throw new Error(`GitHub API error: ${await res.text()}`);
      const data = await res.json();
      if (Array.isArray(data)) {
        return {
          total: data.length,
          repositories: data.map((r) => ({
            name: r.name,
            fullName: r.full_name,
            private: r.private,
            description: r.description || "No description provided",
            stars: r.stargazers_count,
            language: r.language || "Unknown",
            defaultBranch: r.default_branch,
            url: r.html_url,
            updatedAt: r.updated_at,
          })),
        };
      }
      return data;
    }

    if (toolName === "get_repository" || toolName === "github.get_repository") {
      const { owner, repo } = args;
      if (token.startsWith("mock_")) {
        return {
          name: repo,
          fullName: `${owner}/${repo}`,
          private: false,
          description: "Repository description from Rag_Mcp",
          stars: 128,
          language: "JavaScript",
          defaultBranch: "main",
          url: `https://github.com/${owner}/${repo}`,
        };
      }
      const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
        headers: { Authorization: `Bearer ${token}`, "User-Agent": "Rag_Mcp" },
      });
      if (!res.ok) throw new Error(`GitHub get repository failed (${res.status}): ${await res.text()}`);
      const r = await res.json();
      return {
        name: r.name,
        fullName: r.full_name,
        private: r.private,
        description: r.description || "No description provided",
        stars: r.stargazers_count,
        language: r.language || "Unknown",
        defaultBranch: r.default_branch,
        url: r.html_url,
        updatedAt: r.updated_at,
      };
    }

    if (toolName === "list_issues" || toolName === "github.list_issues") {
      const { owner, repo, state = "open", perPage = 10 } = args;
      if (token.startsWith("mock_")) {
        return {
          total: 1,
          issues: [
            {
              number: 1,
              title: "Implement MCP Client Protocol",
              state: "open",
              user: "Priyanshujindal",
              url: `https://github.com/${owner}/${repo}/issues/1`,
              createdAt: new Date().toISOString(),
            },
          ],
        };
      }
      const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues?state=${state}&per_page=${perPage}`, {
        headers: { Authorization: `Bearer ${token}`, "User-Agent": "Rag_Mcp" },
      });
      if (!res.ok) throw new Error(`GitHub list issues failed (${res.status}): ${await res.text()}`);
      const data = await res.json();
      return {
        total: (data || []).length,
        issues: (data || []).filter((i) => !i.pull_request).map((i) => ({
          number: i.number,
          title: i.title,
          state: i.state,
          user: i.user?.login,
          url: i.html_url,
          createdAt: i.created_at,
          updatedAt: i.updated_at,
        })),
      };
    }

    if (toolName === "list_pull_requests" || toolName === "github.list_pull_requests" || toolName === "list_prs" || toolName === "github.list_prs") {
      const { owner, repo, state = "open", perPage = 10 } = args;
      if (token.startsWith("mock_")) {
        return {
          total: 1,
          pullRequests: [
            {
              number: 7,
              title: "Feature: Built-in Connected Apps & Integrations Marketplace",
              state: "open",
              user: "Priyanshujindal",
              url: `https://github.com/${owner}/${repo}/pull/7`,
              createdAt: new Date().toISOString(),
            },
          ],
        };
      }
      const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls?state=${state}&per_page=${perPage}`, {
        headers: { Authorization: `Bearer ${token}`, "User-Agent": "Rag_Mcp" },
      });
      if (!res.ok) throw new Error(`GitHub list PRs failed (${res.status}): ${await res.text()}`);
      const data = await res.json();
      return {
        total: (data || []).length,
        pullRequests: (data || []).map((pr) => ({
          number: pr.number,
          title: pr.title,
          state: pr.state,
          user: pr.user?.login,
          url: pr.html_url,
          createdAt: pr.created_at,
          updatedAt: pr.updated_at,
        })),
      };
    }

    if (toolName === "read_file" || toolName === "github.read_file") {
      const { owner, repo, path: filePath } = args;
      if (token.startsWith("mock_")) {
        return {
          owner,
          repo,
          path: filePath,
          content: `# Rag_Mcp\n\nProduction-oriented Model Context Protocol ecosystem.\nFeatures:\n- Stdio & Streamable HTTP transports\n- RAG vector retrieval\n- Connected Apps Marketplace (Google, GitHub, Notion, Slack)`,
          size: 215,
        };
      }

      const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${filePath}`, {
        headers: { Authorization: `Bearer ${token}`, "User-Agent": "Rag_Mcp" },
      });
      if (!res.ok) throw new Error(`GitHub file fetch failed: ${await res.text()}`);
      const data = await res.json();
      const content = Buffer.from(data.content || "", "base64").toString("utf-8");
      return { owner, repo, path: filePath, content, size: data.size };
    }

    if (toolName === "search_code" || toolName === "github.search_code") {
      const query = args.query;
      if (token.startsWith("mock_")) {
        return {
          query,
          totalCount: 1,
          items: [
            {
              name: "mcp.orchestrator.js",
              path: "apps/api/src/modules/mcp/mcp.orchestrator.js",
              repository: "Priyanshujindal/Rag_Mcp",
              snippet: "export class McpOrchestrator { static async getActiveTools(workspaceId) { ... } }",
            },
          ],
        };
      }

      const res = await fetch(`https://api.github.com/search/code?q=${encodeURIComponent(query)}`, {
        headers: { Authorization: `Bearer ${token}`, "User-Agent": "Rag_Mcp" },
      });
      if (!res.ok) throw new Error(`GitHub search code error: ${await res.text()}`);
      return await res.json();
    }

    if (toolName === "create_issue" || toolName === "github.create_issue") {
      const { owner, repo, title, body } = args;
      if (token.startsWith("mock_")) {
        return {
          status: "created",
          issueNumber: 42,
          title,
          url: `https://github.com/${owner}/${repo}/issues/42`,
          createdAt: new Date().toISOString(),
        };
      }

      const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "User-Agent": "Rag_Mcp",
        },
        body: JSON.stringify({ title, body }),
      });
      if (!res.ok) throw new Error(`GitHub create issue failed: ${await res.text()}`);
      return await res.json();
    }

    throw new Error(`Unsupported GitHub tool operation: ${toolName}`);
  }
}
