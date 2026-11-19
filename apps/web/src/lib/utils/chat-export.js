/**
 * Exports a chat conversation as Markdown or JSON file.
 *
 * @param {object} options
 * @param {string} options.title - Conversation title
 * @param {Array<object>} options.messages - Array of chat messages
 * @param {string} [options.provider] - LLM provider name
 * @param {string} [options.model] - LLM model name
 * @param {"markdown" | "json"} options.format - Target export format
 */
export function exportChat({
  title = "Conversation",
  messages = [],
  provider = "AI",
  model = "Standard",
  format = "markdown",
}) {
  if (!messages || messages.length === 0) return;

  const dateStr = new Date().toISOString().split("T")[0];
  const cleanTitle = (title || "conversation")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const filename = `${cleanTitle || "chat"}-${dateStr}.${format === "json" ? "json" : "md"}`;

  let content = "";
  let mimeType = "text/markdown;charset=utf-8;";

  if (format === "json") {
    mimeType = "application/json;charset=utf-8;";
    const exportData = {
      title,
      exportedAt: new Date().toISOString(),
      provider,
      model,
      messageCount: messages.length,
      messages: messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        sources: m.sources || [],
      })),
    };
    content = JSON.stringify(exportData, null, 2);
  } else {
    // Markdown format
    const lines = [
      `# ${title || "Chat Export"}`,
      ``,
      `*Exported on ${new Date().toLocaleString()} • Model: ${model} (${provider})*`,
      ``,
      `---`,
      ``,
    ];

    messages.forEach((m, idx) => {
      const isUser = m.role === "user";
      const sender = isUser ? "### 👤 User" : `### 🤖 Assistant (${model})`;
      lines.push(sender);
      lines.push(``);
      lines.push(m.content || "");
      lines.push(``);

      if (m.sources && m.sources.length > 0) {
        lines.push(`**Sources Cited:**`);
        m.sources.forEach((s, sIdx) => {
          const score = s.score ? ` (${Math.round(s.score * 100)}% match)` : "";
          if (s.url) {
            lines.push(`- [${sIdx + 1}] [${s.title || s.url}](${s.url})${score}`);
          } else {
            lines.push(`- [${sIdx + 1}] ${s.title || "Reference source"}${score}`);
          }
        });
        lines.push(``);
      }

      lines.push(`---`);
      lines.push(``);
    });

    content = lines.join("\n");
  }

  // Trigger browser download
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

