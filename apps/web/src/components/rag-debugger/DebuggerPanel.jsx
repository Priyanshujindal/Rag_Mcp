import React from "react";
import { X, ShieldCheck } from "lucide-react";
import { ContextView } from "./ContextView";
import { ChunkList } from "./ChunkList";

/**
 * Slide-out RAG Inspection and Debugger Panel.
 * @param {object} props
 * @param {boolean} props.isOpen - Whether the panel is visible
 * @param {() => void} props.onClose - Close panel callback
 * @param {string} [props.activeQuery] - Current user query text
 */
export function DebuggerPanel({ isOpen, onClose, activeQuery }) {
  if (!isOpen) return null;

  return (
    <div className="rag-panel rag-panel-override">
      <div className="rag-panel-header">
        <span className="rag-panel-title">RAG Inspection & Scores</span>
        <button
          type="button"
          className="btn btn-ghost btn-icon btn-sm"
          onClick={onClose}
          aria-label="Close debugger panel"
        >
          <X size={14} />
        </button>
      </div>

      <div className="rag-panel-body">
        <ContextView query={activeQuery} />
        <ChunkList />

        <div>
          <div className="rag-section-title">Security & Guardrails</div>
          <div className="rag-guardrails-row">
            <ShieldCheck size={13} />
            <span>SSRF guard active • Private IPs blocked</span>
          </div>
        </div>
      </div>
    </div>
  );
}

