import React from "react";

export function Input({
  className = "",
  type = "text",
  placeholder,
  value,
  onChange,
  disabled,
  ...props
}) {
  return (
    <input
      type={type}
      className={`input ${className}`}
      placeholder={placeholder}
      value={value}
      onChange={onChange}
      disabled={disabled}
      {...props}
    />
  );
}

export function Textarea({
  className = "",
  placeholder,
  value,
  onChange,
  rows = 3,
  ...props
}) {
  return (
    <textarea
      className={`input textarea ${className}`}
      placeholder={placeholder}
      value={value}
      onChange={onChange}
      rows={rows}
      {...props}
    />
  );
}
