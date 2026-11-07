/**
 * packages/widget/src/index.js
 * ==========================================================
 * Public Entry Point for Rag_Mcp Standalone Embeddable Chat Widget.
 * Can be loaded via <script data-bot-id="..."> or RagMcpWidget.init({ ... })
 */

import { getWidgetStyles } from "./theme.js";
import { ChatWidget } from "./ChatWidget.js";
import { fetchBotConfig } from "./api-client.js";

let currentWidgetInstance = null;
let hostElement = null;

export function init(options = {}) {
  // If already initialized on this page, clean up previous
  if (hostElement) {
    destroy();
  }

  // Determine configuration
  const config = {
    publicId: options.publicId || options.botId || options.chatbotId || "",
    apiHost: (options.apiHost || "").replace(/\/+$/, "") || window.location.origin,
    name: options.name || "AI Assistant",
    primaryColor: options.primaryColor || options.color || "#10a37f",
    position: options.position || "bottom-right",
    theme: options.theme || "dark",
    welcomeMessage: options.welcomeMessage || options.welcome || "Hello! How can I help you today?",
    suggestedQuestions: options.suggestedQuestions || [],
    ...options,
  };

  // Create isolated Host Element
  hostElement = document.createElement("div");
  hostElement.id = "rag-mcp-widget-host";
  document.body.appendChild(hostElement);

  // Attach Shadow DOM Root
  const shadowRoot = hostElement.attachShadow({ mode: "open" });

  // Inject Styles into Shadow Root
  const styleEl = document.createElement("style");
  styleEl.textContent = getWidgetStyles(config.primaryColor, config.theme);
  shadowRoot.appendChild(styleEl);

  // Container for component
  const componentContainer = document.createElement("div");
  componentContainer.className = "rmw-root";
  shadowRoot.appendChild(componentContainer);

  // Instantiate ChatWidget
  currentWidgetInstance = new ChatWidget(componentContainer, config);

  // Fetch dynamic remote configuration from backend if publicId is set
  if (config.publicId) {
    fetchBotConfig(config.apiHost, config.publicId).then((remoteConfig) => {
      if (remoteConfig) {
        // Update styles if color or theme changed
        if (
          (remoteConfig.primaryColor && remoteConfig.primaryColor !== config.primaryColor) ||
          (remoteConfig.theme && remoteConfig.theme !== config.theme)
        ) {
          styleEl.textContent = getWidgetStyles(
            remoteConfig.primaryColor || config.primaryColor,
            remoteConfig.theme || config.theme
          );
        }

        currentWidgetInstance.updateConfig({
          name: remoteConfig.name || config.name,
          primaryColor: remoteConfig.primaryColor || config.primaryColor,
          theme: remoteConfig.theme || config.theme,
          position: remoteConfig.position || config.position,
          welcomeMessage: remoteConfig.welcomeMessage || config.welcomeMessage,
          suggestedQuestions: remoteConfig.suggestedQuestions || config.suggestedQuestions,
        });
      }
    });
  }

  return currentWidgetInstance;
}

export function open() {
  if (currentWidgetInstance) currentWidgetInstance.open();
}

export function close() {
  if (currentWidgetInstance) currentWidgetInstance.close();
}

export function toggle() {
  if (currentWidgetInstance) currentWidgetInstance.toggle();
}

export function destroy() {
  if (hostElement && hostElement.parentNode) {
    hostElement.parentNode.removeChild(hostElement);
  }
  hostElement = null;
  currentWidgetInstance = null;
}

// Auto-initialize when loaded via script tag with data attributes
function autoInit() {
  if (typeof document === "undefined") return;

  const scriptTag =
    document.querySelector("script[data-bot-id]") ||
    document.querySelector("script[data-chatbot-id]");

  if (scriptTag) {
    const publicId =
      scriptTag.getAttribute("data-bot-id") ||
      scriptTag.getAttribute("data-chatbot-id");

    const apiHost =
      scriptTag.getAttribute("data-api-host") ||
      new URL(scriptTag.src, window.location.href).origin;

    const primaryColor = scriptTag.getAttribute("data-color");
    const position = scriptTag.getAttribute("data-position");
    const theme = scriptTag.getAttribute("data-theme");
    const welcome = scriptTag.getAttribute("data-welcome");

    init({
      publicId,
      apiHost,
      ...(primaryColor ? { primaryColor } : {}),
      ...(position ? { position } : {}),
      ...(theme ? { theme } : {}),
      ...(welcome ? { welcomeMessage: welcome } : {}),
    });
  }
}

// Attach to window object
if (typeof window !== "undefined") {
  window.RagMcpWidget = {
    init,
    open,
    close,
    toggle,
    destroy,
  };

  // Run autoInit on DOMContentLoaded or immediately if already loaded
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", autoInit);
  } else {
    autoInit();
  }
}

export default {
  init,
  open,
  close,
  toggle,
  destroy,
};

