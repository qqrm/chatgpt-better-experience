import type { MessageTimestampRecord } from "./messageTimestamps.repo";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function asEpochMs(value: unknown): number | undefined {
  const numeric =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : Number.NaN;
  if (!Number.isFinite(numeric) || numeric <= 0) return undefined;
  return Math.round(numeric < 1_000_000_000_000 ? numeric * 1000 : numeric);
}

function firstTimestamp(...values: unknown[]) {
  for (const value of values) {
    const timestamp = asEpochMs(value);
    if (timestamp) return timestamp;
  }
  return undefined;
}

function readAssistantCompletedAt(
  message: Record<string, unknown>,
  node: Record<string, unknown>
): number | undefined {
  const metadata = asRecord(message.metadata);
  return firstTimestamp(
    message.update_time,
    node.update_time,
    metadata?.finished_at,
    metadata?.finish_time,
    metadata?.completed_at,
    metadata?.timestamp_,
    message.create_time,
    node.create_time
  );
}

export async function getAccessToken(): Promise<string | null> {
  try {
    const response = await fetch("/api/auth/session?unstable_client=true", {
      credentials: "include"
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { accessToken?: unknown };
    return typeof data.accessToken === "string" ? data.accessToken : null;
  } catch {
    return null;
  }
}

export async function buildChatGptAuthHeaders({
  includeJsonContentType = false
}: {
  includeJsonContentType?: boolean;
} = {}): Promise<Record<string, string> | null> {
  const token = await getAccessToken();
  if (!token) return null;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`
  };

  if (includeJsonContentType) {
    headers["Content-Type"] = "application/json";
  }

  const deviceId = localStorage.getItem("oai-device-id");
  if (deviceId) headers["oai-device-id"] = deviceId;

  return headers;
}

export function extractConversationTimestampRecords(
  payload: unknown
): Record<string, MessageTimestampRecord> {
  const root = asRecord(payload);
  const mapping = asRecord(root?.mapping);
  if (!mapping) return {};

  const records: Record<string, MessageTimestampRecord> = {};

  for (const node of Object.values(mapping)) {
    const nodeRecord = asRecord(node);
    const message = asRecord(nodeRecord?.message);
    const author = asRecord(message?.author);
    const role = author?.role === "user" || author?.role === "assistant" ? author.role : null;
    const messageId = typeof message?.id === "string" ? message.id : null;
    if (!role || !messageId || !message || !nodeRecord) continue;

    if (role === "user") {
      const sentAt = firstTimestamp(message.create_time, nodeRecord?.create_time);
      if (!sentAt) continue;
      records[messageId] = { role, sentAt };
      continue;
    }

    const completedAt = readAssistantCompletedAt(message, nodeRecord);
    if (!completedAt) continue;
    records[messageId] = { role, completedAt };
  }

  return records;
}

export async function fetchConversationTimestampRecords(
  conversationId: string
): Promise<Record<string, MessageTimestampRecord> | null> {
  try {
    const headers = await buildChatGptAuthHeaders();
    if (!headers) return null;

    const response = await fetch(`/backend-api/conversation/${conversationId}`, {
      credentials: "include",
      headers
    });

    if (!response.ok) return null;
    return extractConversationTimestampRecords(await response.json());
  } catch {
    return null;
  }
}
