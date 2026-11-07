import React, { useEffect, useCallback, useRef } from "react";
import { X } from "lucide-react";

export function Dialog({ open, onClose, children, maxWidth = "480px" }) {
  const dialogRef = useRef(null);

  const handleKeyDown = useCallback(
    (e) => {
      if (e.key === "Escape") {
        onClose?.();
        return;
      }
      if (e.key === "Tab" && dialogRef.current) {
        const focusable = dialogRef.current.querySelectorAll(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === first) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    },
    [onClose]
  );

  useEffect(() => {
    if (open) {
      document.addEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "hidden";
      const timer = setTimeout(() => {
        if (dialogRef.current) {
          const autoFocusEl = dialogRef.current.querySelector("[autofocus]");
          if (autoFocusEl) {
            autoFocusEl.focus();
          } else {
            const first = dialogRef.current.querySelector(
              'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
            );
            first?.focus();
          }
        }
      }, 50);
      return () => {
        clearTimeout(timer);
        document.removeEventListener("keydown", handleKeyDown);
        document.body.style.overflow = "";
      };
    }
  }, [open, handleKeyDown]);

  if (!open) return null;

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        className="dialog-content"
        style={maxWidth && maxWidth !== "480px" ? { maxWidth } : undefined}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="dialog-close"
          onClick={onClose}
          aria-label="Close dialog"
        >
          <X size={16} />
        </button>
        {children}
      </div>
    </div>
  );
}

export function DialogTitle({ children }) {
  return <h2 className="dialog-title">{children}</h2>;
}

export function DialogDesc({ children }) {
  return <p className="dialog-desc">{children}</p>;
}

export function DialogFooter({ children }) {
  return <div className="dialog-footer">{children}</div>;
}
