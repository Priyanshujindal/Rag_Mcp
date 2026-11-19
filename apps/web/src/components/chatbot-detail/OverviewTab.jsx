import React, { useState } from "react";
import { Check, Copy } from "lucide-react";

/**
 * Overview tab displaying high-level metrics and a quick-embed script box.
 * @param {object} props
 * @param {object} props.bot - Chatbot model instance
 * @param {object} props.linkedKb - Knowledge base instance associated with the bot
 * @param {string} props.embedScript - Embed HTML snippet
 */
export function OverviewTab({ bot, linkedKb, embedScript }) {
  const [copiedScript, setCopiedScript] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(embedScript);
    setCopiedScript(true);
    setTimeout(() => setCopiedScript(false), 2000);
  };

  return (
    <div>
      {/* Quick Metrics */}
      <div className="metrics-grid bot-detail-tabs">
        <div className="metric-card">
          <span className="metric-label">Total Conversations</span>
          <div className="metric-value">{bot.conversationsCount.toLocaleString()}</div>
          <div className="metric-sub">Across all embedded sites</div>
        </div>
        <div className="metric-card">
          <span className="metric-label">Total Messages</span>
          <div className="metric-value">{bot.messagesCount.toLocaleString()}</div>
          <div className="metric-sub">4.8 avg messages/session</div>
        </div>
        <div className="metric-card">
          <span className="metric-label">Underlying Model</span>
          <div className="metric-value metric-val-compact">{bot.model}</div>
          <div className="metric-sub">Temp: {bot.temperature}</div>
        </div>
        <div className="metric-card">
          <span className="metric-label">Knowledge Base</span>
          <div className="metric-value metric-val-accent">
            {linkedKb.name.split(" ")[0]}
          </div>
          <div className="metric-sub">{linkedKb.totalChunks} indexed chunks</div>
        </div>
      </div>

      {/* Quick Embed Banner */}
      <div className="card bot-detail-card">
        <div className="bot-detail-card-header">
          <div>
            <h4 className="bot-detail-card-title">Quick Embed</h4>
            <p className="bot-detail-card-desc">
              Add this script to your site to activate the chatbot widget instantly.
            </p>
          </div>
          <button
            type="button"
            className="btn btn-secondary btn-sm btn-with-icon"
            onClick={handleCopy}
            aria-label="Copy code"
          >
            {copiedScript ? <Check size={13} color="var(--success)" /> : <Copy size={13} />}
            {copiedScript ? "Copied" : "Copy Code"}
          </button>
        </div>
        <pre className="bot-detail-code-pre">
          {embedScript}
        </pre>
      </div>
    </div>
  );
}

