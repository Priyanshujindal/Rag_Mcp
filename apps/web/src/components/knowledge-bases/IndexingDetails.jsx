import React, { useState, useEffect } from "react";
import {
  FileText,
  Layers,
  AlertCircle,
  Clock,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Info,
  RefreshCw,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  formatIndexingDuration,
  getEmbeddingStatus,
  sanitizeErrorMessage,
} from "@/lib/utils/indexing-details";

const CHUNKS_PER_PAGE = 5;
const TEXT_PREVIEW_LIMIT = 300;

export function IndexingDetails({ source, details, loading = false, error = null, onRefresh = null, onLoadChunks = null }) {
  const [showFullText, setShowFullText] = useState(false);
  const [chunkPage, setChunkPage] = useState(1);
  const [showAllChunks, setShowAllChunks] = useState(false);
  const [chunkData, setChunkData] = useState({ items: [], pagination: { page: 1, limit: CHUNKS_PER_PAGE, total: 0, totalPages: 0 } });
  const [chunkLoading, setChunkLoading] = useState(false);
  const [chunkError, setChunkError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    if (!onLoadChunks || !source?.id) return undefined;
    setChunkLoading(true);
    setChunkError(null);
    const fetchChunks = async () => {
      if (showAllChunks) {
        // API pagination bounds each request, but all stored chunks remain
        // available. Gather every page when the user explicitly requests all.
        const pageSize = 20;
        const firstPage = await onLoadChunks(source.id, 1, pageSize);
        const allItems = [...(firstPage?.items || [])];
        const totalPages = firstPage?.pagination?.totalPages || 1;

        for (let page = 2; page <= totalPages; page += 1) {
          if (cancelled) return;
          const result = await onLoadChunks(source.id, page, pageSize);
          allItems.push(...(result?.items || []));
        }

        if (!cancelled) {
          setChunkData({
            items: allItems,
            pagination: {
              page: 1,
              limit: allItems.length,
              total: firstPage?.pagination?.total ?? allItems.length,
              totalPages: 1,
            },
          });
        }
      } else {
        const result = await onLoadChunks(source.id, chunkPage, CHUNKS_PER_PAGE);
        if (!cancelled) {
          setChunkData(result || { items: [], pagination: { page: chunkPage, limit: CHUNKS_PER_PAGE, total: 0, totalPages: 0 } });
        }
      }
    };

    fetchChunks()
      .catch((err) => {
        if (!cancelled) setChunkError(err?.isServiceUnavailable
          ? "The service is temporarily unavailable. Please try again in a moment."
          : err?.message || "Failed to load chunks.");
      })
      .finally(() => { if (!cancelled) setChunkLoading(false); });
    return () => { cancelled = true; };
  }, [onLoadChunks, source?.id, chunkPage, showAllChunks]);

  const activeData = details || source || {};
  const embeddingInfo = getEmbeddingStatus(activeData);
  const duration = formatIndexingDuration(
    activeData.indexingDurationMs,
    activeData.indexingStartedAt,
    activeData.indexingCompletedAt
  );

  const totalChunks =
    activeData.chunkCount ??
    activeData.chunksCount ??
    source.chunkCount ??
    source.chunksCount ??
    0;

  const rawExtractedText = activeData.extractedText || "";
  const extractedCharCount = activeData.extractedCharCount ?? rawExtractedText.length;
  const hasExtractedText = typeof rawExtractedText === "string" && rawExtractedText.trim().length > 0;

  const chunkList = Array.isArray(chunkData.items) ? chunkData.items : [];
  const hasChunksList = chunkList.length > 0;
  const totalChunkPages = Math.max(1, chunkData.pagination?.totalPages || 1);
  const displayedChunks = chunkList;
  const totalChunkCount = chunkData.pagination?.total ?? totalChunks;

  const isFailed = (source.status || "").toLowerCase() === "failed" || Boolean(activeData.error);
  const errorMessage = activeData.error || source.error;

  return (
    <div className="kb-indexing-details-panel" data-testid="indexing-details-panel">
      {/* Top summary row: Embeddings, Duration, Total Chunks, Status */}
      <div className="kb-details-meta-grid">
        <div className="kb-details-meta-item">
          <span className="kb-details-meta-label">Embedding Status</span>
          <span className="kb-details-meta-value">
            <Badge variant={embeddingInfo.variant} dot={embeddingInfo.available}>
              {embeddingInfo.label}
            </Badge>
          </span>
          {!embeddingInfo.available && (
            <span className="kb-details-subtext">Backend does not expose status</span>
          )}
        </div>

        <div className="kb-details-meta-item">
          <span className="kb-details-meta-label">Indexing Duration</span>
          <span className="kb-details-meta-value">
            <Clock size={13} className="icon-faint" />
            <span>{duration}</span>
          </span>
          {duration === "Unavailable" && (
            <span className="kb-details-subtext">Timestamps not exposed</span>
          )}
        </div>

        <div className="kb-details-meta-item">
          <span className="kb-details-meta-label">Total Chunks</span>
          <span className="kb-details-meta-value">
            <Layers size={13} className="icon-accent" />
            <span>{totalChunks}</span>
          </span>
          <span className="kb-details-subtext">Stored in MongoDB Atlas</span>
        </div>

        <div className="kb-details-meta-item">
          <span className="kb-details-meta-label">Ingestion State</span>
          <span className="kb-details-meta-value">
            {(source.status || "").toLowerCase() === "indexed" ? (
              <CheckCircle2 size={13} className="icon-success" />
            ) : isFailed ? (
              <AlertCircle size={13} className="icon-danger" />
            ) : (
              <Clock size={13} className="icon-faint" />
            )}
            <span style={{ textTransform: "capitalize" }}>{source.status || "Unknown"}</span>
          </span>
          {onRefresh && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              style={{ padding: "2px 6px", fontSize: "11px", height: "auto", alignSelf: "flex-start", marginTop: "2px" }}
              onClick={onRefresh}
              disabled={loading}
              title="Refresh details"
            >
              <RefreshCw size={11} className={loading ? "icon-warning-spin" : ""} /> Refresh
            </button>
          )}
        </div>
      </div>

      {/* Loading state indicator */}
      {loading && (
        <div style={{ padding: "8px 0" }}>
          <Skeleton height={16} width="40%" style={{ marginBottom: "8px" }} />
          <Skeleton height={64} width="100%" />
        </div>
      )}

      {/* Error fetching source details */}
      {error && (
        <div className="kb-details-error-banner" role="alert">
          <AlertCircle size={14} className="icon-danger" />
          <div>
            <strong>Error retrieving details:</strong> {error}
          </div>
        </div>
      )}

      {/* Ingestion failure details banner */}
      {isFailed && errorMessage && (
        <div className="kb-details-error-banner" role="alert">
          <AlertCircle size={14} className="icon-danger" />
          <div>
            <strong>Indexing Failure:</strong> {sanitizeErrorMessage(errorMessage)}
          </div>
        </div>
      )}

      {/* Extracted Text Preview section */}
      <div className="kb-details-section">
        <div className="kb-details-section-header">
          <span className="kb-details-section-title">
            <FileText size={13} className="icon-accent" />
            Extracted Text Preview
          </span>
          {hasExtractedText && (
            <span className="kb-details-count">{extractedCharCount} characters</span>
          )}
        </div>

        {hasExtractedText ? (
          <div>
            <pre className="kb-details-code-box">
              {showFullText
                ? rawExtractedText
                : rawExtractedText.slice(0, TEXT_PREVIEW_LIMIT) +
                  (rawExtractedText.length > TEXT_PREVIEW_LIMIT ? "…" : "")}
            </pre>
            {rawExtractedText.length > TEXT_PREVIEW_LIMIT && (
              <div style={{ marginTop: "6px" }}>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setShowFullText((prev) => !prev)}
                >
                  {showFullText ? "Show less" : "Show more"}
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="kb-details-empty-note">
            <Info size={13} />
            <span>Extracted text preview is not exposed by the backend API.</span>
          </div>
        )}
      </div>

      {/* Chunks Preview section */}
      <div className="kb-details-section">
        <div className="kb-details-section-header">
          <span className="kb-details-section-title">
            <Layers size={13} className="icon-accent" />
            Chunks Preview ({totalChunkCount} total)
          </span>
          {hasChunksList && (
            <span className="kb-details-count">
              {showAllChunks
                ? `Showing all ${displayedChunks.length} chunks`
                : `Showing ${displayedChunks.length} of ${totalChunkCount}`}
            </span>
          )}
        </div>

        {totalChunkCount > CHUNKS_PER_PAGE && !chunkLoading && !chunkError && (
          <div style={{ marginBottom: "8px" }}>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => {
                setChunkPage(1);
                setShowAllChunks((value) => !value);
              }}
            >
              {showAllChunks ? "Show paginated chunks" : `Load all ${totalChunkCount} chunks`}
            </button>
          </div>
        )}

        {chunkLoading && (
          <div style={{ padding: "8px 0" }}>
            <Skeleton height={16} width="40%" style={{ marginBottom: "8px" }} />
            <Skeleton height={64} width="100%" />
          </div>
        )}

        {chunkError && (
          <div className="kb-details-error-banner" role="alert">
            <AlertCircle size={14} className="icon-danger" />
            <div>{chunkError}</div>
          </div>
        )}

        {!chunkLoading && !chunkError && hasChunksList ? (
          <div>
            {displayedChunks.map((chunk, idx) => {
              const chunkIdx = chunk.index ?? chunk.chunkIndex ?? (chunkPage - 1) * CHUNKS_PER_PAGE + idx;
              const charCount = chunk.characterCount ?? (chunk.text || chunk.content || "").length;
              return (
                <div key={chunk.id || chunkIdx} className="kb-chunk-card">
                  <div className="kb-chunk-header">
                    <span>Chunk #{chunkIdx + 1}</span>
                    <span className="kb-chunk-meta">
                      {charCount} chars {chunk.tokens ? `• ${chunk.tokens} tokens` : ""}
                    </span>
                  </div>
                  <pre className="kb-details-code-box kb-chunk-box">
                    {chunk.content || chunk.text || ""}
                  </pre>
                </div>
              );
            })}

            {!showAllChunks && totalChunkPages > 1 && (
              <div className="kb-chunk-pagination">
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={chunkPage === 1 || chunkLoading}
                  onClick={() => setChunkPage((p) => Math.max(1, p - 1))}
                >
                  <ChevronLeft size={12} /> Prev
                </button>
                <span>
                  Page {chunkPage} of {totalChunkPages}
                </span>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={chunkPage === totalChunkPages || chunkLoading}
                  onClick={() => setChunkPage((p) => Math.min(totalChunkPages, p + 1))}
                >
                  Next <ChevronRight size={12} />
                </button>
              </div>
            )}
          </div>
        ) : !chunkLoading && !chunkError ? (
          <div className="kb-details-empty-note">
            <Info size={13} />
            <span>No chunk content is available for this source.</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

