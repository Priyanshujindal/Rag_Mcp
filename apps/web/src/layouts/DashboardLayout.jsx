import React from "react";
import { Outlet, Navigate, useMatches } from "react-router-dom";
import { AppShell } from "@/components/layout/app-shell";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/lib/auth";

export default function DashboardLayout() {
  const { isAuthenticated, isLoading } = useAuth();
  const matches = useMatches();

  if (isLoading) {
    return (
      <div className="page-skeleton-container" style={{ padding: "2rem", display: "flex", flexDirection: "column", gap: "1rem" }}>
        <Skeleton height={28} width="40%" />
        <Skeleton height={14} width="70%" />
        <Skeleton height={14} width="55%" />
        <Skeleton height={14} width="60%" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  const isFullBleed = matches.some((match) => Boolean(match.handle?.fullBleed));

  return (
    <AppShell fullBleed={isFullBleed}>
      <Outlet />
    </AppShell>
  );
}
