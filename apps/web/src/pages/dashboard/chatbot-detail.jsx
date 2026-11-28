import React, { useState, useEffect } from "react";
import { useParams, Link, useSearchParams } from "react-router-dom";
import {
  Bot, Settings, Palette, Database, BarChart3, Code2, MessageSquare, Loader
} from "lucide-react";
import { mockChatbots, mockKnowledgeBases } from "@/lib/mock/data";
import { getMockChatbotById, getMockKnowledgeBases, updateChatbot, getApiOrigin, isMock } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { OverviewTab } from "@/components/chatbot-detail/OverviewTab";
import { CustomizeTab } from "@/components/chatbot-detail/CustomizeTab";
import { SourcesTab } from "@/components/chatbot-detail/SourcesTab";
import { AnalyticsTab } from "@/components/chatbot-detail/AnalyticsTab";
import { EmbedTab } from "@/components/chatbot-detail/EmbedTab";
import { SettingsTab } from "@/components/chatbot-detail/SettingsTab";
import "./chatbot-detail.css";

const TABS = [
  { id: "overview",  label: "Overview",   icon: Bot },
  { id: "customize", label: "Customize",  icon: Palette },
  { id: "sources",   label: "Sources",    icon: Database },
  { id: "analytics", label: "Analytics",  icon: BarChart3 },
  { id: "embed",     label: "Embed",      icon: Code2 },
  { id: "settings",  label: "Settings",   icon: Settings },
];

/**
 * Chatbot details page with synchronized tabs for Overview, Customizer, Sources, Analytics, Embed, and Settings.
 */
