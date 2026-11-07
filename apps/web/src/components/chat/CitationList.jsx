import React from "react";
import { ShieldCheck } from "lucide-react";

/**
 * Renders a list of citations for a generated assistant response.
 * @param {object} props
 * @param {Array<{ title: string, score: number }>} props.sources - List of source references
 */
export function CitationList({ sources }) {
  if (!sources || sources.length === 0) return null;

  return (
    <div className="chat-sources-row">
      <span className="chat-sources-label">Sources:</span>
      {sources.map((src, i) => {
        const scorePercent = src.score && src.score > 0 ? `${Math.round(src.score * 100)}%` : null;
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

