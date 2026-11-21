# Rag_Mcp Connected Apps & Integrations Progress

This document tracks the implementation, authentication status, and verification state of the built-in Apps & Integrations ecosystem in Rag_Mcp.

## Ecosystem Status Overview

- **Architecture:** Unified Integration-to-MCP Tool Adapter. Connected apps are first-class MCP tools managed under the central `McpOrchestrator` with AES-256-GCM encrypted credentials at rest, OAuth 2.0 PKCE, and human-in-the-loop approval policies for write operations.
- **UI:** Connected Apps Marketplace located at `/dashboard/apps` with search, category filtering, connection management, tool permission toggles, and token configuration dialogs.
- **Security:** Secret encryption at rest, SSRF guard for external API requests, secret masking on serialization, workspace and user isolation, and unprivileged read-only defaults.

---

## Integration Status Matrix

| Integration | Category | Auth Type | Status | Supported Tools | Approval Policy |
|---|---|---|---|---|---|
| **Gmail** | Email | OAuth 2.0 | Implemented | `gmail.search_emails`, `gmail.get_email`, `gmail.get_thread`, `gmail.create_draft`, `gmail.send_email` | Reads: `auto`<br>Writes: `always_ask` |
| **Google Drive** | Storage & Docs | OAuth 2.0 | Implemented | `google_drive.search_files`, `google_drive.get_file`, `google_drive.read_file_content`, `google_drive.create_file` | Reads: `auto`<br>Writes: `always_ask` |
| **Google Calendar** | Calendar | OAuth 2.0 | Implemented | `google_calendar.list_events`, `google_calendar.get_event`, `google_calendar.create_event` | Reads: `auto`<br>Writes: `always_ask` |
| **Notion** | Knowledge & Docs | OAuth 2.0 / API Key | Implemented | `notion.search`, `notion.get_page`, `notion.read_database`, `notion.create_page` | Reads: `auto`<br>Writes: `always_ask` |
| **GitHub** | Development | OAuth 2.0 / PAT | Implemented | `github.list_repositories`, `github.get_repository`, `github.read_file`, `github.search_code`, `github.list_issues`, `github.list_pull_requests`, `github.create_issue` | Reads: `auto`<br>Writes: `always_ask` |
| **Slack** | Communication | OAuth 2.0 / Bot Token | Implemented | `slack.list_channels`, `slack.search_messages`, `slack.get_channel_history`, `slack.send_message` | Reads: `auto`<br>Writes: `always_ask` |
| **Linear** | Project Management | OAuth 2.0 / API Key | Implemented | `linear.list_projects`, `linear.search_issues`, `linear.create_issue` | Reads: `auto`<br>Writes: `always_ask` |
| **Microsoft Outlook** | Email | OAuth 2.0 (MS Graph) | Planned / Coming Soon | `outlook.search_emails`, `outlook.send_email` | Reads: `auto`<br>Writes: `always_ask` |
| **Microsoft OneDrive** | Storage | OAuth 2.0 (MS Graph) | Planned / Coming Soon | `onedrive.search_files`, `onedrive.read_file` | Reads: `auto`<br>Writes: `always_ask` |
| **Jira & Confluence** | Project & Docs | OAuth 2.0 | Planned / Coming Soon | `jira.search_issues`, `confluence.search_pages` | Reads: `auto`<br>Writes: `always_ask` |

---

## Capabilities & Verified Operations

### Google Workspace (Gmail, Drive, Calendar)
- Search emails by query string (`from:`, `subject:`, `is:unread`, etc.).
- Retrieve email bodies and parse message headers.
- Search files in Drive with mime-type filters and export summaries.
- List calendar events with time-window filtering.
- Drafting emails and creating files/events with strict user approval gates.

### Notion
- Search workspace pages and databases by title or content.
- Retrieve page blocks and formatted markdown content.
- Query database properties.
- Append or create pages with human confirmation.

### GitHub
- Inspect repositories, READMEs, and file snippets.
- Search code across authorized repositories.
- List issues, pull requests, and commit histories.
- Create issues with user approval.

### Slack
- List public/private channels the bot has access to.
- Search messages across workspace discussions.
- Retrieve thread context.
- Post channel messages after user confirmation.
