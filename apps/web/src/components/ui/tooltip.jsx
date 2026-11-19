import React, { useState } from "react";

export function Tooltip({ children, content, className = "" }) {
  const [visible, setVisible] = useState(false);

  return (
    <div
      className={`tooltip-wrapper ${className}`}
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
    >
      {children}
      {visible && content && (
        <div className="tooltip-bubble">
          {content}
        </div>
      )}
    </div>
  );
}
