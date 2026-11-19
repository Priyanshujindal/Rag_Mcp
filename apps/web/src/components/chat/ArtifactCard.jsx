import React, { useState } from "react";
import {
  FileText,
  FileSpreadsheet,
  Presentation,
  Code,
  Download,
  Eye,
  RotateCw,
  CheckCircle2,
  AlertCircle,
  Loader2,
} from "lucide-react";
import { getAccessToken, getActiveWorkspaceId } from "@/lib/api/client";
import "./artifact-card.css";

function formatBytes(bytes, decimals = 1) {
  if (!bytes || bytes === 0) return "0 B";
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + " " + sizes[i];
}

function formatTimestamp(ts) {
  if (!ts) return "";
  try {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

function getFileTypeIcon(fileType = "") {
  const t = fileType.toLowerCase();
  if (t === "pdf") {
    return {
      icon: <FileText size={20} />,
      label: "PDF",
      className: "artifact-icon-pdf",
    };
  }
  if (t === "docx" || t === "doc") {
    return {
      icon: <FileText size={20} />,
      label: "DOCX",
      className: "artifact-icon-docx",
    };
  }
  if (t === "pptx" || t === "ppt") {
    return {
      icon: <Presentation size={20} />,
      label: "PPTX",
      className: "artifact-icon-pptx",
    };
  }
  if (t === "xlsx" || t === "xls" || t === "csv") {
    return {
      icon: <FileSpreadsheet size={20} />,
      label: t.toUpperCase(),
      className: "artifact-icon-xlsx",
    };
  }
  if (
    [
      "py",
      "js",
      "jsx",
      "ts",
      "tsx",
      "html",
      "css",
      "json",
      "yaml",
      "sql",
      "java",
      "cpp",
      "c",
    ].includes(t)
  ) {
    return {
      icon: <Code size={20} />,
      label: t.toUpperCase(),
      className: "artifact-icon-code",
    };
  }
  return {
    icon: <FileText size={20} />,
    label: (t || "TXT").toUpperCase(),
    className: "artifact-icon-text",
  };
}

export function ArtifactCard({ artifact, onPreview, onRegenerate }) {
  const [isDownloading, setIsDownloading] = useState(false);
  const typeInfo = getFileTypeIcon(artifact.fileType || artifact.type);
  const status = artifact.status || "ready";

  const handleDownload = async (e) => {
    e.stopPropagation();
    const artifactId = artifact.id || artifact._id;
    if (!artifactId) return;

    try {
      setIsDownloading(true);
      const token = getAccessToken();
      const workspaceId = getActiveWorkspaceId();
      const BASE_URL = import.meta.env.VITE_API_URL || "/api/v1";

      const res = await fetch(`${BASE_URL}/artifacts/${artifactId}/download`, {
        headers: {
          ...(token && { Authorization: `Bearer ${token}` }),
          ...(workspaceId && { "X-Workspace-Id": workspaceId }),
        },
      });

      if (!res.ok) {
        throw new Error(`Download failed: ${res.statusText}`);
      }

      const blob = await res.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = downloadUrl;
      a.download = artifact.filename || `file.${artifact.fileType || "bin"}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(downloadUrl);
    } catch (err) {
      console.error("Artifact download failed:", err);
      alert("Failed to download file. Please try again.");
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <div className="artifact-card">
      <div className="artifact-card-left">
        <div className={`artifact-card-icon ${typeInfo.className}`}>
          {typeInfo.icon}
        </div>
        <div className="artifact-card-details">
          <span className="artifact-card-name" title={artifact.filename}>
            {artifact.filename || "Generated Document"}
          </span>
          <div className="artifact-card-meta">
            <span>{formatBytes(artifact.sizeBytes || artifact.size)}</span>
            <span>•</span>
            <span
              className={`artifact-card-badge ${
                status === "ready"
                  ? "artifact-badge-ready"
                  : status === "generating"
                  ? "artifact-badge-generating"
                  : "artifact-badge-failed"
              }`}
            >
              {status === "ready" && <CheckCircle2 size={11} />}
              {status === "generating" && <Loader2 size={11} className="animate-spin" />}
              {status === "failed" && <AlertCircle size={11} />}
              {status.charAt(0).toUpperCase() + status.slice(1)}
            </span>
            {artifact.createdAt && (
              <>
                <span>•</span>
                <span>{formatTimestamp(artifact.createdAt)}</span>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="artifact-card-actions">
        {onPreview && (
          <button
            type="button"
            className="artifact-btn"
            onClick={() => onPreview(artifact)}
            title="Preview file content"
          >
            <Eye size={14} />
            <span>Preview</span>
          </button>
        )}

        <button
          type="button"
          className="artifact-btn artifact-btn-download"
          onClick={handleDownload}
          disabled={isDownloading || status !== "ready"}
          title="Download file to computer"
        >
          {isDownloading ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Download size={14} />
          )}
          <span>{isDownloading ? "Downloading..." : "Download"}</span>
        </button>

        {onRegenerate && (
          <button
            type="button"
            className="artifact-btn artifact-btn-icon-only"
            onClick={() => onRegenerate(artifact)}
            title="Regenerate file"
          >
            <RotateCw size={14} />
          </button>
        )}
      </div>
    </div>
  );
}

export default ArtifactCard;

