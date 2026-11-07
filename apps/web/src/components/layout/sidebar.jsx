import React, { useState, useEffect, useCallback } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  Bot,
  Database,
  Wrench,
  Key,
  BarChart3,
  TestTube2,
  SquarePen,
  PanelLeftClose,
  PanelLeft,
  Search,
  Sparkles,
  ChevronRight,
  Sun,
  Moon,
  LogOut,
  Settings,
  Layers,
  MessageSquare,
  Trash2,
} from "lucide-react";
import { getMockChatbots } from "@/lib/api";
import { api } from "@/lib/api/client";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useTheme } from "@/lib/theme";
import { useAuth } from "@/lib/auth";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const MAIN_NAV = [
  { href: "/chatbots",        label: "Chatbots Builder",  icon: Bot,          isPrimary: true },
  { href: "/knowledge-bases", label: "Knowledge Bases",   icon: Database },
  { href: "/mcp",             label: "MCP Plugins & Tools", icon: Wrench },
  { href: "/evals",           label: "RAG Evals",         icon: TestTube2 },
  { href: "/api-keys",        label: "API Keys",          icon: Key },
  { href: "/usage",           label: "Usage & Limits",    icon: BarChart3 },
];

export function Sidebar({ isCollapsed, onToggleCollapse, mobileOpen, onCloseMobile }) {
  const location = useLocation();
  const { theme, toggleTheme } = useTheme();
  const { user: authUser, logout } = useAuth();
  const collapsed = isCollapsed;
  const currentUser = authUser || {
    name: "Demo User",
    email: "demo@rag-mcp.ai",
    plan: "Free",
    initials: "DU",
  };
  const userInitials = currentUser.initials || (currentUser.name ? currentUser.name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2) : "U");

  const [bots, setBots] = useState([]);
  const [recents, setRecents] = useState([]);
  const [loadingRecents, setLoadingRecents] = useState(false);

  const loadRecents = useCallback(async () => {
    try {
      setLoadingRecents(true);
      const data = await api.get("/conversations?limit=30");
      if (data && Array.isArray(data.items)) {
        setRecents(data.items);
      } else if (Array.isArray(data)) {
        setRecents(data);
      }
    } catch (err) {
      console.warn("Failed to load real recents:", err);
    } finally {
      setLoadingRecents(false);
    }
  }, []);

  useEffect(() => {
    getMockChatbots()
      .then((data) => {
        if (Array.isArray(data)) setBots(data);
      })
      .catch(() => {});

    loadRecents();

    const handleUpdate = () => {
      loadRecents();
    };

    window.addEventListener("rag:conversations-changed", handleUpdate);
    return () => {
      window.removeEventListener("rag:conversations-changed", handleUpdate);
    };
  }, [loadRecents]);

  const handleDeleteRecent = async (e, id) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      await api.delete(`/conversations/${id}`);
      setRecents((prev) => prev.filter((item) => (item.id || item._id) !== id));
      window.dispatchEvent(new CustomEvent("rag:conversations-changed"));
      const searchParams = new URLSearchParams(location.search);
      const currentId = searchParams.get("c") || searchParams.get("id");
      if (currentId === id) {
        window.dispatchEvent(new CustomEvent("rag:new-conversation"));
      }
    } catch (err) {
      console.error("Failed to delete conversation:", err);
    }
  };

  const handleLinkClick = () => {
    onCloseMobile?.();
  };

  return (
    <aside
      className={`sidebar ${collapsed ? "sidebar-collapsed" : "sidebar-expanded"} ${mobileOpen ? "mobile-open" : ""}`}
      aria-label="Main sidebar"
    >
      {/* Header */}
      <div className="sidebar-header">
        {!collapsed && (
          <Link to="/" className="sidebar-logo" onClick={handleLinkClick}>
            <div className="sidebar-logo-icon">
              <Sparkles size={15} />
            </div>
            ChatGPT
          </Link>
        )}

        <div className={`sidebar-header-actions ${collapsed ? "collapsed" : ""}`}>
          {!collapsed && (
            <button
              type="button"
              className="sidebar-icon-btn"
              title="Search"
              aria-label="Search navigation"
            >
              <Search size={15} />
            </button>
          )}
          <button
            type="button"
            className="sidebar-icon-btn"
            onClick={onToggleCollapse}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? <PanelLeft size={15} /> : <PanelLeftClose size={15} />}
          </button>
        </div>
      </div>

      {/* New Chat CTA Pill */}
      <div className="sidebar-cta">
        <Link
          to="/"
          className={`sidebar-cta-btn ${collapsed ? "centered" : ""}`}
          title="New chat"
          onClick={() => {
            handleLinkClick();
            window.dispatchEvent(new CustomEvent("rag:new-conversation"));
          }}
        >
          <div className="sidebar-cta-btn-inner">
            <SquarePen size={15} />
            {!collapsed && <span>New chat</span>}
          </div>
          {!collapsed && <span className="sidebar-kbd">⌘K</span>}
        </Link>
      </div>

      {/* Body */}
      <div className="sidebar-body">
        {/* Navigation Sections */}
        <nav className="sidebar-nav" aria-label="Primary navigation">
          {MAIN_NAV.map((item) => {
            const Icon = item.icon;
            const isActive = location.pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                to={item.href}
                className={`sidebar-nav-link ${isActive ? "active" : ""} ${collapsed ? "centered" : ""}`}
                title={collapsed ? item.label : undefined}
                aria-current={isActive ? "page" : undefined}
                onClick={handleLinkClick}
              >
                <Icon className="nav-icon" size={16} />
                {!collapsed && (
                  <>
                    <span className="truncate-flex">
                      {item.label}
                    </span>
                    {item.isPrimary && (
                      <span className="nav-badge-primary">Builder</span>
                    )}
                  </>
                )}
              </Link>
            );
          })}
        </nav>

        {/* Custom Website Chatbots */}
        {!collapsed && (
          <div>
            <div className="sidebar-section-label">Your Website Bots</div>
            <div className="sidebar-nav">
              {bots.filter((b) => b.status === "active").map((bot) => (
                <Link
                  key={bot.id}
                  to={`/?botId=${bot.id}`}
                  className="sidebar-recent-link"
                  title={`Chat with ${bot.name}`}
                  onClick={handleLinkClick}
                >
                  <span
                    className="sidebar-bot-dot"
                    style={{ "--bot-color": bot.theme?.primaryColor || "var(--accent)" }}
                  />
                  <span className="truncate-flex">
                    {bot.name}
                  </span>
                  <ChevronRight size={12} className="icon-faint" />
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Recents (Real Conversations from MongoDB) */}
        {!collapsed && (
          <div>
            <div className="sidebar-section-label">Recents</div>
            <div className="sidebar-nav">
              {loadingRecents && recents.length === 0 ? (
                <div className="sidebar-empty-recents">Loading chats...</div>
              ) : recents.length === 0 ? (
                <div className="sidebar-empty-recents">No recent chats</div>
              ) : (
                recents.map((item) => {
                  const itemId = item.id || item._id;
                  const searchParams = new URLSearchParams(location.search);
                  const currentId = searchParams.get("c") || searchParams.get("id");
                  const isActive = (location.pathname === "/" || location.pathname === "/chat") && currentId === itemId;
                  return (
                    <Link
                      key={itemId}
                      to={`/?c=${itemId}`}
                      className={`sidebar-recent-link ${isActive ? "active" : ""}`}
                      title={item.title || "Untitled Conversation"}
                      onClick={handleLinkClick}
                    >
                      <MessageSquare size={13} className="sidebar-recent-icon" />
                      <span className="truncate-flex">
                        {item.title || "Untitled Conversation"}
                      </span>
                      <button
                        type="button"
                        className="sidebar-recent-delete-btn"
                        title="Delete conversation"
                        aria-label="Delete conversation"
                        onClick={(e) => handleDeleteRecent(e, itemId)}
                      >
                        <Trash2 size={12} />
                      </button>
                    </Link>
                  );
                })
              )}
            </div>
          </div>
        )}
      </div>

      {/* Footer / Profile (Matches Screenshot: Priyanshu Jindal - PJ - Go) */}
      <div className="sidebar-footer">
        <DropdownMenu>
          <DropdownMenuTrigger aria-label="User profile options">
            <div
              className={`profile-pill ${collapsed ? "centered" : ""}`}
              role="button"
              tabIndex={0}
            >
              <Avatar size="sm" className="sidebar-user-avatar">
                <AvatarFallback>{userInitials}</AvatarFallback>
              </Avatar>
              {!collapsed && (
                <div className="profile-info">
                  <div className="profile-name">{currentUser.name}</div>
                  <div className="profile-meta">
                    <span className="profile-plan">{currentUser.plan || "Free"}</span>
                    <span className="profile-workspace">{currentUser.workspace || "Workspace"}</span>
                  </div>
                </div>
              )}
            </div>
          </DropdownMenuTrigger>

          <DropdownMenuContent align="left" side="top" className="sidebar-profile-menu">
            <div className="dropdown-user-header">
              <div className="dropdown-user-name">{currentUser.name}</div>
              <div className="dropdown-user-email">{currentUser.email}</div>
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={toggleTheme}>
              {theme === "dark"
                ? <><Sun size={14} className="icon-muted" /> Switch to Light Mode</>
                : <><Moon size={14} className="icon-muted" /> Switch to Dark Mode</>
              }
            </DropdownMenuItem>
            <DropdownMenuItem>
              <Layers size={14} className="icon-muted" /> Switch Workspace
            </DropdownMenuItem>
            <DropdownMenuItem>
              <Settings size={14} className="icon-muted" /> Workspace Settings
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem danger onClick={logout}>
              <LogOut size={14} /> Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </aside>
  );
}
