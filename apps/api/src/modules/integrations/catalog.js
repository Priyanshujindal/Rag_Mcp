/**
 * Integration Catalog Definition for Rag_Mcp Connected Apps.
 * Defines metadata, auth configurations, scopes, capabilities, and tool schemas.
 */

export const INTEGRATION_CATEGORIES = [
  "All",
  "Email",
  "Storage & Docs",
  "Calendar",
  "Development",
  "Knowledge & Docs",
  "Communication",
  "Project Management",
];

export const INTEGRATIONS_CATALOG = [
  {
    id: "gmail",
    name: "Gmail",
    description: "Search, read, summarize, draft, and send emails through your Google Workspace account.",
    category: "Email",
    icon: "Mail",
    provider: "google",
    authType: "oauth2",
    status: "available",
    oauth: {
      authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenUrl: "https://oauth2.googleapis.com/token",
      defaultScopes: [
        "https://www.googleapis.com/auth/gmail.readonly",
        "https://www.googleapis.com/auth/gmail.compose",
        "https://www.googleapis.com/auth/gmail.send",
        "https://www.googleapis.com/auth/userinfo.email",
        "https://www.googleapis.com/auth/userinfo.profile",
      ],
      requiredEnv: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
    },
    capabilities: [
      "Search emails with query filters (sender, subject, date, unread)",
      "Read full email threads and attachments metadata",
      "Draft email replies for review",
      "Send emails with explicit confirmation",
    ],
    tools: [
      {
        name: "search_emails",
        fullName: "gmail.search_emails",
        description: "Search user's Gmail messages. To list latest/recent emails, use query: 'in:inbox'. To filter, use query syntax like 'subject:internship', 'from:company.com', 'is:unread', or keywords. Returns message IDs, subjects, senders, dates, and snippets.",
        writeOperation: false,
        requiresApproval: false,
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "Gmail search query (e.g. 'in:inbox' for recent emails, 'subject:offer', 'from:google.com'). Do NOT pass whole user sentences.",
              default: "in:inbox",
            },
            maxResults: { type: "number", description: "Max messages to return (default: 5, max: 20)", default: 5 },
          },
          required: ["query"],
        },
      },
      {
        name: "get_email",
        fullName: "gmail.get_email",
        description: "Retrieve complete contents, headers, subject, sender, and snippet of a specific Gmail message by ID.",
        writeOperation: false,
        requiresApproval: false,
        inputSchema: {
          type: "object",
          properties: {
            messageId: { type: "string", description: "The unique Gmail message ID" },
          },
          required: ["messageId"],
        },
      },
      {
        name: "get_thread",
        fullName: "gmail.get_thread",
        description: "Retrieve an entire email conversation thread by thread ID.",
        writeOperation: false,
        requiresApproval: false,
        inputSchema: {
          type: "object",
          properties: {
            threadId: { type: "string", description: "The unique Gmail thread ID" },
          },
          required: ["threadId"],
        },
      },
      {
        name: "create_draft",
        fullName: "gmail.create_draft",
        description: "Create an email draft in Gmail without sending it.",
        writeOperation: true,
        requiresApproval: true,
        inputSchema: {
          type: "object",
          properties: {
            to: { type: "string", description: "Recipient email address" },
            subject: { type: "string", description: "Email subject line" },
            body: { type: "string", description: "Email body text (plain text or basic HTML)" },
          },
          required: ["to", "subject", "body"],
        },
      },
      {
        name: "send_email",
        fullName: "gmail.send_email",
        description: "Send an email directly from the user's Gmail account. STRICT: Requires explicit human approval.",
        writeOperation: true,
        requiresApproval: true,
        inputSchema: {
          type: "object",
          properties: {
            to: { type: "string", description: "Recipient email address" },
            subject: { type: "string", description: "Email subject line" },
            body: { type: "string", description: "Email message body" },
          },
          required: ["to", "subject", "body"],
        },
      },
    ],
  },
  {
    id: "google_drive",
    name: "Google Drive",
    description: "Search files, read document contents, summarize spreadsheets and PDFs, and create files.",
    category: "Storage & Docs",
    icon: "HardDrive",
    provider: "google",
    authType: "oauth2",
    status: "available",
    oauth: {
      authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenUrl: "https://oauth2.googleapis.com/token",
      defaultScopes: [
        "https://www.googleapis.com/auth/drive.readonly",
        "https://www.googleapis.com/auth/drive.file",
        "https://www.googleapis.com/auth/userinfo.email",
      ],
      requiredEnv: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
    },
    capabilities: [
      "Search Google Drive files and folders by name and content",
      "Read text, Markdown, Google Docs, and spreadsheet summaries",
      "Create new files in Google Drive",
      "Download file content for RAG ingestion or file generation",
    ],
    tools: [
      {
        name: "search_files",
        fullName: "google_drive.search_files",
        description: "Search files and folders in Google Drive by filename or keyword. To view recent files, pass query: ''. To search for a specific document, pass the name or keyword.",
        writeOperation: false,
        requiresApproval: false,
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string", description: "Search keyword or filename (or '' for recent files)" },
            mimeType: { type: "string", description: "Optional filter (e.g. 'application/pdf', 'application/vnd.google-apps.document')" },
            maxResults: { type: "number", description: "Max files to return (default: 10, max: 25)" },
          },
          required: ["query"],
        },
      },
      {
        name: "get_file",
        fullName: "google_drive.get_file",
        description: "Retrieve metadata, webViewLink, and export URLs for a specific Google Drive file ID.",
        writeOperation: false,
        requiresApproval: false,
        inputSchema: {
          type: "object",
          properties: {
            fileId: { type: "string", description: "The Google Drive file ID" },
          },
          required: ["fileId"],
        },
      },
      {
        name: "read_file_content",
        fullName: "google_drive.read_file_content",
        description: "Extract and read text content from Google Docs, Sheets, text files, or PDFs stored in Google Drive.",
        writeOperation: false,
        requiresApproval: false,
        inputSchema: {
          type: "object",
          properties: {
            fileId: { type: "string", description: "The Google Drive file ID" },
            maxChars: { type: "number", description: "Maximum characters of text to read (default: 8000)" },
          },
          required: ["fileId"],
        },
      },
      {
        name: "create_file",
        fullName: "google_drive.create_file",
        description: "Create a new text or document file in the user's Google Drive. Requires approval.",
        writeOperation: true,
        requiresApproval: true,
        inputSchema: {
          type: "object",
          properties: {
            name: { type: "string", description: "File name with extension (e.g. 'meeting_summary.md')" },
            content: { type: "string", description: "File body content" },
            mimeType: { type: "string", description: "MIME type (default: 'text/markdown')" },
          },
          required: ["name", "content"],
        },
      },
    ],
  },
  {
    id: "google_calendar",
    name: "Google Calendar",
    description: "Check your schedule, list upcoming meetings, search calendar events, and schedule new events.",
    category: "Calendar",
    icon: "Calendar",
    provider: "google",
    authType: "oauth2",
    status: "available",
    oauth: {
      authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenUrl: "https://oauth2.googleapis.com/token",
      defaultScopes: [
        "https://www.googleapis.com/auth/calendar.events.readonly",
        "https://www.googleapis.com/auth/calendar.events",
      ],
      requiredEnv: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
    },
    capabilities: [
      "List upcoming events and agenda for today or future dates",
      "Search events by title, attendee, or keyword",
      "Create calendar events and invites with approval",
    ],
    tools: [
      {
        name: "list_events",
        fullName: "google_calendar.list_events",
        description: "List scheduled calendar events within a specific time range (e.g. today, tomorrow, or this week).",
        writeOperation: false,
        requiresApproval: false,
        inputSchema: {
          type: "object",
          properties: {
            timeMin: { type: "string", description: "ISO date-time string for start range (default: now)" },
            timeMax: { type: "string", description: "ISO date-time string for end range (default: end of today)" },
            maxResults: { type: "number", description: "Maximum events to return (default: 15)" },
          },
        },
      },
      {
        name: "get_event",
        fullName: "google_calendar.get_event",
        description: "Retrieve full details, description, attendees, and meeting link for a calendar event.",
        writeOperation: false,
        requiresApproval: false,
        inputSchema: {
          type: "object",
          properties: {
            eventId: { type: "string", description: "Calendar event ID" },
          },
          required: ["eventId"],
        },
      },
      {
        name: "create_event",
        fullName: "google_calendar.create_event",
        description: "Schedule a new event in Google Calendar. Requires user approval.",
        writeOperation: true,
        requiresApproval: true,
        inputSchema: {
          type: "object",
          properties: {
            summary: { type: "string", description: "Title of the event" },
            description: { type: "string", description: "Event description or agenda" },
            startDateTime: { type: "string", description: "Start time in ISO format (e.g. 2026-11-22T14:00:00Z)" },
            endDateTime: { type: "string", description: "End time in ISO format (e.g. 2026-11-22T15:00:00Z)" },
            attendees: { type: "array", items: { type: "string" }, description: "List of attendee emails" },
          },
          required: ["summary", "startDateTime", "endDateTime"],
        },
      },
    ],
  },
  {
    id: "notion",
    name: "Notion",
    description: "Search workspace pages, inspect databases, read project documentation, and create pages.",
    category: "Knowledge & Docs",
    icon: "FileText",
    provider: "notion",
    authType: "oauth2",
    status: "available",
    oauth: {
      authUrl: "https://api.notion.com/v1/oauth/authorize",
      tokenUrl: "https://api.notion.com/v1/oauth/token",
      requiredEnv: ["NOTION_CLIENT_ID", "NOTION_CLIENT_SECRET"],
    },
    capabilities: [
      "Search pages and databases across the authorized Notion workspace",
      "Read formatted page text and blocks",
      "Query databases for project tasks or structured records",
      "Create new pages or notes with human confirmation",
    ],
    tools: [
      {
        name: "search",
        fullName: "notion.search",
        description: "Search pages, databases, and workspace content in Notion. Pass query: '' to list all accessible pages in the workspace, or pass keywords to filter by page title.",
        writeOperation: false,
        requiresApproval: false,
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "Title keyword to search for, or '' (empty string) to retrieve all accessible pages in the workspace.",
              default: "",
            },
            filter: { type: "string", enum: ["page", "database"], description: "Optional filter for page or database" },
            pageSize: { type: "number", description: "Number of results (default: 10, max: 25)" },
          },
        },
      },
      {
        name: "get_page",
        fullName: "notion.get_page",
        description: "Retrieve content, properties, and markdown text of a specific Notion page by page ID.",
        writeOperation: false,
        requiresApproval: false,
        inputSchema: {
          type: "object",
          properties: {
            pageId: { type: "string", description: "The Notion page ID" },
          },
          required: ["pageId"],
        },
      },
      {
        name: "read_database",
        fullName: "notion.read_database",
        description: "Query structured database records in Notion with schema properties.",
        writeOperation: false,
        requiresApproval: false,
        inputSchema: {
          type: "object",
          properties: {
            databaseId: { type: "string", description: "The Notion database ID" },
            pageSize: { type: "number", description: "Max records to return (default: 15)" },
          },
          required: ["databaseId"],
        },
      },
      {
        name: "create_page",
        fullName: "notion.create_page",
        description: "Create a new page in Notion inside a parent page or database. Requires user approval.",
        writeOperation: true,
        requiresApproval: true,
        inputSchema: {
          type: "object",
          properties: {
            parentPageId: { type: "string", description: "Parent page or database ID" },
            title: { type: "string", description: "Title of the new Notion page" },
            content: { type: "string", description: "Markdown body content for the page" },
          },
          required: ["parentPageId", "title", "content"],
        },
      },
    ],
  },
  {
    id: "github",
    name: "GitHub",
    description: "Inspect repositories, search code, read files, review pull requests, and manage issues.",
    category: "Development",
    icon: "Github",
    provider: "github",
    authType: "oauth2",
    status: "available",
    oauth: {
      authUrl: "https://github.com/login/oauth/authorize",
      tokenUrl: "https://github.com/login/oauth/access_token",
      defaultScopes: ["repo", "read:user", "user:email"],
      requiredEnv: ["GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET"],
    },
    capabilities: [
      "List personal and organization repositories",
      "Search code and inspect repository files and commits",
      "List and read issues and pull requests",
      "Create GitHub issues with user approval",
    ],
    tools: [
      {
        name: "list_repositories",
        fullName: "github.list_repositories",
        description: "List the authenticated user's repositories, including public and private repos.",
        writeOperation: false,
        requiresApproval: false,
        inputSchema: {
          type: "object",
          properties: {
            visibility: { type: "string", enum: ["all", "public", "private"], description: "Filter by visibility (default: all)" },
            sort: { type: "string", enum: ["updated", "created", "pushed", "full_name"], description: "Sort criteria" },
            perPage: { type: "number", description: "Number of repos to return (default: 15)" },
          },
        },
      },
      {
        name: "get_repository",
        fullName: "github.get_repository",
        description: "Get detailed information about a GitHub repository (description, stars, languages, default branch).",
        writeOperation: false,
        requiresApproval: false,
        inputSchema: {
          type: "object",
          properties: {
            owner: { type: "string", description: "Repository owner username or organization" },
            repo: { type: "string", description: "Repository name" },
          },
          required: ["owner", "repo"],
        },
      },
      {
        name: "read_file",
        fullName: "github.read_file",
        description: "Read the text contents of a file from a GitHub repository (e.g. README.md, package.json).",
        writeOperation: false,
        requiresApproval: false,
        inputSchema: {
          type: "object",
          properties: {
            owner: { type: "string", description: "Repository owner" },
            repo: { type: "string", description: "Repository name" },
            path: { type: "string", description: "Path to file inside repo (e.g. 'src/index.js' or 'README.md')" },
            ref: { type: "string", description: "Branch, tag, or commit SHA (default: default branch)" },
          },
          required: ["owner", "repo", "path"],
        },
      },
      {
        name: "search_code",
        fullName: "github.search_code",
        description: "Search code across repositories using GitHub search syntax (e.g. 'RAG user:Priyanshujindal').",
        writeOperation: false,
        requiresApproval: false,
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string", description: "Search query string" },
            perPage: { type: "number", description: "Max results (default: 10)" },
          },
          required: ["query"],
        },
      },
      {
        name: "list_issues",
        fullName: "github.list_issues",
        description: "List issues for a repository with state filtering (open, closed, all).",
        writeOperation: false,
        requiresApproval: false,
        inputSchema: {
          type: "object",
          properties: {
            owner: { type: "string", description: "Repository owner" },
            repo: { type: "string", description: "Repository name" },
            state: { type: "string", enum: ["open", "closed", "all"], description: "Issue state (default: open)" },
            perPage: { type: "number", description: "Number of issues (default: 10)" },
          },
          required: ["owner", "repo"],
        },
      },
      {
        name: "list_pull_requests",
        fullName: "github.list_pull_requests",
        description: "List pull requests for a repository with state filtering.",
        writeOperation: false,
        requiresApproval: false,
        inputSchema: {
          type: "object",
          properties: {
            owner: { type: "string", description: "Repository owner" },
            repo: { type: "string", description: "Repository name" },
            state: { type: "string", enum: ["open", "closed", "all"], description: "PR state (default: open)" },
            perPage: { type: "number", description: "Number of PRs (default: 10)" },
          },
          required: ["owner", "repo"],
        },
      },
      {
        name: "create_issue",
        fullName: "github.create_issue",
        description: "Create a new issue in a GitHub repository. Requires user confirmation.",
        writeOperation: true,
        requiresApproval: true,
        inputSchema: {
          type: "object",
          properties: {
            owner: { type: "string", description: "Repository owner" },
            repo: { type: "string", description: "Repository name" },
            title: { type: "string", description: "Issue title" },
            body: { type: "string", description: "Issue description and details" },
            labels: { type: "array", items: { type: "string" }, description: "Optional labels" },
          },
          required: ["owner", "repo", "title"],
        },
      },
    ],
  },
  {
    id: "slack",
    name: "Slack",
    description: "Search workspace discussions, read channel message history, and post messages.",
    category: "Communication",
    icon: "MessageSquare",
    provider: "slack",
    authType: "oauth2",
    status: "available",
    oauth: {
      authUrl: "https://slack.com/oauth/v2/authorize",
      tokenUrl: "https://slack.com/api/oauth.v2.access",
      defaultScopes: ["channels:history", "channels:read", "chat:write", "search:read"],
      requiredEnv: ["SLACK_CLIENT_ID", "SLACK_CLIENT_SECRET"],
    },
    capabilities: [
      "List accessible public and private channels",
      "Search messages and discussion threads across Slack",
      "Read conversation history from specific channels",
      "Send messages with explicit user confirmation",
    ],
    tools: [
      {
        name: "list_channels",
        fullName: "slack.list_channels",
        description: "List channels in the connected Slack workspace.",
        writeOperation: false,
        requiresApproval: false,
        inputSchema: {
          type: "object",
          properties: {
            types: { type: "string", description: "Channel types (e.g. 'public_channel,private_channel')" },
            limit: { type: "number", description: "Max channels to return (default: 20)" },
          },
        },
      },
      {
        name: "search_messages",
        fullName: "slack.search_messages",
        description: "Search Slack messages by keywords, from user, or channel name.",
        writeOperation: false,
        requiresApproval: false,
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string", description: "Search query text" },
            count: { type: "number", description: "Number of messages (default: 10)" },
          },
          required: ["query"],
        },
      },
      {
        name: "get_channel_history",
        fullName: "slack.get_channel_history",
        description: "Retrieve recent message history from a specific Slack channel ID.",
        writeOperation: false,
        requiresApproval: false,
        inputSchema: {
          type: "object",
          properties: {
            channelId: { type: "string", description: "Slack channel ID" },
            limit: { type: "number", description: "Number of messages to retrieve (default: 20)" },
          },
          required: ["channelId"],
        },
      },
      {
        name: "send_message",
        fullName: "slack.send_message",
        description: "Post a message to a Slack channel. Requires user approval.",
        writeOperation: true,
        requiresApproval: true,
        inputSchema: {
          type: "object",
          properties: {
            channelId: { type: "string", description: "Slack channel ID" },
            text: { type: "string", description: "Message content to post" },
          },
          required: ["channelId", "text"],
        },
      },
    ],
  },
  {
    id: "linear",
    name: "Linear",
    description: "Search project tasks, view assigned issues, and create or update engineering tickets.",
    category: "Project Management",
    icon: "CheckSquare",
    provider: "linear",
    authType: "oauth2",
    status: "available",
    oauth: {
      authUrl: "https://linear.app/oauth/authorize",
      tokenUrl: "https://api.linear.app/oauth/token",
      defaultScopes: ["read", "write", "issues:create"],
      requiredEnv: ["LINEAR_CLIENT_ID", "LINEAR_CLIENT_SECRET"],
    },
    capabilities: [
      "List engineering projects and roadmaps",
      "Search issues and check tasks assigned to you",
      "Create new issues and update task statuses with approval",
    ],
    tools: [
      {
        name: "list_projects",
        fullName: "linear.list_projects",
        description: "List projects in the connected Linear organization.",
        writeOperation: false,
        requiresApproval: false,
        inputSchema: {
          type: "object",
          properties: {
            limit: { type: "number", description: "Max projects to return (default: 15)" },
          },
        },
      },
      {
        name: "search_issues",
        fullName: "linear.search_issues",
        description: "Search issues in Linear by keyword, assignee, or status.",
        writeOperation: false,
        requiresApproval: false,
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string", description: "Search query string" },
            limit: { type: "number", description: "Max issues to return (default: 15)" },
          },
          required: ["query"],
        },
      },
      {
        name: "create_issue",
        fullName: "linear.create_issue",
        description: "Create a new issue in Linear. Requires user approval.",
        writeOperation: true,
        requiresApproval: true,
        inputSchema: {
          type: "object",
          properties: {
            title: { type: "string", description: "Issue title" },
            description: { type: "string", description: "Issue description in markdown" },
            teamId: { type: "string", description: "Team identifier" },
            priority: { type: "number", description: "Priority 0-4 (0=none, 1=urgent, 4=low)" },
          },
          required: ["title", "teamId"],
        },
      },
    ],
  },
  {
    id: "microsoft_outlook",
    name: "Microsoft Outlook",
    description: "Search emails, read messages, draft replies, and send emails via Microsoft 365.",
    category: "Email",
    icon: "Mail",
    provider: "microsoft",
    authType: "oauth2",
    status: "coming_soon",
    capabilities: ["Search Outlook emails", "Read threads", "Send emails with approval"],
    tools: [],
  },
  {
    id: "microsoft_onedrive",
    name: "Microsoft OneDrive",
    description: "Search and read files, documents, and spreadsheets stored in Microsoft OneDrive.",
    category: "Storage & Docs",
    icon: "Cloud",
    provider: "microsoft",
    authType: "oauth2",
    status: "coming_soon",
    capabilities: ["Search OneDrive files", "Read Word & Excel files"],
    tools: [],
  },
  {
    id: "jira",
    name: "Jira & Confluence",
    description: "Track Jira issues, search sprint tasks, and access Confluence workspace documentation.",
    category: "Project Management",
    icon: "Layers",
    provider: "atlassian",
    authType: "oauth2",
    status: "coming_soon",
    capabilities: ["Search Jira issues", "Read Confluence pages"],
    tools: [],
  },
];

/**
 * Returns catalog item by ID
 */
export function getIntegrationById(id) {
  return INTEGRATIONS_CATALOG.find((item) => item.id === id) || null;
}
