import React from "react";
import { useLocation } from "react-router-dom";
import { Sun, Moon, Bell, ChevronDown, LogOut, Layers, Menu } from "lucide-react";
import { useTheme } from "@/lib/theme";
import { useAuth } from "@/lib/auth";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const PAGE_TITLES = {
  "/chatbots":        "Chatbots",
  "/knowledge-bases": "Knowledge Bases",
  "/assistant":       "Assistant",
  "/mcp":             "MCP Tools",
  "/api-keys":        "API Keys",
  "/usage":           "Usage & Limits",
  "/evals":           "RAG Evals",
};

export function Topbar({ onToggleMobileSidebar }) {
  const location = useLocation();
  const { theme, toggleTheme } = useTheme();
  const { user: authUser, logout } = useAuth();
  const currentUser = authUser || {
    name: "Demo User",
    email: "demo@rag-mcp.ai",
    plan: "Free",
    initials: "DU",
  };

  const title = Object.entries(PAGE_TITLES).find(([path]) =>
    location.pathname.startsWith(path)
  )?.[1] || "Dashboard";

  return (
    <header className="topbar">
      {/* Left: mobile hamburger + page title */}
      <div className="topbar-left">
        <button
          type="button"
          className="btn btn-ghost btn-icon mobile-menu-toggle"
          onClick={onToggleMobileSidebar}
          aria-label="Open navigation menu"
        >
          <Menu size={18} />
        </button>
        <span className="topbar-title">{title}</span>
      </div>

      {/* Right: actions */}
      <div className="topbar-right">
        {/* Theme toggle */}
        <button
          type="button"
          className="btn btn-ghost btn-icon"
          onClick={toggleTheme}
          title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
        >
          {theme === "dark" ? (
            <Sun size={16} className="icon-muted" />
          ) : (
            <Moon size={16} className="icon-muted" />
          )}
        </button>

        {/* Notification bell */}
        <button
          type="button"
          className="btn btn-ghost btn-icon"
          title="Notifications"
          aria-label="View notifications"
        >
          <Bell size={16} className="icon-muted" />
        </button>

        {/* User / Workspace menu with working Logout */}
        <DropdownMenu>
          <DropdownMenuTrigger aria-label="Workspace and account menu">
            <div className="btn btn-ghost btn-sm topbar-workspace-pill">
              <span className="topbar-workspace-text">{currentUser.workspace || "Workspace"}</span>
              <ChevronDown size={12} className="icon-faint" />
            </div>
          </DropdownMenuTrigger>

          <DropdownMenuContent align="right" side="bottom" className="topbar-user-menu">
            <div className="dropdown-user-header">
              <div className="dropdown-user-name">{currentUser.name}</div>
              <div className="dropdown-user-email">
                {currentUser.email}
              </div>
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem>
              <Layers size={14} className="icon-muted" />
              <span>{currentUser.workspace || "Workspace"}</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem danger onClick={logout}>
              <LogOut size={14} />
              <span>Log out</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