export default function ChatbotDetailPage() {
  const { botId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get("tab") || "customize";

  const fallbackBot = isMock
    ? mockChatbots.find((b) => b.id === botId) || mockChatbots[0]
    : {
        id: botId,
        name: "Loading...",
        status: "ACTIVE",
        config: {},
        knowledgeBaseIds: [],
      };
  const [bot, setBot] = useState(fallbackBot);
  const [kbs, setKbs] = useState(isMock ? mockKnowledgeBases : []);
  const [loading, setLoading] = useState(!isMock);

  // Customizer state linked to live preview
  const [themeConfig, setThemeConfig] = useState({
    name: isMock ? fallbackBot.name : "AI Assistant",
    headerTitle: isMock ? (fallbackBot.theme?.headerTitle || fallbackBot.name) : "AI Assistant",
    primaryColor: fallbackBot.theme?.primaryColor || "#6366f1",
    theme: "dark",
    position: fallbackBot.theme?.position || "bottom-right",
    borderRadius: fallbackBot.theme?.borderRadius || "16px",
    welcomeMessage: fallbackBot.theme?.welcomeMessage || "Hi there! 👋 How can I help you today?",
    systemPrompt: fallbackBot.systemPrompt || "You are a helpful assistant.",
    suggestedQuestions: isMock
      ? fallbackBot.theme?.suggestedQuestions || []
      : [],
  });

  useEffect(() => {
    if (!isMock && botId) {
      setLoading(true);
      Promise.all([
        getMockChatbotById(botId).catch(() => null),
        getMockKnowledgeBases().catch(() => mockKnowledgeBases),
      ]).then(([loadedBot, loadedKbs]) => {
        if (loadedBot) {
          setBot(loadedBot);
          const cfg = loadedBot.config || {};
          const th = loadedBot.theme || {};
          setThemeConfig((prev) => ({
            ...prev,
            name: loadedBot.name || prev.name,
            headerTitle: th.headerTitle || loadedBot.name || prev.headerTitle,
            primaryColor: cfg.primaryColor || th.primaryColor || prev.primaryColor,
            theme: cfg.theme || prev.theme,
            position: cfg.position || th.position || prev.position,
            welcomeMessage: cfg.welcomeMessage || th.welcomeMessage || prev.welcomeMessage,
            systemPrompt: cfg.systemPrompt || loadedBot.systemPrompt || prev.systemPrompt,
            suggestedQuestions: Array.isArray(cfg.suggestedQuestions)
              ? cfg.suggestedQuestions
              : Array.isArray(th.suggestedQuestions)
              ? th.suggestedQuestions
              : [],
          }));
        }
        if (Array.isArray(loadedKbs) && loadedKbs.length > 0) {
          setKbs(loadedKbs);
        }
      }).finally(() => {
        setLoading(false);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [botId]);

  const handleSaveTheme = async () => {
    if (isMock) {
      alert("Settings saved (mock mode)!");
      return;
    }
    await updateChatbot(bot.id || botId, {
      name: themeConfig.name,
      config: {
        theme: themeConfig.theme,
        primaryColor: themeConfig.primaryColor,
        position: themeConfig.position,
        welcomeMessage: themeConfig.welcomeMessage,
        systemPrompt: themeConfig.systemPrompt,
        suggestedQuestions: themeConfig.suggestedQuestions,
      },
    });
    setBot((prev) => ({
      ...prev,
      name: themeConfig.name,
      config: {
        ...(prev.config || {}),
        theme: themeConfig.theme,
        primaryColor: themeConfig.primaryColor,
        position: themeConfig.position,
        welcomeMessage: themeConfig.welcomeMessage,
        systemPrompt: themeConfig.systemPrompt,
        suggestedQuestions: themeConfig.suggestedQuestions,
      },
    }));
  };

  const handleTabChange = (tabId) => {
    setSearchParams({ tab: tabId });
  };

  const linkedKb =
    kbs.find((kb) => kb.id === bot.knowledgeBaseId || (bot.knowledgeBaseIds || []).includes(kb.id)) ||
    kbs[0] ||
    mockKnowledgeBases[0];

  const apiHost = getApiOrigin();

  const embedScript = `<!-- Rag_Mcp Web Chatbot Embed -->
<script
  src="${apiHost}/api/v1/public/widget.js"
  data-bot-id="${bot.publicId || bot.id}"
  data-api-host="${apiHost}"
  data-color="${themeConfig.primaryColor}"
  data-position="${themeConfig.position}"
  defer>
</script>`;

  return (
    <div>
      {loading && (
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "1rem", color: "var(--text-secondary)" }}>
          <Loader size={16} className="animate-spin" /> Loading chatbot details...
        </div>
      )}
      {/* Bot Top Header */}
      <div className="bot-detail-header">
        <div className="bot-detail-header-left">
          <div
            className="bot-detail-header-icon"
            style={{
              "--bot-color": themeConfig.primaryColor,
              "--bot-bg": `${themeConfig.primaryColor}25`,
            }}
          >
            <Bot size={22} />
          </div>
          <div>
            <div className="bot-detail-header-title-row">
              <h1 className="page-title bot-detail-header-title">{themeConfig.name}</h1>
              <Badge variant={bot.status === "active" ? "success" : "neutral"} dot>
                {bot.status}
              </Badge>
            </div>
            <p className="page-desc bot-detail-header-desc">{bot.description}</p>
          </div>
        </div>

        <div className="bot-detail-header-actions">
          <Link to={`/assistant?botId=${bot.id}`} className="btn btn-secondary btn-sm btn-with-icon">
            <MessageSquare size={13} /> Test in Assistant
          </Link>
          <button
            type="button"
            className="btn btn-primary btn-sm btn-with-icon"
            onClick={() => handleTabChange("embed")}
          >
            <Code2 size={13} /> Get Embed Code
          </button>
        </div>
      </div>

      {/* Tabs Bar */}
      <div className="tabs-list bot-detail-tabs">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              className={`tab-trigger ${isActive ? "active" : ""} bot-detail-tab-btn`}
              onClick={() => handleTabChange(tab.id)}
            >
              <Icon size={14} />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab Panels */}
      {activeTab === "overview" && (
        <OverviewTab bot={bot} linkedKb={linkedKb} embedScript={embedScript} />
      )}
      {activeTab === "customize" && (
        <CustomizeTab
          bot={bot}
          themeConfig={themeConfig}
          setThemeConfig={setThemeConfig}
          onSaveTheme={handleSaveTheme}
          simulatedSiteUrl={bot.allowedDomains?.[0] || "https://yourwebsite.com"}
        />
      )}
      {activeTab === "sources" && <SourcesTab linkedKb={linkedKb} />}
      {activeTab === "analytics" && <AnalyticsTab />}
      {activeTab === "embed" && (
        <EmbedTab bot={bot} themeConfig={themeConfig} embedScript={embedScript} apiHost={apiHost} />
      )}
      {activeTab === "settings" && <SettingsTab bot={bot} />}
    </div>
  );
}
