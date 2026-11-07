import React from "react";

export function Card({ children, className = "", onClick, style }) {
  return (
    <div className={`card ${className}`} onClick={onClick} style={style}>
      {children}
    </div>
  );
}

export function CardHeader({ children, className = "" }) {
  return <div className={`card-header ${className}`}>{children}</div>;
}

export function CardTitle({ children, className = "" }) {
  return <h3 className={`card-title ${className}`}>{children}</h3>;
}

export function CardDesc({ children, className = "" }) {
  return <p className={`card-desc ${className}`}>{children}</p>;
}

export function CardFooter({ children, className = "" }) {
  return <div className={`card-footer ${className}`}>{children}</div>;
}
