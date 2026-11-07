import React, { useState, useEffect } from "react";
import { useParams, Link, useSearchParams } from "react-router-dom";
import {
  Bot, Settings, Palette, Database, BarChart3, Code2, MessageSquare, Loader
} from "lucide-react";
import { mockChatbots, mockKnowledgeBases } from "@/lib/mock/data";
import { getMockChatbotById, getMockKnowledgeBases, isMock } from "@/lib/api";
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

  const fallbackBot = mockChatbots.find((b) => b.id === botId) || mockChatbots[0];
  const [bot, setBot] = useState(fallbackBot);
  const [kbs, setKbs] = useState(mockKnowledgeBases);
  const [loading, setLoading] = useState(false);

  // Customizer state linked to live preview
  const [themeConfig, setThemeConfig] = useState({
    name: fallbackBot.name,
    headerTitle: fallbackBot.theme?.headerTitle || fallbackBot.name,
    primaryColor: fallbackBot.theme?.primaryColor || "#6366f1",
    theme: "dark",
    position: fallbackBot.theme?.position || "bottom-right",
    borderRadius: fallbackBot.theme?.borderRadius || "16px",
    welcomeMessage: fallbackBot.theme?.welcomeMessage || "Hi there! 👋 How can I help you today?",
    systemPrompt: fallbackBot.systemPrompt || "You are a helpful assistant.",
    suggestedQuestions: fallbackBot.theme?.suggestedQuestions || [
      "How does this product work?",
      "Can I view the documentation?",
      "How to contact support?",
    ],
  });

  useEffect(() => {
    if (!isMock && botId) {
      setLoading(true);
      Promise.all([
        getMockChatbotById(botId).catch(() => fallbackBot),
        getMockKnowledgeBases().catch(() => mockKnowledgeBases),
      ]).then(([loadedBot, loadedKbs]) => {
        if (loadedBot) {
          setBot(loadedBot);
          setThemeConfig((prev) => ({
            ...prev,
            name: loadedBot.name,
            headerTitle: loadedBot.theme?.headerTitle || loadedBot.name,
            primaryColor: loadedBot.theme?.primaryColor || "#6366f1",
            welcomeMessage: loadedBot.theme?.welcomeMessage || prev.welcomeMessage,
            systemPrompt: loadedBot.systemPrompt || prev.systemPrompt,
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

  const handleTabChange = (tabId) => {
    setSearchParams({ tab: tabId });
  };

  const linkedKb =
    kbs.find((kb) => (bot.knowledgeBaseIds || []).includes(kb.id)) ||
    kbs[0] ||
    mockKnowledgeBases[0];

  const embedScript = `<!-- Rag_Mcp Web Chatbot Embed -->
<script
  src="https://cdn.ragmcp.dev/widget.js"
  data-bot-id="${bot.publicId || bot.id}"
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
          themeConfig={themeConfig}
          setThemeConfig={setThemeConfig}
          simulatedSiteUrl={bot.allowedDomains?.[0] || "https://yourwebsite.com"}
        />
      )}
      {activeTab === "sources" && <SourcesTab linkedKb={linkedKb} />}
      {activeTab === "analytics" && <AnalyticsTab />}
      {activeTab === "embed" && (
        <EmbedTab bot={bot} themeConfig={themeConfig} embedScript={embedScript} />
      )}
      {activeTab === "settings" && <SettingsTab bot={bot} />}
    </div>
  );
}
