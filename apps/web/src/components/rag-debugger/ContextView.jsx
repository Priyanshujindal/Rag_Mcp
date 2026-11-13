import React from "react";

/**
 * Displays the current query being processed by the RAG pipeline.
 * @param {object} props
 * @param {string} props.query - Query string or message content preview
 */
export function ContextView({ query }) {
  return (
    <div>
      <div className="rag-section-title">Query Processing</div>
      <div className="rag-query-box">
        {query ? query.slice(0, 80) : "No active query"}
      </div>
    </div>
  );
}

