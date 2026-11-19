# Rag_Mcp Architecture & Multi-Tenant Design

Rag_Mcp is a multi-tenant RAG (Retrieval-Augmented Generation) & Model Context Protocol (MCP) platform.

---

## 1. Data Layer: Hosted MongoDB Atlas

The backend uses **MongoDB Atlas with Mongoose** exclusively (no PostgreSQL, no Prisma, no pgvector, and no local MongoDB containers).

### Mongoose Collections & Tenant Ownership
All tenant-owned documents include a required `workspaceId` (ObjectId) field and are indexed accordingly:

| Collection | Ownership | Description |
|---|---|---|
| `users` | Global | User identity, email (unique lowercase), password hash |
| `workspaces` | Global | Tenant workspace container, unique slug |
| `memberships` | User + Workspace | Relational mapping with roles (`OWNER`, `ADMIN`, `MEMBER`) |
| `refreshtokens` | User | Refresh tokens stored hashed with SHA-256 and TTL index |
| `knowledgebases`| Workspace | Knowledge base collections per tenant |
| `sources` | Workspace + KB | Uploaded files (PDF, DOCX, TXT, CSV) and URLs |
| `chatbots` | Workspace | Deployed chatbot configurations with unique `publicId` |
| `conversations` | Workspace | Chat sessions tied to users and bots |
| `messages` | Workspace + Conv | Unbounded conversation turns with subdocument citations |
| `apikeys` | Workspace | Tenant API keys, secrets hashed with SHA-256 |
| `mcpservers` | Workspace | MCP tool servers with per-tool permissions |
| `webhooks` | Workspace | Event subscriptions, secrets hashed |
| `evalruns` | Workspace + KB | RAG evaluation runs (faithfulness, relevance) |

---

## 2. Multi-Tenant Isolation Rules

Multi-tenancy is enforced on **every single request**:

1. **Authentication & Tenant Resolution:**
   - Client sends JWT access token in `Authorization: Bearer <token>`.
   - `auth.middleware.js` verifies the JWT signature and extracts `req.user.id`.
   - `tenant-guard.middleware.js` inspects the optional `X-Workspace-Id` header (or defaults to the user's personal/primary workspace).
   - Validates that an active `Membership` document exists for `(userId, workspaceId)`. If not found, returns **`404 Not Found`** (never `403`, to avoid leaking workspace existence).
2. **Query Filtering:**
   - Every database query in services must explicitly include `{ workspaceId: req.workspaceId }`.
   - Any query attempting to access or modify another tenant's resource fails to match and returns `404 Not Found`.
3. **Cross-Tenant Reference Validation:**
   - Creating or updating resources that reference other resources (e.g. creating a Chatbot linked to a `knowledgeBaseId`) strictly verifies that the referenced resource also belongs to `req.workspaceId`.

---

## 3. Hybrid Search: The `chunks` Collection & Atlas Search Indexes

The `chunks` collection is managed and populated by the Python `ai-service`:
- **Document Structure:** `{ workspaceId, knowledgeBaseId, sourceId, text, metadata, embedding[] }`
- **Shared Index Strategy:** Free MongoDB Atlas M0 clusters enforce strict search index limits. Therefore, all tenants share **two centralized search indexes**:
  1. **`chunks_vector`** (`vectorSearch`):
     - Field: `embedding` (numDimensions from `EMBEDDING_DIMENSIONS`, cosine similarity)
     - Filter paths: `workspaceId`, `knowledgeBaseId`, `sourceId`
  2. **`chunks_text`** (`search` / Lucene):
     - Text search on `text` and `metadata.title`
     - Token filters on `workspaceId`, `knowledgeBaseId`, `sourceId`
- **Tenant Isolation in Search:**
  Multi-tenant isolation in hybrid search is strictly enforced at query execution time by requiring the `workspaceId` filter inside every `$vectorSearch` and `$search` aggregation pipeline stage.

---

## 4. File Storage Interface
File bytes are never stored in MongoDB. Uploads are handled by `multer` (with strict magic-byte executable verification) and stored behind an abstract `storage` interface (currently local disk in `./storage/`, swappable for AWS S3).

---

## 5. Internal Service Contract: Node API & Python AI Service

The platform follows a split-service architecture where the Node API (`apps/api`) acts as the public-facing gateway and orchestrator, while the Python AI Service (`services/ai-service`) acts as the internal processing engine for ML/vector workloads.

### Security & Authentication Boundary
- **Internal Only**: The Python AI Service is never exposed directly to external end-users.
- **Shared Secret (`X-Internal-Key`)**: Every internal endpoint (except `/health`) requires an `X-Internal-Key` header matching `INTERNAL_API_KEY`. Verification is performed using constant-time comparison (`secrets.compare_digest`) to prevent timing attacks.
- **Tenant Context (`X-Workspace-Id`)**: The Node API validates the user's JWT or public widget origin, and forwards the verified 24-hex ObjectId in `X-Workspace-Id`. The Python service strictly rejects any request lacking this header.

### Responsibilities & Data Ownership
| Domain | Node API (`apps/api`) | Python AI Service (`services/ai-service`) |
|---|---|---|
| Users & Workspaces | Primary source of truth | Stateless (reads via tenant header) |
| Knowledge Bases & Sources | Metadata & file storage keys | `chunks` collection & search indexes |
| Chatbots & Widget | Configuration, themes, public API | LLM prompt synthesis & streaming |
| Conversations & Messages | Persistent history in MongoDB | Formatted prompt context builder |
| Search & RAG | Relays requests & streams SSE | ANN vector + BM25 hybrid search |
| Evaluations | UI & triggers | Benchmarks (Hit Rate@k, MRR, Faithfulness) |

### Internal Contract Endpoints
- **`POST /ingest`**: Initiates ingestion pipeline (web crawl or file extraction, text chunking, embedding generation, two-phase atomic index update).
- **`DELETE /sources/:id/chunks`**: Deletes all chunks associated with a source.
- **`DELETE /knowledge-bases/:id/chunks`**: Cascade-deletes all chunks for a deleted knowledge base.
- **`GET /usage`**: Returns workspace chunk counts, estimated storage MB, and cluster quota percentages.
- **`POST /retrieve`**: Executes hybrid retrieval returning candidates, scores (`vectorScore`, `textScore`, `fusedScore`), and citations.
- **`POST /chat`**: Server-Sent Events (SSE) stream emitting `citations`, `token`, `usage`, and `done` events with prompt-injection defense.
- **`POST /evaluate`**: Computes retrieval & generation benchmarks against test datasets in `evals/datasets/` and writes run reports to `evals/reports/`.

### Resilience & Failure Modes
1. **Network Retries**: The Node API client (`aiClient`) employs exponential backoff for transient 502/503/504 errors.
2. **Client Disconnection**: The Node API aborts upstream AI service streaming immediately when the client disconnects (`req.on("close")`).
3. **Graceful Degradation**: If the AI service is momentarily unreachable during usage queries, safe fallback zero-defaults are returned to prevent dashboard downtime.

