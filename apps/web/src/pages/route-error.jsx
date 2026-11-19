import React from "react";
import { useRouteError, Link } from "react-router-dom";
import { AlertTriangle, Home, RefreshCw } from "lucide-react";

export default function RouteError() {
  const error = useRouteError();
  console.error("Route error:", error);

  const errorMessage =
    error?.statusText || error?.message || "An unexpected error occurred.";

  return (
    <div className="empty-state empty-state-centered">
      <div className="empty-state-icon empty-state-icon-danger">
        <AlertTriangle size={28} />
      </div>
      <h1 className="empty-state-title empty-state-title-large">Something went wrong</h1>
      <p className="empty-state-desc empty-state-desc-constrained">
        {errorMessage}
      </p>
      <div className="empty-state-actions">
        <button
          type="button"
          className="btn btn-secondary btn-with-icon"
          onClick={() => window.location.reload()}
        >
          <RefreshCw size={14} />
          Reload
        </button>
        <Link to="/" className="btn btn-primary btn-with-icon">
          <Home size={14} />
          Back to home
        </Link>
      </div>
    </div>
  );
}
