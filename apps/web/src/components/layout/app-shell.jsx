import React, { useState, useEffect } from "react";
import { useLocation } from "react-router-dom";
import { Menu } from "lucide-react";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";

export function AppShell({ children, fullBleed = false }) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();

  // Close mobile drawer on navigation
  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  return (
    <div className="app-shell">
      {/* Mobile backdrop overlay */}
      {mobileOpen && (
        <div
          className="sidebar-backdrop"
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
        />
      )}

      <Sidebar
        isCollapsed={collapsed}
        onToggleCollapse={() => setCollapsed((v) => !v)}
        mobileOpen={mobileOpen}
        onCloseMobile={() => setMobileOpen(false)}
      />

      <div className="main-content">
        {!fullBleed && (
          <Topbar onToggleMobileSidebar={() => setMobileOpen((v) => !v)} />
        )}
        {fullBleed && (
          <button
            type="button"
            className="btn btn-ghost btn-icon mobile-only-menu-btn"
            onClick={() => setMobileOpen((v) => !v)}
            aria-label="Open sidebar menu"
          >
            <Menu size={18} />
          </button>
        )}
        <main className={`page-content ${fullBleed ? "full-bleed" : ""}`}>
          {children}
        </main>
      </div>
    </div>
  );
}
