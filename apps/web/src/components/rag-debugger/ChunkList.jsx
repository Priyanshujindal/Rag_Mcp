import React from "react";

const DEFAULT_CHUNKS = [
  {
    title: "Next.js 14 App Router Specs",
    score: 0.96,
    text: "Server Components reduce client-side bundle size by moving data fetching to the server…",
  },
  {
    title: "Reciprocal Rank Fusion Paper",
    score: 0.91,
    text: "RRF merges dense vector rankings with BM25 sparse keyword rankings without score normalization…",
  },
  {
    title: "Stripe Webhook Signature Verification",
    score: 0.88,
    text: "Verify the event payload using stripe-signature header and the endpoint secret key…",
  },
];

/**
 * List of retrieved and reranked context chunks with similarity scores.
 * @param {object} props
 * @param {Array<{ title: string, score: number, text: string }>} [props.chunks] - Chunks to render
 */
export function ChunkList({ chunks = DEFAULT_CHUNKS }) {
  return (
    <div>
      <div className="rag-section-title">Retrieved & Reranked Chunks</div>
      {chunks.map((chunk, idx) => (
        <div key={idx} className="rag-chunk rag-chunk-item">
          <div className="rag-chunk-header">
            <span className="rag-chunk-source">{chunk.title}</span>
            <span className="rag-chunk-score">{(chunk.score * 100).toFixed(0)}%</span>
          </div>
          <div className="rag-chunk-text">{chunk.text}</div>
        </div>
      ))}
    </div>
  );
}

