# Public Chatbot API & Platform API Keys Guide

Rag_Mcp includes a comprehensive **Platform API Key System and Public Chatbot API** that enables developers to integrate their hosted RAG chatbots into external web apps, mobile apps, customer portals, browser widgets, and backend services.

---

## 1. Key Architecture & Security Model

Platform API keys are separated into two distinct types:

| Key Type | Prefix | Target Environment | Security & Origin Enforcement |
| :--- | :--- | :--- | :--- |
| **Publishable Key** | `rag_pk_live_...` | Client-side frontend, browser widgets, embeds | Restricted to allowed domains (`allowedOrigins`). Cannot access admin endpoints. Safe for client code. |
| **Secret Key** | `rag_sk_live_...` | Server-to-server backends, CLI tools, automated jobs | High-entropy server secret. Never expose in browsers or public repositories. |

### Cryptographic Storage & Verification

- Keys are generated with 24 bytes (48 hex characters) of cryptographic entropy.
- Full keys are displayed **only once** upon creation.
- Plaintext secrets are **never** stored in the database.
- Storage records hold an HMAC-SHA-256 hash salted with `PLATFORM_KEY_PEPPER` alongside a masked identifier (e.g. `rag_sk_live_••••••••••••8F2D`).
- Rotation immediately replaces the stored hash and invalidates the prior secret.

### Chatbot-Specific Scoping

- **1 API Key → 1 Chatbot**: Every platform key is scoped to a single chatbot inside the workspace.
- Backend middleware strictly verifies that incoming requests target only the authorized chatbot (`_id` or `publicId`).
- Requests attempting to cross boundaries are rejected with `403 Forbidden`.

---

## 2. API Endpoints Reference

Base Path: `/api/v1/public`

### Authentication Headers

Pass your platform key via either of the following standard headers:

```http
Authorization: Bearer <YOUR_API_KEY>
```
or
```http
x-api-key: <YOUR_API_KEY>
```

---

### A. Health Check
```http
GET /api/v1/public/health
```
Returns service health and status:
```json
{
  "status": "ok",
  "service": "public-chatbot-api",
  "version": "v1",
  "timestamp": "2026-11-21T13:47:40.000Z"
}
```

---

### B. Safe Public Configuration
```http
GET /api/v1/public/chatbots/:chatbotId
```
Returns public metadata without revealing internal prompts, tool configs, or workspace details:
```json
{
  "data": {
    "id": "bot_cust_support",
    "name": "Customer Support Agent",
    "description": "Public customer support bot",
    "greeting": "Hello! How can I assist you?",
    "appearance": {
      "theme": "dark",
      "primaryColor": "#10a37f",
      "position": "bottom-right"
    },
    "suggestedQuestions": [
      "How to reset password?",
      "Pricing info"
    ],
    "capabilities": {
      "streaming": true,
      "fileUpload": false
    },
    "status": "ACTIVE"
  }
}
```

---

### C. Synchronous Chat Message
```http
POST /api/v1/public/chatbots/:chatbotId/messages
Content-Type: application/json
```

**Request Body:**
```json
{
  "message": "What is the return policy?",
  "conversationId": null,
  "visitorId": "visitor_anon_8821"
}
```

**Response (HTTP 200):**
```json
{
  "message": {
    "id": "6732f1a...",
    "role": "assistant",
    "content": "Our return policy allows items to be returned within 30 days of purchase.",
    "citations": [
      {
        "title": "Return Policy 2026.pdf",
        "url": "",
        "snippet": "Items can be returned within 30 days..."
      }
    ]
  },
  "conversationId": "6732f19...",
  "usage": {
    "inputTokens": 45,
    "outputTokens": 22
  }
}
```

---

### D. Streaming Chat Message (Server-Sent Events)
```http
POST /api/v1/public/chatbots/:chatbotId/messages/stream
Content-Type: application/json
```

**Request Body:**
```json
{
  "message": "Tell me about your services",
  "visitorId": "visitor_anon_8821"
}
```

**SSE Events Streamed:**
```
event: conversation
data: {"conversationId":"6732f19..."}

event: token
data: {"delta":"We "}

event: token
data: {"delta":"offer..."}

event: citations
data: [{"title":"Services.pdf","snippet":"..."}]

event: usage
data: {"prompt_tokens":32,"completion_tokens":18,"total_tokens":50}

event: done
data: {}
```

---

### E. Conversation History
```http
GET /api/v1/public/chatbots/:chatbotId/conversations/:conversationId?visitorId=visitor_anon_8821
```
*When accessed via a publishable key, matching `visitorId` is strictly enforced to protect visitor privacy.*

---

## 3. Integration Code Examples

### cURL (Synchronous)
```bash
curl -X POST "http://localhost:8000/api/v1/public/chatbots/YOUR_CHATBOT_ID/messages" \
  -H "Authorization: Bearer rag_sk_live_YOUR_SECRET_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "message": "How do I upgrade my plan?",
    "visitorId": "user_42"
  }'
```

### cURL (Live Streaming SSE)
```bash
curl -N -X POST "http://localhost:8000/api/v1/public/chatbots/YOUR_CHATBOT_ID/messages/stream" \
  -H "Authorization: Bearer rag_pk_live_YOUR_PUBLISHABLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "message": "Tell me about your platform",
    "visitorId": "user_42"
  }'
```

### JavaScript / Browser (Streaming with Fetch)
```javascript
const response = await fetch("http://localhost:8000/api/v1/public/chatbots/YOUR_CHATBOT_ID/messages/stream", {
  method: "POST",
  headers: {
    "Authorization": "Bearer rag_pk_live_YOUR_PUBLISHABLE_KEY",
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    message: "Hello chatbot!",
    visitorId: "anon_visitor_991"
  })
});

const reader = response.body.getReader();
const decoder = new TextDecoder("utf-8");

while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  const chunk = decoder.decode(value);
  // Parse lines starting with "data: "
  console.log("Chunk:", chunk);
}
```

### Node.js (Server-to-Server)
```javascript
import fetch from "node-fetch";

async function askRagBot(prompt) {
  const res = await fetch("http://localhost:8000/api/v1/public/chatbots/YOUR_CHATBOT_ID/messages", {
    method: "POST",
    headers: {
      "Authorization": "Bearer rag_sk_live_YOUR_SECRET_KEY",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ message: prompt })
  });

  const data = await res.json();
  console.log("Assistant:", data.message.content);
  return data;
}
```

### Python
```python
import requests

url = "http://localhost:8000/api/v1/public/chatbots/YOUR_CHATBOT_ID/messages"
headers = {
    "Authorization": "Bearer rag_sk_live_YOUR_SECRET_KEY",
    "Content-Type": "application/json"
}
payload = {
    "message": "What is our company return policy?",
    "visitorId": "user_123"
}

res = requests.post(url, json=payload, headers=headers)
print(res.json()["message"]["content"])
```
