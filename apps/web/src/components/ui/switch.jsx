import React from "react";

export function Switch({ checked, onChange, disabled, id, label }) {
  return (
    <label
      className={`switch-root ${disabled ? "disabled" : ""}`}
      htmlFor={id}
      title={label}
    >
      <input
        id={id}
        type="checkbox"
        role="switch"
        aria-checked={checked}
        aria-label={label || "Toggle switch"}
        checked={checked}
        onChange={(e) => !disabled && onChange?.(e.target.checked)}
        disabled={disabled}
      />
      <span className="switch-track" />
      <span className="switch-thumb" />
    </label>
  );
}
