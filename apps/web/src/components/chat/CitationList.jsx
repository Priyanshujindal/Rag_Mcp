import React from "react";
import { ShieldCheck, ExternalLink } from "lucide-react";

/**
 * Extracts a clean hostname for display badges (e.g. "wikipedia.org", "vidiq.com")
 */
function extractDomain(url) {
  if (!url) return null;
  try {
    const parsed = new URL(url.startsWith("http://") || url.startsWith("https://") ? url : `https://${url}`);
    return parsed.hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/**
 * Renders a list of citations for a generated assistant response.
 * Clickable links navigate directly to the reference source in a new tab.
 * @param {object} props
 * @param {Array<{ title: string, url?: string, score: number }>} props.sources - List of source references
 */
export function CitationList({ sources }) {
  if (!sources || sources.length === 0) return null;

  return (
    <div className="chat-sources-row">
      <span className="chat-sources-label">Sources:</span>
      {sources.map((src, i) => {
        const scorePercent = src.score && src.score > 0 ? `${Math.round(src.score * 100)}%` : null;
        const rawUrl = src.url ? src.url.trim() : "";
        const href = rawUrl
          ? rawUrl.startsWith("http://") || rawUrl.startsWith("https://")
            ? rawUrl
            : `https://${rawUrl}`
          : null;
        const domain = href ? extractDomain(href) : null;

        if (href) {
          return (
            <a
              key={i}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="chat-source-chip clickable"
              title={`Visit source: ${src.title}\n${href}`}
            >
              <ExternalLink size={11} className="chip-external-icon" />
              {domain && <span className="chip-domain">{domain}</span>}
              <span className="chip-text">{src.title}</span>
              {scorePercent && <span className="chip-score">({scorePercent})</span>}
            </a>
          );
        }

        return (
          <span key={i} className="chat-source-chip" title={src.title}>
            <ShieldCheck size={11} />
            <span className="chip-text">{src.title}</span>
            {scorePercent && <span className="chip-score">({scorePercent})</span>}
          </span>
        );
      })}
    </div>
  );
}


