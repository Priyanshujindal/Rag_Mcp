import React, { useState, useEffect, useMemo } from "react";
import { X, Code2, Eye, Copy, Check, Download, ExternalLink, Maximize2 } from "lucide-react";

/**
 * Interactive Code & Data Artifacts Preview Drawer (Claude Artifacts style).
 * Renders HTML, SVG, and interactive charts live in an isolated side drawer.
 *
 * @param {object} props
 * @param {object} props.artifact - Artifact data { title, code, language, type }
 * @param {() => void} props.onClose - Drawer close callback
 */
export function ArtifactDrawer({ artifact, onClose }) {
  const [activeTab, setActiveTab] = useState("preview");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (artifact) {
      setActiveTab("preview");
    }
  }, [artifact]);

  const handleCopy = () => {
    if (!artifact?.code) return;
    navigator.clipboard.writeText(artifact.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  const handleDownload = () => {
    if (!artifact?.code) return;
    const isSvg = artifact.language === "svg" || artifact.code.trim().startsWith("<svg");
    const filename = `${(artifact.title || "artifact").toLowerCase().replace(/[^a-z0-9]+/g, "-")}.${isSvg ? "svg" : "html"}`;
    const blob = new Blob([artifact.code], { type: isSvg ? "image/svg+xml" : "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleOpenNewTab = () => {
    if (!artifact?.code) return;
    const isSvg = artifact.language === "svg" || artifact.code.trim().startsWith("<svg");
    const blob = new Blob([srcDocContent], { type: isSvg ? "image/svg+xml" : "text/html" });
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank");
  };

  // Build sandboxed HTML document with Chart.js and Tailwind pre-loaded
  const srcDocContent = useMemo(() => {
    if (!artifact?.code) return "";
    const raw = artifact.code.trim();
    const isFullHtml = raw.toLowerCase().includes("<html") || raw.toLowerCase().includes("<!doctype");
    const isSvg = artifact.language === "svg" || raw.startsWith("<svg");

    if (isSvg) {
      return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body {
      margin: 0;
      padding: 24px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #0f172a;
      min-height: 100vh;
      box-sizing: border-box;
    }
    svg {
      max-width: 100%;
      height: auto;
      filter: drop-shadow(0 4px 12px rgba(0,0,0,0.3));
    }
  </style>
</head>
<body>
  ${raw}
</body>
</html>`;
    }

    if (isFullHtml) {
      return raw;
    }

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <script src="https://cdn.tailwindcss.com"></script>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <style>
    body {
      margin: 0;
      padding: 20px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #090d16;
      color: #f1f5f9;
      min-height: 100vh;
      box-sizing: border-box;
    }
  </style>
</head>
<body>
  ${raw}
</body>
</html>`;
  }, [artifact]);

  if (!artifact) return null;

  return (
    <aside className="chatgpt-artifact-drawer" aria-label="Artifact preview drawer">
      <div className="chatgpt-artifact-header">
        <div className="artifact-header-left">
          <span className="artifact-title-badge">Artifact</span>
          <h3 className="artifact-title" title={artifact.title || "Interactive Preview"}>
            {artifact.title || "Interactive Artifact"}
          </h3>
          <span className="artifact-lang-tag">{artifact.language || "HTML"}</span>
        </div>

        <div className="artifact-header-tabs">
          <button
            type="button"
            className={`artifact-tab-btn ${activeTab === "preview" ? "active" : ""}`}
            onClick={() => setActiveTab("preview")}
          >
            <Eye size={13} />
            <span>Preview</span>
          </button>
          <button
            type="button"
            className={`artifact-tab-btn ${activeTab === "code" ? "active" : ""}`}
            onClick={() => setActiveTab("code")}
          >
            <Code2 size={13} />
            <span>Code</span>
          </button>
        </div>

        <div className="artifact-header-actions">
          <button
            type="button"
            className="artifact-action-btn"
            onClick={handleCopy}
            title={copied ? "Copied" : "Copy code"}
            aria-label="Copy code"
          >
            {copied ? <Check size={14} color="#10a37f" /> : <Copy size={14} />}
          </button>

          <button
            type="button"
            className="artifact-action-btn"
            onClick={handleDownload}
            title="Download file"
            aria-label="Download file"
          >
            <Download size={14} />
          </button>

          <button
            type="button"
            className="artifact-action-btn"
            onClick={handleOpenNewTab}
            title="Open in new tab"
            aria-label="Open in new tab"
          >
            <ExternalLink size={14} />
          </button>

          <button
            type="button"
            className="artifact-action-btn close-btn"
            onClick={onClose}
            title="Close artifact"
            aria-label="Close artifact drawer"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      <div className="chatgpt-artifact-content">
        {activeTab === "preview" ? (
          <iframe
            className="artifact-preview-iframe"
            title="Interactive Preview"
            srcDoc={srcDocContent}
            sandbox="allow-scripts allow-modals allow-same-origin"
          />
        ) : (
          <div className="artifact-code-view">
            <pre className="artifact-code-pre">
              <code>{artifact.code}</code>
            </pre>
          </div>
        )}
      </div>
    </aside>
  );
}

