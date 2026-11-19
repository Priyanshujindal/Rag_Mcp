/**
 * packages/widget/src/ChatWidget.js
 * ==========================================================
 * Vanilla JavaScript Shadow DOM Chat Widget Component.
 * Encapsulated, highly performant, zero-dependency.
 */

import { streamPublicChat } from "./api-client.js";

// Safe inline markdown renderer for bot responses
function renderMarkdown(rawText) {
  if (!rawText) return "";

  // 1. Escape HTML tags
  let escaped = rawText
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // 2. Code blocks (```code```)
  escaped = escaped.replace(/```([\s\S]*?)```/g, (_match, code) => {
    return `<pre><code>${code.trim()}</code></pre>`;
  });

  // 3. Inline code (`code`)
  escaped = escaped.replace(/`([^`]+)`/g, "<code>$1</code>");

  // 4. Bold (**text**)
  escaped = escaped.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");

  // 5. Italic (*text*)
  escaped = escaped.replace(/\*([^*]+)\*/g, "<em>$1</em>");

  // 6. Links [text](url)
  escaped = escaped.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>'
  );

  // 7. Bullet lists (- item)
  const lines = escaped.split("\n");
  const processed = [];
  let inList = false;

  for (const line of lines) {
    if (line.trim().startsWith("- ") || line.trim().startsWith("* ")) {
      if (!inList) {
        processed.push("<ul>");
        inList = true;
      }
      processed.push(`<li>${line.trim().substring(2)}</li>`);
    } else {
      if (inList) {
        processed.push("</ul>");
        inList = false;
      }
      if (line.trim()) {
        processed.push(`<p>${line}</p>`);
      }
    }
  }
  if (inList) processed.push("</ul>");

  return processed.join("");
}

export class ChatWidget {
  constructor(root, config) {
    this.root = root;
    this.config = {
      apiHost: config.apiHost || window.location.origin,
      publicId: config.publicId || config.botId || "",
      name: config.name || "AI Assistant",
      primaryColor: config.primaryColor || "#10a37f",
      position: config.position || "bottom-right",
      theme: config.theme || "dark",
      welcomeMessage: config.welcomeMessage || "Hello! How can I help you today?",
      suggestedQuestions: Array.isArray(config.suggestedQuestions)
        ? config.suggestedQuestions
        : [],
      ...config,
    };

    this.isOpen = false;
    this.isStreaming = false;
    this.storageKey = `rmw_conv_${this.config.publicId}`;
    this.conversationId = sessionStorage.getItem(this.storageKey) || null;

    // Initial messages
    this.messages = [
      {
        id: "w_welcome",
        sender: "bot",
        text: this.config.welcomeMessage,
        citations: [],
      },
    ];

    this.render();
  }

  updateConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
    if (this.messages.length === 1 && this.messages[0].id === "w_welcome") {
      this.messages[0].text = this.config.welcomeMessage;
    }
    this.render();
  }

  toggle() {
    this.isOpen = !this.isOpen;
    this.updateVisibility();
  }

  open() {
    if (!this.isOpen) {
      this.isOpen = true;
      this.updateVisibility();
    }
  }

  close() {
    if (this.isOpen) {
      this.isOpen = false;
      this.updateVisibility();
    }
  }

  updateVisibility() {
    const win = this.root.querySelector(".rmw-window");
    const launcher = this.root.querySelector(".rmw-launcher");
    const badge = this.root.querySelector(".rmw-badge");

    if (this.isOpen) {
      win.classList.add("open");
      if (badge) badge.style.display = "none";
      launcher.setAttribute("aria-expanded", "true");
      // Focus textarea
      setTimeout(() => {
        const textarea = this.root.querySelector(".rmw-textarea");
        if (textarea) textarea.focus();
        this.scrollToBottom();
      }, 150);
    } else {
      win.classList.remove("open");
      launcher.setAttribute("aria-expanded", "false");
    }
  }

  scrollToBottom() {
    const list = this.root.querySelector(".rmw-messages");
    if (list) {
      list.scrollTop = list.scrollHeight;
    }
  }

  async handleSendMessage(text) {
    if (!text || !text.trim() || this.isStreaming) return;
    const userMessage = text.trim();

    // Append user message
    const userMsgObj = {
      id: `u_${Date.now()}`,
      sender: "user",
      text: userMessage,
    };
    this.messages.push(userMsgObj);

    // Prepare streaming bot placeholder
    const botMsgId = `b_${Date.now()}`;
    const botMsgObj = {
      id: botMsgId,
      sender: "bot",
      text: "",
      citations: [],
      isStreaming: true,
    };
    this.messages.push(botMsgObj);

    this.isStreaming = true;
    this.renderMessages();
    this.scrollToBottom();

    // Disable input
    const textarea = this.root.querySelector(".rmw-textarea");
    const sendBtn = this.root.querySelector(".rmw-send-btn");
    if (textarea) textarea.value = "";
    if (sendBtn) sendBtn.disabled = true;

    try {
      await streamPublicChat({
        apiHost: this.config.apiHost,
        publicId: this.config.publicId,
        message: userMessage,
        conversationId: this.conversationId,
        onToken: (token) => {
          botMsgObj.text += token;
          this.updateBotStreamingText(botMsgId, botMsgObj.text);
        },
        onCitation: (citation) => {
          botMsgObj.citations.push(citation);
        },
        onDone: (data) => {
          botMsgObj.isStreaming = false;
          if (data?.conversationId) {
            this.conversationId = data.conversationId;
            sessionStorage.setItem(this.storageKey, this.conversationId);
          }
          this.isStreaming = false;
          this.renderMessages();
          if (sendBtn) sendBtn.disabled = false;
        },
        onError: (err) => {
          botMsgObj.isStreaming = false;
          botMsgObj.text = `⚠️ Error: ${err.message || "Failed to get response"}`;
          this.isStreaming = false;
          this.renderMessages();
          if (sendBtn) sendBtn.disabled = false;
        },
      });
    } catch (err) {
      botMsgObj.isStreaming = false;
      botMsgObj.text = `⚠️ Connection error: ${err.message}`;
      this.isStreaming = false;
      this.renderMessages();
      if (sendBtn) sendBtn.disabled = false;
    }
  }

  updateBotStreamingText(msgId, text) {
    const bubble = this.root.querySelector(`[data-msg-id="${msgId}"] .rmw-bubble`);
    if (bubble) {
      bubble.innerHTML = renderMarkdown(text) + '<span class="rmw-cursor"></span>';
      this.scrollToBottom();
    }
  }

  resetConversation() {
    this.conversationId = null;
    sessionStorage.removeItem(this.storageKey);
    this.messages = [
      {
        id: "w_welcome",
        sender: "bot",
        text: this.config.welcomeMessage,
        citations: [],
      },
    ];
    this.renderMessages();
  }

  renderMessages() {
    const list = this.root.querySelector(".rmw-messages");
    if (!list) return;

    list.innerHTML = "";

    this.messages.forEach((m) => {
      const row = document.createElement("div");
      row.className = `rmw-msg-row ${m.sender}`;
      row.setAttribute("data-msg-id", m.id);

      const bubble = document.createElement("div");
      bubble.className = "rmw-bubble";

      if (m.sender === "user") {
        bubble.textContent = m.text;
      } else {
        bubble.innerHTML =
          renderMarkdown(m.text) + (m.isStreaming ? '<span class="rmw-cursor"></span>' : "");

        // Render citations
        if (m.citations && m.citations.length > 0) {
          const citContainer = document.createElement("div");
          citContainer.className = "rmw-citations";
          m.citations.forEach((cit, idx) => {
            const pill = document.createElement("span");
            pill.className = "rmw-citation-pill";
            pill.textContent = `[${idx + 1}] ${cit.sourceName || cit.source_name || "Document"}`;
            pill.title = cit.text || cit.snippet || "";
            citContainer.appendChild(pill);
          });
          bubble.appendChild(citContainer);
        }
      }

      row.appendChild(bubble);
      list.appendChild(row);
    });

    // If only welcome message is present, show suggested questions
    if (
      this.messages.length === 1 &&
      this.config.suggestedQuestions &&
      this.config.suggestedQuestions.length > 0
    ) {
      const suggestionsDiv = document.createElement("div");
      suggestionsDiv.className = "rmw-suggestions";

      this.config.suggestedQuestions.forEach((q) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "rmw-suggestion-btn";
        btn.textContent = q;
        btn.onclick = () => this.handleSendMessage(q);
        suggestionsDiv.appendChild(btn);
      });

      list.appendChild(suggestionsDiv);
    }

    this.scrollToBottom();
  }

  render() {
    const isLeft = this.config.position === "bottom-left";

    this.root.innerHTML = `
      <div class="rmw-container ${isLeft ? "pos-left" : ""}">
        <!-- Chat Window -->
        <div class="rmw-window" role="dialog" aria-label="${this.config.name} Chat">
          <!-- Header -->
          <div class="rmw-header">
            <div class="rmw-header-bot">
              <div class="rmw-avatar">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M12 8V4H8"></path>
                  <rect width="16" height="12" x="4" y="8" rx="2"></rect>
                  <path d="M2 14h2"></path>
                  <path d="M20 14h2"></path>
                  <path d="M15 13v2"></path>
                  <path d="M9 13v2"></path>
                </svg>
              </div>
              <div class="rmw-header-info">
                <span class="rmw-header-title">${this.config.name}</span>
                <span class="rmw-header-status">
                  <span class="rmw-status-dot"></span> Online
                </span>
              </div>
            </div>

            <div class="rmw-header-actions">
              <button type="button" class="rmw-icon-btn rmw-reset-btn" title="Reset conversation">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"></path>
                  <path d="M21 3v5h-5"></path>
                  <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"></path>
                  <path d="M8 16H3v5"></path>
                </svg>
              </button>
              <button type="button" class="rmw-icon-btn rmw-close-btn" title="Close chat">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            </div>
          </div>

          <!-- Messages -->
          <div class="rmw-messages"></div>

          <!-- Footer / Composer -->
          <div class="rmw-footer">
            <div class="rmw-input-wrapper">
              <textarea
                class="rmw-textarea"
                rows="1"
                placeholder="Type your message..."
                aria-label="Message input"
              ></textarea>
              <button type="button" class="rmw-send-btn" title="Send message" aria-label="Send">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <line x1="22" y1="2" x2="11" y2="13"></line>
                  <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
                </svg>
              </button>
            </div>
            <div class="rmw-powered-by">
              Powered by <a href="https://github.com" target="_blank" rel="noopener noreferrer">Rag_Mcp</a>
            </div>
          </div>
        </div>

        <!-- Floating Launcher -->
        <button
          type="button"
          class="rmw-launcher"
          aria-label="Open chat"
          aria-expanded="false"
        >
          <svg class="rmw-launcher-icon" viewBox="0 0 24 24">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
          </svg>
          <span class="rmw-badge">1</span>
        </button>
      </div>
    `;

    // Bind event listeners
    const launcher = this.root.querySelector(".rmw-launcher");
    const closeBtn = this.root.querySelector(".rmw-close-btn");
    const resetBtn = this.root.querySelector(".rmw-reset-btn");
    const textarea = this.root.querySelector(".rmw-textarea");
    const sendBtn = this.root.querySelector(".rmw-send-btn");

    launcher.onclick = () => this.toggle();
    closeBtn.onclick = () => this.close();
    resetBtn.onclick = () => this.resetConversation();

    const submit = () => {
      const val = textarea.value;
      if (val.trim()) {
        this.handleSendMessage(val);
      }
    };

    sendBtn.onclick = submit;

    textarea.onkeydown = (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        submit();
      }
    };

    // Auto grow textarea
    textarea.oninput = () => {
      textarea.style.height = "auto";
      textarea.style.height = Math.min(textarea.scrollHeight, 100) + "px";
    };

    this.renderMessages();
  }
}

