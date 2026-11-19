import React from "react";

export function Avatar({ children, className = "", size = "md", style }) {
  const sizeClass = { sm: "avatar-sm", md: "avatar-md", lg: "avatar-lg" }[size] || "avatar-md";
  return (
    <div className={`avatar ${sizeClass} ${className}`} style={style}>
      {children}
    </div>
  );
}

export function AvatarFallback({ children }) {
  return <span>{children}</span>;
}

export function AvatarImage({ src, alt = "" }) {
  return (
    <img
      src={src}
      alt={alt}
      className="avatar-image"
    />
  );
}
