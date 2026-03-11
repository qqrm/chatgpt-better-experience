import { isThenable } from "../lib/utils";

export type LocalStorageAreaLike = {
  get: (
    keys: Record<string, unknown>,
    cb: (res: Record<string, unknown>) => void
  ) => void | Promise<Record<string, unknown>>;
  set: (values: Record<string, unknown>, cb: () => void) => void | Promise<void>;
};

export interface MessageTimestampRecord {
  role: "user" | "assistant";
  sentAt?: number;
  completedAt?: number;
}

export interface ConversationTimestampRecord {
  updatedAt: number;
  messages: Record<string, MessageTimestampRecord>;
}

export interface TimestampSnapshot {
  conversations: Record<string, ConversationTimestampRecord>;
}

export interface TimestampRepository {
  getConversation: (conversationId: string) => Promise<ConversationTimestampRecord | null>;
  upsertMessage: (
    conversationId: string,
    messageId: string,
    patch: Partial<MessageTimestampRecord> & Pick<MessageTimestampRecord, "role">
  ) => Promise<MessageTimestampRecord>;
}

const STORAGE_KEY = "qqrmMessageTimestampsV1";
const DEFAULT_MAX_CONVERSATIONS = 100;
const DEFAULT_MAX_MESSAGES_PER_CONVERSATION = 50;

const EMPTY_SNAPSHOT: TimestampSnapshot = { conversations: {} };

function toError(err: unknown, fallback: string) {
  return err instanceof Error ? err : new Error(fallback);
}

function asEpochMs(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return undefined;
  return Math.round(value);
}

function normalizeMessageRecord(value: unknown): MessageTimestampRecord | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const role = raw.role === "user" || raw.role === "assistant" ? raw.role : null;
  if (!role) return null;

  const sentAt = asEpochMs(raw.sentAt);
  const completedAt = asEpochMs(raw.completedAt);

  return {
    role,
    ...(sentAt ? { sentAt } : {}),
    ...(completedAt ? { completedAt } : {})
  };
}

function normalizeConversationRecord(value: unknown): ConversationTimestampRecord | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const rawMessages = raw.messages;
  if (!rawMessages || typeof rawMessages !== "object") return null;

  const messages: Record<string, MessageTimestampRecord> = {};
  for (const [messageId, record] of Object.entries(rawMessages as Record<string, unknown>)) {
    const normalized = normalizeMessageRecord(record);
    if (normalized) messages[messageId] = normalized;
  }

  if (!Object.keys(messages).length) return null;

  return {
    updatedAt: asEpochMs(raw.updatedAt) ?? 0,
    messages
  };
}

function normalizeSnapshot(value: unknown): TimestampSnapshot {
  if (!value || typeof value !== "object") return { ...EMPTY_SNAPSHOT };

  const raw = value as Record<string, unknown>;
  const conversations: Record<string, ConversationTimestampRecord> = {};

  if (raw.conversations && typeof raw.conversations === "object") {
    for (const [conversationId, record] of Object.entries(
      raw.conversations as Record<string, unknown>
    )) {
      const normalized = normalizeConversationRecord(record);
      if (normalized) conversations[conversationId] = normalized;
    }
  }

  return { conversations };
}

function pruneSnapshot(
  snapshot: TimestampSnapshot,
  maxConversations: number,
  maxMessagesPerConversation: number
) {
  const conversations = Object.entries(snapshot.conversations)
    .sort(([, a], [, b]) => (b.updatedAt || 0) - (a.updatedAt || 0))
    .slice(0, Math.max(1, maxConversations));

  snapshot.conversations = Object.fromEntries(
    conversations.map(([conversationId, record]) => {
      const messages = Object.entries(record.messages)
        .sort(([, a], [, b]) => {
          const aTs = a.completedAt ?? a.sentAt ?? 0;
          const bTs = b.completedAt ?? b.sentAt ?? 0;
          return bTs - aTs;
        })
        .slice(0, Math.max(1, maxMessagesPerConversation));

      return [
        conversationId,
        {
          ...record,
          messages: Object.fromEntries(messages)
        } satisfies ConversationTimestampRecord
      ];
    })
  );
}

function storageGet(
  defaults: Record<string, unknown>,
  localArea: LocalStorageAreaLike | null | undefined
): Promise<Record<string, unknown>> {
  if (!localArea) return Promise.resolve({ ...defaults });

  return new Promise((resolve, reject) => {
    try {
      const result = localArea.get(defaults, (res) => resolve(res || { ...defaults }));
      if (isThenable(result)) result.then(resolve, reject);
    } catch (err) {
      reject(toError(err, "Local storage get failed"));
    }
  });
}

function storageSet(
  values: Record<string, unknown>,
  localArea: LocalStorageAreaLike | null | undefined
): Promise<void> {
  if (!localArea) return Promise.resolve();

  return new Promise((resolve, reject) => {
    try {
      const result = localArea.set(values, () => resolve());
      if (isThenable(result)) result.then(() => resolve(), reject);
    } catch (err) {
      reject(toError(err, "Local storage set failed"));
    }
  });
}

export function createMessageTimestampRepository({
  localArea,
  now = () => Date.now(),
  maxConversations = DEFAULT_MAX_CONVERSATIONS,
  maxMessagesPerConversation = DEFAULT_MAX_MESSAGES_PER_CONVERSATION
}: {
  localArea?: LocalStorageAreaLike | null;
  now?: () => number;
  maxConversations?: number;
  maxMessagesPerConversation?: number;
}): TimestampRepository {
  let loadPromise: Promise<TimestampSnapshot> | null = null;
  let saveQueue: Promise<void> = Promise.resolve();
  let cache: TimestampSnapshot = { ...EMPTY_SNAPSHOT };

  const ensureLoaded = async () => {
    if (!loadPromise) {
      loadPromise = storageGet({ [STORAGE_KEY]: EMPTY_SNAPSHOT }, localArea).then((data) => {
        cache = normalizeSnapshot(data[STORAGE_KEY]);
        return cache;
      });
    }
    return await loadPromise;
  };

  const persist = async () => {
    pruneSnapshot(cache, maxConversations, maxMessagesPerConversation);
    saveQueue = saveQueue.then(() => storageSet({ [STORAGE_KEY]: cache }, localArea));
    await saveQueue;
  };

  return {
    getConversation: async (conversationId) => {
      const snapshot = await ensureLoaded();
      return snapshot.conversations[conversationId] ?? null;
    },

    upsertMessage: async (conversationId, messageId, patch) => {
      const snapshot = await ensureLoaded();
      const conversation = snapshot.conversations[conversationId] ?? {
        updatedAt: 0,
        messages: {}
      };
      const previous = conversation.messages[messageId];
      const next: MessageTimestampRecord = {
        ...(previous ?? {}),
        ...patch,
        role: patch.role ?? previous?.role ?? "assistant"
      };
      conversation.updatedAt = now();
      conversation.messages[messageId] = next;
      snapshot.conversations[conversationId] = conversation;
      await persist();
      return next;
    }
  };
}
