import React, { Suspense } from "react";
import { createBrowserRouter } from "react-router-dom";
import { Skeleton } from "@/components/ui/skeleton";
import DashboardLayout from "@/layouts/DashboardLayout";
import AuthLayout from "@/layouts/AuthLayout";
import NotFoundPage from "@/pages/not-found";
import RouteError from "@/pages/route-error";

// ---------------------------------------------------------------------------
// Page-level lazy imports
// ---------------------------------------------------------------------------
const ChatCanvas         = React.lazy(() => import("@/pages/dashboard/chat-canvas"));
const ChatbotsPage       = React.lazy(() => import("@/pages/dashboard/chatbots"));
const CreateChatbotWizard = React.lazy(() => import("@/pages/dashboard/chatbot-create-wizard"));
const ChatbotDetailPage  = React.lazy(() => import("@/pages/dashboard/chatbot-detail"));
const KnowledgeBasesPage = React.lazy(() => import("@/pages/dashboard/knowledge-bases"));
const McpPage            = React.lazy(() => import("@/pages/dashboard/mcp"));
const ApiKeysPage        = React.lazy(() => import("@/pages/dashboard/api-keys"));
const UsagePage          = React.lazy(() => import("@/pages/dashboard/usage"));
const EvalsPage          = React.lazy(() => import("@/pages/dashboard/evals"));
const LoginPage          = React.lazy(() => import("@/pages/auth/login"));
const RegisterPage       = React.lazy(() => import("@/pages/auth/register"));

// ---------------------------------------------------------------------------
// Suspense fallback skeleton
// ---------------------------------------------------------------------------
function PageSkeleton() {
  return (
    <div className="page-skeleton-container">
      <Skeleton height={28} width="40%" />
      <Skeleton height={14} width="70%" />
      <Skeleton height={14} width="55%" />
      <Skeleton height={14} width="60%" />
    </div>
  );
}

/** Wraps a lazy component in Suspense with the shared skeleton fallback. */
function lazy(Component) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Component />
    </Suspense>
  );
}

// ---------------------------------------------------------------------------
// Router definition
// ---------------------------------------------------------------------------
export const router = createBrowserRouter([
  // Auth routes — redirect to "/" when already signed in
  {
    element: <AuthLayout />,
    errorElement: <RouteError />,
    children: [
      { path: "/login",    element: lazy(LoginPage) },
      { path: "/register", element: lazy(RegisterPage) },
    ],
  },

  // Dashboard routes — redirect to "/login" when signed out
  {
    element: <DashboardLayout />,
    errorElement: <RouteError />,
    children: [
      // Full-bleed chat canvas (no padding/inner-scroll wrapper)
      { path: "/",          element: lazy(ChatCanvas), handle: { fullBleed: true } },
      { path: "/chat",      element: lazy(ChatCanvas), handle: { fullBleed: true } },
      { path: "/assistant", element: lazy(ChatCanvas), handle: { fullBleed: true } },

      // Builder & tools
      { path: "/chatbots",         element: lazy(ChatbotsPage) },
      { path: "/chatbots/new",     element: lazy(CreateChatbotWizard) },
      { path: "/chatbots/:botId",  element: lazy(ChatbotDetailPage) },
      { path: "/knowledge-bases",  element: lazy(KnowledgeBasesPage) },
      { path: "/mcp",              element: lazy(McpPage) },
      { path: "/api-keys",         element: lazy(ApiKeysPage) },
      { path: "/usage",            element: lazy(UsagePage) },
      { path: "/evals",            element: lazy(EvalsPage) },

      // 404 — must be last
      { path: "*", element: <NotFoundPage /> },
    ],
  },
]);

