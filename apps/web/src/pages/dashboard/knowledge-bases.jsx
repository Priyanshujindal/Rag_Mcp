import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Upload, Link as LinkIcon, FileText, File, Globe, Trash2, RefreshCw,
  Plus, CheckCircle, Clock, AlertCircle, Loader, Database, ChevronDown, ChevronUp,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { TableSkeleton } from "@/components/ui/skeleton";
import { Dialog, DialogTitle, DialogDesc, DialogFooter } from "@/components/ui/dialog";
import {
  getMockKnowledgeBases,
  getSource,
  getSourceChunks,
  createKnowledgeBase,
  createUrlSource,
  uploadSourceFile,
  deleteKnowledgeBase,
  deleteSource,
  reindexSource,
  isMock,
} from "@/lib/api";
import { shouldPollSources, cleanUrlInput } from "@/lib/utils/poll-sources";
import { IndexingDetails } from "@/components/knowledge-bases/IndexingDetails";
import "./knowledge-bases.css";

// Re-export so callers that import from this module still work
export { shouldPollSources, cleanUrlInput };

function statusIcon(status) {
  switch (status?.toLowerCase()) {
    case "indexed":
    case "ready":
    case "active":
      return <CheckCircle size={13} className="icon-success" />;
    case "crawling":
    case "indexing":
      return <Loader size={13} className="icon-warning-spin" />;
    case "queued":
      return <Clock size={13} className="icon-faint" />;
    case "failed":
      return <AlertCircle size={13} className="icon-danger" />;
    default:
      return null;
  }
}

function typeIcon(type) {
  switch (type?.toLowerCase()) {
    case "url":  return <Globe size={13} className="icon-accent" />;
    case "pdf":  return <FileText size={13} className="icon-danger" />;
    case "docx": return <File size={13} className="icon-info" />;
    default:     return <File size={13} className="icon-faint" />;
  }
}

