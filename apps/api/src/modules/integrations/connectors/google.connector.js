import { BaseConnector } from "./base.connector.js";
import { getIntegrationById } from "../catalog.js";

/**
 * Google Connector handling Gmail, Google Drive, and Google Calendar.
 * Uses official Google REST APIs with standard OAuth 2.0 Bearer tokens.
 */
export class GoogleConnector extends BaseConnector {
  constructor(integrationId = "gmail") {
    super(integrationId);
    this.catalog = getIntegrationById(integrationId) || getIntegrationById("gmail");
  }

  getAuthUrl({ state, redirectUri, scopes }) {
    const clientId = process.env.GOOGLE_CLIENT_ID || "mock_google_client_id";
    const selectedScopes = scopes || this.catalog.oauth.defaultScopes;

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: selectedScopes.join(" "),
      access_type: "offline",
      prompt: "consent",
      state,
    });

    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  }

  async exchangeCode({ code, redirectUri }) {
    const clientId = process.env.GOOGLE_CLIENT_ID || "mock_google_client_id";
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET || "mock_google_client_secret";

    // Live exchange if real credentials exist, or return mock for test/demo mode
    if (clientId === "mock_google_client_id") {
      return {
        accessToken: `mock_google_token_${Date.now()}`,
        refreshToken: `mock_google_refresh_${Date.now()}`,
        expiresAt: new Date(Date.now() + 3600 * 1000),
        accountEmail: "user@gmail.com",
        accountDisplayName: "Google Account User",
        providerAccountId: "google_sub_123456",
      };
    }

    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Google token exchange failed (${res.status}): ${err}`);
    }

    const data = await res.json();
    const expiresAt = new Date(Date.now() + (data.expires_in || 3600) * 1000);

    // Fetch user profile info
    let accountEmail = "google_user@gmail.com";
    let accountDisplayName = "Google Workspace User";
    let providerAccountId = "";

    try {
      const profileRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
        headers: { Authorization: `Bearer ${data.access_token}` },
      });
      if (profileRes.ok) {
        const profile = await profileRes.json();
        accountEmail = profile.email || accountEmail;
        accountDisplayName = profile.name || accountEmail;
        providerAccountId = profile.id || "";
      }
    } catch {
      // ignore profile fetch failure
    }

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt,
      accountEmail,
      accountDisplayName,
      providerAccountId,
    };
  }

  async refreshToken(refreshToken) {
    const clientId = process.env.GOOGLE_CLIENT_ID || "mock_google_client_id";
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET || "mock_google_client_secret";

    if (clientId === "mock_google_client_id") {
      return {
        accessToken: `refreshed_mock_google_token_${Date.now()}`,
        expiresAt: new Date(Date.now() + 3600 * 1000),
      };
    }

    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Google token refresh failed (${res.status}): ${err}`);
    }

    const data = await res.json();
    return {
      accessToken: data.access_token,
      expiresAt: new Date(Date.now() + (data.expires_in || 3600) * 1000),
      refreshToken: data.refresh_token || refreshToken,
    };
  }

  async executeTool(toolName, args, connection) {
    const accessToken = connection.getAccessToken();

    // ----------------- GMAIL TOOLS -----------------
    if (toolName === "search_emails" || toolName === "gmail.search_emails") {
      let rawQuery = (args.query || "").trim();
      // Detect if user/model passed conversational request or requested recent/latest emails
      const isConversational =
        !rawQuery ||
        /^(search\s+(for\s+)?(my\s+)?)?(latest|recent|newest|all)?\s*(emails?|messages?|inbox)?.*$/i.test(rawQuery) &&
        !/(from:|to:|subject:|has:|is:|after:|before:|label:)/i.test(rawQuery);

      let effectiveQuery = isConversational ? "in:inbox" : rawQuery;
      // Strip outer quotes if model enclosed query in quotes
      effectiveQuery = effectiveQuery.replace(/^["']|["']$/g, "").trim() || "in:inbox";

      const maxResults = Math.min(Math.max(args.maxResults || 5, 1), 20);
      const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(effectiveQuery)}&maxResults=${maxResults}`;

      if (accessToken.startsWith("mock_")) {
        return {
          query: effectiveQuery,
          resultCount: 2,
          messages: [
            {
              id: "msg_18b2c45d6e7f",
              threadId: "th_18b2c45d6e7f",
              subject: `Internship Offer & Details: ${effectiveQuery}`,
              from: "recruiting@toptech.com",
              date: new Date().toISOString(),
              snippet: "We are delighted to offer you the Software Engineering Internship position for Summer 2026...",
            },
            {
              id: "msg_19a3d48f7a1b",
              threadId: "th_19a3d48f7a1b",
              subject: "Follow-up: RAG and Machine Learning Project Interview",
              from: "hiring-manager@ai-lab.io",
              date: new Date(Date.now() - 86400000).toISOString(),
              snippet: "Thank you for sending your resume and project documentation. The team was impressed...",
            },
          ],
        };
      }

      const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
      if (!res.ok) throw new Error(`Gmail API error (${res.status}): ${await res.text()}`);
      const data = await res.json();

      // Automatically hydrate messages with Subject, From, Date, and Snippet
      if (Array.isArray(data.messages) && data.messages.length > 0) {
        const enrichedMessages = await Promise.all(
          data.messages.slice(0, maxResults).map(async (m) => {
            try {
              const detailRes = await fetch(
                `https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`,
                { headers: { Authorization: `Bearer ${accessToken}` } }
              );
              if (detailRes.ok) {
                const detail = await detailRes.json();
                const headers = detail.payload?.headers || [];
                const subject = headers.find((h) => h.name.toLowerCase() === "subject")?.value || "No Subject";
                const from = headers.find((h) => h.name.toLowerCase() === "from")?.value || "Unknown Sender";
                const date = headers.find((h) => h.name.toLowerCase() === "date")?.value || "";
                return {
                  id: m.id,
                  threadId: m.threadId,
                  subject,
                  from,
                  date,
                  snippet: detail.snippet || "",
                };
              }
            } catch {
              // fallback to bare ID
            }
            return m;
          })
        );

        return {
          query: effectiveQuery,
          resultCount: enrichedMessages.length,
          messages: enrichedMessages,
        };
      }

      return {
        query: effectiveQuery,
        resultCount: 0,
        messages: [],
      };
    }

    if (toolName === "get_email" || toolName === "gmail.get_email") {
      const msgId = args.messageId;
      if (accessToken.startsWith("mock_")) {
        return {
          id: msgId,
          subject: "Software Engineering Internship Acceptance & Next Steps",
          from: "hr@company.com",
          to: connection.accountEmail || "user@gmail.com",
          date: new Date().toISOString(),
          body: "Hello! Welcome to the team. Please find attached the onboarding documentation and equipment request form. You will be working on our Core AI and RAG search platform.",
          hasAttachments: true,
          attachments: [{ filename: "internship_agreement_2026.pdf", mimeType: "application/pdf", size: 142000 }],
        };
      }

      const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${msgId}?format=full`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) throw new Error(`Gmail message fetch failed: ${await res.text()}`);
      return await res.json();
    }

    if (toolName === "send_email" || toolName === "gmail.send_email") {
      const { to, subject, body } = args;
      if (accessToken.startsWith("mock_")) {
        return {
          status: "sent",
          messageId: `msg_sent_${Date.now()}`,
          to,
          subject,
          timestamp: new Date().toISOString(),
          details: "Email dispatched via Gmail API.",
        };
      }

      const emailLines = [
        `To: ${to}`,
        `Subject: ${subject}`,
        "Content-Type: text/plain; charset=utf-8",
        "",
        body,
      ];
      const raw = Buffer.from(emailLines.join("\r\n")).toString("base64url");
      const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ raw }),
      });
      if (!res.ok) throw new Error(`Gmail send failed: ${await res.text()}`);
      return await res.json();
    }

    // ----------------- GOOGLE DRIVE TOOLS -----------------
    if (toolName === "search_files" || toolName === "google_drive.search_files") {
      const query = args.query || "";
      if (accessToken.startsWith("mock_")) {
        return {
          query,
          files: [
            {
              id: "file_drive_01",
              name: "Priyanshu_Jindal_Resume_2026.pdf",
              mimeType: "application/pdf",
              modifiedTime: new Date().toISOString(),
              webViewLink: "https://drive.google.com/file/d/file_drive_01/view",
              size: "245 KB",
            },
            {
              id: "file_drive_02",
              name: "Rag_Mcp_Architecture_Specification.docx",
              mimeType: "application/vnd.google-apps.document",
              modifiedTime: new Date(Date.now() - 172800000).toISOString(),
              webViewLink: "https://drive.google.com/file/d/file_drive_02/view",
              size: "52 KB",
            },
          ],
        };
      }

      let rawQuery = (args.query || "").trim();
      const isConversational =
        !rawQuery ||
        /^(search\s+(for\s+)?(my\s+)?)?(latest|recent|newest|all)?\s*(files?|documents?|drive)?.*$/i.test(rawQuery);

      let filterParts = ["trashed = false"];
      if (!isConversational && rawQuery) {
        const cleanQuery = rawQuery.replace(/^["']|["']$/g, "").trim();
        filterParts.push(`name contains '${cleanQuery.replace(/'/g, "\\'")}'`);
      }
      if (args.mimeType) {
        filterParts.push(`mimeType = '${args.mimeType}'`);
      }

      const q = encodeURIComponent(filterParts.join(" and "));
      const pageSize = Math.min(Math.max(args.maxResults || 10, 1), 25);
      const url = `https://www.googleapis.com/drive/v3/files?q=${q}&orderBy=modifiedTime%20desc&pageSize=${pageSize}&fields=files(id,name,mimeType,size,modifiedTime,webViewLink)`;

      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) {
        const errText = await res.text();
        if (errText.includes("has not been used in project") || errText.includes("disabled")) {
          throw new Error("Google Drive API is disabled in your Google Cloud project. Please enable it in Google Cloud Console: https://console.cloud.google.com/apis/library/drive.googleapis.com");
        }
        throw new Error(`Google Drive API error (${res.status}): ${errText}`);
      }
      return await res.json();
    }

    if (toolName === "read_file_content" || toolName === "google_drive.read_file_content") {
      const fileId = args.fileId;
      if (accessToken.startsWith("mock_")) {
        return {
          fileId,
          name: "Priyanshu_Jindal_Resume_2026.pdf",
          content: "PRIYANSHU JINDAL - Full Stack AI & Systems Engineer.\nExperience: Core Contributor to Rag_Mcp (Model Context Protocol ecosystem, hybrid vector RAG retrieval, multi-LLM orchestration).\nSkills: Node.js, Python FastAPI, React, PyTorch, MongoDB, Vector Databases, OAuth 2.0 Security.",
          characterCount: 285,
        };
      }

      const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) throw new Error(`Google Drive read content failed: ${await res.text()}`);
      const text = await res.text();
      return { fileId, content: text.slice(0, args.maxChars || 8000) };
    }

    // ----------------- GOOGLE CALENDAR TOOLS -----------------
    if (toolName === "list_events" || toolName === "google_calendar.list_events") {
      if (accessToken.startsWith("mock_")) {
        return {
          count: 2,
          events: [
            {
              id: "evt_cal_01",
              summary: "Team AI Architecture Sync: MCP Ecosystem Review",
              start: new Date(Date.now() + 3600000).toISOString(),
              end: new Date(Date.now() + 7200000).toISOString(),
              attendees: ["priyanshu@rag-mcp.ai", "lead-architect@rag-mcp.ai"],
              meetLink: "https://meet.google.com/abc-defg-hij",
            },
            {
              id: "evt_cal_02",
              summary: "Demo: Connected Apps & OAuth Integrations Showcase",
              start: new Date(Date.now() + 86400000).toISOString(),
              end: new Date(Date.now() + 90000000).toISOString(),
              attendees: ["priyanshu@rag-mcp.ai", "team@rag-mcp.ai"],
            },
          ],
        };
      }

      const timeMin = args.timeMin || new Date().toISOString();
      const maxResults = Math.min(Math.max(args.maxResults || 10, 1), 50);
      let url = `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${encodeURIComponent(timeMin)}&singleEvents=true&orderBy=startTime&maxResults=${maxResults}`;
      if (args.timeMax) {
        url += `&timeMax=${encodeURIComponent(args.timeMax)}`;
      }

      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) {
        const errText = await res.text();
        if (errText.includes("has not been used in project") || errText.includes("disabled")) {
          throw new Error("Google Calendar API is not enabled in your Google Cloud project. Enable it here: https://console.cloud.google.com/apis/library/calendar-json.googleapis.com");
        }
        if (res.status === 401 || res.status === 403) {
          throw new Error(`Google Calendar access denied (${res.status}). Please reconnect Google Calendar to grant calendar permissions.`);
        }
        throw new Error(`Google Calendar API error (${res.status}): ${errText}`);
      }
      const data = await res.json();
      return {
        count: (data.items || []).length,
        events: (data.items || []).map((ev) => ({
          id: ev.id,
          summary: ev.summary || "No Title",
          description: ev.description || "",
          start: ev.start?.dateTime || ev.start?.date || "",
          end: ev.end?.dateTime || ev.end?.date || "",
          meetLink: ev.hangoutLink || ev.conferenceData?.entryPoints?.[0]?.uri || "",
          attendees: (ev.attendees || []).map((a) => a.email),
          status: ev.status,
        })),
      };
    }

    if (toolName === "get_event" || toolName === "google_calendar.get_event") {
      const eventId = args.eventId;
      if (accessToken.startsWith("mock_")) {
        return {
          id: eventId,
          summary: "Team AI Architecture Sync",
          start: new Date().toISOString(),
          end: new Date(Date.now() + 3600000).toISOString(),
          description: "Review MCP tool pipelines, token encryption, and multi-model dispatch.",
          attendees: ["priyanshu@rag-mcp.ai"],
          meetLink: "https://meet.google.com/abc-defg-hij",
        };
      }

      const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) throw new Error(`Google Calendar get event error: ${await res.text()}`);
      const ev = await res.json();
      return {
        id: ev.id,
        summary: ev.summary || "No Title",
        description: ev.description || "",
        start: ev.start?.dateTime || ev.start?.date || "",
        end: ev.end?.dateTime || ev.end?.date || "",
        meetLink: ev.hangoutLink || ev.conferenceData?.entryPoints?.[0]?.uri || "",
        attendees: (ev.attendees || []).map((a) => a.email),
        status: ev.status,
      };
    }

    if (toolName === "create_event" || toolName === "google_calendar.create_event") {
      const { summary, description, startDateTime, endDateTime, attendees } = args;
      if (accessToken.startsWith("mock_")) {
        return {
          status: "confirmed",
          id: `evt_${Date.now()}`,
          summary,
          description,
          start: startDateTime,
          end: endDateTime,
          htmlLink: "https://calendar.google.com/calendar/event?eid=mock_eid",
        };
      }

      const body = {
        summary,
        description,
        start: { dateTime: startDateTime },
        end: { dateTime: endDateTime },
        attendees: Array.isArray(attendees) ? attendees.map((email) => ({ email })) : undefined,
      };

      const res = await fetch("https://www.googleapis.com/calendar/v3/calendars/primary/events", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`Google Calendar create event error: ${await res.text()}`);
      return await res.json();
    }

    throw new Error(`Unsupported Google tool operation: ${toolName}`);
  }
}
