import { BaseConnector } from "./base.connector.js";
import { getIntegrationById } from "../catalog.js";

/**
 * Notion Connector handling workspace search, pages, and databases.
 * Supports Notion OAuth 2.0 and Internal Integration Secrets.
 */
function extractNotionTitle(page) {
  if (page.properties) {
    for (const key of Object.keys(page.properties)) {
      const prop = page.properties[key];
      if (prop.type === "title" && Array.isArray(prop.title) && prop.title.length > 0) {
        return prop.title.map((t) => t.plain_text).join("");
      }
    }
  }
  if (page.title && Array.isArray(page.title)) {
    return page.title.map((t) => t.plain_text).join("");
  }
  return "Untitled Page";
}

export class NotionConnector extends BaseConnector {
  constructor() {
    super("notion");
    this.catalog = getIntegrationById("notion");
  }

  getAuthUrl({ state, redirectUri }) {
    const clientId = process.env.NOTION_CLIENT_ID || "mock_notion_client_id";
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      owner: "user",
      state,
    });
    return `https://api.notion.com/v1/oauth/authorize?${params.toString()}`;
  }

  async exchangeCode({ code, redirectUri }) {
    const clientId = process.env.NOTION_CLIENT_ID || "mock_notion_client_id";
    const clientSecret = process.env.NOTION_CLIENT_SECRET || "mock_notion_client_secret";

    if (clientId === "mock_notion_client_id") {
      return {
        accessToken: `mock_notion_token_${Date.now()}`,
        expiresAt: null,
        accountEmail: "workspace_owner@notion.so",
        accountDisplayName: "Engineering Workspace",
        providerAccountId: "notion_ws_12345",
      };
    }

    const authHeader = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
    const res = await fetch("https://api.notion.com/v1/oauth/token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${authHeader}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
      }),
    });

    if (!res.ok) throw new Error(`Notion token exchange failed: ${await res.text()}`);
    const data = await res.json();

    return {
      accessToken: data.access_token,
      expiresAt: null,
      accountEmail: data.owner?.user?.person?.email || "workspace@notion.so",
      accountDisplayName: data.workspace_name || "Notion Workspace",
      providerAccountId: data.workspace_id || "",
    };
  }

  async refreshToken(refreshToken) {
    return { accessToken: refreshToken, expiresAt: null };
  }

  async executeTool(toolName, args, connection) {
    const token = connection.getAccessToken();

    if (toolName === "search" || toolName === "notion.search") {
      let rawQuery = (args.query || "").trim();
      // Detect if user or model asked for all pages/notes in natural language
      const isConversational =
        !rawQuery ||
        /^(search\s+(for\s+)?(my\s+)?)?(all|available|recent)?\s*(pages?|notes?|workspace|docs?)?.*$/i.test(rawQuery);

      let effectiveQuery = isConversational ? "" : rawQuery.replace(/^["']|["']$/g, "").trim();

      if (token.startsWith("mock_")) {
        return {
          query: effectiveQuery,
          resultCount: 2,
          results: [
            {
              id: "page_notion_rag_arch",
              object: "page",
              title: "Rag_Mcp Project Documentation & MCP Spec",
              url: "https://notion.so/workspace/rag-mcp-project-docs",
              lastEditedTime: new Date().toISOString(),
              snippet: "This document outlines the hybrid retrieval architecture, Model Context Protocol integration, and connected apps...",
            },
            {
              id: "page_notion_internship_prep",
              object: "page",
              title: "Software Engineering Internship Onboarding & Checklists",
              url: "https://notion.so/workspace/internship-prep",
              lastEditedTime: new Date(Date.now() - 86400000).toISOString(),
              snippet: "Complete technical onboarding: install Node.js 22, configure MongoDB Atlas, review RAG architecture...",
            },
          ],
        };
      }

      const body = {
        page_size: args.pageSize || 10,
      };
      if (effectiveQuery) {
        body.query = effectiveQuery;
      }
      if (args.filter) {
        body.filter = { value: args.filter, property: "object" };
      }

      const res = await fetch("https://api.notion.com/v1/search", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Notion-Version": "2022-06-28",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Notion search failed (${res.status}): ${errText}`);
      }
      const data = await res.json();

      const enrichedResults = (data.results || []).map((item) => ({
        id: item.id,
        object: item.object,
        title: extractNotionTitle(item),
        url: item.url,
        lastEditedTime: item.last_edited_time,
        archived: item.archived,
      }));

      return {
        query: effectiveQuery,
        resultCount: enrichedResults.length,
        results: enrichedResults,
      };
    }

    if (toolName === "get_page" || toolName === "notion.get_page") {
      const pageId = args.pageId;
      if (token.startsWith("mock_")) {
        return {
          id: pageId,
          title: "Rag_Mcp Project Documentation & MCP Spec",
          content: "# Rag_Mcp Project\n\nRag_Mcp provides a unified AI platform integrating RAG with official MCP client and Connected Apps Marketplace.\n\n## Core Components:\n- Apps Marketplace (Google, GitHub, Notion, Slack)\n- Multi-LLM Orchestration (Gemini, OpenRouter, Groq, Cloudflare)\n- Tool approval gates for human-in-the-loop safety.",
          url: "https://notion.so/workspace/rag-mcp-project-docs",
        };
      }

      const res = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
        headers: { Authorization: `Bearer ${token}`, "Notion-Version": "2022-06-28" },
      });
      if (!res.ok) throw new Error(`Notion get page failed: ${await res.text()}`);
      const page = await res.json();

      let textContent = "";
      try {
        const blocksRes = await fetch(`https://api.notion.com/v1/blocks/${pageId}/children?page_size=50`, {
          headers: { Authorization: `Bearer ${token}`, "Notion-Version": "2022-06-28" },
        });
        if (blocksRes.ok) {
          const blocks = await blocksRes.json();
          textContent = (blocks.results || [])
            .map((b) => {
              const type = b.type;
              const rich = b[type]?.rich_text;
              if (Array.isArray(rich)) {
                return rich.map((r) => r.plain_text).join("");
              }
              return "";
            })
            .filter(Boolean)
            .join("\n\n");
        }
      } catch {
        // fallback to metadata only
      }

      return {
        id: page.id,
        title: extractNotionTitle(page),
        url: page.url,
        content: textContent || "No text content found in page body.",
      };
    }

    if (toolName === "create_page" || toolName === "notion.create_page") {
      const { parentPageId, title, content } = args;
      if (token.startsWith("mock_")) {
        return {
          status: "created",
          id: `page_notion_${Date.now()}`,
          title,
          url: `https://notion.so/workspace/page_${Date.now()}`,
          createdTime: new Date().toISOString(),
        };
      }

      const res = await fetch("https://api.notion.com/v1/pages", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Notion-Version": "2022-06-28",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          parent: { page_id: parentPageId },
          properties: {
            title: [{ text: { content: title } }],
          },
          children: [
            {
              object: "block",
              type: "paragraph",
              paragraph: { rich_text: [{ type: "text", text: { content } }] },
            },
          ],
        }),
      });
      if (!res.ok) throw new Error(`Notion create page failed: ${await res.text()}`);
      return await res.json();
    }

    throw new Error(`Unsupported Notion tool operation: ${toolName}`);
  }
}
