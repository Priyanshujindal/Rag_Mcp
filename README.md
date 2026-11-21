# RAG MCP Platform (`Rag_Mcp`)

A production-ready monorepo for **Retrieval-Augmented Generation (RAG)** chatbots, multi-tenant knowledge bases, automated evaluation benchmarks, and **Model Context Protocol (MCP)** tool execution.

---

## 🏛️ System Architecture

```
                    ┌──────────────────────────────────────────────┐
                    │       Web Application (React 18 + Vite)      │
                    │               localhost:3000                 │
                    └───────────────┬──────────────────────────────┘
                                    │ HTTP / SSE / WebSockets
                                    ▼
                    ┌──────────────────────────────────────────────┐
                    │        API Server (Node.js + Express)        │
                    │               localhost:8000                 │
                    │    • JWT Auth & RBAC   • MongoDB Mongoose    │
                    │    • Quotas & Limits   • MCP Client Runner   │
                    └───────────────┬──────────────────────────────┘
                                    │ HTTP Internal (X-Internal-Key)
                                    ▼
                    ┌──────────────────────────────────────────────┐
                    │       AI Service (Python 3.12 + FastAPI)     │
                    │               localhost:8001                 │
                    │    • PyMuPDF & Crawl   • FastEmbed (ONNX)    │
                    │    • Hybrid Retrieval  • Cross-Encoder Rerank│
                    │    • LLM Orchestration • RAG Evaluation      │
                    └───────────────┬──────────────────────────────┘
                                    │
            ┌───────────────────────┴───────────────────────┐
            ▼                                               ▼
┌───────────────────────────┐                   ┌───────────────────────────┐
│     MongoDB Atlas (SRV)   │                   │    LLM Providers (APIs)   │
│ • Sources & Chunk Vectors │                   │ • Google Gemini (3.8/3.5) │
│ • Conversations & Evals   │                   │ • Groq LPU (Qwen/Llama)   │
│ • MCP Server Configs      │                   │ • Cloudflare Workers AI   │
└───────────────────────────┘                   │ • OpenRouter              │
                                                └───────────────────────────┘
```

---

## 📦 Monorepo Packages & Workspaces

| Workspace | Technology | Description |
| :--- | :--- | :--- |
| **`apps/web`** | React 18, Vite, Tailwind/CSS | Chat canvas, interactive artifacts, slide deck preview, RAG debugger & Evals dashboard |
| **`apps/api`** | Node.js, Express, Mongoose | Core backend handling auth, tenant isolation, documents, MCP runners, and usage quotas |
| **`services/ai-service`** | Python 3.12, FastAPI, PyMuPDF | Ingestion pipeline, recursive crawler, vector embeddings, hybrid search, and evaluation |
| **`packages/widget`** | Vanilla JS, Vite | Lightweight embeddable chat widget script for external web applications |
| **`packages/mcp-servers`** | Node.js, TypeScript | Standard Model Context Protocol servers and custom tool integrations |
| **`packages/shared`** | TypeScript | Shared data schemas, validation contracts, and utilities |

---

## 🌐 Local Development Ports

| Component | URL | Notes |
| :--- | :--- | :--- |
| **Web Dashboard** | `http://localhost:3000` | Main user interface |
| **API Server** | `http://localhost:8000` | Core backend REST API |
| **AI Service** | `http://localhost:8001` | Ingestion, retrieval & LLM pipeline |
| **Embeddable Widget** | `http://localhost:5174` | Standalone widget preview |
| **Redis** *(optional)* | `localhost:6379` | Background queues & rate limits |

---

## ⚡ Quick Start

### 1. Prerequisites
- **Node.js**: `v20.x` or `v22.x`
- **pnpm**: `v9.x` (`corepack enable && corepack prepare pnpm@latest --activate`)
- **Python**: `>= 3.12`
- **MongoDB Atlas**: Free cluster connection string with read/write permissions

---

