import React, { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Plus,
  Bot,
  MessageSquare,
  Settings2,
  MoreHorizontal,
  Search,
  Filter,
  AlertCircle,
  RefreshCw,
  Code2,
  ExternalLink,
  Power,
  Trash2,
  Palette,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { CardSkeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { getMockChatbots, updateChatbot, deleteChatbot } from "@/lib/api";

function statusVariant(status) {
  return status?.toLowerCase() === "active" ? "success" : status?.toLowerCase() === "draft" ? "neutral" : "warning";
}

function BotCard({ bot, onToggleStatus, onDelete }) {
  const navigate = useNavigate();
  const primaryColor = bot.config?.primaryColor || bot.theme?.primaryColor || "var(--accent)";
  const isActive = (bot.status || "").toUpperCase() === "ACTIVE";
  const botPublicId = bot.publicId || bot.id;

  return (
    <Link to={`/chatbots/${bot.id}`} className="bot-card">
      <div className="bot-card-header">
        <div
          className="bot-card-icon"
          style={{ "--bot-color": primaryColor, "--bot-bg": `${primaryColor}22` }}
        >
          <Bot size={18} />
        </div>
        <div className="bot-card-header-info">
          <div className="bot-card-name">{bot.name}</div>
          <Badge variant={statusVariant(bot.status)} dot className="bot-card-status">
            {bot.status}
          </Badge>
        </div>
        <div
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
        >
          <DropdownMenu>
            <DropdownMenuTrigger>
              <button
                type="button"
                className="btn btn-ghost btn-icon"
                title="More options"
                aria-label="More options"
              >
                <MoreHorizontal size={15} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="right">
              <DropdownMenuItem onClick={() => navigate(`/chatbots/${bot.id}?tab=customize`)}>
                <Palette size={14} style={{ marginRight: "8px" }} />
                Customize Appearance
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => navigate(`/chatbots/${bot.id}?tab=embed`)}>
                <Code2 size={14} style={{ marginRight: "8px" }} />
                Get Embed Code
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => window.open(`/bot/${botPublicId}`, "_blank", "noopener,noreferrer")}
              >
                <ExternalLink size={14} style={{ marginRight: "8px" }} />
                Open Public Bot
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => onToggleStatus(bot)}>
                <Power size={14} style={{ marginRight: "8px" }} />
                {isActive ? "Pause Chatbot" : "Activate Chatbot"}
              </DropdownMenuItem>
              <DropdownMenuItem danger onClick={() => onDelete(bot)}>
                <Trash2 size={14} style={{ marginRight: "8px" }} />
                Delete Chatbot
              </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
        </div>
      </div>

      <p className="bot-card-desc">{bot.description}</p>

      <div className="bot-card-meta">
        <span className="badge badge-neutral">{bot.config?.model || bot.model || "gemini-3.5-flash-lite"}</span>
        <span className="bot-card-meta-text">
          {(bot.knowledgeBaseIds || []).length} knowledge base{(bot.knowledgeBaseIds || []).length !== 1 ? "s" : ""}
        </span>
      </div>

      <div className="bot-card-footer">
        <div className="bot-card-stats">
          <div className="bot-card-stat">
            <span className="bot-card-stat-label">Conversations</span>
            <span className="bot-card-stat-value">{(bot.conversationsCount || 0).toLocaleString()}</span>
          </div>
          <div className="bot-card-stat">
            <span className="bot-card-stat-label">Messages</span>
            <span className="bot-card-stat-value">{(bot.messagesCount || 0).toLocaleString()}</span>
          </div>
        </div>
        <div className="bot-card-actions">
          <button
            type="button"
            className="btn btn-ghost btn-icon"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              navigate(`/chatbots/${bot.id}?tab=analytics`);
            }}
            title="Analytics"
            aria-label="View analytics"
          >
            <MessageSquare size={13} className="icon-faint" />
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-icon"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              navigate(`/chatbots/${bot.id}?tab=settings`);
            }}
            title="Settings"
            aria-label="Bot settings"
          >
            <Settings2 size={13} className="icon-faint" />
          </button>
        </div>
      </div>
    </Link>
  );
}

