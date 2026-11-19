# MongoDB Atlas Setup Guide for Rag_Mcp

This document guides you through setting up a hosted MongoDB Atlas cluster for the Rag_Mcp platform.

---

## 1. Create an Atlas Cluster
1. Sign in to [MongoDB Atlas](https://cloud.mongodb.com).
2. Create a new Project (e.g. `Rag_Mcp`).
3. Deploy a cluster:
   - Select the **M0 Free Tier** (shared instance).
   - Choose a cloud provider and region closest to your deployment server (e.g., AWS / `us-east-1` or `ap-south-1`).
   - Click **Create Deployment**.

---

## 2. Database User Setup
1. In the Atlas sidebar, navigate to **Security** → **Database Access**.
2. Click **Add New Database User**:
   - Authentication Method: **Password**.
   - Username: e.g. `ragmcp_app`.
   - Autogenerate or specify a secure password.
3. Under **Database User Privileges**:
   - Do **NOT** assign Atlas Admin.
   - Choose **Built-in Role** or **Specific Privileges**:
   - Grant `readWrite` on the **`Rag_Mcp`** database.
   - Grant `readWrite` on the **`Rag_Mcp_test`** database.
4. Click **Add User**.

---

## 3. Network Access (IP Allowlist)
1. In the Atlas sidebar, navigate to **Security** → **Network Access**.
2. Click **Add IP Address**:
   - Add your development machine's current public IP address (click **Add Current IP Address**).
   - **Important:** Do NOT use `0.0.0.0/0` (allow access from anywhere) in production.
3. Click **Confirm**.

---

## 4. Obtain the Connection String
1. In the **Database Deployments** view, click **Connect** on your cluster.
2. Choose **Drivers** (Node.js or Python).
3. Copy the SRV connection URI:
   ```env
   mongodb+srv://ragmcp_app:<password>@<cluster>.mongodb.net/?retryWrites=true&w=majority
   ```
4. Paste this into your root `.env` file as `MONGODB_URI`.
5. Set `MONGODB_DB_NAME=Rag_Mcp` and `MONGODB_TEST_DB_NAME=Rag_Mcp_test`.

---

## 5. Atlas Vector & Full-Text Search Indexes (`chunks`)
The `chunks` collection is managed and populated by the Python AI service (`services/ai-service`).

### Free Tier Cluster Limit Warning
> **Atlas Index Limit Notice:** MongoDB Atlas **M0 Free Tier clusters strictly cap the number of Atlas Search indexes at 3 indexes total** across the entire cluster.
> 
> Therefore, Rag_Mcp uses **exactly two shared search indexes** for all workspaces and knowledge bases:
> 1. `chunks_vector` (Atlas Vector Search)
> 2. `chunks_text` (Atlas Search full-text)
> 
> Creating separate indexes per workspace or knowledge base would immediately exceed the M0 limit and fail. Strict multi-tenant isolation is enforced inside every query pipeline by including `workspaceId` as an `objectId` filter inside the `$vectorSearch` and `$search` stages.

### Standard B-Tree Indexes (`chunks`)
In addition to the Atlas Search indexes, the following standard B-Tree indexes are created and verified on the `chunks` collection:
- `idx_workspace_kb_source`: Compound index on `(workspaceId, knowledgeBaseId, sourceId)` for fast tenant-scoped hierarchy lookups.
- `idx_source_ingestion`: Compound index on `(sourceId, ingestionId)` for fast cleanup of specific ingestion runs.
- `idx_source_ingestion_contenthash_unique`: Unique compound index on `(sourceId, ingestionId, contentHash)`. This replaces the legacy unique index on `(sourceId, contentHash)` to safely enable two-phase re-indexing (where new chunks are inserted with a new `ingestionId` before older chunks are deleted, avoiding duplicate key collisions on unchanged content). The migration helper in `ensure_indexes()` drops the legacy index idempotently.

### Index Specifications
1. **`chunks_vector`** (Vector Search Index, `type: vectorSearch`):
   - Path: `embedding`
   - Similarity: `cosine`
   - Dimensions: Configured via `EMBEDDING_DIMENSIONS` (default `384` for `BAAI/bge-small-en-v1.5`).
   - Filter fields: `workspaceId`, `knowledgeBaseId`, `sourceId`.
2. **`chunks_text`** (Full-Text Search Index, `type: search`):
   - Indexed text fields: `text`, `metadata.title` (analyzer: `lucene.standard`).
   - Filter fields: `workspaceId`, `knowledgeBaseId`, `sourceId` (type: `objectId`).

### Automated Management
You can automatically create, verify, or inspect the status of both indexes using the AI service CLI:
```powershell
# In services/ai-service:
python -m app.rag.indexes --status
python -m app.rag.indexes --ensure
```
The exact JSON schemas are maintained in [infra/db/vector-index.json](file:///c:/Users/DELL/OneDrive/Documents/Rag_Mcp/infra/db/vector-index.json).
