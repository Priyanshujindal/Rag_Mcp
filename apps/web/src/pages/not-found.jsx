import React from "react";
import { Link } from "react-router-dom";
import { AlertCircle, Home } from "lucide-react";

export default function NotFoundPage() {
  return (
    <div className="empty-state empty-state-centered">
      <div className="empty-state-icon empty-state-icon-large">
        <AlertCircle size={28} />
      </div>
      <h1 className="empty-state-title empty-state-title-large">404 - Page Not Found</h1>
      <p className="empty-state-desc">
        The page you are looking for doesn't exist or has been moved.
      </p>
      <Link to="/" className="btn btn-primary btn-with-icon">
        <Home size={15} />
        Back to home
      </Link>
    </div>
  );
}
