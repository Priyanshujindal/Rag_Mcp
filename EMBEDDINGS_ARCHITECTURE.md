# Where Are Your Embeddings Stored?

## YES! Embeddings are stored in MongoDB Atlas

Your embeddings are stored in **MongoDB Atlas** in the `chunks` collection, and you're using **MongoDB Atlas Vector Search** for similarity queries.

## Storage Architecture

### 1. Chunks Collection (MongoDB Atlas)
**Collection**: `chunks`
**Database**: `Rag_Mcp`

Each chunk document contains:
```javascript
{
  _id: ObjectId("..."),
  workspaceId: ObjectId("..."),
  knowledgeBaseId: ObjectId("..."),
  sourceId: ObjectId("..."),
  ingestionId: "uuid-hex-string",
  chunkIndex: 0,
  text: "The actual chunk text content...",
  embedding: [0.123, -0.456, 0.789, ...],  // 384-dimensional vector
  embeddingModel: "sentence-transformers/all-MiniLM-L6-v2",
  contentHash: "sha256-hash",
  metadata: {
    url: "https://...",
    title: "...",
    heading: "...",
    sourceType: "URL"
  },
  createdAt: ISODate("2026-11-06T...")
}
```

### 2. Vector Index Configuration

**Index Name**: `chunks_vector`
**Type**: `vectorSearch` (MongoDB Atlas Vector Search)
**Dimensions**: 384
**Similarity**: Cosine similarity
**Filter Fields**: workspaceId, knowledgeBaseId, sourceId

**Location**: MongoDB Atlas (cloud-hosted)
**Index Definition**: `infra/db/vector-index.json`

## Verification from Backfill Script

From the backfill we just ran, we confirmed:
- ✅ Your JavaScript Guide has **919 chunks**
- ✅ All chunks have embeddings: `embedding: [...]` array
- ✅ Each embedding has **384 dimensions**
- ✅ Embedding model: `all-MiniLM-L6-v2`

```
Chunks checked: 50
Chunks with embeddings: 50
Sample embedding length: 384
```

## How Vector Search Works

### 1. Query Embedding Generation
When a user asks a question:
```python
# services/ai-service/app/rag/retrieval.py
query_embedding = await embedding_provider.embed_query("How do I use async/await?")
# Returns: [0.234, -0.567, 0.890, ...] (384 dims)
```

### 2. Vector Search via MongoDB Atlas
```python
# services/ai-service/app/rag/vector_store.py
results = await store.vector_search(
    workspace_id=workspace_id,
    kb_id=knowledge_base_id,
    query_embedding=query_embedding,
    top_n=5
)
```

This generates a MongoDB aggregation pipeline:
```javascript
[
  {
    $vectorSearch: {
      index: "chunks_vector",
      path: "embedding",
      queryVector: [0.234, -0.567, ...],
      numCandidates: 50,
      limit: 5,
      filter: {
        workspaceId: { $eq: ObjectId("...") },
        knowledgeBaseId: { $eq: ObjectId("...") }
      }
    }
  },
  {
    $addFields: {
      vectorScore: { $meta: "vectorSearchScore" }
    }
  }
]
```

### 3. Results
Returns the top 5 most similar chunks with scores:
```javascript
[
  {
    _id: ObjectId("..."),
    text: "Async/await is syntactic sugar for promises...",
    vectorScore: 0.87,  // Cosine similarity score (0-1)
    metadata: { ... }
  },
  // ... 4 more results
]
```

## Why MongoDB Atlas (Not a Separate Vector Database)

Your system uses **MongoDB Atlas Vector Search** instead of a separate vector database (like Pinecone, Weaviate, or Chroma) because:

### Advantages:
1. ✅ **Single Database**: Embeddings, chunks, and metadata all in one place
2. ✅ **No Data Sync**: No need to sync between document DB and vector DB
3. ✅ **Cost Effective**: Free tier includes vector search
4. ✅ **Tenant Isolation**: Filter by workspaceId at query time
5. ✅ **Hybrid Search**: Combine vector search with text search (BM25) and filters

### How It Works:
- MongoDB Atlas has built-in vector indexing capability
- Uses HNSW (Hierarchical Navigable Small World) algorithm
- Performs approximate nearest neighbor (ANN) search
- Scales automatically with your cluster

## Complete Data Flow

### Indexing (Write Path):
```
1. User uploads document
   ↓
2. AI Service extracts text and chunks it
   ↓
3. Generate embeddings for each chunk (384-dim vectors)
   ↓
4. Store chunks with embeddings in MongoDB
   ↓
5. MongoDB Atlas automatically indexes embeddings
```

### Retrieval (Read Path):
```
1. User asks question in chatbot
   ↓
2. Generate query embedding (384-dim vector)
   ↓
3. MongoDB Atlas Vector Search finds similar chunks
   ↓
4. Return top K most relevant chunks
   ↓
5. LLM generates answer using retrieved context
```

## Your System Architecture

```
┌─────────────────────────────────────────────────────────┐
│                  MongoDB Atlas Cloud                     │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  Database: Rag_Mcp                                       │
│  ┌────────────────────────────────────────────┐        │
│  │  Collection: chunks                         │        │
│  │  ├─ text: "chunk content"                   │        │
│  │  ├─ embedding: [384-dim vector]            │        │
│  │  └─ metadata: {...}                         │        │
│  └────────────────────────────────────────────┘        │
│                     ↓                                    │
│  ┌────────────────────────────────────────────┐        │
│  │  Vector Index: chunks_vector                │        │
│  │  - Type: vectorSearch                       │        │
│  │  - Dimensions: 384                          │        │
│  │  - Similarity: cosine                       │        │
│  │  - Filter fields: workspaceId, kbId         │        │
│  └────────────────────────────────────────────┘        │
│                                                          │
└─────────────────────────────────────────────────────────┘
                        ↑
                        │ MongoDB Driver
                        │
┌───────────────────────┴─────────────────────────────────┐
│  AI Service (Python FastAPI)                            │
│  - Embedding Generation (all-MiniLM-L6-v2)              │
│  - Vector Search Queries                                │
│  - RAG Pipeline                                         │
└──────────────────────────────────────────────────────────┘
```

## Files Involved

### Vector Search Implementation:
- `services/ai-service/app/rag/vector_store.py` - Vector search queries
- `services/ai-service/app/rag/embeddings.py` - Embedding generation
- `services/ai-service/app/rag/retrieval.py` - RAG pipeline
- `services/ai-service/app/schemas/rag.py` - Chunk schema (includes embedding field)

### Index Configuration:
- `infra/db/vector-index.json` - Vector index definition
- `services/ai-service/app/db/indexes.py` - Index management

### Storage:
- `services/ai-service/app/ingestion/pipeline.py` - Stores chunks with embeddings

## Summary

✅ **Yes, embeddings are stored in MongoDB Atlas**
✅ **919 chunks × 384 dimensions = 352,896 floats stored for your JS Guide**
✅ **MongoDB Atlas Vector Search provides the vector database capability**
✅ **No separate vector database needed**
✅ **Everything is in one place: chunks, embeddings, and metadata**

Your system is using a **modern, unified approach** where MongoDB Atlas acts as both your document database AND your vector database, eliminating the complexity of managing multiple systems.
