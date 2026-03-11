import {
  MESSAGE_TIMESTAMPS_BRIDGE_SOURCE,
  type UserMessageSentBridgePayload
} from "../features/messageTimestamps.bridge";

declare global {
  interface Window {
    __qqrmConversationPageBridgeInstalled__?: boolean;
  }
}

const POST_CONVERSATION_RE = /\/backend-api\/(?:f\/)?conversation(?:\/|$)/i;

function toMessageSentPayload(
  body: unknown,
  sentAtMs: number
): UserMessageSentBridgePayload | null {
  if (!body || typeof body !== "object") return null;

  const raw = body as Record<string, unknown>;
  const messages = Array.isArray(raw.messages) ? raw.messages : [];
  const userMessage = messages.find((entry) => {
    if (!entry || typeof entry !== "object") return false;
    const candidate = entry as Record<string, unknown>;
    return (
      typeof candidate.id === "string" &&
      !!candidate.id &&
      typeof candidate.author === "object" &&
      candidate.author !== null &&
      (candidate.author as Record<string, unknown>).role === "user"
    );
  }) as Record<string, unknown> | undefined;

  if (!userMessage || typeof userMessage.id !== "string") return null;

  const createTimeRaw = userMessage.create_time;
  const createTimeMs =
    typeof createTimeRaw === "number" && Number.isFinite(createTimeRaw) && createTimeRaw > 0
      ? Math.round(createTimeRaw * 1000)
      : null;

  return {
    source: MESSAGE_TIMESTAMPS_BRIDGE_SOURCE,
    type: "user-message-sent",
    conversationId: typeof raw.conversation_id === "string" ? raw.conversation_id : null,
    messageId: userMessage.id,
    sentAtMs,
    createTimeMs
  };
}

function tryParseJson(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function install() {
  if (window.__qqrmConversationPageBridgeInstalled__) return;
  window.__qqrmConversationPageBridgeInstalled__ = true;

  const originalFetch = window.fetch.bind(window);

  window.fetch = async function patchedFetch(input: RequestInfo | URL, init?: RequestInit) {
    let request: Request | null = null;
    try {
      request = new Request(input, init);
    } catch {
      request = null;
    }

    if (
      request &&
      request.method.toUpperCase() === "POST" &&
      POST_CONVERSATION_RE.test(request.url)
    ) {
      const sentAtMs = Date.now();
      try {
        const text = await request.clone().text();
        const payload = toMessageSentPayload(tryParseJson(text), sentAtMs);
        if (payload) {
          window.postMessage(payload, location.origin);
        }
      } catch {
        // ignore malformed or unreadable request bodies
      }
    }

    return await originalFetch(input, init);
  };
}

install();
