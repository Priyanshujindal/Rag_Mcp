import React from "react";
import { RefreshCw, FileText, AlertCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { reindexSource } from "@/lib/api";

/**
 * Sources tab listing linked knowledge base documents and indexing status.
 * @param {object} props
 * @param {object} [props.linkedKb] - Knowledge base instance
 * @param {function} [props.onRefresh] - Called after a mutation to refresh the parent's KB list
 */
export function SourcesTab({ linkedKb, onRefresh }) {
  if (!linkedKb) {
    return (
      <div className="empty-state">
        <div className="empty-state-icon"><FileText size={24} /></div>
        <div className="empty-state-title">No knowledge base linked</div>
        <div className="empty-state-desc">Attach a knowledge base to this chatbot in Settings to provide factual context.</div>
      </div>
    );
  }

  const sources = linkedKb.sources || [];

  const handleReindexAll = async () => {
    await Promise.allSettled(sources.map((s) => reindexSource(s.id)));
    if (onRefresh) onRefresh();
  };

  const handleReindex = async (id) => {
    await reindexSource(id);
    if (onRefresh) onRefresh();
  };

  const statusBadgeVariant = (status) => {
    const st = status?.toLowerCase();
    if (st === "indexed") return "success";
    if (st === "crawling" || st === "indexing") return "warning";
    if (st === "failed") return "danger";
    return "neutral";
  };

  return (
    <div className="sources-stack">
      <div className="card bot-detail-card-padded">
        <div className="bot-detail-card-header">
          <div>
            <h4 className="bot-detail-card-title">
              Linked Knowledge Base: {linkedKb.name}
            </h4>
            <p className="bot-detail-card-desc">
              {linkedKb.description}
            </p>
          </div>
          <button
            type="button"
            className="btn btn-secondary btn-sm btn-with-icon"
            aria-label="Re-index all sources"
            onClick={handleReindexAll}
          >
            <RefreshCw size={12} /> Re-index All
          </button>
        </div>

        {sources.length > 0 ? (
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Source Document / URL</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th>Chunks</th>
                  <th>Last Indexed</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {sources.map((src) => {
                  const st = src.status?.toLowerCase();
                  const lastIndexed = src.lastIndexedAt
                    ? new Date(src.lastIndexedAt).toLocaleDateString()
                    : "—";
                  return (
                    <React.Fragment key={src.id}>
                      <tr>
                        <td className="sources-mono-cell">{src.title || src.name}</td>
                        <td>
                          <Badge variant="neutral">{(src.type || "file").toUpperCase()}</Badge>
                        </td>
                        <td>
                          <Badge variant={statusBadgeVariant(src.status)} dot>
                            {src.status || "unknown"}
                          </Badge>
                        </td>
                        <td className="sources-chunks-cell">{src.chunksCount ?? 0} chunks</td>
                        <td className="analytics-date-cell">{lastIndexed}</td>
                        <td>
                          <button
                            type="button"
                            className="btn btn-ghost btn-icon"
                            title="Re-index"
                            aria-label="Re-index source"
                            onClick={() => handleReindex(src.id)}
                          >
                            <RefreshCw size={12} />
                          </button>
                        </td>
                      </tr>
                      {st === "failed" && src.error && (
                        <tr>
                          <td colSpan={6} style={{ paddingTop: 0 }}>
                            <span style={{ display: "inline-flex", alignItems: "center", gap: "4px", fontSize: "12px", color: "var(--color-danger, #ef4444)" }}>
                              <AlertCircle size={11} /> {src.error}
                            </span>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state">
            <div className="empty-state-icon"><FileText size={22} /></div>
            <div className="empty-state-title">No sources in this knowledge base</div>
            <div className="empty-state-desc">Upload documents or add URLs to start indexing content.</div>
          </div>
        )}
      </div>
    </div>
  );
}
