import React, { useState } from "react";
import { Check, Copy } from "lucide-react";

/**
 * Component for displaying syntax-highlighted or formatted code with a copy button.
 * @param {object} props
 * @param {string} props.code - The code string to display
 * @param {string} [props.language] - Programming language identifier
 */
export function CodeBlock({ code, language = "javascript" }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className="code-snippet-box">
      <div className="bot-detail-card-header">
        <span className="api-key-code">{language}</span>
        <button
          type="button"
          className="btn btn-ghost btn-sm btn-with-icon"
          onClick={handleCopy}
          aria-label="Copy code"
        >
          {copied ? <Check size={12} color="var(--success)" /> : <Copy size={12} />}
          <span>{copied ? "Copied" : "Copy"}</span>
        </button>
      </div>
      <pre className="bot-detail-code-pre">
        <code>{code}</code>
      </pre>
    </div>
  );
}

