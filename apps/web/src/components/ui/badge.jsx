import React from "react";

export function Badge({ children, variant = "neutral", className = "", dot }) {
  const variantClass = {
    success: "badge-success",
    warning: "badge-warning",
    danger:  "badge-danger",
    info:    "badge-info",
    neutral: "badge-neutral",
    accent:  "badge-accent",
  }[variant] || "badge-neutral";

  return (
    <span className={`badge ${variantClass} ${className}`}>
      {dot && <span className="badge-dot" />}
      {children}
    </span>
  );
}
