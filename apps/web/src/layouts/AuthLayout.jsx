import React from "react";
import { Outlet, Navigate } from "react-router-dom";
import { useAuth } from "@/lib/auth";

export default function AuthLayout() {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return null;
  }

  if (isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="auth-page">
      <Outlet />
    </div>
  );
}
