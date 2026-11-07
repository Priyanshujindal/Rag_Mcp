import React from "react";
import { Bot } from "lucide-react";
import { CitationList } from "./CitationList";
import { MessageActions } from "./MessageActions";
import { MarkdownRenderer } from "./MarkdownRenderer";

/**
 * Individual chat message row supporting both user and assistant roles.
 * @param {object} props
 * @param {object} props.message - The message object
 * @param {string} props.message.id - Message ID
 * @param {"user" | "assistant"} props.message.role - Role of sender
 * @param {string} props.message.content - Markdown or plain text message
 * @param {Array} [props.message.sources] - Citations attached to the response
 * @param {object} [props.activeBot] - Currently selected custom bot
 * @param {boolean} props.isCopied - Whether this message is copied
 * @param {(id: string, text: string) => void} props.onCopy - Copy handler
 * @param {() => void} [props.onRegenerate] - Regenerate handler
 */
export function MessageItem({
  message,
  activeBot,
  isCopied,
  onCopy,
  onRegenerate,
}) {
  const isUser = message.role === "user";

  if (isUser) {
    return (
      <div className="chatgpt-msg-user">
        {message.content}
      </div>
    );
  }

  const avatarColor = activeBot?.theme?.primaryColor || "var(--accent)";

  return (
    <div className="chatgpt-msg-assistant">
      <div
        className="chat-msg-avatar"
        style={{ "--avatar-color": avatarColor }}
      >
        <Bot size={17} />
      </div>

      <div className="chat-msg-content-wrapper">
        <div className="chat-msg-text">
          {message.content ? (
            <MarkdownRenderer content={message.content} />
          ) : (
            <div className="chat-typing-dots">
              <span className="typing-dot" />
              <span className="typing-dot" />
              <span className="typing-dot" />
            </div>
          )}
        </div>

        {message.sources && <CitationList sources={message.sources} />}

        <MessageActions
          messageId={message.id}
          content={message.content}
          isCopied={isCopied}
          onCopy={onCopy}
          onRegenerate={onRegenerate}
        />
      </div>
    </div>
  );
}

