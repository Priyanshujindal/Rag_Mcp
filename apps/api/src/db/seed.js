import bcrypt from "bcryptjs";
import config from "../config/index.js";
import logger from "../utils/logger.js";
import { connectDb, disconnectDb } from "./connection.js";
import {
  User,
  Workspace,
  Membership,
  KnowledgeBase,
  Source,
  Chatbot,
} from "./models/index.js";

/**
 * Seeds the database with initial demo fixtures mirroring apps/web mock data.
 * Fully idempotent: running multiple times updates rather than duplicates records.
 * @param {object} [options]
 * @param {boolean} [options.silent=false]
 */
export async function seedDatabase(options = {}) {
  if (config.NODE_ENV === "production") {
    throw new Error("SAFETY GUARD: db:seed refuses to run when NODE_ENV=production.");
  }

  const log = options.silent ? () => {} : (msg) => logger.info(msg);
  log("[seed] Seeding database...");

  // 1. Demo User
  const demoEmail = "demo@rag-mcp.ai";
  const rawPassword = process.env.DEMO_USER_PASSWORD || "Demo@12345";
  const passwordHash = await bcrypt.hash(rawPassword, 12);

  const user = await User.findOneAndUpdate(
    { email: demoEmail },
    {
      $set: {
        name: "Priyanshu Jindal",
        email: demoEmail,
        passwordHash,
        avatarUrl: null,
      },
    },
    { upsert: true, new: true }
  );
  log(`[seed] ✓ User seeded: ${user.email} (id: ${user.id})`);

  // 2. Demo Workspace
  const workspaceSlug = "rag-mcp-studio";
  const workspace = await Workspace.findOneAndUpdate(
    { slug: workspaceSlug },
    {
      $set: {
        name: "Rag_Mcp Studio",
        slug: workspaceSlug,
      },
    },
    { upsert: true, new: true }
  );
  log(`[seed] ✓ Workspace seeded: ${workspace.name} (id: ${workspace.id})`);

  // 3. Membership (Owner)
  await Membership.findOneAndUpdate(
    { userId: user._id, workspaceId: workspace._id },
    {
      $set: {
        userId: user._id,
        workspaceId: workspace._id,
        role: "OWNER",
      },
    },
    { upsert: true, new: true }
  );
  log(`[seed] ✓ Membership seeded: OWNER for user ${user.email}`);

  // 4. Knowledge Base
  const kbName = "Next.js Official Documentation";
  const knowledgeBase = await KnowledgeBase.findOneAndUpdate(
    { workspaceId: workspace._id, name: kbName },
    {
      $set: {
        workspaceId: workspace._id,
        name: kbName,
        description:
          "Crawl of nextjs.org/docs including App Router, Server Components, and CLI reference.",
        status: "ACTIVE",
      },
    },
    { upsert: true, new: true }
  );
  log(`[seed] ✓ Knowledge base seeded: ${knowledgeBase.name} (id: ${knowledgeBase.id})`);

  // 5. Three Sources for the Knowledge Base
  const sourcesData = [
    {
      name: "Next.js App Routing Documentation",
      type: "URL",
      url: "https://nextjs.org/docs/app/building-your-application/routing",
      fileKey: null,
      status: "INDEXED",
      chunkCount: 88,
      lastIndexedAt: new Date("2026-10-30T18:00:00Z"),
    },
    {
      name: "Server Components Deep Dive (PDF)",
      type: "PDF",
      url: null,
      fileKey: "uploads/nextjs-server-components.pdf",
      status: "INDEXED",
      chunkCount: 142,
      lastIndexedAt: new Date("2026-10-29T12:00:00Z"),
    },
    {
      name: "Next.js Troubleshooting & Common Gotchas",
      type: "TXT",
      url: null,
      fileKey: "uploads/troubleshooting-faq.txt",
      status: "INDEXED",
      chunkCount: 54,
      lastIndexedAt: new Date("2026-10-28T09:30:00Z"),
    },
  ];

  for (const src of sourcesData) {
    await Source.findOneAndUpdate(
      {
        workspaceId: workspace._id,
        knowledgeBaseId: knowledgeBase._id,
        name: src.name,
      },
      {
        $set: {
          workspaceId: workspace._id,
          knowledgeBaseId: knowledgeBase._id,
          ...src,
        },
      },
      { upsert: true, new: true }
    );
  }
  log(`[seed] ✓ 3 Sources seeded for ${knowledgeBase.name}`);

  // 6. Demo Chatbot
  const botPublicId = "bot_nextjs_docs";
  const chatbot = await Chatbot.findOneAndUpdate(
    { publicId: botPublicId },
    {
      $set: {
        workspaceId: workspace._id,
        knowledgeBaseId: knowledgeBase._id,
        name: "Next.js 14 Knowledge Bot",
        status: "ACTIVE",
        publicId: botPublicId,
        config: {
          theme: "dark",
          welcomeMessage:
            "Hello! I'm your workspace copilot. I'm connected to your synced documentation, API specs, and indexed knowledge bases.",
          systemPrompt:
            "You are the official Next.js technical assistant. Answer questions truthfully using the provided context chunks.",
          suggestedQuestions: [
            "How do Server Actions work in Next.js 14?",
            "Explain parallel and intercepting routes",
            "How does revalidatePath differ from revalidateTag?",
          ],
          position: "bottom-right",
          primaryColor: "#10a37f",
        },
        allowedOrigins: ["*"],
      },
    },
    { upsert: true, new: true }
  );
  log(`[seed] ✓ Chatbot seeded: ${chatbot.name} (publicId: ${chatbot.publicId})`);

  log("[seed] Seeding completed successfully!");
  return { user, workspace, knowledgeBase, chatbot };
}

// Execute directly if run via CLI
if (process.argv[1] && process.argv[1].endsWith("seed.js")) {
  (async () => {
    try {
      await connectDb();
      await seedDatabase();
      await disconnectDb();
      process.exit(0);
    } catch (err) {
      logger.error(`[seed] Fatal error during seeding: ${err.message}`);
      await disconnectDb();
      process.exit(1);
    }
  })();
}

export default seedDatabase;

