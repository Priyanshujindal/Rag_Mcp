import { BaseConnector } from "./base.connector.js";
import { getIntegrationById } from "../catalog.js";

/**
 * Slack Connector handling channel messaging, discussion search, and history.
 * Supports Slack OAuth 2.0 and Bot User OAuth Tokens.
 */
export class SlackConnector extends BaseConnector {
  constructor() {
    super("slack");
    this.catalog = getIntegrationById("slack");
  }

  getAuthUrl({ state, redirectUri, scopes }) {
    const clientId = process.env.SLACK_CLIENT_ID || "mock_slack_client_id";
    const selectedScopes = scopes || this.catalog.oauth.defaultScopes;
    const params = new URLSearchParams({
      client_id: clientId,
      user_scope: selectedScopes.join(","),
      redirect_uri: redirectUri,
      state,
    });
    return `https://slack.com/oauth/v2/authorize?${params.toString()}`;
  }

  async exchangeCode({ code, redirectUri }) {
    const clientId = process.env.SLACK_CLIENT_ID || "mock_slack_client_id";
    const clientSecret = process.env.SLACK_CLIENT_SECRET || "mock_slack_client_secret";

    if (clientId === "mock_slack_client_id") {
      return {
        accessToken: `mock_slack_token_${Date.now()}`,
        expiresAt: null,
        accountEmail: "team@slack.com",
        accountDisplayName: "Engineering Slack Workspace",
        providerAccountId: "T01234567",
      };
    }

    const res = await fetch("https://slack.com/api/oauth.v2.access", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri,
      }),
    });

    if (!res.ok) throw new Error(`Slack OAuth failed: ${await res.text()}`);
    const data = await res.json();
    if (!data.ok) throw new Error(`Slack OAuth error: ${data.error}`);

    return {
      accessToken: data.authed_user?.access_token || data.access_token,
      expiresAt: null,
      accountEmail: "slack_user@company.com",
      accountDisplayName: data.team?.name || "Slack Team",
      providerAccountId: data.team?.id || "",
    };
  }

  async refreshToken(refreshToken) {
    return { accessToken: refreshToken, expiresAt: null };
  }

  async executeTool(toolName, args, connection) {
    const token = connection.getAccessToken();

    if (toolName === "search_messages" || toolName === "slack.search_messages") {
      const query = args.query || "";
      if (token.startsWith("mock_")) {
        return {
          query,
          messages: [
            {
              channel: "#general-dev",
              username: "priyanshu",
              text: "Hey team, the new Connected Apps Marketplace for Rag_Mcp is now running smoothly with OAuth support for Google, GitHub, and Notion!",
              timestamp: new Date().toISOString(),
              permalink: "https://rag-mcp.slack.com/archives/C0123/p123456",
            },
          ],
        };
      }

      // If user token (xoxp-), attempt standard search.messages
      if (!token.startsWith("xoxb-")) {
        const res = await fetch(`https://slack.com/api/search.messages?query=${encodeURIComponent(query)}&count=${args.count || 10}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const data = await res.json();
          if (data.ok) return data;
        }
      }

      // For bot tokens (xoxb-), fetch channels and search conversation history
      const chanRes = await fetch("https://slack.com/api/conversations.list?types=public_channel,private_channel&limit=10", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (chanRes.ok) {
        const chanData = await chanRes.json();
        if (chanData.ok && Array.isArray(chanData.channels)) {
          const messagesFound = [];
          for (const ch of chanData.channels.slice(0, 5)) {
            try {
              const histRes = await fetch(`https://slack.com/api/conversations.history?channel=${ch.id}&limit=10`, {
                headers: { Authorization: `Bearer ${token}` },
              });
              if (histRes.ok) {
                const histData = await histRes.json();
                if (histData.ok && Array.isArray(histData.messages)) {
                  histData.messages.forEach((m) => {
                    if (!query || m.text?.toLowerCase().includes(query.toLowerCase())) {
                      messagesFound.push({
                        channel: `#${ch.name}`,
                        channelId: ch.id,
                        user: m.user,
                        text: m.text,
                        ts: m.ts,
                      });
                    }
                  });
                }
              }
            } catch {
              // continue
            }
          }
          return {
            query,
            totalFound: messagesFound.length,
            messages: messagesFound,
          };
        }
      }

      return { query, messages: [] };
    }

    if (toolName === "send_message" || toolName === "slack.send_message") {
      let targetChannel = (args.channelId || args.channel || "general").replace(/^#/, "").trim();
      const text = args.text || "";

      if (token.startsWith("mock_")) {
        return {
          ok: true,
          channel: targetChannel,
          ts: String(Date.now() / 1000),
          message: { text, user: "U12345" },
        };
      }

      // If channel is a name (e.g. "new-channel") rather than a Slack ID ("C0123..."), resolve it
      if (!targetChannel.startsWith("C") && !targetChannel.startsWith("G")) {
        try {
          const listRes = await fetch("https://slack.com/api/conversations.list?types=public_channel,private_channel&limit=100", {
            headers: { Authorization: `Bearer ${token}` },
            signal: AbortSignal.timeout(4000),
          });
          if (listRes.ok) {
            const listData = await listRes.json();
            if (listData.ok && Array.isArray(listData.channels)) {
              const matched = listData.channels.find(
                (c) => c.name.toLowerCase() === targetChannel.toLowerCase()
              );
              if (matched) {
                targetChannel = matched.id;
              }
            }
          }
        } catch {
          // fallback to using targetChannel as passed
        }
      }

      const res = await fetch("https://slack.com/api/chat.postMessage", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ channel: targetChannel, text }),
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) throw new Error(`Slack post message failed: ${await res.text()}`);
      const data = await res.json();

      if (!data.ok) {
        if (data.error === "not_in_channel") {
          // Attempt auto-joining the channel if public
          try {
            const joinRes = await fetch("https://slack.com/api/conversations.join", {
              method: "POST",
              headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ channel: targetChannel }),
              signal: AbortSignal.timeout(3000),
            });
            if (joinRes.ok) {
              const joinData = await joinRes.json();
              if (joinData.ok) {
                const retryRes = await fetch("https://slack.com/api/chat.postMessage", {
                  method: "POST",
                  headers: {
                    Authorization: `Bearer ${token}`,
                    "Content-Type": "application/json",
                  },
                  body: JSON.stringify({ channel: targetChannel, text }),
                  signal: AbortSignal.timeout(4000),
                });
                if (retryRes.ok) {
                  const retryData = await retryRes.json();
                  if (retryData.ok) {
                    return retryData;
                  }
                }
              }
            }
          } catch {
            // continue to fallback error
          }

          return {
            ok: false,
            error: "not_in_channel",
            channel: targetChannel,
            message: `The bot is not a member of #${args.channelId || args.channel || targetChannel}. In Slack, please open the channel and type '/invite @Rag_Mcp' (or your bot's name) to grant access, then try again.`,
          };
        }

        if (data.error === "channel_not_found") {
          return {
            ok: false,
            error: "channel_not_found",
            channel: targetChannel,
            message: `Slack channel #${args.channelId || args.channel || targetChannel} was not found. Please verify the channel name or make sure the bot has access to it.`,
          };
        }

        return {
          ok: false,
          error: data.error,
          message: `Slack API returned error: ${data.error}`,
        };
      }

      return data;
    }

    if (toolName === "list_channels" || toolName === "slack.list_channels") {
      if (token.startsWith("mock_")) {
        return {
          total: 2,
          channels: [
            { id: "C0123DEV", name: "dev-announcements", isPrivate: false, numMembers: 18, topic: "Development updates" },
            { id: "C0123ENG", name: "general-engineering", isPrivate: false, numMembers: 24, topic: "Engineering team discussion" },
          ],
        };
      }

      const res = await fetch("https://slack.com/api/conversations.list?types=public_channel,private_channel&exclude_archived=true&limit=50", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`Slack channels list failed: ${await res.text()}`);
      const data = await res.json();
      if (!data.ok) throw new Error(`Slack channels list error: ${data.error}`);

      const channels = (data.channels || []).map((c) => ({
        id: c.id,
        name: c.name,
        isPrivate: Boolean(c.is_private),
        numMembers: c.num_members || 0,
        topic: c.topic?.value || "No topic",
      }));

      return {
        total: channels.length,
        channels,
      };
    }

    throw new Error(`Unsupported Slack tool operation: ${toolName}`);
  }
}
