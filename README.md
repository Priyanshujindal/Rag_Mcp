# RAG MCP Monorepo (Rag_Mcp)

A production monorepo for RAG (Retrieval-Augmented Generation) chatbots and MCP (Model Context Protocol) tool integration.

## Workspaces

- **`apps/web`**: Web dashboard and ChatGPT-style chat canvas built with React 18, Vite, and custom CSS design system. See [apps/web/README.md](apps/web/README.md).
- **`services/ai-service`**: Python/FastAPI retrieval and agentic orchestration service.
- **`packages/widget`**: Standalone embeddable customer-facing chat widget.
- **`packages/mcp-servers`**: Modular MCP servers and tool connectors.
- **`packages/shared`**: Shared TypeScript types and client utilities.

## Local Development Ports

- **Web (Frontend)**: `http://localhost:3000`
- **API (Backend)**: `http://localhost:8000`
- **Redis (Cache & Queues)**: `localhost:6379`

## Quick Start

```bash
# Install dependencies
pnpm install

# Run frontend in development mode
pnpm dev

# Build frontend
pnpm build

# Lint frontend
pnpm lint

# Run all API tests (gracefully skips live Atlas suite if unreachable)
pnpm --filter @rag-mcp/api test

# Run API unit/validation/model tests (requires zero DB connection)
pnpm --filter @rag-mcp/api test:unit

# Run live Atlas database tests (hard fails if Atlas is unreachable or REQUIRE_LIVE_TESTS=true)
pnpm --filter @rag-mcp/api test:live

# Run web offline tests (asserts ZERO network requests in mock mode & in-memory token safety)
pnpm --filter @rag-mcp/web test

# demo user id and password
user id: demo@rag-mcp.ai
password: Demo@12345 
```

