/**
 * packages/widget/src/api-client.js
 * ==========================================================
 * Network client for public chatbot widget.
 * Communicates with /api/v1/public endpoints with SSE streaming.
 */

export async function fetchBotConfig(apiHost, publicId) {
  const base = apiHost ? apiHost.replace(/\/+$/, "") : "";
  const url = `${base}/api/v1/public/chatbots/${encodeURIComponent(publicId)}/config`;

  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData?.error?.message || `HTTP ${res.status}: Failed to load chatbot config`);
    }

    const json = await res.json();
    return json.data || json;
  } catch (err) {
    console.warn("[RagMcpWidget] Could not fetch bot config from server:", err.message);
    return null;
  }
}

export async function streamPublicChat({
  apiHost,
  publicId,
  message,
  conversationId,
  onToken,
  onCitation,
  onDone,
  onError,
}) {
  const base = apiHost ? apiHost.replace(/\/+$/, "") : "";
  const url = `${base}/api/v1/public/chatbots/${encodeURIComponent(publicId)}/chat`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify({
        message,
        ...(conversationId ? { conversationId } : {}),
      }),
    });

    if (!response.ok) {
      const errJson = await response.json().catch(() => null);
      const errorMsg =
        errJson?.error?.message ||
        `Request failed with status ${response.status} (${response.statusText})`;
      if (onError) onError(new Error(errorMsg));
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split("\n\n");
      buffer = events.pop() || "";

      for (const eventStr of events) {
        if (!eventStr.trim()) continue;

        let eventType = "message";
        let dataStr = "";

        const lines = eventStr.split("\n");
        for (const line of lines) {
          if (line.startsWith("event:")) {
            eventType = line.slice(6).trim();
          } else if (line.startsWith("data:")) {
            dataStr = line.slice(5).trim();
          }
        }

        if (eventType === "error") {
          let errPayload = {};
          try {
            errPayload = JSON.parse(dataStr);
          } catch {}
          if (onError) onError(new Error(errPayload.message || "Public chat error"));
          return;
        }

        if (eventType === "token") {
          try {
            const parsed = JSON.parse(dataStr);
            const delta = parsed.delta || parsed.token || "";
            if (delta && onToken) onToken(delta);
          } catch {}
        } else if (eventType === "citation") {
          try {
            const parsed = JSON.parse(dataStr);
            if (onCitation) onCitation(parsed);
          } catch {}
        } else if (eventType === "done") {
          try {
            const parsed = JSON.parse(dataStr);
            if (onDone) onDone(parsed);
          } catch {
            if (onDone) onDone({});
          }
        }
      }
    }

    if (onDone) onDone({});
  } catch (err) {
    if (onError) onError(err);
  }
}

