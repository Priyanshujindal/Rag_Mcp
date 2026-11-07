import React, { useState, useEffect } from "react";
import { TestTube2, Play, AlertCircle, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Skeleton, TableSkeleton } from "@/components/ui/skeleton";
import { mockEvalRuns } from "@/lib/mock/data";
import { getMockEvalRuns } from "@/lib/api";
import "./evals.css";

function ScoreBar({ value, color }) {
  const pct = Math.round(value * 100);
  return (
    <div className="score-bar-wrapper">
      <div className="score-bar-track">
        <div
          className="score-bar-fill"
          style={{ "--pct": `${pct}%`, "--score-color": color || "var(--accent)" }}
        />
      </div>
      <span className="score-value">{pct}%</span>
    </div>
  );
}

function statusBadge(status) {
  if (status === "completed") return <Badge variant="success" dot>Completed</Badge>;
  if (status === "running")   return <Badge variant="info" dot>Running</Badge>;
  if (status === "failed")    return <Badge variant="danger" dot>Failed</Badge>;
  return <Badge variant="neutral" dot>{status}</Badge>;
}

export default function EvalsPage() {
  const [runs, setRuns] = useState(mockEvalRuns);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    getMockEvalRuns()
      .then((data) => {
        if (Array.isArray(data) && data.length > 0) {
          setRuns(data);
        }
      })
      .catch((err) => {
        setError(err.message || "Failed to load evaluations");
      });
  }, []);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">RAG Evals</h1>
          <p className="page-desc">
            Evaluate retrieval accuracy, answer faithfulness, and context relevance against golden Q&A test suites.
          </p>
        </div>
        <button type="button" className="btn btn-primary btn-with-icon" aria-label="Run evaluation">
          <Play size={14} /> Run Evaluation
        </button>
      </div>

      {/* Error state */}
      {error && (
        <div className="empty-state">
          <div className="empty-state-icon empty-state-icon-danger">
            <AlertCircle size={24} />
          </div>
          <div className="empty-state-title">Failed to load evaluations</div>
          <div className="empty-state-desc">{error}</div>
          <button
            type="button"
            className="btn btn-secondary btn-with-icon empty-state-cta"
            onClick={() => { setError(null); setLoading(false); }}
          >
            <RefreshCw size={14} /> Retry
          </button>
        </div>
      )}

      {/* Loading state */}
      {!error && loading && (
        <div>
          <div className="eval-score-grid">
            <div className="eval-score-card"><Skeleton height={40} /><Skeleton height={14} width="60%" style={{ margin: "8px auto 0" }} /></div>
            <div className="eval-score-card"><Skeleton height={40} /><Skeleton height={14} width="60%" style={{ margin: "8px auto 0" }} /></div>
            <div className="eval-score-card"><Skeleton height={40} /><Skeleton height={14} width="60%" style={{ margin: "8px auto 0" }} /></div>
          </div>
          <div className="table-wrapper">
            <TableSkeleton rows={4} cols={8} />
          </div>
        </div>
      )}

      {/* Normal display */}
      {!error && !loading && (
        <>
          {/* Score cards */}
          {runs.length > 0 && (
            <div className="eval-score-grid">
              {[
                { label: "Faithfulness",      value: runs[0].faithfulnessScore, color: "var(--success)" },
                { label: "Relevance",         value: runs[0].relevanceScore,    color: "var(--accent)" },
                { label: "Context Recall",    value: runs[0].contextRecallScore, color: "var(--info)" },
              ].map((s) => (
                <div key={s.label} className="eval-score-card">
                  <div
                    className="eval-score-val"
                    style={{ "--score-color": s.color }}
                  >
                    {Math.round(s.value * 100)}
                    <span className="eval-score-pct">%</span>
                  </div>
                  <div className="eval-score-label">
                    {s.label}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Eval runs table */}
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Test Suite</th>
                  <th>Model</th>
                  <th>Samples</th>
                  <th>Faithfulness</th>
                  <th>Relevance</th>
                  <th>Context Recall</th>
                  <th>Status</th>
                  <th>Run At</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr key={run.id}>
                    <td className="eval-suite-cell">
                      <span className="eval-suite-text">
                        {run.testSuite}
                      </span>
                    </td>
                    <td>
                      <code className="eval-model-code">
                        {run.model}
                      </code>
                    </td>
                    <td className="eval-samples-cell">{run.samplesCount}</td>
                    <td className="eval-score-col">
                      <ScoreBar value={run.faithfulnessScore} color="var(--success)" />
                    </td>
                    <td className="eval-score-col">
                      <ScoreBar value={run.relevanceScore} color="var(--accent)" />
                    </td>
                    <td className="eval-score-col">
                      <ScoreBar value={run.contextRecallScore} color="var(--info)" />
                    </td>
                    <td>{statusBadge(run.status)}</td>
                    <td className="analytics-date-cell">
                      {new Date(run.runAt).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {runs.length === 0 && (
              <div className="empty-state">
                <div className="empty-state-icon"><TestTube2 size={24} /></div>
                <div className="empty-state-title">No eval runs yet</div>
                <div className="empty-state-desc">
                  Create a test suite and run your first evaluation to measure RAG quality.
                </div>
                <button type="button" className="btn btn-primary btn-with-icon empty-state-cta">
                  <Play size={14} /> Run First Evaluation
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
