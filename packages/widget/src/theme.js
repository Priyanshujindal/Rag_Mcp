/**
 * packages/widget/src/theme.js
 * ==========================================================
 * Shadow DOM scoped styles for Rag_Mcp Embeddable Chat Widget.
 * Encapsulated inside the shadow root so host styles never leak in
 * and widget styles never leak out.
 */

export function getWidgetStyles(primaryColor = "#10a37f", theme = "dark") {
  const isDark = theme === "dark";

  return `
    :host {
      all: initial;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      font-size: 14px;
      line-height: 1.5;
      color-scheme: ${isDark ? "dark" : "light"};
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    .rmw-container {
      position: fixed;
      z-index: 2147483647;
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      bottom: 20px;
      right: 20px;
      --rmw-brand: ${primaryColor};
      --rmw-brand-hover: ${primaryColor}dd;
      --rmw-bg-card: ${isDark ? "#18181b" : "#ffffff"};
      --rmw-bg-subtle: ${isDark ? "#27272a" : "#f4f4f5"};
      --rmw-bg-bubble-bot: ${isDark ? "#27272a" : "#f4f4f5"};
      --rmw-text-main: ${isDark ? "#f4f4f5" : "#18181b"};
      --rmw-text-muted: ${isDark ? "#a1a1aa" : "#71717a"};
      --rmw-border: ${isDark ? "#3f3f46" : "#e4e4e7"};
      --rmw-shadow: 0 12px 36px rgba(0, 0, 0, ${isDark ? "0.55" : "0.18"});
    }

    .rmw-container.pos-left {
      right: auto;
      left: 20px;
      align-items: flex-start;
    }

    /* Floating Launcher Button */
    .rmw-launcher {
      width: 58px;
      height: 58px;
      border-radius: 50%;
      background: var(--rmw-brand);
      color: #ffffff;
      border: none;
      outline: none;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 6px 20px rgba(0, 0, 0, 0.25);
      transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 0.2s ease;
      position: relative;
    }

    .rmw-launcher:hover {
      transform: scale(1.06);
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.32);
    }

    .rmw-launcher:active {
      transform: scale(0.96);
    }

    .rmw-launcher-icon {
      width: 26px;
      height: 26px;
      fill: none;
      stroke: currentColor;
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
      transition: transform 0.2s ease;
    }

    .rmw-badge {
      position: absolute;
      top: -2px;
      right: -2px;
      background: #ef4444;
      color: #ffffff;
      font-size: 11px;
      font-weight: 700;
      width: 20px;
      height: 20px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      border: 2px solid var(--rmw-bg-card);
      animation: rmwBounce 0.4s ease;
    }

    @keyframes rmwBounce {
      0%, 100% { transform: scale(1); }
      50% { transform: scale(1.25); }
    }

    /* Chat Window */
    .rmw-window {
      width: 380px;
      height: 580px;
      max-width: calc(100vw - 40px);
      max-height: calc(100vh - 100px);
      background: var(--rmw-bg-card);
      border: 1px solid var(--rmw-border);
      border-radius: 18px;
      box-shadow: var(--rmw-shadow);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      margin-bottom: 14px;
      opacity: 0;
      transform: translateY(16px) scale(0.97);
      transform-origin: bottom right;
      pointer-events: none;
      transition: opacity 0.22s ease, transform 0.22s cubic-bezier(0.16, 1, 0.3, 1);
    }

    .rmw-container.pos-left .rmw-window {
      transform-origin: bottom left;
    }

    .rmw-window.open {
      opacity: 1;
      transform: translateY(0) scale(1);
      pointer-events: auto;
    }

    /* Window Header */
    .rmw-header {
      background: var(--rmw-brand);
      color: #ffffff;
      padding: 16px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    }

    .rmw-header-bot {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .rmw-avatar {
      width: 38px;
      height: 38px;
      border-radius: 50%;
      background: rgba(255, 255, 255, 0.2);
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }

    .rmw-header-info {
      display: flex;
      flex-direction: column;
    }

    .rmw-header-title {
      font-weight: 700;
      font-size: 15px;
      line-height: 1.2;
    }

    .rmw-header-status {
      font-size: 11px;
      opacity: 0.88;
      display: flex;
      align-items: center;
      gap: 5px;
      margin-top: 2px;
    }

    .rmw-status-dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: #22c55e;
      display: inline-block;
    }

    .rmw-header-actions {
      display: flex;
      align-items: center;
      gap: 4px;
    }

    .rmw-icon-btn {
      background: none;
      border: none;
      color: rgba(255, 255, 255, 0.85);
      cursor: pointer;
      padding: 6px;
      border-radius: 6px;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background 0.15s, color 0.15s;
    }

    .rmw-icon-btn:hover {
      background: rgba(255, 255, 255, 0.18);
      color: #ffffff;
    }

    /* Messages Area */
    .rmw-messages {
      flex: 1;
      overflow-y: auto;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 14px;
      background: var(--rmw-bg-card);
      scroll-behavior: smooth;
    }

    .rmw-msg-row {
      display: flex;
      flex-direction: column;
      max-width: 86%;
      animation: rmwFadeIn 0.2s ease;
    }

    @keyframes rmwFadeIn {
      from { opacity: 0; transform: translateY(6px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .rmw-msg-row.user {
      align-self: flex-end;
    }

    .rmw-msg-row.bot {
      align-self: flex-start;
    }

    .rmw-bubble {
      padding: 11px 15px;
      border-radius: 16px;
      font-size: 13.5px;
      line-height: 1.45;
      word-break: break-word;
    }

    .rmw-msg-row.user .rmw-bubble {
      background: var(--rmw-brand);
      color: #ffffff;
      border-bottom-right-radius: 4px;
    }

    .rmw-msg-row.bot .rmw-bubble {
      background: var(--rmw-bg-bubble-bot);
      color: var(--rmw-text-main);
      border-bottom-left-radius: 4px;
      border: 1px solid var(--rmw-border);
    }

    /* Markdown inside Bot Bubble */
    .rmw-bubble p {
      margin-bottom: 8px;
    }
    .rmw-bubble p:last-child {
      margin-bottom: 0;
    }
    .rmw-bubble strong {
      font-weight: 700;
    }
    .rmw-bubble code {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 12px;
      background: rgba(120, 120, 120, 0.18);
      padding: 2px 5px;
      border-radius: 4px;
    }
    .rmw-bubble pre {
      background: rgba(0, 0, 0, 0.25);
      padding: 10px;
      border-radius: 8px;
      overflow-x: auto;
      margin: 8px 0;
    }
    .rmw-bubble pre code {
      background: none;
      padding: 0;
    }
    .rmw-bubble ul, .rmw-bubble ol {
      margin: 6px 0 6px 18px;
    }
    .rmw-bubble li {
      margin-bottom: 3px;
    }
    .rmw-bubble a {
      color: var(--rmw-brand);
      text-decoration: underline;
    }

    /* Streaming Cursor */
    .rmw-cursor {
      display: inline-block;
      width: 6px;
      height: 14px;
      background: var(--rmw-brand);
      margin-left: 3px;
      vertical-align: middle;
      animation: rmwBlink 0.9s infinite;
    }

    @keyframes rmwBlink {
      0%, 100% { opacity: 1; }
      50% { opacity: 0; }
    }

    /* Citations in Bot Message */
    .rmw-citations {
      margin-top: 8px;
      padding-top: 8px;
      border-top: 1px solid var(--rmw-border);
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }

    .rmw-citation-pill {
      font-size: 11px;
      background: var(--rmw-bg-subtle);
      border: 1px solid var(--rmw-border);
      border-radius: 12px;
      padding: 3px 8px;
      color: var(--rmw-text-muted);
      cursor: pointer;
      transition: background 0.15s;
    }

    .rmw-citation-pill:hover {
      background: var(--rmw-border);
      color: var(--rmw-text-main);
    }

    /* Suggested Questions */
    .rmw-suggestions {
      display: flex;
      flex-direction: column;
      gap: 6px;
      margin-top: 4px;
    }

    .rmw-suggestion-btn {
      background: var(--rmw-bg-subtle);
      border: 1px solid var(--rmw-border);
      color: var(--rmw-text-main);
      border-radius: 12px;
      padding: 8px 12px;
      font-size: 12.5px;
      text-align: left;
      cursor: pointer;
      transition: all 0.15s ease;
    }

    .rmw-suggestion-btn:hover {
      border-color: var(--rmw-brand);
      color: var(--rmw-brand);
      background: var(--rmw-bg-card);
    }

    /* Composer / Input Area */
    .rmw-footer {
      padding: 12px 14px;
      border-top: 1px solid var(--rmw-border);
      background: var(--rmw-bg-card);
    }

    .rmw-input-wrapper {
      display: flex;
      align-items: flex-end;
      gap: 8px;
      background: var(--rmw-bg-subtle);
      border: 1px solid var(--rmw-border);
      border-radius: 14px;
      padding: 8px 10px;
      transition: border-color 0.15s;
    }

    .rmw-input-wrapper:focus-within {
      border-color: var(--rmw-brand);
    }

    .rmw-textarea {
      flex: 1;
      background: transparent;
      border: none;
      outline: none;
      resize: none;
      max-height: 100px;
      font-family: inherit;
      font-size: 13.5px;
      color: var(--rmw-text-main);
      line-height: 1.4;
    }

    .rmw-textarea::placeholder {
      color: var(--rmw-text-muted);
    }

    .rmw-send-btn {
      width: 32px;
      height: 32px;
      border-radius: 50%;
      background: var(--rmw-brand);
      color: #ffffff;
      border: none;
      outline: none;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      transition: opacity 0.15s, transform 0.15s;
    }

    .rmw-send-btn:disabled {
      opacity: 0.4;
      cursor: not-allowed;
      transform: none;
    }

    .rmw-send-btn:not(:disabled):hover {
      transform: scale(1.05);
    }

    .rmw-powered-by {
      font-size: 10.5px;
      color: var(--rmw-text-muted);
      text-align: center;
      margin-top: 8px;
    }

    .rmw-powered-by a {
      color: inherit;
      text-decoration: none;
      font-weight: 600;
    }

    .rmw-powered-by a:hover {
      text-decoration: underline;
    }

    /* Mobile Fullscreen */
    @media (max-width: 480px) {
      .rmw-container {
        bottom: 12px;
        right: 12px;
      }
      .rmw-container.pos-left {
        left: 12px;
      }
      .rmw-window {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        width: 100vw;
        height: 100vh;
        max-width: 100vw;
        max-height: 100vh;
        border-radius: 0;
        margin-bottom: 0;
      }
    }
  `;
}

