# Connected Apps & Integrations OAuth Setup Guide

Rag_Mcp includes a built-in Connected Apps & Integrations Marketplace. Users can connect their own accounts to Gmail, Google Drive, Google Calendar, Notion, GitHub, and Slack to query, analyze, and perform authorized operations in natural language.

---

## 1. Google Workspace (Gmail, Google Drive, Google Calendar)

### Setup in Google Cloud Console
1. Go to the [Google Cloud Console](https://console.cloud.google.com/).
2. Create or select a project (e.g. `Rag-Mcp-Apps`).
3. Enable the following APIs under **APIs & Services -> Enabled APIs & services**:
   - **Gmail API**
   - **Google Drive API**
   - **Google Calendar API**
4. Configure the **OAuth consent screen**:
   - User Type: **External** (or Internal for Google Workspace domains).
   - Scopes:
     - `https://www.googleapis.com/auth/gmail.readonly`
     - `https://www.googleapis.com/auth/gmail.compose`
     - `https://www.googleapis.com/auth/gmail.send`
     - `https://www.googleapis.com/auth/drive.readonly`
     - `https://www.googleapis.com/auth/drive.file`
     - `https://www.googleapis.com/auth/calendar.events.readonly`
     - `https://www.googleapis.com/auth/calendar.events`
     - `https://www.googleapis.com/auth/userinfo.email`
     - `https://www.googleapis.com/auth/userinfo.profile`
5. Go to **Credentials -> Create Credentials -> OAuth client ID**:
   - Application type: **Web application**
   - Authorized JavaScript origins: `http://localhost:3000`
   - Authorized redirect URIs: `http://localhost:8000/api/v1/integrations/gmail/callback` (or your production API URL)
6. Add your Client ID and Client Secret to `.env`:
   ```env
   GOOGLE_CLIENT_ID=your_google_client_id.apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=your_google_client_secret
   ```

---

## 2. GitHub Integration

### Option A: Personal Access Token (PAT)
- Users can directly connect using a GitHub Personal Access Token (Classic or Fine-grained) with `repo` and `read:user` permissions directly in the Rag_Mcp Apps UI without setting up an OAuth application.

### Option B: OAuth App Registration
1. Go to **GitHub Settings -> Developer settings -> OAuth Apps -> New OAuth App**.
2. Fill in:
   - Application name: `Rag_Mcp Connected App`
   - Homepage URL: `http://localhost:3000`
   - Authorization callback URL: `http://localhost:8000/api/v1/integrations/github/callback`
3. Add credentials to `.env`:
   ```env
   GITHUB_CLIENT_ID=your_github_client_id
   GITHUB_CLIENT_SECRET=your_github_client_secret
   ```

---

## 3. Notion Integration

### Option A: Internal Integration Secret
- Create an internal integration at [notion.so/my-integrations](https://www.notion.so/my-integrations).
- Share the desired workspace pages or databases with the integration.
- Paste the internal integration token (`secret_...`) directly in the Rag_Mcp Apps UI.

### Option B: Public OAuth App
1. At [notion.so/my-integrations](https://www.notion.so/my-integrations), configure integration type as **Public**.
2. Set Redirect URI: `http://localhost:8000/api/v1/integrations/notion/callback`
3. Add credentials to `.env`:
   ```env
   NOTION_CLIENT_ID=your_notion_client_id
   NOTION_CLIENT_SECRET=your_notion_client_secret
   ```

---

## 4. Slack Integration

1. Go to [api.slack.com/apps](https://api.slack.com/apps) and click **Create New App** (From scratch).
2. Under **OAuth & Permissions**:
   - Add Redirect URL: `http://localhost:8000/api/v1/integrations/slack/callback`
   - Add User Scopes: `channels:history`, `channels:read`, `chat:write`, `search:read`
3. Under **Basic Information -> App Credentials**, copy Client ID and Client Secret:
   ```env
   SLACK_CLIENT_ID=your_slack_client_id
   SLACK_CLIENT_SECRET=your_slack_client_secret
   ```

---

## 5. Security Architecture

- **Token Encryption at Rest:** All access tokens and refresh tokens are encrypted using **AES-256-GCM** with an authentication tag before being saved in MongoDB.
- **Tenant Isolation:** Every connected account is strictly scoped by `workspaceId` and `userId`. A user cannot see, call, or borrow tokens from another user.
- **Secret Masking:** Serialization hooks automatically strip `encryptedAccessToken` and `encryptedRefreshToken` from API responses and client payloads.
- **Human-in-the-Loop Write Protection:** Any tool performing external mutations (e.g. `gmail.send_email`, `google_drive.create_file`, `github.create_issue`, `slack.send_message`) defaults to `always_ask`, requiring explicit user confirmation in the chat UI before execution.
