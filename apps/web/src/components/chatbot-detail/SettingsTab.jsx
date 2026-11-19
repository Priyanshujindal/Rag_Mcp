import React from "react";
import { Trash2 } from "lucide-react";

/**
 * Settings tab for allowed CORS domains and chatbot deletion danger zone.
 * @param {object} props
 * @param {object} props.bot - Chatbot instance
 */
export function SettingsTab({ bot }) {
  const handleDelete = () => {
    if (window.confirm("Are you sure you want to delete this chatbot?")) {
      alert("Chatbot deleted.");
    }
  };

  return (
    <div className="settings-stack">
      <div className="card bot-detail-card-padded">
        <h4 className="bot-detail-card-title-lg">
          CORS & Allowed Domains
        </h4>
        <div className="form-row">
          <label className="form-label">Allowed Domains (one per line)</label>
          <textarea
            className="input textarea"
            rows={3}
            defaultValue={bot.allowedDomains?.join("\n") || "https://example.com"}
          />
          <span className="form-hint">
            Only requests originating from these domains will be permitted to query this bot.
          </span>
        </div>
      </div>

      {/* Danger Zone */}
      <div className="card danger-zone-card">
        <h4 className="danger-zone-title">
          Danger Zone
        </h4>
        <p className="bot-detail-card-desc-spaced">
          Deleting this chatbot will permanently invalidate its embed script and tokens.
        </p>
        <button
          type="button"
          className="btn btn-danger btn-with-icon"
          onClick={handleDelete}
        >
          <Trash2 size={14} /> Delete Chatbot
        </button>
      </div>
    </div>
  );
}

