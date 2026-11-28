FROM node:20-bookworm-slim

# Install Python 3, curl, and uv so custom stdio MCP servers (npx, uv, python) run cleanly
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    curl \
    ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && curl -LsSf https://astral.sh/uv/install.sh | env UV_INSTALL_DIR="/usr/local/bin" sh

RUN npm install -g pnpm@9

WORKDIR /app

# Copy workspace manifests
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY packages/mcp-servers/package.json packages/mcp-servers/package.json
COPY packages/widget/package.json packages/widget/package.json

RUN pnpm install --frozen-lockfile --filter @rag-mcp/api... --filter @rag-mcp/widget...

# Copy application & widget source
COPY apps/api ./apps/api
COPY packages/mcp-servers ./packages/mcp-servers
COPY packages/widget ./packages/widget

# Build standalone embeddable widget bundle (served at /api/v1/public/widget.js)
RUN pnpm --filter @rag-mcp/widget build

# Create persistent storage directory for uploads & generated artifacts
RUN mkdir -p /app/storage

ENV NODE_ENV=production
ENV PORT=8000
ENV STORAGE_DIR=/app/storage

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -f http://localhost:8000/health || exit 1

CMD ["node", "apps/api/src/server.js"]
