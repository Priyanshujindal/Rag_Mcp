# Rag_Mcp API Reference

Base URL: `http://localhost:8000/api/v1`

All responses follow standard JSON envelopes:
- Success: Object / Array with `id` strings (never `_id` or `__v`).
- Error: `{ error: { code: string, message: string, details?: any[] } }`

---

## Headers
- `Authorization`: `Bearer <jwt_access_token>` (required on all protected endpoints)
- `X-Workspace-Id`: `<24_char_hex_workspace_id>` (optional; defaults to user's first/personal workspace)
- `X-Request-Id`: `<uuid>` (optional; returned in response headers for request correlation)

---

## 1. System & Probes
| Method | Endpoint | Description | Status |
|---|---|---|---|
| `GET` | `/health` | Liveness probe returning ISO timestamp | 200 |
| `GET` | `/ready` | Readiness probe verifying MongoDB Atlas connectivity | 200 / 503 |

---

## 2. Authentication (`/api/v1/auth`)
| Method | Endpoint | Description | Request Body | Rate Limit |
|---|---|---|---|---|
| `POST` | `/api/v1/auth/register` | Register user, auto-provisions personal workspace & owner role | `{ email, password, name }` | 10 req / 15 min per IP |
| `POST` | `/api/v1/auth/login` | Authenticate with credentials. Refresh token issued in `httpOnly` cookie only | `{ email, password }` | 10 failed / 15 min per IP+email; 20 failed / hr per email |
| `POST` | `/api/v1/auth/refresh` | Atomically rotate refresh token from `httpOnly` cookie with race grace window (`REFRESH_GRACE_SECONDS`) | *Cookie only* | 60 req / 15 min per IP |
| `POST` | `/api/v1/auth/logout` | Revoke current refresh token and clear cookie | *Cookie only* | None |
| `GET` | `/api/v1/auth/me` | Return profile and associated workspaces | *None* | Standard |

---

## 3. Knowledge Bases (`/api/v1/knowledge-bases`)
Protected with JWT + Tenant Guard.
| Method | Endpoint | Description | Request Body / Query |
|---|---|---|---|
| `GET` | `/api/v1/knowledge-bases` | List knowledge bases with pagination & sort | `?page=1&limit=20&sort=-createdAt` |
| `POST` | `/api/v1/knowledge-bases` | Create knowledge base (enforces `MAX_KBS_PER_WORKSPACE`) | `{ name, description? }` |
| `GET` | `/api/v1/knowledge-bases/:id` | Get single knowledge base | *None* |
| `PATCH` | `/api/v1/knowledge-bases/:id` | Update name, description, or status | `{ name?, description?, status? }` |
| `DELETE` | `/api/v1/knowledge-bases/:id` | Cascade delete knowledge base and its sources | *None* |

---

## 4. Sources (`/api/v1/sources`)
Protected with JWT + Tenant Guard.
| Method | Endpoint | Description | Request Body / Query |
|---|---|---|---|
| `GET` | `/api/v1/sources` | List sources | `?knowledgeBaseId=...&page=1&limit=50` |
| `POST` | `/api/v1/sources` | Create URL source (validates workspace KB ownership & quota) | `{ knowledgeBaseId, name, url }` |
| `GET` | `/api/v1/sources/:id` | Get source details | *None* |
| `POST` | `/api/v1/sources/:id/reindex` | Trigger re-index (sets status to `QUEUED`) | *None* |
| `DELETE` | `/api/v1/sources/:id` | Delete source record & physical uploaded file | *None* |
| `POST` | `/api/v1/sources/upload` | Multipart file upload (`pdf`, `docx`, `txt`, `csv`) | `multipart/form-data`: `file`, `knowledgeBaseId` |

---

## 5. Chatbots (`/api/v1/chatbots`)
Protected with JWT + Tenant Guard.
| Method | Endpoint | Description | Request Body / Query |
|---|---|---|---|
| `GET` | `/api/v1/chatbots` | List chatbots in workspace | `?page=1&limit=20` |
| `POST` | `/api/v1/chatbots` | Create chatbot with auto-generated `publicId` | `{ name, knowledgeBaseId?, status?, config?, allowedOrigins? }` |
| `GET` | `/api/v1/chatbots/:id` | Get chatbot | *None* |
| `GET` | `/api/v1/chatbots/:id/embed` | Returns embed script tag with `WIDGET_URL` and `publicId` | *None* |
| `PATCH` | `/api/v1/chatbots/:id` | Update chatbot configuration (`publicId` immutable) | `{ name?, status?, config?, allowedOrigins? }` |
| `DELETE` | `/api/v1/chatbots/:id` | Cascade delete chatbot, conversations, and messages | *None* |

---

## 6. API Keys (`/api/v1/api-keys`)
Protected with JWT + Tenant Guard.
| Method | Endpoint | Description | Request Body |
|---|---|---|---|
| `GET` | `/api/v1/api-keys` | List API keys (shows prefix, lastUsedAt, revokedAt; never secret) | *None* |
| `POST` | `/api/v1/api-keys` | Generate new API key (secret returned ONCE in response) | `{ name }` |
| `POST` | `/api/v1/api-keys/:id/revoke` | Revoke an API key immediately | *None* |
| `DELETE` | `/api/v1/api-keys/:id` | Permanently delete API key | *None* |

---

## 7. MCP Servers (`/api/v1/mcp`)
Protected with JWT + Tenant Guard.
| Method | Endpoint | Description | Request Body |
|---|---|---|---|
| `GET` | `/api/v1/mcp` | List registered MCP servers | *None* |
| `POST` | `/api/v1/mcp` | Register MCP server | `{ name, url?, command?, transport?, tools? }` |
| `GET` | `/api/v1/mcp/:id` | Get MCP server details | *None* |
| `PATCH` | `/api/v1/mcp/:id` | Update MCP server | `{ name?, url?, command?, transport?, tools? }` |
| `DELETE` | `/api/v1/mcp/:id` | Delete MCP server | *None* |
| `PATCH` | `/api/v1/mcp/:id/tools/:toolName` | Toggle tool enabled / approval requirement | `{ enabled?, requiresApproval? }` |

---

## 8. Usage & Quotas (`/api/v1/usage`)
Protected with JWT + Tenant Guard.
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/v1/usage` | Returns current counts vs. configured quotas for KBs, sources, bots, storage |

---

## 9. Stubs (Mounted Route Map - 501 Not Implemented)
| Path | Status |
|---|---|
| `/api/v1/analytics/*` | 501 Not Implemented |
| `/api/v1/conversations/*` | 501 Not Implemented |
| `/api/v1/webhooks/*` | 501 Not Implemented |
| `/api/v1/public/*` | 501 Not Implemented |

