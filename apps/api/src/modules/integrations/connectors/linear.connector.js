import { BaseConnector } from "./base.connector.js";
import { getIntegrationById } from "../catalog.js";

/**
 * Linear Connector handling project roadmaps and issue tracking.
 * Supports Linear OAuth 2.0 and API keys.
 */
export class LinearConnector extends BaseConnector {
  constructor() {
    super("linear");
    this.catalog = getIntegrationById("linear");
  }

  getAuthUrl({ state, redirectUri, scopes }) {
    const clientId = process.env.LINEAR_CLIENT_ID || "mock_linear_client_id";
    const selectedScopes = scopes || this.catalog.oauth.defaultScopes;
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: selectedScopes.join(","),
      state,
    });
    return `https://linear.app/oauth/authorize?${params.toString()}`;
  }

  async exchangeCode({ code, redirectUri }) {
    const clientId = process.env.LINEAR_CLIENT_ID || "mock_linear_client_id";
    const clientSecret = process.env.LINEAR_CLIENT_SECRET || "mock_linear_client_secret";

    if (clientId === "mock_linear_client_id") {
      return {
        accessToken: `mock_linear_token_${Date.now()}`,
        expiresAt: null,
        accountEmail: "lead@linear.app",
        accountDisplayName: "Engineering Linear Workspace",
        providerAccountId: "linear_ws_01",
      };
    }

    const res = await fetch("https://api.linear.app/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });

    if (!res.ok) throw new Error(`Linear OAuth exchange failed: ${await res.text()}`);
    const data = await res.json();

    return {
      accessToken: data.access_token,
      expiresAt: null,
      accountEmail: "linear_user@company.com",
      accountDisplayName: "Linear Workspace",
      providerAccountId: "linear_org",
    };
  }

  async refreshToken(refreshToken) {
    return { accessToken: refreshToken, expiresAt: null };
  }

  async executeTool(toolName, args = {}, connection) {
    const token = connection.getAccessToken();
    const authHeader = token.startsWith("lin_api_") ? token : `Bearer ${token}`;

    if (toolName === "search_issues" || toolName === "linear.search_issues") {
      let query = (args.query || "").trim();
      // Clean conversational phrases
      query = query
        .replace(/^(?:search|find|list|show|check|look for|my)\s+(?:linear\s+issues?|linear\s+tasks?|issues?|tasks?)(?:\s+for)?/i, "")
        .trim();

      if (token.startsWith("mock_")) {
        return {
          query: query || "all",
          totalFound: 2,
          issues: [
            {
              id: "LIN-101",
              title: "Implement Connected Apps Marketplace UI and OAuth flows",
              state: "In Progress",
              priority: 1,
              assignee: "Priyanshu Jindal",
              url: "https://linear.app/team/issue/LIN-101",
            },
            {
              id: "LIN-102",
              title: "Add Google Drive, Notion, and Linear MCP tool adapters",
              state: "Completed",
              priority: 2,
              assignee: "Priyanshu Jindal",
              url: "https://linear.app/team/issue/LIN-102",
            },
          ],
        };
      }

      // Modern Linear GraphQL query using `issues` (issueSearch is deprecated)
      const graphqlQuery = `
        query GetIssues($filter: IssueFilter) {
          issues(filter: $filter, first: 15, orderBy: updatedAt) {
            nodes {
              id
              identifier
              title
              url
              state {
                name
              }
              priority
              assignee {
                name
              }
            }
          }
        }
      `;

      const variables =
        query && query !== "all"
          ? { filter: { title: { containsIgnoreCase: query } } }
          : {};

      const res = await fetch("https://api.linear.app/graphql", {
        method: "POST",
        headers: {
          Authorization: authHeader,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query: graphqlQuery, variables }),
        signal: AbortSignal.timeout(8000),
      });

      if (!res.ok) throw new Error(`Linear API error: ${await res.text()}`);
      const data = await res.json();
      if (data.errors && data.errors.length > 0) {
        throw new Error(`Linear GraphQL error: ${data.errors[0].message}`);
      }

      const nodes = data?.data?.issues?.nodes || [];
      return {
        query: query || "all",
        totalFound: nodes.length,
        issues: nodes.map((n) => ({
          id: n.identifier || n.id,
          title: n.title,
          state: n.state?.name || "Unknown",
          priority: n.priority || 0,
          assignee: n.assignee?.name || "Unassigned",
          url: n.url,
        })),
      };
    }

    if (toolName === "list_projects" || toolName === "linear.list_projects") {
      if (token.startsWith("mock_")) {
        return {
          total: 2,
          projects: [
            { id: "proj_01", name: "Rag_Mcp Core 2.0", state: "started", progress: 0.85, url: "https://linear.app" },
            { id: "proj_02", name: "Connected Apps Ecosystem", state: "started", progress: 0.95, url: "https://linear.app" },
          ],
        };
      }

      const listProjectsQuery = `
        query ListProjects {
          projects(first: 15) {
            nodes {
              id
              name
              state
              progress
              url
            }
          }
        }
      `;

      const res = await fetch("https://api.linear.app/graphql", {
        method: "POST",
        headers: {
          Authorization: authHeader,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query: listProjectsQuery }),
        signal: AbortSignal.timeout(8000),
      });

      if (!res.ok) throw new Error(`Linear API error: ${await res.text()}`);
      const data = await res.json();
      if (data.errors && data.errors.length > 0) {
        throw new Error(`Linear GraphQL error: ${data.errors[0].message}`);
      }

      const nodes = data?.data?.projects?.nodes || [];
      return {
        total: nodes.length,
        projects: nodes.map((p) => ({
          id: p.id,
          name: p.name,
          state: p.state || "unknown",
          progress: p.progress || 0,
          url: p.url,
        })),
      };
    }

    if (toolName === "create_issue" || toolName === "linear.create_issue") {
      const title = args.title || "New Issue from Rag_Mcp";
      const description = args.description || "";
      let teamId = args.teamId;

      if (token.startsWith("mock_")) {
        return {
          success: true,
          issue: {
            id: `LIN-${Math.floor(100 + Math.random() * 900)}`,
            title,
            url: "https://linear.app/team/issue/LIN-new",
          },
        };
      }

      // If teamId not provided, auto-resolve first team
      if (!teamId) {
        const teamQuery = `query GetFirstTeam { teams(first: 1) { nodes { id name key } } }`;
        const teamRes = await fetch("https://api.linear.app/graphql", {
          method: "POST",
          headers: { Authorization: authHeader, "Content-Type": "application/json" },
          body: JSON.stringify({ query: teamQuery }),
          signal: AbortSignal.timeout(5000),
        });
        if (teamRes.ok) {
          const teamData = await teamRes.json();
          teamId = teamData?.data?.teams?.nodes?.[0]?.id;
        }
      }

      if (!teamId) throw new Error("Could not find a Linear team to create the issue in. Please provide teamId.");

      const createMutation = `
        mutation CreateIssue($input: IssueCreateInput!) {
          issueCreate(input: $input) {
            success
            issue {
              id
              identifier
              title
              url
            }
          }
        }
      `;

      const input = {
        title,
        teamId,
        description,
        ...(args.priority !== undefined && { priority: Number(args.priority) }),
      };

      const res = await fetch("https://api.linear.app/graphql", {
        method: "POST",
        headers: { Authorization: authHeader, "Content-Type": "application/json" },
        body: JSON.stringify({ query: createMutation, variables: { input } }),
        signal: AbortSignal.timeout(8000),
      });

      if (!res.ok) throw new Error(`Linear API error: ${await res.text()}`);
      const data = await res.json();
      if (data.errors && data.errors.length > 0) {
        throw new Error(`Linear GraphQL error: ${data.errors[0].message}`);
      }

      return {
        success: data?.data?.issueCreate?.success || true,
        issue: data?.data?.issueCreate?.issue,
      };
    }

    throw new Error(`Unsupported Linear tool operation: ${toolName}`);
  }
}
