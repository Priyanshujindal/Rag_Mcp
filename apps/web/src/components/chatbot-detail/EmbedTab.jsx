import React, { useState } from "react";
import { Check, Copy } from "lucide-react";

/**
 * Embed tab providing script tag snippet and React component integration examples.
 * @param {object} props
 * @param {object} props.bot - Chatbot instance
 * @param {object} props.themeConfig - Theme and configuration settings
 * @param {string} props.embedScript - Generated embed script
 */
export function EmbedTab({ bot, themeConfig, embedScript }) {
  const [copiedScript, setCopiedScript] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(embedScript);
    setCopiedScript(true);
    setTimeout(() => setCopiedScript(false), 2000);
  };

  const reactSnippet = `import { ChatbotWidget } from "@rag-mcp/widget-react";

export default function Layout({ children }) {
  return (
    <>
      {children}
      <ChatbotWidget
        botId="${bot.id}"
        primaryColor="${themeConfig.primaryColor}"
        position="${themeConfig.position}"
      />
    </>
  );
}`;

  return (
    <div className="embed-stack">
      {/* Method 1: HTML Script Tag */}
      <div className="card bot-detail-card-padded">
        <div className="bot-detail-card-header">
          <h4 className="bot-detail-card-title">
            Method 1: Standard Script Tag (Recommended)
          </h4>
          <button
            type="button"
            className="btn btn-secondary btn-sm btn-with-icon"
            onClick={handleCopy}
            aria-label="Copy embed script"
          >
            {copiedScript ? <Check size={13} color="var(--success)" /> : <Copy size={13} />}
            {copiedScript ? "Copied" : "Copy Code"}
          </button>
        </div>
        <p className="embed-desc">
          Paste this snippet right before the closing <code>&lt;/body&gt;</code> tag of your website.
        </p>
        <pre className="bot-detail-code-pre">
          {embedScript}
        </pre>
      </div>

      {/* Method 2: React Component */}
      <div className="card bot-detail-card-padded">
        <h4 className="bot-detail-card-title">
          Method 2: React / Next.js Component
        </h4>
        <p className="embed-desc">
          Import our lightweight NPM package <code>@rag-mcp/widget-react</code>.
        </p>
        <pre className="bot-detail-code-pre">
          {reactSnippet}
        </pre>
      </div>
    </div>
  );
}

