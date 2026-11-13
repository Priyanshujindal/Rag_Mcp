# @rag-mcp/web (Rag_Mcp Frontend)

The web dashboard and conversational interface for the RAG MCP platform. Built with **React 18 + Vite + plain JavaScript (.jsx / .js) + plain CSS variables**.

---

## Getting Started

### Prerequisites
- Node.js >= 18
- pnpm >= 9

### Development & Build Commands

Run from monorepo root:
```bash
# Start Vite development server (default: http://localhost:5173)
pnpm dev

# Build production bundle to dist/
pnpm build

# Preview production build locally
pnpm preview

# Run ESLint validation
pnpm lint
```

Or from within `apps/web`:
```bash
cd apps/web
pnpm dev
pnpm build
pnpm lint
```

---

## Folder Structure

```
apps/web/
├── public/                 # Static public assets
├── src/
│   ├── components/         # Reusable presentation & feature components
│   │   ├── bot-customizer/ # Live widget preview & brand customizer
│   │   ├── chat/           # Modular chat components (Header, Composer, MessageItem, etc.)
│   │   ├── chatbot-detail/ # Bot detail sub-tabs (Overview, Customize, Sources, etc.)
│   │   ├── layout/         # Shell, collapsible Sidebar, Topbar
│   │   ├── rag-debugger/   # Context view, chunk inspection panel
│   │   └── ui/             # Design system primitives (Button, Dialog, Dropdown, Skeleton, etc.)
│   ├── hooks/              # Custom React hooks (useChat)
│   ├── layouts/            # Route layouts (DashboardLayout, AuthLayout)
│   ├── lib/                # Shared utilities, auth context, theme manager, mock data
│   │   └── mock/           # Mock data fixtures & API layer
│   ├── pages/              # Lazy-loaded page views
│   │   ├── auth/           # Login & Registration views
│   │   ├── dashboard/      # Chat canvas, bot manager, KB manager, MCP tools, Evals, etc.
│   │   ├── not-found.jsx   # 404 page
│   │   └── route-error.jsx # Route-level error boundary
│   ├── styles/
│   │   └── globals.css     # Design tokens (:root CSS vars), base reset, responsive styles
│   ├── App.jsx             # Top-level application component with providers
│   ├── main.jsx            # Application entry point
│   └── router.jsx          # Declarative router definition with lazy loading
├── eslint.config.js        # ESLint flat configuration
├── index.html              # HTML shell
├── package.json            # Package metadata & scripts
└── vite.config.js          # Vite config & path aliases (@/ -> src/)
```

---

## Design System & Styling Rules

- **Pure CSS Variables:** All colors, radiuses, shadows, and spacing are driven by tokens defined in `src/styles/globals.css`.
- **Theme Support:** Supports both dark (default) and light themes via CSS custom properties overridden on `[data-theme="light"]`.
- **Zero Inline Styles:** All static styles reside in colocated `.css` files or `globals.css`. Only dynamic runtime calculations (e.g. user-selected brand colors, bar graph percentages) use CSS custom properties on `style={{ "--token": value }}`.

