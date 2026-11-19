export const mockUser = {
  id: "usr_priyanshu_01",
  name: "Priyanshu Jindal",
  email: "priyanshu@example.com",
  initials: "PJ",
  plan: "Go",
  workspace: "Rag_Mcp Studio",
};

export const mockRecents = [
  {
    id: "conv_rag_eval",
    title: "Evaluate RAG MCP Project",
    preview: "Analysis of the hybrid search reciprocal rank fusion algorithm...",
    createdAt: "2026-10-31T09:15:00Z",
    pinned: true,
  },
  {
    id: "conv_sets",
    title: "Explain Sets Relations Functions",
    preview: "Let's explore equivalence relations, equivalence classes...",
    createdAt: "2026-10-30T16:20:00Z",
  },
  {
    id: "conv_digraphs",
    title: "Explain Digraphs",
    preview: "A directed graph is composed of vertices and directed edges...",
    createdAt: "2026-10-29T14:00:00Z",
  },
  {
    id: "conv_discrete_math",
    title: "Explain Discrete Mathematics",
    preview: "Discrete math encompasses combinatorics, graph theory, propositional logic...",
    createdAt: "2026-10-28T11:00:00Z",
  },
  {
    id: "conv_pkg_diff",
    title: "Package Files Difference",
    preview: "Comparing package.json vs package-lock.json and pnpm-lock.yaml...",
    createdAt: "2026-10-27T08:30:00Z",
  },
  {
    id: "conv_multer",
    title: "Explain Multer",
    preview: "Multer is a Node.js middleware for handling multipart/form-data...",
    createdAt: "2026-10-26T18:00:00Z",
  },
];

export const mockChatbots = [
  {
    id: "bot_nextjs_docs",
    name: "Next.js 14 Knowledge Bot",
    description: "Trained on the official Next.js documentation, App Router guides, and API specs.",
    status: "active",
    model: "gpt-4o",
    temperature: 0.2,
    systemPrompt:
      "You are the official Next.js technical assistant. Answer questions truthfully using the provided context chunks.",
    knowledgeBaseIds: ["kb_nextjs"],
    conversationsCount: 1420,
    messagesCount: 6840,
    embedToken: "emb_live_nxt14_89df2a39",
    allowedDomains: ["https://nextjs.org", "https://vercel.com"],
    theme: {
      primaryColor: "#0070f3",
      userBubbleColor: "#0070f3",
      botBubbleColor: "#2f2f2f",
      fontFamily: "Inter",
      borderRadius: "16px",
      position: "bottom-right",
      headerTitle: "Next.js AI Support",
      welcomeMessage: "Hi there! 👋 Ask me anything about Next.js 14, App Router, or Server Actions.",
      suggestedQuestions: [
        "How do Server Actions work in Next.js 14?",
        "Difference between generateStaticParams and dynamicParams?",
        "How to handle auth with middleware?",
      ],
    },
    createdAt: "2026-10-15T10:00:00Z",
    updatedAt: "2026-10-31T08:30:00Z",
  },
  {
    id: "bot_stripe_api",
    name: "Stripe Billing & API Bot",
    description: "Answers developer questions on webhooks, Stripe Checkout, and subscription lifecycles.",
    status: "active",
    model: "gpt-4o-mini",
    temperature: 0.1,
    systemPrompt:
      "You are Stripe Assistant. Provide exact code snippets and webhook verification examples.",
    knowledgeBaseIds: ["kb_stripe"],
    conversationsCount: 890,
    messagesCount: 3950,
    embedToken: "emb_live_strp_41e97d21",
    allowedDomains: ["https://stripe.com", "https://dashboard.stripe.com"],
    theme: {
      primaryColor: "#635bff",
      userBubbleColor: "#635bff",
      botBubbleColor: "#2f2f2f",
      fontFamily: "Inter",
      borderRadius: "12px",
      position: "bottom-right",
      headerTitle: "Stripe Developer Copilot",
      welcomeMessage: "Hello! Need help configuring Stripe subscriptions or webhooks?",
      suggestedQuestions: [
        "How do I verify a webhook signature?",
        "What is the lifecycle of an invoice.payment_failed event?",
        "How to create a customer portal session?",
      ],
    },
    createdAt: "2026-10-20T12:00:00Z",
    updatedAt: "2026-10-30T14:10:00Z",
  },
  {
    id: "bot_handbook",
    name: "Employee Handbook Concierge",
    description: "Internal company assistant for HR, PTO policies, remote benefits, and IT helpdesk.",
    status: "active",
    model: "gpt-4o-mini",
    temperature: 0.3,
    systemPrompt:
      "You are the internal company handbook assistant. Be polite, concise, and refer employees to HR links.",
    knowledgeBaseIds: ["kb_company"],
    conversationsCount: 340,
    messagesCount: 1120,
    embedToken: "emb_live_corp_67a331be",
    allowedDomains: ["https://internal.company.io"],
    theme: {
      primaryColor: "#10b981",
      userBubbleColor: "#10b981",
      botBubbleColor: "#2f2f2f",
      fontFamily: "Inter",
      borderRadius: "16px",
      position: "bottom-left",
      headerTitle: "Company HR Helper",
      welcomeMessage: "Welcome to Acme Corp! How can I assist you with benefits or policies today?",
      suggestedQuestions: [
        "What is our annual PTO policy?",
        "How do I claim health insurance reimbursement?",
        "Where do I file an IT hardware request?",
      ],
    },
    createdAt: "2026-10-22T09:00:00Z",
    updatedAt: "2026-10-29T11:45:00Z",
  },
  {
    id: "bot_landing_page",
    name: "SaaS Landing Page Concierge",
    description: "Converts website visitors into qualified leads and schedules demo calls automatically.",
    status: "draft",
    model: "gpt-4o",
    temperature: 0.4,
    systemPrompt:
      "You are an energetic product specialist. Help prospective clients understand our enterprise tiers.",
    knowledgeBaseIds: ["kb_product"],
    conversationsCount: 18,
    messagesCount: 54,
    embedToken: "emb_live_prod_09ca4198",
    allowedDomains: ["https://mysaas.com"],
    theme: {
      primaryColor: "#8b5cf6",
      userBubbleColor: "#8b5cf6",
      botBubbleColor: "#2f2f2f",
      fontFamily: "Inter",
      borderRadius: "20px",
      position: "bottom-right",
      headerTitle: "Sales & Demo Assistant",
      welcomeMessage: "Looking to scale your engineering team? Let me answer questions or book a demo!",
      suggestedQuestions: [
        "What makes your platform different from competitors?",
        "Do you offer enterprise SOC-2 compliance?",
        "Can I schedule a 15-minute live demo?",
      ],
    },
    createdAt: "2026-10-28T16:00:00Z",
    updatedAt: "2026-10-31T07:15:00Z",
  },
];

