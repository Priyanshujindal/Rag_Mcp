import React, { useState, useRef, useEffect, useCallback } from "react";

export function DropdownMenu({ children }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  const handleKeyDown = useCallback((e) => {
    if (e.key === "Escape") {
      setOpen(false);
    }
  }, []);

  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [handleKeyDown]);

  const trigger = React.Children.toArray(children).find(
    (c) => c && c.type === DropdownMenuTrigger
  );
  const content = React.Children.toArray(children).find(
    (c) => c && c.type === DropdownMenuContent
  );

  return (
    <div className="dropdown-wrapper" ref={ref}>
      {trigger &&
        React.cloneElement(trigger, {
          onClick: () => setOpen((v) => !v),
          "aria-expanded": open,
        })}
      {open &&
        content &&
        React.cloneElement(content, { onClose: () => setOpen(false) })}
    </div>
  );
}

export function DropdownMenuTrigger({ children, onClick, ...props }) {
  const handleKeyDown = (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onClick?.(e);
    }
  };

  return (
    <div
      onClick={onClick}
      onKeyDown={handleKeyDown}
      className="dropdown-trigger"
      role="button"
      tabIndex={0}
      aria-haspopup="true"
      {...props}
    >
      {children}
    </div>
  );
}

export function DropdownMenuContent({
  children,
  onClose,
  align = "left",
  className = "",
  side = "bottom",
  style,
}) {
  const sideClass = side === "top" ? "dropdown-side-top" : "dropdown-side-bottom";
  const alignClass =
    align === "right"
      ? "dropdown-align-right"
      : align === "center"
      ? "dropdown-align-center"
      : "dropdown-align-left";

  return (
    <div
      className={`dropdown-menu ${sideClass} ${alignClass} ${className}`}
      style={style}
      role="menu"
    >
      {React.Children.map(children, (child) => {
        if (!child) return null;
        if (child.type === DropdownMenuItem) {
          return React.cloneElement(child, {
            onClose,
          });
        }
        return child;
      })}
    </div>
  );
}

export function DropdownMenuItem({
  children,
  onClick,
  onClose,
  className = "",
  danger,
}) {
  return (
    <button
      type="button"
      role="menuitem"
      className={`dropdown-item ${danger ? "danger" : ""} ${className}`}
      onClick={() => {
        onClick?.();
        onClose?.();
      }}
    >
      {children}
    </button>
  );
}

export function DropdownMenuSeparator() {
  return <div className="dropdown-separator" role="separator" />;
}

export function DropdownMenuLabel({ children }) {
  return <div className="dropdown-label">{children}</div>;
}
