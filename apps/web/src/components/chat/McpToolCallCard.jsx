import React, { useState } from "react";
import {
  Wrench,
  ShieldAlert,
  CheckCircle2,
  XCircle,
  ChevronDown,
  ChevronRight,
  Database,
  FileCode,
  Terminal,
  Calculator,
  Loader2,
} from "lucide-react";
import "./mcp-tool-card.css";

function getToolIcon(name) {
  if (name?.includes("sql") || name?.includes("db") || name?.includes("query")) {
    return <Database size={15} />;
  }
  if (name?.includes("file") || name?.includes("directory")) {
    return <FileCode size={15} />;
  }
  if (name?.includes("calc") || name?.includes("metric")) {
    return <Calculator size={15} />;
  }
  return <Wrench size={15} />;
}

export function McpToolCallCard({ toolCall, onApprove, onReject, isStreaming }) {
  const [isOutputExpanded, setIsOutputExpanded] = useState(true);
  const [isApproving, setIsApproving] = useState(false);

  const {
    id,
    toolName = "mcp_tool",
    serverName = "MCP Server",
    args = {},
    status = "pending", // 'pending' | 'executing' | 'completed' | 'rejected'
    result,
    requiresApproval = false,
  } = toolCall;

  const handleApprove = async () => {
    setIsApproving(true);
    try {
      if (onApprove) await onApprove(id, toolName, args);
    } finally {
      setIsApproving(false);
    }
  };

  const handleReject = () => {
    if (onReject) onReject(id, toolName);
  };

  return (
    <div className={`mcp-tool-card mcp-status-${status}`}>
      {/* Top Header */}
      <div className="mcp-tool-header">
        <div className="mcp-tool-title-row">
          <div className="mcp-tool-icon-wrap">{getToolIcon(toolName)}</div>
          <div className="mcp-tool-names">
            <span className="mcp-tool-name">{toolName}</span>
            <span className="mcp-server-tag">{serverName}</span>
          </div>
        </div>

        <div className="mcp-tool-status-pill">
          {status === "pending" && (
            <span className="status-badge badge-amber">
              <ShieldAlert size={12} /> Awaiting Approval
            </span>
          )}
          {status === "executing" && (
            <span className="status-badge badge-blue">
              <Loader2 size={12} className="spin" /> Executing Tool...
            </span>
          )}
          {status === "completed" && (
            <span className="status-badge badge-green">
              <CheckCircle2 size={12} /> Executed
            </span>
          )}
          {status === "rejected" && (
            <span className="status-badge badge-red">
              <XCircle size={12} /> Rejected
            </span>
          )}
        </div>
      </div>

      {/* Input Parameters Box */}
      {args && Object.keys(args).length > 0 && (
        <div className="mcp-tool-params-box">
          <div className="mcp-params-label">Tool Input Parameters</div>
          <pre className="mcp-params-code">
            {typeof args === "string" ? args : JSON.stringify(args, null, 2)}
          </pre>
        </div>
      )}

      {/* Human-in-the-Loop Action Approval Banner */}
      {status === "pending" && requiresApproval && (
        <div className="mcp-approval-banner">
          <div className="mcp-approval-msg">
            <ShieldAlert size={16} className="mcp-alert-icon" />
            <span>
              <strong>Human-in-the-Loop Guard:</strong> This tool requires your explicit confirmation before accessing workspace resources.
            </span>
          </div>
          <div className="mcp-approval-actions">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={handleReject}
              disabled={isApproving}
            >
              Reject
            </button>
            <button
              type="button"
              className="btn btn-primary btn-sm btn-with-icon"
              onClick={handleApprove}
              disabled={isApproving}
            >
              {isApproving ? (
                <>
                  <Loader2 size={13} className="spin" /> Executing...
                </>
              ) : (
                <>
                  <CheckCircle2 size={13} /> Approve & Run Tool
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* Result Section (Collapsible) */}
      {status === "completed" && result && (
        <div className="mcp-tool-result-section">
          <button
            type="button"
            className="mcp-result-toggle"
            onClick={() => setIsOutputExpanded(!isOutputExpanded)}
          >
            {isOutputExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            <span>Tool Execution Output</span>
            {result.rowCount !== undefined && (
              <span className="mcp-result-meta">({result.rowCount} rows returned)</span>
            )}
          </button>

          {isOutputExpanded && (
            <div className="mcp-result-body">
              {Array.isArray(result.data) ? (
                <div className="mcp-table-responsive">
                  <table className="mcp-data-table">
                    <thead>
                      <tr>
                        {result.columns?.map((col) => (
                          <th key={col}>{col}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {result.data.map((row, rIdx) => (
                        <tr key={rIdx}>
                          {result.columns?.map((col) => (
                            <td key={col}>{String(row[col] ?? "")}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <pre className="mcp-result-code">
                  {typeof result === "string" ? result : JSON.stringify(result, null, 2)}
                </pre>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default McpToolCallCard;

