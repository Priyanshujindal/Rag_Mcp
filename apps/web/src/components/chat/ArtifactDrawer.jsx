import React, { useState, useEffect, useMemo } from "react";
import {
  X,
  Code2,
  Eye,
  Copy,
  Check,
  Download,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
  FileText,
  Table as TableIcon,
  Presentation,
  Loader2,
} from "lucide-react";
import { getAccessToken, getActiveWorkspaceId } from "@/lib/api/client";
import "./artifact-card.css";

export function ArtifactDrawer({ artifact, onClose }) {
  const [activeTab, setActiveTab] = useState("preview");
  const [copied, setCopied] = useState(false);
  const [currentSlideIndex, setCurrentSlideIndex] = useState(0);
  const [tableFilter, setTableFilter] = useState("");
  const [pdfBlobUrl, setPdfBlobUrl] = useState(null);
  const [loadingPdf, setLoadingPdf] = useState(false);

  const fileType = (artifact?.fileType || artifact?.language || "").toLowerCase();
  const previewData = artifact?.previewData || {};

  useEffect(() => {
    setActiveTab("preview");
    setCurrentSlideIndex(0);
    setTableFilter("");

    // If PDF, fetch blob for native browser iframe preview
    if (fileType === "pdf" && (artifact?.id || artifact?._id)) {
      const artifactId = artifact.id || artifact._id;
      const token = getAccessToken();
      const workspaceId = getActiveWorkspaceId();
      const BASE_URL = import.meta.env.VITE_API_URL || "/api/v1";

      setLoadingPdf(true);
      fetch(`${BASE_URL}/artifacts/${artifactId}/download`, {
        headers: {
          ...(token && { Authorization: `Bearer ${token}` }),
          ...(workspaceId && { "X-Workspace-Id": workspaceId }),
        },
      })
        .then((res) => {
          if (!res.ok) throw new Error("Failed to load PDF");
          return res.blob();
        })
        .then((blob) => {
          const url = URL.createObjectURL(blob);
          setPdfBlobUrl(url);
        })
        .catch((err) => console.warn("PDF preview fetch error:", err))
        .finally(() => setLoadingPdf(false));
    }

    return () => {
      if (pdfBlobUrl) {
        URL.revokeObjectURL(pdfBlobUrl);
      }
    };
  }, [artifact]);

  const rawCode = useMemo(() => {
    if (artifact?.code) return artifact.code;
    if (previewData.code) return previewData.code;
    if (previewData.text) return previewData.text;
    return "";
  }, [artifact, previewData]);

  const handleCopy = () => {
    if (!rawCode) return;
    navigator.clipboard.writeText(rawCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  const handleDownload = async () => {
    const artifactId = artifact?.id || artifact?._id;
    if (artifactId) {
      const token = getAccessToken();
      const workspaceId = getActiveWorkspaceId();
      const BASE_URL = import.meta.env.VITE_API_URL || "/api/v1";

      const res = await fetch(`${BASE_URL}/artifacts/${artifactId}/download`, {
        headers: {
          ...(token && { Authorization: `Bearer ${token}` }),
          ...(workspaceId && { "X-Workspace-Id": workspaceId }),
        },
      });
      if (res.ok) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = artifact.filename || `file.${fileType || "txt"}`;
        a.click();
        URL.revokeObjectURL(url);
        return;
      }
    }

    // Fallback download from code string
    if (rawCode) {
      const blob = new Blob([rawCode], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = artifact.filename || `artifact.${fileType || "txt"}`;
      a.click();
      URL.revokeObjectURL(url);
    }
  };

  const handleOpenNewTab = () => {
    if (pdfBlobUrl) {
      window.open(pdfBlobUrl, "_blank");
      return;
    }
    if (rawCode) {
      const blob = new Blob([rawCode], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank");
    }
  };

  // Render HTML / SVG code
  const srcDocContent = useMemo(() => {
    if (!artifact?.code) return "";
    const raw = artifact.code.trim();
    const isSvg = artifact.language === "svg" || raw.startsWith("<svg");

    if (isSvg) {
      return `<!DOCTYPE html><html><body style="margin:0;padding:24px;display:flex;align-items:center;justify-content:center;background:#0f172a;min-height:100vh;">${raw}</body></html>`;
    }
    if (raw.toLowerCase().includes("<html") || raw.toLowerCase().includes("<!doctype")) {
      return raw;
    }
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><script src="https://cdn.tailwindcss.com"></script><script src="https://cdn.jsdelivr.net/npm/chart.js"></script><body style="margin:0;padding:20px;font-family:sans-serif;background:#090d16;color:#f1f5f9;">${raw}</body></html>`;
  }, [artifact]);

  if (!artifact) return null;

  // PPTX Presentation Slides Preview
  const slides = previewData.slides || [];
  const activeSlide = slides[currentSlideIndex] || slides[0];

  // Table Data Preview (XLSX, CSV)
  const headers = previewData.headers || [];
  const rows = previewData.rows || [];
  const filteredRows = useMemo(() => {
    if (!tableFilter.trim()) return rows;
    const q = tableFilter.toLowerCase();
    return rows.filter((r) =>
      r.some((c) => String(c).toLowerCase().includes(q))
    );
  }, [rows, tableFilter]);

  return (
    <aside className="chatgpt-artifact-drawer" aria-label="Artifact preview drawer">
      <div className="chatgpt-artifact-header">
        <div className="artifact-header-left">
          <span className="artifact-title-badge">Artifact</span>
          <h3 className="artifact-title" title={artifact.filename || artifact.title || "Preview"}>
            {artifact.filename || artifact.title || "Interactive Artifact"}
          </h3>
          <span className="artifact-lang-tag">{(fileType || "file").toUpperCase()}</span>
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
            <span>Content</span>
          </button>
        </div>

        <div className="artifact-header-actions">
          {rawCode && (
            <button
              type="button"
              className="artifact-action-btn"
              onClick={handleCopy}
              title={copied ? "Copied" : "Copy content"}
            >
              {copied ? <Check size={14} color="#10a37f" /> : <Copy size={14} />}
            </button>
          )}

          <button
            type="button"
            className="artifact-action-btn"
            onClick={handleDownload}
            title="Download file"
          >
            <Download size={14} />
          </button>

          <button
            type="button"
            className="artifact-action-btn"
            onClick={handleOpenNewTab}
            title="Open in new window"
          >
            <ExternalLink size={14} />
          </button>

          <button
            type="button"
            className="artifact-action-btn close-btn"
            onClick={onClose}
            title="Close drawer"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      <div className="chatgpt-artifact-content" style={{ height: "calc(100% - 53px)", overflow: "hidden" }}>
        {activeTab === "preview" ? (
          // 1. PPTX Slide Presentation View
          fileType === "pptx" && slides.length > 0 ? (
            <div className="artifact-slide-container">
              <div className="artifact-slide-card">
                <h2 className="artifact-slide-title">
                  {activeSlide?.title || `Slide ${currentSlideIndex + 1}`}
                </h2>
                <ul className="artifact-slide-points">
                  {(activeSlide?.points || []).map((pt, pIdx) => (
                    <li key={pIdx} className="artifact-slide-point">
                      <span>{pt}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="artifact-slide-footer">
                <button
                  type="button"
                  className="artifact-slide-nav-btn"
                  disabled={currentSlideIndex === 0}
                  onClick={() => setCurrentSlideIndex((prev) => Math.max(0, prev - 1))}
                >
                  <ChevronLeft size={16} />
                  <span>Previous</span>
                </button>

                <span className="artifact-slide-counter">
                  Slide {currentSlideIndex + 1} of {slides.length}
                </span>

                <button
                  type="button"
                  className="artifact-slide-nav-btn"
                  disabled={currentSlideIndex >= slides.length - 1}
                  onClick={() => setCurrentSlideIndex((prev) => Math.min(slides.length - 1, prev + 1))}
                >
                  <span>Next</span>
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
          ) : // 2. XLSX / CSV Data Table View
          (fileType === "xlsx" || fileType === "csv") && headers.length > 0 ? (
            <div className="artifact-table-container">
              <div className="artifact-table-toolbar">
                <input
                  type="text"
                  placeholder="Filter table rows..."
                  value={tableFilter}
                  onChange={(e) => setTableFilter(e.target.value)}
                  className="artifact-table-search"
                />
                <span className="artifact-slide-counter">
                  Showing {filteredRows.length} rows ({headers.length} columns)
                </span>
              </div>

              <div className="artifact-table-wrapper">
                <table className="artifact-data-table">
                  <thead>
                    <tr>
                      {headers.map((h, hIdx) => (
                        <th key={hIdx}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRows.map((r, rIdx) => (
                      <tr key={rIdx}>
                        {r.map((c, cIdx) => (
                          <td key={cIdx}>{String(c)}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : // 3. PDF Native Preview
          fileType === "pdf" ? (
            loadingPdf ? (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#94a3b8" }}>
                <Loader2 size={24} className="animate-spin" />
                <span style={{ marginLeft: 8 }}>Loading PDF preview...</span>
              </div>
            ) : pdfBlobUrl ? (
              <iframe
                src={pdfBlobUrl}
                title="PDF Preview"
                style={{ width: "100%", height: "100%", border: "none" }}
              />
            ) : (
              <div className="artifact-doc-container">
                <div className="artifact-doc-paper">
                  <h1 className="artifact-doc-title">{artifact.filename || "PDF Document"}</h1>
                  <div className="artifact-doc-content">{previewData.text || rawCode || "Document generated successfully."}</div>
                </div>
              </div>
            )
          ) : // 4. DOCX Document View
          fileType === "docx" ? (
            <div className="artifact-doc-container">
              <div className="artifact-doc-paper">
                <h1 className="artifact-doc-title">{previewData.title || artifact.filename || "Document Report"}</h1>
                <div className="artifact-doc-content">{previewData.text || rawCode || "Document generated successfully."}</div>
              </div>
            </div>
          ) : // 5. HTML / SVG preview
          artifact.code ? (
            <iframe
              className="artifact-preview-iframe"
              title="Interactive Preview"
              srcDoc={srcDocContent}
              sandbox="allow-scripts allow-modals allow-same-origin"
              style={{ width: "100%", height: "100%", border: "none" }}
            />
          ) : (
            // 6. Generic Code / Text View
            <div className="artifact-code-view" style={{ padding: 20, height: "100%", overflow: "auto" }}>
              <pre className="artifact-code-pre">
                <code>{rawCode || "No preview available"}</code>
              </pre>
            </div>
          )
        ) : (
          <div className="artifact-code-view" style={{ padding: 20, height: "100%", overflow: "auto" }}>
            <pre className="artifact-code-pre">
              <code>{rawCode || JSON.stringify(previewData, null, 2)}</code>
            </pre>
          </div>
        )}
      </div>
    </aside>
  );
}

export default ArtifactDrawer;