export default function KnowledgeBasesPage() {
  const [dragOver, setDragOver] = useState(false);
  const [urlInput, setUrlInput] = useState("");
  const [addingUrl, setAddingUrl] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [kbs, setKbs] = useState([]);
  const [selectedKbId, setSelectedKbId] = useState("");
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [newKbName, setNewKbName] = useState("");
  const [expandedSourceIds, setExpandedSourceIds] = useState(new Set());
  const [sourceDetailsCache, setSourceDetailsCache] = useState({});
  const [loadingDetails, setLoadingDetails] = useState({});
  const [detailsErrors, setDetailsErrors] = useState({});
  const fileRef = useRef(null);
  const urlInputRef = useRef(null);
  const crawlSectionRef = useRef(null);
  const pollRef = useRef(null);
  const kbsRef = useRef([]);

  // Keep ref in sync for polling callback (avoid stale closure)
  kbsRef.current = kbs;

  const activeTargetKb = kbs.find((k) => k.id === selectedKbId) || kbs[0] || null;

  const toggleIndexingDetails = async (sourceId) => {
    const isCurrentlyExpanded = expandedSourceIds.has(sourceId);
    setExpandedSourceIds((prev) => {
      const next = new Set(prev);
      if (isCurrentlyExpanded) {
        next.delete(sourceId);
      } else {
        next.add(sourceId);
      }
      return next;
    });

    // If opening and not yet in cache, fetch it (avoid duplicate requests on repeated toggle)
    if (!isCurrentlyExpanded && !sourceDetailsCache[sourceId] && !loadingDetails[sourceId]) {
      setLoadingDetails((prev) => ({ ...prev, [sourceId]: true }));
      setDetailsErrors((prev) => ({ ...prev, [sourceId]: null }));
      try {
        const data = await getSource(sourceId);
        setSourceDetailsCache((prev) => ({ ...prev, [sourceId]: data }));
      } catch (err) {
        setDetailsErrors((prev) => ({
          ...prev,
          [sourceId]: err?.isServiceUnavailable
            ? "The service is temporarily unavailable. Please try again in a moment."
            : err.message || "Failed to load indexing details",
        }));
      } finally {
        setLoadingDetails((prev) => ({ ...prev, [sourceId]: false }));
      }
    }
  };

  const loadSourceChunks = useCallback(
    (sourceId, page = 1, limit = 5) => getSourceChunks(sourceId, page, limit),
    []
  );

  const refreshSourceDetails = async (sourceId) => {
    setLoadingDetails((prev) => ({ ...prev, [sourceId]: true }));
    setDetailsErrors((prev) => ({ ...prev, [sourceId]: null }));
    try {
      const data = await getSource(sourceId);
      setSourceDetailsCache((prev) => ({ ...prev, [sourceId]: data }));
    } catch (err) {
      setDetailsErrors((prev) => ({
        ...prev,
        [sourceId]: err?.isServiceUnavailable
          ? "The service is temporarily unavailable. Please try again in a moment."
          : err.message || "Failed to refresh indexing details",
      }));
    } finally {
      setLoadingDetails((prev) => ({ ...prev, [sourceId]: false }));
    }
  };

  // Silently refresh without touching the loading spinner
  const refreshKbs = () =>
    getMockKnowledgeBases()
      .then((data) => {
        const list = Array.isArray(data) ? data : [];
        setKbs(list);
        setSelectedKbId((prev) => {
          if (prev && list.some((k) => k.id === prev)) return prev;
          return list[0]?.id || "";
        });
      })
      .catch(() => {
        // silent – errors surfaced on initial load only
      });

  const fetchKbs = (showLoading = true) => {
    if (showLoading) {
      setLoading(true);
      setError(null);
    }
    getMockKnowledgeBases()
      .then((data) => {
        const list = Array.isArray(data) ? data : [];
        setKbs(list);
        setSelectedKbId((prev) => {
          if (prev && list.some((k) => k.id === prev)) return prev;
          return list[0]?.id || "";
        });
      })
      .catch((err) => {
        const msg =
          err?.isServiceUnavailable
            ? "The knowledge base service is temporarily unavailable. Please try again in a moment."
            : err.message || "Failed to load knowledge bases";
        setError(msg);
      })
      .finally(() => {
        if (showLoading) setLoading(false);
      });
  };

  // Initial fetch
  useEffect(() => {
    fetchKbs(true);
  }, []);

  // Polling: restart whenever kbs changes so we pick up new active sources
  useEffect(() => {
    clearInterval(pollRef.current);
    if (!shouldPollSources(kbs)) return;

    pollRef.current = setInterval(() => {
      if (document.visibilityState === "hidden") return;
      if (!shouldPollSources(kbsRef.current)) {
        clearInterval(pollRef.current);
        return;
      }
      refreshKbs();
    }, 3000);

    const handleVisibility = () => {
      if (document.visibilityState === "visible" && shouldPollSources(kbsRef.current)) {
        refreshKbs();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      clearInterval(pollRef.current);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [kbs]);

  const handleDragOver = (e) => { e.preventDefault(); setDragOver(true); };
  const handleDragLeave = () => setDragOver(false);

  const handleFileUpload = async (files, explicitKbId = null) => {
    if (!files || files.length === 0) return;
    const file = files[0];
    const targetKb = (explicitKbId ? kbs.find((k) => k.id === explicitKbId) : null) || activeTargetKb;
    if (!targetKb) {
      setError("Please select or create a Knowledge Base before uploading documents.");
      return;
    }

    // Optimistic: show the new source immediately as "queued"
    const optimisticSrc = {
      id: `opt_${Date.now()}`,
      knowledgeBaseId: targetKb.id,
      title: file.name,
      name: file.name,
      url: "",
      type: (file.name.split(".").pop() || "file").toLowerCase(),
      status: "queued",
      chunksCount: 0,
      chunkCount: 0,
      chunks: 0,
      error: null,
      lastIndexedAt: null,
      createdAt: new Date().toISOString(),
    };
    setKbs((prev) =>
      prev.map((kb) =>
        kb.id === targetKb.id
          ? { ...kb, sources: [optimisticSrc, ...(kb.sources || [])] }
          : kb
      )
    );

    try {
      if (!isMock) {
        await uploadSourceFile(targetKb.id, file);
        fetchKbs(false);
      }
    } catch (err) {
      setError(err.message || "Failed to upload file");
      // Roll back optimistic source on failure
      setKbs((prev) =>
        prev.map((kb) =>
          kb.id === targetKb.id
            ? { ...kb, sources: (kb.sources || []).filter((s) => s.id !== optimisticSrc.id) }
            : kb
        )
      );
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFileUpload(e.dataTransfer.files);
    }
  };

  const handleAddUrl = async (explicitKbId = null) => {
    const raw = urlInput.trim();
    if (!raw) return;
    const url = cleanUrlInput(raw);
    if (!url) return;

    const targetKb = (explicitKbId ? kbs.find((k) => k.id === explicitKbId) : null) || activeTargetKb;
    if (!targetKb) {
      setError("Please select or create a Knowledge Base before adding a website source.");
      return;
    }

    setAddingUrl(true);
    setError(null);

    // Optimistic: show immediately as "queued"
    const optimisticSrc = {
      id: `opt_${Date.now()}`,
      knowledgeBaseId: targetKb.id,
      title: url,
      name: url,
      url,
      type: "url",
      status: "queued",
      chunksCount: 0,
      chunkCount: 0,
      chunks: 0,
      error: null,
      lastIndexedAt: null,
      createdAt: new Date().toISOString(),
    };

    setKbs((prev) =>
      prev.map((kb) =>
        kb.id === targetKb.id
          ? { ...kb, sources: [optimisticSrc, ...(kb.sources || [])] }
          : kb
      )
    );

    try {
      if (!isMock) {
        await createUrlSource({
          knowledgeBaseId: targetKb.id,
          name: url,
          url,
        });
        fetchKbs(false);
      } else {
        await new Promise((r) => setTimeout(r, 600));
      }
      setUrlInput("");
    } catch (err) {
      setError(err.message || "Failed to add URL source");
      // Roll back
      setKbs((prev) =>
        prev.map((kb) =>
          kb.id === targetKb.id
            ? { ...kb, sources: (kb.sources || []).filter((s) => s.id !== optimisticSrc.id) }
            : kb
        )
      );
    } finally {
      setAddingUrl(false);
    }
  };

  const handleCreateKb = async () => {
    if (!newKbName.trim()) return;
    setError(null);
    try {
      if (!isMock) {
        const created = await createKnowledgeBase({ name: newKbName });
        const newId = created?.id || created?._id;
        if (newId) setSelectedKbId(newId);
        await fetchKbs(false);
        if (newId) setSelectedKbId(newId);
      } else {
        const mockNew = {
          id: `kb_${Date.now()}`,
          name: newKbName,
          description: "New workspace knowledge base",
          status: "ready",
          sourcesCount: 0,
          totalChunks: 0,
          lastIndexedAt: new Date().toISOString(),
          sources: [],
        };
        setKbs((prev) => [mockNew, ...prev]);
        setSelectedKbId(mockNew.id);
      }
      setCreateDialogOpen(false);
      setNewKbName("");
    } catch (err) {
      setError(err.message || "Failed to create knowledge base");
    }
  };

  const handleDeleteKb = async (id) => {
    try {
      if (!isMock) {
        await deleteKnowledgeBase(id);
      }
      setKbs((prev) => prev.filter((k) => k.id !== id));
    } catch (err) {
      setError(err.message || "Failed to delete knowledge base");
    }
  };

  const handleDeleteSource = async (kbId, sourceId) => {
    // Optimistic remove
    setKbs((prev) =>
      prev.map((kb) =>
        kb.id === kbId
          ? { ...kb, sources: (kb.sources || []).filter((s) => s.id !== sourceId) }
          : kb
      )
    );
    setExpandedSourceIds((prev) => {
      const next = new Set(prev);
      next.delete(sourceId);
      return next;
    });
    setSourceDetailsCache((prev) => {
      const next = { ...prev };
      delete next[sourceId];
      return next;
    });
    try {
      if (!isMock) {
        await deleteSource(sourceId);
      }
    } catch (err) {
      setError(err.message || "Failed to delete source");
      fetchKbs(false); // restore on failure
    }
  };

  const handleReindexSource = async (kbId, sourceId) => {
    // Invalidate details cache so future expansion re-fetches fresh data
    setSourceDetailsCache((prev) => {
      const next = { ...prev };
      delete next[sourceId];
      return next;
    });
    // Optimistic: mark as queued
    setKbs((prev) =>
      prev.map((kb) =>
        kb.id === kbId
          ? {
              ...kb,
              sources: (kb.sources || []).map((s) =>
                s.id === sourceId ? { ...s, status: "queued" } : s
              ),
            }
          : kb
      )
    );
    try {
      await reindexSource(sourceId);
    } catch (err) {
      setError(err.message || "Failed to re-index source");
      fetchKbs(false);
    }
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Knowledge Bases</h1>
          <p className="page-desc">Upload documents or crawl websites to power your chatbots.</p>
        </div>
        <button
          type="button"
          className="btn btn-primary btn-with-icon"
          onClick={() => setCreateDialogOpen(true)}
        >
          <Plus size={15} /> New Knowledge Base
        </button>
      </div>

      {error && (
        <div style={{ color: "#ef4444", fontSize: "13px", marginBottom: "16px" }}>
          {error}
        </div>
      )}

      {/* Upload zone */}
      <div
        className={`kb-upload-zone ${dragOver ? "drag-over" : ""}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => fileRef.current?.click()}
        role="button"
        tabIndex={0}
        aria-label="Upload documents"
      >
        <input
          ref={fileRef}
          type="file"
          accept=".pdf,.docx,.txt,.csv"
          className="kb-file-input"
          onChange={(e) => handleFileUpload(e.target.files)}
        />
        <div className="kb-upload-icon-wrapper">
          <Upload size={22} className="kb-upload-icon" />
        </div>
        <div className="kb-upload-heading">Drop your documents here, or browse</div>
        <div className="kb-upload-subtext">
          PDF, DOCX, TXT, CSV up to 20MB {activeTargetKb ? `• Target: ${activeTargetKb.name}` : ""}
        </div>
      </div>

      {/* URL crawl input */}
      <div className="kb-url-card" ref={crawlSectionRef}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "12px", marginBottom: "8px" }}>
          <div>
            <h3 className="kb-url-title">
              <LinkIcon size={14} className="icon-accent" /> Crawl Website
            </h3>
            <p className="kb-url-desc">
              Add any public documentation site or blog. We'll crawl up to 50 pages automatically.
            </p>
          </div>

          {kbs.length > 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <label htmlFor="kb-target-select" style={{ fontSize: "12px", fontWeight: 500, color: "var(--text-muted)", whiteSpace: "nowrap" }}>
                Target Knowledge Base:
              </label>
              <select
                id="kb-target-select"
                className="input"
                style={{ padding: "4px 8px", fontSize: "13px", height: "32px", minWidth: "180px", cursor: "pointer" }}
                value={activeTargetKb?.id || ""}
                onChange={(e) => setSelectedKbId(e.target.value)}
              >
                {kbs.map((kb) => (
                  <option key={kb.id} value={kb.id}>
                    {kb.name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        <div className="kb-url-row">
          <input
            ref={urlInputRef}
            className="input kb-url-input"
            type="url"
            placeholder="https://docs.example.com"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAddUrl()}
          />
          <button
            type="button"
            className="btn btn-secondary btn-with-icon"
            onClick={() => handleAddUrl()}
            disabled={addingUrl || !urlInput.trim() || !activeTargetKb}
          >
            {addingUrl ? <Loader size={13} className="icon-spin" /> : <Globe size={13} />}
            {addingUrl ? "Adding..." : activeTargetKb ? `Add to ${activeTargetKb.name}` : "Add Source"}
          </button>
        </div>
      </div>

      {/* Knowledge bases list */}
      <div className="kb-list-section">
        <h2 className="section-title">Active Knowledge Bases</h2>

        {loading ? (
          <TableSkeleton rows={4} cols={4} />
        ) : kbs.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">
              <Database size={24} />
            </div>
            <div className="empty-state-title">No knowledge bases yet</div>
            <div className="empty-state-desc">Create your first knowledge base to start indexing documents.</div>
            <button
              type="button"
              className="btn btn-primary btn-with-icon"
              onClick={() => setCreateDialogOpen(true)}
            >
              <Plus size={15} /> New Knowledge Base
            </button>
          </div>
        ) : (
          <div className="kb-cards-grid">
            {kbs.map((kb) => {
              const isSelected = activeTargetKb?.id === kb.id;
              return (
                <div key={kb.id} className="card kb-card">
                  <div className="kb-card-header">
                    <div>
                      <div className="kb-card-title-row" style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <span className="kb-card-name">{kb.name}</span>
                        <Badge variant={kb.status === "ready" || kb.status === "active" ? "success" : "neutral"} dot>
                          {kb.status}
                        </Badge>
                        {isSelected && (
                          <Badge variant="accent">Target KB</Badge>
                        )}
                      </div>
                      {kb.description && (
                        <p className="kb-card-desc">{kb.description}</p>
                      )}
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: "8px", marginLeft: "auto" }}>
                      {!isSelected ? (
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() => {
                            setSelectedKbId(kb.id);
                            urlInputRef.current?.focus();
                          }}
                        >
                          Select as Target
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm btn-with-icon"
                          onClick={() => {
                            urlInputRef.current?.focus();
                            crawlSectionRef.current?.scrollIntoView({ behavior: "smooth" });
                          }}
                        >
                          <Plus size={12} /> Add Source
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn btn-ghost btn-icon"
                        title="Delete knowledge base"
                        aria-label="Delete knowledge base"
                        onClick={() => handleDeleteKb(kb.id)}
                      >
                        <Trash2 size={14} className="icon-danger" />
                      </button>
                    </div>
                  </div>

                <div className="kb-stats-row">
                  <div>
                    <span className="stat-label">Total Chunks: </span>
                    <span className="stat-value">{kb.totalChunks || 0}</span>
                  </div>
                  <div>
                    <span className="stat-label">Sources: </span>
                    <span className="stat-value">{kb.sourcesCount || kb.sources?.length || 0}</span>
                  </div>
                </div>

                {kb.sources && kb.sources.length > 0 && (
                  <div className="kb-sources-list">
                    <table className="kb-sources-table">
                      <thead>
                        <tr>
                          <th>Source</th>
                          <th>Type</th>
                          <th>Status</th>
                          <th>Chunks</th>
                          <th>Last Indexed</th>
                          <th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {kb.sources.map((s) => {
                          const st = s.status?.toLowerCase();
                          const badgeVariant =
                            st === "indexed" ? "success" :
                            st === "crawling" || st === "indexing" ? "warning" :
                            st === "failed" ? "danger" : "neutral";
                          return (
                            <React.Fragment key={s.id}>
                              <tr>
                                <td className="kb-source-name-cell">
                                  {typeIcon(s.type)}
                                  <span className="kb-source-title">{s.title || s.name}</span>
                                </td>
                                <td>
                                  <Badge variant="neutral">{(s.type || "file").toUpperCase()}</Badge>
                                </td>
                                <td>
                                  <Badge variant={badgeVariant} dot>
                                    {statusIcon(s.status)}
                                    {s.status || "unknown"}
                                  </Badge>
                                </td>
                                <td className="kb-source-chunks-cell">
                                  {s.chunksCount ?? s.chunkCount ?? 0}
                                </td>
                                <td className="kb-source-date-cell">
                                  {s.lastIndexedAt
                                    ? new Date(s.lastIndexedAt).toLocaleDateString()
                                    : "—"}
                                </td>
                                <td className="kb-source-actions-cell">
                                  <button
                                    type="button"
                                    className="btn btn-ghost btn-sm btn-with-icon"
                                    title="Inspect indexing details"
                                    aria-label="Inspect indexing details"
                                    aria-expanded={expandedSourceIds.has(s.id)}
                                    onClick={() => toggleIndexingDetails(s.id)}
                                  >
                                    Indexing Details
                                    {expandedSourceIds.has(s.id) ? (
                                      <ChevronUp size={12} />
                                    ) : (
                                      <ChevronDown size={12} />
                                    )}
                                  </button>
                                  <button
                                    type="button"
                                    className="btn btn-ghost btn-icon"
                                    title="Re-index source"
                                    aria-label="Re-index source"
                                    onClick={() => handleReindexSource(kb.id, s.id)}
                                  >
                                    <RefreshCw size={12} />
                                  </button>
                                  <button
                                    type="button"
                                    className="btn btn-ghost btn-icon"
                                    title="Delete source"
                                    aria-label="Delete source"
                                    onClick={() => handleDeleteSource(kb.id, s.id)}
                                  >
                                    <Trash2 size={12} className="icon-danger" />
                                  </button>
                                </td>
                              </tr>
                              {st === "failed" && s.error && !expandedSourceIds.has(s.id) && (
                                <tr className="kb-source-error-row">
                                  <td colSpan={6}>
                                    <span className="kb-source-error-text">
                                      <AlertCircle size={12} className="icon-danger" /> {s.error}
                                    </span>
                                  </td>
                                </tr>
                              )}
                              {expandedSourceIds.has(s.id) && (
                                <tr className="kb-indexing-details-row">
                                  <td colSpan={6}>
                                    <IndexingDetails
                                      source={s}
                                      details={sourceDetailsCache[s.id]}
                                      loading={Boolean(loadingDetails[s.id])}
                                      error={detailsErrors[s.id]}
                                      onRefresh={() => refreshSourceDetails(s.id)}
                                      onLoadChunks={loadSourceChunks}
                                    />
                                  </td>
                                </tr>
                              )}
                            </React.Fragment>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        )}
      </div>

      {/* New KB Dialog */}
      <Dialog open={createDialogOpen} onClose={() => setCreateDialogOpen(false)}>
        <DialogTitle>New Knowledge Base</DialogTitle>
        <DialogDesc>Enter a name for your new knowledge base.</DialogDesc>
        <div style={{ marginTop: "16px" }}>
          <input
            className="input"
            type="text"
            placeholder="e.g. Product Documentation"
            value={newKbName}
            onChange={(e) => setNewKbName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCreateKb()}
            autoFocus
          />
        </div>
        <DialogFooter>
          <button type="button" className="btn btn-secondary" onClick={() => setCreateDialogOpen(false)}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={handleCreateKb}>
            Create
          </button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}