export default function ChatbotsPage() {
  const [bots, setBots] = useState([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchBots = () => {
    setLoading(true);
    setError(null);
    getMockChatbots()
      .then((data) => {
        setBots(Array.isArray(data) ? data : []);
      })
      .catch((err) => {
        setError(err.message || "Failed to load chatbots");
      })
      .finally(() => {
        setLoading(false);
      });
  };

  useEffect(() => {
    fetchBots();
  }, []);

  const handleToggleStatus = async (bot) => {
    const nextStatus = (bot.status || "").toUpperCase() === "ACTIVE" ? "PAUSED" : "ACTIVE";
    try {
      await updateChatbot(bot.id, { status: nextStatus });
      fetchBots();
    } catch (err) {
      setError(err.message || "Failed to update chatbot status");
    }
  };

  const handleDeleteBot = async (bot) => {
    if (!window.confirm(`Are you sure you want to delete "${bot.name}"?`)) return;
    try {
      await deleteChatbot(bot.id);
      setBots((prev) => prev.filter((b) => b.id !== bot.id));
    } catch (err) {
      setError(err.message || "Failed to delete chatbot");
    }
  };

  const filtered = bots.filter(
    (b) =>
      b.name.toLowerCase().includes(search.toLowerCase()) ||
      b.description.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div>
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Chatbots</h1>
          <p className="page-desc">Build and manage AI chatbots powered by your knowledge bases.</p>
        </div>
        <Link to="/chatbots/new" className="btn btn-primary btn-with-icon">
          <Plus size={15} /> New Chatbot
        </Link>
      </div>

      {/* Metrics Row */}
      <div className="metrics-grid">
        {[
          { label: "Total Bots", value: bots.length },
          { label: "Active", value: bots.filter((b) => b.status === "active").length },
          { label: "Total Messages", value: bots.reduce((s, b) => s + (b.messagesCount || 0), 0).toLocaleString() },
          { label: "Total Convos", value: bots.reduce((s, b) => s + (b.conversationsCount || 0), 0).toLocaleString() },
        ].map((m) => (
          <div key={m.label} className="card metric-card">
            <span className="metric-label">{m.label}</span>
            <div className="metric-value">{m.value}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="filter-bar">
        <div className="filter-search-wrapper">
          <Search size={14} className="filter-search-icon" />
          <input
            className="input filter-search-input"
            type="search"
            placeholder="Search chatbots..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <button type="button" className="btn btn-secondary btn-with-icon">
          <Filter size={13} /> Filter
        </button>
      </div>

      {/* Error state */}
      {error && (
        <div className="card" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px", borderColor: "var(--danger)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", color: "var(--danger)", fontSize: "14px" }}>
            <AlertCircle size={16} />
            <span>{error}</span>
          </div>
          <button type="button" className="btn btn-secondary btn-sm" onClick={fetchBots}>
            <RefreshCw size={12} /> Retry
          </button>
        </div>
      )}

      {/* Loading state */}
      {loading ? (
        <div className="chatbots-grid">
          {[1, 2, 3].map((n) => (
            <CardSkeleton key={n} />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        /* Empty state */
        <div className="empty-state">
          <div className="empty-state-icon">
            <Bot size={24} />
          </div>
          <div className="empty-state-title">
            {search ? "No matching chatbots" : "No chatbots yet"}
          </div>
          <div className="empty-state-desc">
            {search
              ? `No bots match "${search}". Try adjusting your search.`
              : "Create your first AI chatbot and connect it to a knowledge base."}
          </div>
          {!search && (
            <Link to="/chatbots/new" className="btn btn-primary btn-with-icon">
              <Plus size={15} /> Create your first bot
            </Link>
          )}
        </div>
      ) : (
        /* Bot cards grid */
        <div className="chatbots-grid">
          {filtered.map((bot) => (
            <BotCard
              key={bot.id}
              bot={bot}
              onToggleStatus={handleToggleStatus}
              onDelete={handleDeleteBot}
            />
          ))}
        </div>
      )}
    </div>
  );
}
