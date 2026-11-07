import React from "react";

export function Button({
  children,
  variant = "primary",
  size = "md",
  className = "",
  disabled,
  onClick,
  type = "button",
  title,
  ...props
}) {
  const variantClass = {
    primary:   "btn-primary",
    secondary: "btn-secondary",
    ghost:     "btn-ghost",
    danger:    "btn-danger",
  }[variant] || "btn-primary";

  const sizeClass = {
    sm: "btn-sm",
    md: "",
    lg: "btn-lg",
    icon: "btn-icon",
  }[size] || "";

  return (
    <button
      type={type}
      className={`btn ${variantClass} ${sizeClass} ${className}`}
      disabled={disabled}
      onClick={onClick}
      title={title}
      {...props}
    >
      {children}
    </button>
  );
}
