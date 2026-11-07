import React, { useState } from "react";
import { Check, Copy, Play, Code2, Sparkles, ExternalLink } from "lucide-react";

/**
 * Embed tab providing script tag snippet, JS initialization, and live in-page testing.
 * @param {object} props
 * @param {object} props.bot - Chatbot instance
 * @param {object} props.themeConfig - Theme and configuration settings
 * @param {string} props.embedScript - Generated embed script
 * @param {string} [props.apiHost] - API host URL
 */
export function EmbedTab({ bot, themeConfig, embedScript, apiHost = "http://localhost:8000" }) {
  const [copiedScript, setCopiedScript] = useState(false);
  const [copiedJs, setCopiedJs] = useState(false);
  const [isLiveTesting, setIsLiveTesting] = useState(false);

  const botId = bot.publicId || bot.id;

  const handleCopyScript = () => {
    navigator.clipboard.writeText(embedScript);
    setCopiedScript(true);
    setTimeout(() => setCopiedScript(false), 2000);
  };

  const jsSnippet = `<!-- Method 2: Programmatic JavaScript API -->
<script src="${apiHost}/api/v1/public/widget.js" defer></script>
<script>
  window.addEventListener("DOMContentLoaded", function() {
    RagMcpWidget.init({
      botId: "${botId}",
      apiHost: "${apiHost}",
      primaryColor: "${themeConfig.primaryColor}",
      position: "${themeConfig.position}",
      welcomeMessage: "${bot.config?.welcomeMessage || 'Hello! How can I help you today?'}"
    });
  });
</script>`;

  const handleCopyJs = () => {
    navigator.clipboard.writeText(jsSnippet);
    setCopiedJs(true);
    setTimeout(() => setCopiedJs(false), 2000);
  };

  const handleTestLive = () => {
    if (isLiveTesting) {
      if (window.RagMcpWidget) window.RagMcpWidget.destroy();
      setIsLiveTesting(false);
      return;
    }

    // Load widget script if not already present
    const existingScript = document.querySelector('script[src*="widget.js"]');
    const startWidget = () => {
      if (window.RagMcpWidget) {
        window.RagMcpWidget.init({
          botId,
          apiHost,
          primaryColor: themeConfig.primaryColor,
          position: themeConfig.position,
          welcomeMessage: bot.config?.welcomeMessage,
          suggestedQuestions: bot.config?.suggestedQuestions,
        });
        window.RagMcpWidget.open();
        setIsLiveTesting(true);
      }
    };

    if (window.RagMcpWidget) {
      startWidget();
    } else {
      const script = document.createElement("script");
      script.src = `${apiHost}/api/v1/public/widget.js`;
      script.onload = startWidget;
      document.head.appendChild(script);
    }
  };

  const reactSnippet = `import { useEffect } from "react";

export function ChatbotWidget() {
  useEffect(() => {
    const script = document.createElement("script");
    script.src = "${apiHost}/api/v1/public/widget.js";
    script.setAttribute("data-bot-id", "${botId}");
    script.setAttribute("data-api-host", "${apiHost}");
    script.setAttribute("data-color", "${themeConfig.primaryColor}");
    script.setAttribute("data-position", "${themeConfig.position}");
    script.async = true;
    document.body.appendChild(script);

    return () => {
      if (window.RagMcpWidget) window.RagMcpWidget.destroy();
      if (script.parentNode) script.parentNode.removeChild(script);
    };
  }, []);

  return null;
}`;

  return (
    <div className="embed-stack">
      {/* Live Test Banner Card */}
      <div className="card bot-detail-card-padded" style={{ borderColor: "var(--accent)" }}>
        <div className="bot-detail-card-header">
          <div>
            <h4 className="bot-detail-card-title" style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <Sparkles size={16} color="var(--accent)" /> Test Embed On This Page
            </h4>
            <p className="embed-desc" style={{ marginTop: "4px" }}>
              Launch the live widget in the corner of your screen right now to verify appearance and streaming.
            </p>
          </div>
          <button
            type="button"
            className="btn btn-primary btn-with-icon"
            onClick={handleTestLive}
          >
            <Play size={13} /> {isLiveTesting ? "Dismiss Live Widget" : "Launch Live Widget"}
          </button>
        </div>
      </div>

      {/* Method 1: HTML Script Tag */}
      <div className="card bot-detail-card-padded">
        <div className="bot-detail-card-header">
          <div>
            <h4 className="bot-detail-card-title">
              Method 1: HTML Script Tag (Recommended for any Website)
            </h4>
            <p className="embed-desc" style={{ marginTop: "4px" }}>
              Paste this snippet right before the closing <code>&lt;/body&gt;</code> tag of your website. Zero configuration needed.
            </p>
          </div>
          <button
            type="button"
            className="btn btn-secondary btn-sm btn-with-icon"
            onClick={handleCopyScript}
            aria-label="Copy embed script"
          >
            {copiedScript ? <Check size={13} color="var(--success)" /> : <Copy size={13} />}
            {copiedScript ? "Copied" : "Copy Code"}
          </button>
        </div>
        <pre className="bot-detail-code-pre">
          {embedScript}
        </pre>
      </div>

      {/* Method 2: Programmatic JS */}
      <div className="card bot-detail-card-padded">
        <div className="bot-detail-card-header">
          <div>
            <h4 className="bot-detail-card-title">
              Method 2: Programmatic JavaScript API
            </h4>
            <p className="embed-desc" style={{ marginTop: "4px" }}>
              Control the widget dynamically using <code>RagMcpWidget.init()</code>, <code>.open()</code>, or <code>.close()</code>.
            </p>
          </div>
          <button
            type="button"
            className="btn btn-secondary btn-sm btn-with-icon"
            onClick={handleCopyJs}
            aria-label="Copy JavaScript snippet"
          >
            {copiedJs ? <Check size={13} color="var(--success)" /> : <Copy size={13} />}
            {copiedJs ? "Copied" : "Copy Code"}
          </button>
        </div>
        <pre className="bot-detail-code-pre">
          {jsSnippet}
        </pre>
      </div>

      {/* Method 3: React / Next.js */}
      <div className="card bot-detail-card-padded">
        <h4 className="bot-detail-card-title">
          Method 3: React / Next.js Integration
        </h4>
        <p className="embed-desc">
          Drop this component into your layout or app wrapper.
        </p>
        <pre className="bot-detail-code-pre">
          {reactSnippet}
        </pre>
      </div>
    </div>
  );
}
