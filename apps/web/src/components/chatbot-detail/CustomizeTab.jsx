import React, { useState } from "react";
import { Palette, MessageSquare, Plus, X } from "lucide-react";
import { LiveWidgetPreview } from "@/components/bot-customizer/live-preview";

const PRESET_COLORS = [
  "#6366f1", // Indigo
  "#0070f3", // Vercel Blue
  "#10b981", // Emerald
  "#8b5cf6", // Purple
  "#ec4899", // Pink
  "#f97316", // Orange
  "#18181b", // Zinc Dark
];

/**
 * Customizer tab providing brand controls, tone of voice, suggested questions, and live widget preview.
 * @param {object} props
 * @param {object} props.themeConfig - Configuration state for theme and behavior
 * @param {React.Dispatch<React.SetStateAction<object>>} props.setThemeConfig - State setter for themeConfig
 * @param {string} props.simulatedSiteUrl - Fallback website URL for preview
 */
export function CustomizeTab({ themeConfig, setThemeConfig, simulatedSiteUrl }) {
  const [newQuestion, setNewQuestion] = useState("");

  const addQuestion = () => {
    if (!newQuestion.trim()) return;
    setThemeConfig((prev) => ({
      ...prev,
      suggestedQuestions: [...prev.suggestedQuestions, newQuestion.trim()],
    }));
    setNewQuestion("");
  };

  const removeQuestion = (idx) => {
    setThemeConfig((prev) => ({
      ...prev,
      suggestedQuestions: prev.suggestedQuestions.filter((_, i) => i !== idx),
    }));
  };

  return (
    <div className="customizer-layout">
      {/* Left Form: Theme & Behavior Settings */}
      <div className="customizer-form">
        <div>
          <div className="customizer-section-title">
            <Palette size={14} /> Brand & Styling
          </div>
          <div className="customizer-fields">
            <div className="form-row auth-form-row">
              <label className="form-label">Chatbot Display Name</label>
              <input
                type="text"
                className="input"
                value={themeConfig.name}
                onChange={(e) => setThemeConfig({ ...themeConfig, name: e.target.value })}
              />
            </div>

            <div className="form-row auth-form-row">
              <label className="form-label">Widget Header Title</label>
              <input
                type="text"
                className="input"
                value={themeConfig.headerTitle}
                onChange={(e) => setThemeConfig({ ...themeConfig, headerTitle: e.target.value })}
              />
            </div>

            <div className="form-row auth-form-row">
              <label className="form-label">Primary Brand Color</label>
              <div className="color-swatches color-swatches-wrapper">
                {PRESET_COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    className={`color-swatch color-swatch-item ${themeConfig.primaryColor === color ? "active" : ""}`}
                    style={{ "--swatch-color": color }}
                    onClick={() => setThemeConfig({ ...themeConfig, primaryColor: color })}
                    title={color}
                    aria-label={`Select color ${color}`}
                  />
                ))}
              </div>
              <input
                type="text"
                className="input color-hex-input"
                value={themeConfig.primaryColor}
                onChange={(e) => setThemeConfig({ ...themeConfig, primaryColor: e.target.value })}
              />
            </div>

            <div className="customizer-two-col">
              <div className="form-row auth-form-row">
                <label className="form-label">Widget Theme</label>
                <select
                  className="input"
                  value={themeConfig.theme}
                  onChange={(e) => setThemeConfig({ ...themeConfig, theme: e.target.value })}
                >
                  <option value="dark">Dark Theme</option>
                  <option value="light">Light Theme</option>
                </select>
              </div>
              <div className="form-row auth-form-row">
                <label className="form-label">Bubble Position</label>
                <select
                  className="input"
                  value={themeConfig.position}
                  onChange={(e) => setThemeConfig({ ...themeConfig, position: e.target.value })}
                >
                  <option value="bottom-right">Bottom Right</option>
                  <option value="bottom-left">Bottom Left</option>
                </select>
              </div>
            </div>
          </div>
        </div>

        {/* Welcome & Prompt Settings */}
        <div>
          <div className="customizer-section-title">
            <MessageSquare size={14} /> Messages & Instructions
          </div>
          <div className="customizer-fields">
            <div className="form-row auth-form-row">
              <label className="form-label">Welcome Message</label>
              <textarea
                className="input textarea"
                rows={2}
                value={themeConfig.welcomeMessage}
                onChange={(e) => setThemeConfig({ ...themeConfig, welcomeMessage: e.target.value })}
              />
            </div>

            <div className="form-row auth-form-row">
              <label className="form-label">System Prompt (LLM Persona)</label>
              <textarea
                className="input textarea"
                rows={3}
                value={themeConfig.systemPrompt}
                onChange={(e) => setThemeConfig({ ...themeConfig, systemPrompt: e.target.value })}
              />
            </div>

            {/* Suggested Questions */}
            <div className="form-row auth-form-row">
              <label className="form-label">Suggested Starter Questions</label>
              <div className="suggested-q-list">
                {themeConfig.suggestedQuestions.map((q, idx) => (
                  <div key={idx} className="suggested-q-item">
                    <span className="suggested-q-text">{q}</span>
                    <button
                      type="button"
                      className="suggested-q-delete"
                      onClick={() => removeQuestion(idx)}
                      aria-label={`Remove question: ${q}`}
                    >
                      <X size={13} />
                    </button>
                  </div>
                ))}
              </div>

              <div className="suggested-q-add-row">
                <input
                  type="text"
                  className="input"
                  placeholder="Add another suggested question…"
                  value={newQuestion}
                  onChange={(e) => setNewQuestion(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addQuestion()}
                />
                <button
                  type="button"
                  className="btn btn-secondary btn-sm btn-with-icon"
                  onClick={addQuestion}
                  aria-label="Add suggested question"
                >
                  <Plus size={13} /> Add
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="customizer-actions">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => alert("Settings saved successfully!")}
          >
            Save Changes
          </button>
        </div>
      </div>

      {/* Right Panel: Instant Live Interactive Widget Preview */}
      <LiveWidgetPreview
        config={themeConfig}
        simulatedSiteUrl={simulatedSiteUrl}
      />
    </div>
  );
}

