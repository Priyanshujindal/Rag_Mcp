import React, { useState } from "react";
import { Check, Copy, Eye } from "lucide-react";

/**
 * Component for displaying syntax-highlighted or formatted code with copy & artifact preview.
 * @param {object} props
 * @param {string} props.code - The code string to display
 * @param {string} [props.language] - Programming language identifier
 */
export function CodeBlock({ code, language = "javascript" }) {
  const [copied, setCopied] = useState(false);

  const cleanLang = (language || "").toLowerCase().trim();
  const isPreviewable =
    cleanLang === "html" ||
    cleanLang === "svg" ||
    cleanLang === "xml" ||
    (code && (
      code.includes("<svg") ||
      code.includes("<!DOCTYPE html>") ||
      code.includes("<html") ||
      code.includes("<canvas") ||
      code.includes("new Chart(")
    ));

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  const handlePreview = () => {
    const isSvg = cleanLang === "svg" || code.trim().startsWith("<svg");
    window.dispatchEvent(
      new CustomEvent("rag:open-artifact", {
        detail: {
          title: isSvg ? "SVG Graphic Preview" : "Interactive Artifact",
          code,
          language: isSvg ? "svg" : "html",
          type: isSvg ? "svg" : "html",
        },
      })
    );
  };

  return (
    <div className="code-snippet-box">
      <div className="bot-detail-card-header">
        <span className="api-key-code">{language}</span>
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          {isPreviewable && (
            <button
              type="button"
              className="btn btn-ghost btn-sm btn-with-icon chat-artifact-btn"
              onClick={handlePreview}
              title="Preview interactive artifact"
              aria-label="Preview interactive artifact"
              style={{
                color: "var(--accent, #10a37f)",
                fontWeight: 500,
                fontSize: "12px",
              }}
            >
              <Eye size={12} />
              <span>Preview</span>
            </button>
          )}
          <button
            type="button"
            className="btn btn-ghost btn-sm btn-with-icon"
            onClick={handleCopy}
            aria-label="Copy code"
          >
            {copied ? <Check size={12} color="var(--success)" /> : <Copy size={12} />}
            <span>{copied ? "Copied" : "Copy"}</span>
          </button>
        </div>
      </div>
      <pre className="bot-detail-code-pre">
        <code>{code}</code>
      </pre>
    </div>
  );
}