### 2. Environment Configuration
Copy the sample environment file to `.env`:
```bash
cp .env.example .env
```
Ensure the following key variables are configured in `.env` (and `services/ai-service/.env` if running AI service standalone):
- `MONGODB_URI`: MongoDB Atlas connection string (`mongodb+srv://...`)
- `MONGODB_DB_NAME`: Database name (e.g. `Rag_Mcp`)
- `INTERNAL_API_KEY`: Minimum 32-character shared secret between Node API and Python AI Service
- `JWT_ACCESS_SECRET` & `JWT_REFRESH_SECRET`: Secure 64-character tokens
- `GEMINI_API_KEY`: API key for Gemini 3.8/3.5 models ([Google AI Studio](https://aistudio.google.com/app/apikey))
- Optional inference keys: `GROQ_API_KEY`, `OPENROUTER_API_KEY`, `CLOUDFLARE_API_TOKEN`

---

### 3. Install Dependencies

```bash
# Install Node dependencies across all workspaces
pnpm install

# Setup Python AI service virtual environment
cd services/ai-service
python -m venv .venv

# Activate venv (Windows):
.venv\Scripts\activate
# Activate venv (macOS/Linux):
# source .venv/bin/activate

pip install -r requirements.txt
cd ../..
```

---

### 4. Run the Development Servers

Open separate terminal windows or run services concurrently:

#### Terminal 1: Node API Server
```bash
pnpm dev:api
# Running on http://localhost:8000
```

#### Terminal 2: Python AI Service
```bash
cd services/ai-service
# Windows:
.venv\Scripts\activate
# Linux/macOS:
# source .venv/bin/activate

uvicorn app.main:app --port 8001 --reload
# Running on http://localhost:8001
```

#### Terminal 3: Web Dashboard
```bash
pnpm dev:web
# Running on http://localhost:3000
```

*Tip: You can run both the Node API and Web dashboard together with `pnpm dev:all`.*

---

## 🔑 Default Demo Account

For quick local evaluation without registering a new tenant:
- **Email**: `demo@rag-mcp.ai`
- **Password**: `Demo@12345`

---

## ✨ Key Capabilities

### 1. Robust Multi-Tenant Knowledge Ingestion
- **Document Extractors**: High-fidelity text parsing for `.pdf` (PyMuPDF), `.docx` (python-docx), `.csv`, and `.txt` files.
- **Recursive Web Crawler**: SSRF-safe crawling with `robots.txt` compliance, sitemap auto-discovery, depth limits, and same-origin validation.
- **Deduplication & Quotas**: Cross-page content hashing prevents duplicate chunks; strict workspace chunk quotas are enforced prior to embedding computation.
- **Two-Phase Reindexing**: Guarantees zero-downtime reindexing by staging new vectors before safely atomic swapping.

### 2. Advanced Hybrid RAG Pipeline
- **Embeddings**: Local, high-speed ONNX vector embeddings via `fastembed` (`BAAI/bge-small-en-v1.5`, 384 dimensions) with support for remote providers.
- **Hybrid Search**: Combines BM25 lexical keyword matching with dense vector cosine similarity.
- **Cross-Encoder Reranker**: Post-retrieval reranking filters irrelevant context chunks to boost answer precision.
- **Multi-Model Orchestration**: Seamless streaming chat via Google Gemini (3.8 Flash, 3.5 Flash), Groq LPU, Cloudflare Workers AI, and OpenRouter.

### 3. Model Context Protocol (MCP) Integration
- Direct execution of external tools adhering to Anthropic's open MCP specification.
- Granular human-in-the-loop approval workflows for sensitive actions (destructive operations, external API mutations).
- Full audit logging of tool execution parameters, runtime durations, and outputs.

### 4. Automated RAG Evaluation & Hallucination Guard
- Automated testing benchmarks calculating **Faithfulness**, **Answer Relevance**, **Context Recall / MRR**, and **Hallucination Risk**.
- Visual sample-by-sample analysis showing ground-truth comparisons and retrieved source chunk IDs.

### 5. Generative Artifacts & Presentation Builder
- Live interactive artifact previewing (Markdown, SVG diagrams, and generated PPTX slide decks).

---

## 🧪 Testing & Quality Checks

Run test suites across all workspaces:

```bash
# 1. API Server Tests (Vitest)
pnpm --filter @rag-mcp/api test

# 2. Web Frontend Tests (Vitest)
pnpm --filter @rag-mcp/web test

# 3. Python AI Service Tests (Pytest)
cd services/ai-service
pytest tests/ -q
cd ../..

# 4. Production Monorepo Build Check
pnpm build
```

---

## 🛡️ CI/CD Pipeline
Continuous integration runs on GitHub Actions (`.github/workflows/ci.yml`):
- Node.js 20 build, linting, and automated test execution across `@rag-mcp/api` and `@rag-mcp/web`.
- Python 3.12 test suite with FastEmbed ONNX model caching and MongoDB test safety guards.

---

## 📄 License
MIT License. Created by [Priyanshu Jindal](https://github.com/Priyanshujindal).
