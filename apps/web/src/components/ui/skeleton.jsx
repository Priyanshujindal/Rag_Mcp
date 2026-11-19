import React from "react";

export function Skeleton({ width, height = 16, className = "", style = {} }) {
  return (
    <div
      className={`skeleton ${className}`}
      style={{ width: width || "100%", height, ...style }}
    />
  );
}

export function SkeletonText({ lines = 3, className = "" }) {
  return (
    <div className={`skeleton-text ${className}`}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} height={14} width={i === lines - 1 ? "65%" : "100%"} />
      ))}
    </div>
  );
}

export function TableSkeleton({ rows = 4, cols = 5, className = "" }) {
  return (
    <div className={`table-skeleton ${className}`} role="status" aria-label="Loading table data">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="table-skeleton-row">
          {Array.from({ length: cols }).map((_, c) => (
            <Skeleton key={c} height={16} width={c === 0 ? "70%" : "50%"} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function CardSkeleton({ count = 3, className = "" }) {
  return (
    <div className={`card-skeleton-grid ${className}`} role="status" aria-label="Loading items">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="card-skeleton-item">
          <Skeleton height={20} width="40%" />
          <Skeleton height={14} width="85%" />
          <Skeleton height={14} width="60%" />
          <Skeleton height={32} width="100%" />
        </div>
      ))}
    </div>
  );
}
