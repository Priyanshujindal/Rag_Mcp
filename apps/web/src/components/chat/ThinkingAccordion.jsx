import React, { useState, useEffect, useRef } from "react";
import { Brain, ChevronDown, Sparkles } from "lucide-react";
import { MarkdownRenderer } from "./MarkdownRenderer";

/**
 * Expandable Thinking / Reasoning view (DeepSeek-R1 / OpenAI o1 style).
 * Displays streaming model chain-of-thought in an expandable accordion.
 *
 * @param {object} props
 * @param {string} props.reasoning - The chain-of-thought content
 * @param {boolean} [props.isStreaming=false] - Whether reasoning is currently streaming
 */
export function ThinkingAccordion({ reasoning, isStreaming = false }) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [elapsedSec, setElapsedSec] = useState(0);
  const startRef = useRef(Date.now());
  const timerRef = useRef(null);

  useEffect(() => {
    if (isStreaming) {
      startRef.current = Date.now();
      timerRef.current = setInterval(() => {
        setElapsedSec(Math.max(1, Math.round((Date.now() - startRef.current) / 1000)));
      }, 500);
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isStreaming]);

  if (!reasoning && !isStreaming) return null;

  return (
    <div className={`chatgpt-thinking-accordion ${isStreaming ? "streaming" : ""}`}>
      <button
        type="button"
        className="chatgpt-thinking-header"
        onClick={() => setIsExpanded((prev) => !prev)}
        aria-expanded={isExpanded}
      >
        <div className="chatgpt-thinking-title">
          <Brain size={15} className={`thinking-brain-icon ${isStreaming ? "pulse-brain" : ""}`} />
          <span className="thinking-label">
            {isStreaming
              ? `Thinking Process... (${elapsedSec}s)`
              : elapsedSec > 0
              ? `Thought for ${elapsedSec}s`
              : "Thinking Process"}
          </span>
          {isStreaming && <span className="thinking-live-dot" />}
        </div>
        <ChevronDown
          size={14}
          className={`thinking-chevron ${isExpanded ? "expanded" : ""}`}
        />
      </button>

      {isExpanded && (
        <div className="chatgpt-thinking-body">
          <div className="chatgpt-thinking-content">
            {reasoning ? (
              <MarkdownRenderer content={reasoning} />
            ) : (
              <div className="chat-thinking-placeholder">
                <Sparkles size={13} className="sparkle-pulse" />
                <span>Formulating reasoning and analyzing requirements...</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

