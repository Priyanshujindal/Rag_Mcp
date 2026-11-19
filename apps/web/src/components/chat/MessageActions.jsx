import React from "react";
import { Check, Copy, RefreshCw } from "lucide-react";

/**
 * Action toolbar for assistant messages (copy response, regenerate).
 * @param {object} props
 * @param {string} props.messageId - Unique identifier of the message
 * @param {string} props.content - Text content of the message
 * @param {boolean} props.isCopied - Whether this message was recently copied
 * @param {(id: string, text: string) => void} props.onCopy - Callback when copy is clicked
 * @param {() => void} [props.onRegenerate] - Callback when regenerate is clicked
 */
export function MessageActions({ messageId, content, isCopied, onCopy, onRegenerate }) {
  return (
    <div className="chat-msg-actions">
      <button
        type="button"
        className="btn btn-ghost btn-icon btn-sm"
        onClick={() => onCopy(messageId, content)}
        title="Copy response"
        aria-label="Copy response"
      >
        {isCopied ? <Check size={13} color="var(--success)" /> : <Copy size={13} />}
      </button>
      {onRegenerate && (
        <button
          type="button"
          className="btn btn-ghost btn-icon btn-sm"
          onClick={onRegenerate}
          title="Regenerate"
          aria-label="Regenerate response"
        >
          <RefreshCw size={13} />
        </button>
      )}
    </div>
  );
}