export const mockKnowledgeBases = [
  {
    id: "kb_nextjs",
    name: "Next.js Official Documentation",
    description: "Crawl of nextjs.org/docs including App Router, Server Components, and CLI reference.",
    sourcesCount: 42,
    totalChunks: 840,
    status: "ready",
    lastIndexedAt: "2026-10-30T18:00:00Z",
    sources: [
      {
        id: "src_next_01",
        title: "https://nextjs.org/docs/app/building-your-application/routing",
        url: "https://nextjs.org/docs/app/building-your-application/routing",
        type: "url",
        status: "indexed",
        chunksCount: 88,
        lastIndexedAt: "2026-10-30T18:00:00Z",
      },
    ],
  },
  {
    id: "kb_stripe",
    name: "Stripe API Reference & Guides",
    description: "Extracted documentation on customer portal, webhooks, and payment intents.",
    sourcesCount: 15,
    totalChunks: 420,
    status: "ready",
    lastIndexedAt: "2026-10-29T12:00:00Z",
    sources: [
      {
        id: "src_stripe_01",
        title: "stripe-api-reference-v2026.pdf",
        type: "pdf",
        status: "indexed",
        chunksCount: 220,
        lastIndexedAt: "2026-10-29T12:00:00Z",
      },
    ],
  },
];

export const mockMcpServers = [
  {
    id: "mcp_fs",
    name: "Scoped Filesystem MCP",
    description: "Safe file reading, grep search, and directory navigation restricted to workspace subtrees.",
    transport: "stdio",
    endpointOrCommand: "npx @ask0/mcp-server-filesystem",
    status: "connected",
    tools: [
      {
        id: "tool_fs_read",
        name: "read_file_snippet",
        description: "Reads file text up to a safe byte limit within allowed sandbox directories.",
        permission: "auto",
      },
      {
        id: "tool_fs_list",
        name: "list_directory",
        description: "Returns tree list of files and folders in allowed scope.",
        permission: "auto",
      },
    ],
  },
  {
    id: "mcp_db",
    name: "PostgreSQL Analytics MCP",
    description: "Read-only SQL executor for querying application metrics and customer segments.",
    transport: "stdio",
    endpointOrCommand: "python -m ask0.mcp.postgres",
    status: "connected",
    tools: [
      {
        id: "tool_db_query",
        name: "execute_readonly_sql",
        description: "Runs SELECT queries against analytical replicas.",
        permission: "require_approval",
      },
    ],
  },
];

export const mockApiKeys = [
  {
    id: "key_prod_01",
    name: "Production Website Widget Key",
    prefix: "ragmcp_live_839a9c",
    createdAt: "2026-10-10T14:00:00Z",
    lastUsedAt: "2026-10-31T11:05:00Z",
    rateLimitPerMin: 120,
  },
];

export const mockUsageMetrics = [
  { date: "Oct 25", messages: 1240, tokens: 280000, costUsd: 0.56, avgLatencyMs: 380 },
  { date: "Oct 26", messages: 1580, tokens: 340000, costUsd: 0.68, avgLatencyMs: 410 },
  { date: "Oct 27", messages: 1890, tokens: 410000, costUsd: 0.82, avgLatencyMs: 395 },
  { date: "Oct 28", messages: 2150, tokens: 490000, costUsd: 0.98, avgLatencyMs: 430 },
  { date: "Oct 29", messages: 2600, tokens: 580000, costUsd: 1.16, avgLatencyMs: 405 },
  { date: "Oct 30", messages: 3100, tokens: 710000, costUsd: 1.42, avgLatencyMs: 420 },
  { date: "Oct 31", messages: 3450, tokens: 790000, costUsd: 1.58, avgLatencyMs: 390 },
];

export const mockEvalRuns = [
  {
    id: "eval_run_01",
    testSuite: "Next.js App Router Golden Q&A (100 samples)",
    model: "gpt-4o",
    samplesCount: 100,
    faithfulnessScore: 0.96,
    relevanceScore: 0.94,
    contextRecallScore: 0.91,
    status: "completed",
    runAt: "2026-10-30T22:00:00Z",
  },
];

