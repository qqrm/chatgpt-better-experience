import { FeatureContext, FeatureHandle } from "../application/featureContext";
import type { DomDelta } from "../application/domEventBus";
import {
  collectMessageElementsFromNode,
  findMainComposerForm,
  findMainSendButton,
  findMainRoot,
  findMessageTurn,
  findUserMessageBubble,
  getMessageRole,
  readConversationStorageKey
} from "./chatgptConversation";
import {
  createMessageTimestampRepository,
  type LocalStorageAreaLike,
  type MessageTimestampRecord
} from "./messageTimestamps.repo";

const STYLE_ID = "qqrm-message-timestamps-style";
const USER_BUBBLE_ATTR = "data-qqrm-message-time-bubble";
const TIMESTAMP_ATTR = "data-qqrm-message-time";
const ASSISTANT_TIMESTAMP_ATTR = "data-qqrm-message-time-role";
const ASSISTANT_COMPLETION_QUIET_MS = 1500;
const USER_SEND_CAPTURE_DEDUPE_MS = 750;
const MAX_PENDING_USER_SENDS = 12;

type AssistantTracker = {
  messageId: string;
  conversationId: string;
  root: HTMLElement;
  observer: MutationObserver;
  quietTimerId: number | null;
};

type ExtensionLike = {
  storage?: {
    local?: LocalStorageAreaLike;
  };
};

const extensionApi =
  (globalThis as typeof globalThis & { browser?: ExtensionLike; chrome?: ExtensionLike }).browser ??
  (globalThis as typeof globalThis & { browser?: ExtensionLike; chrome?: ExtensionLike }).chrome;

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

function formatTimestamp(ms: number, nowMs = Date.now()) {
  const value = new Date(ms);
  const now = new Date(nowMs);
  const sameDay =
    value.getFullYear() === now.getFullYear() &&
    value.getMonth() === now.getMonth() &&
    value.getDate() === now.getDate();
  const sameYear = value.getFullYear() === now.getFullYear();
  const hhmm = `${pad2(value.getHours())}:${pad2(value.getMinutes())}`;

  if (sameDay) return hhmm;
  if (sameYear) return `${pad2(value.getDate())}.${pad2(value.getMonth() + 1)} ${hhmm}`;
  return `${pad2(value.getDate())}.${pad2(value.getMonth() + 1)}.${value.getFullYear()} ${hhmm}`;
}

function ensureStyle() {
  let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (style) return style;

  style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    [${USER_BUBBLE_ATTR}] {
      padding-bottom: 1.15rem !important;
    }

    [${TIMESTAMP_ATTR}] {
      color: color-mix(in srgb, currentColor 58%, transparent);
      font-size: 11px;
      line-height: 1;
      user-select: none;
      font-variant-numeric: tabular-nums;
      letter-spacing: 0.01em;
    }

    [${TIMESTAMP_ATTR}][data-qqrm-message-time-variant="user"] {
      position: absolute;
      inset-inline-end: 0.85rem;
      bottom: 0.45rem;
      opacity: 0.82;
      pointer-events: none;
    }

    [${TIMESTAMP_ATTR}][data-qqrm-message-time-variant="assistant"] {
      align-self: flex-end;
      margin-top: 0.1rem;
      opacity: 0.72;
    }
  `;

  (document.head ?? document.documentElement)?.appendChild(style);
  return style;
}

function removeAllRenderedTimestamps() {
  for (const el of Array.from(document.querySelectorAll<HTMLElement>(`[${TIMESTAMP_ATTR}]`))) {
    el.remove();
  }
  for (const bubble of Array.from(
    document.querySelectorAll<HTMLElement>(`[${USER_BUBBLE_ATTR}]`)
  )) {
    bubble.removeAttribute(USER_BUBBLE_ATTR);
  }
}

export function initMessageTimestampsFeature(ctx: FeatureContext): FeatureHandle {
  const repo = createMessageTimestampRepository({
    localArea: extensionApi?.storage?.local ?? null
  });

  const state = {
    started: false,
    currentConversationKey: readConversationStorageKey(),
    currentRecords: new Map<string, MessageTimestampRecord>(),
    pendingUserSends: [] as Array<{ conversationKey: string; sentAt: number }>,
    lastUserSendCaptureAt: 0,
    expectedAssistantCounts: new Map<string, number>(),
    assistantTrackers: new Map<string, AssistantTracker>(),
    unsubMainDelta: null as (() => void) | null,
    unsubRoots: null as (() => void) | null,
    unsubPath: null as (() => void) | null
  };

  const setCurrentRecord = (
    conversationKey: string,
    messageId: string,
    record: MessageTimestampRecord
  ) => {
    if (conversationKey !== state.currentConversationKey) return;
    state.currentRecords.set(messageId, record);
  };

  const incrementExpectedAssistant = (conversationId: string) => {
    state.expectedAssistantCounts.set(
      conversationId,
      (state.expectedAssistantCounts.get(conversationId) ?? 0) + 1
    );
  };

  const capturePendingUserSend = (sentAt = Date.now()) => {
    if (sentAt - state.lastUserSendCaptureAt < USER_SEND_CAPTURE_DEDUPE_MS) return;
    state.lastUserSendCaptureAt = sentAt;
    state.pendingUserSends.push({
      conversationKey: state.currentConversationKey ?? readConversationStorageKey(),
      sentAt
    });
    if (state.pendingUserSends.length > MAX_PENDING_USER_SENDS) {
      state.pendingUserSends.splice(0, state.pendingUserSends.length - MAX_PENDING_USER_SENDS);
    }
  };

  const takePendingUserSend = (conversationKey: string) => {
    const matchIndex = state.pendingUserSends.findIndex((entry) => {
      return entry.conversationKey === conversationKey;
    });
    if (matchIndex < 0) return null;
    const [pending] = state.pendingUserSends.splice(matchIndex, 1);
    return pending ?? null;
  };

  const consumeExpectedAssistant = (conversationId: string) => {
    const count = state.expectedAssistantCounts.get(conversationId) ?? 0;
    if (count <= 0) return false;
    if (count === 1) state.expectedAssistantCounts.delete(conversationId);
    else state.expectedAssistantCounts.set(conversationId, count - 1);
    return true;
  };

  const loadCurrentConversation = async () => {
    const conversationKey = readConversationStorageKey();
    const previousConversationKey = state.currentConversationKey;
    const localRecords = new Map(state.currentRecords);
    state.currentConversationKey = conversationKey;
    state.currentRecords.clear();

    const conversation = await repo.getConversation(conversationKey);
    if (state.currentConversationKey !== conversationKey) return;

    for (const [messageId, record] of Object.entries(conversation?.messages ?? {})) {
      state.currentRecords.set(messageId, record);
    }

    if (conversationKey === previousConversationKey) {
      for (const [messageId, record] of localRecords) {
        state.currentRecords.set(messageId, record);
      }
    }

    renderCurrentConversation();
    void adoptPendingUserMessages(conversationKey);
  };

  const persistRecord = async (
    conversationKey: string,
    messageId: string,
    patch: Partial<MessageTimestampRecord> & Pick<MessageTimestampRecord, "role">
  ) => {
    const next = await repo.upsertMessage(conversationKey, messageId, patch);
    setCurrentRecord(conversationKey, messageId, next);

    if (conversationKey === state.currentConversationKey) {
      const messageEl = document.querySelector<HTMLElement>(`[data-message-id="${messageId}"]`);
      if (messageEl) renderMessage(messageEl);
    }
  };

  const renderUserTimestamp = (messageEl: HTMLElement, text: string, title: string) => {
    const bubble = findUserMessageBubble(messageEl);
    if (!bubble) return;

    bubble.setAttribute(USER_BUBBLE_ATTR, "1");

    let stamp = bubble.querySelector<HTMLElement>(`[${TIMESTAMP_ATTR}]`);
    if (!stamp) {
      stamp = document.createElement("span");
      stamp.setAttribute(TIMESTAMP_ATTR, "1");
      stamp.setAttribute("data-qqrm-message-time-variant", "user");
      bubble.appendChild(stamp);
    }

    stamp.textContent = text;
    stamp.title = title;
  };

  const renderAssistantTimestamp = (messageEl: HTMLElement, text: string, title: string) => {
    let stamp = messageEl.querySelector<HTMLElement>(
      `[${TIMESTAMP_ATTR}][${ASSISTANT_TIMESTAMP_ATTR}="assistant"]`
    );
    if (!stamp) {
      stamp = document.createElement("div");
      stamp.setAttribute(TIMESTAMP_ATTR, "1");
      stamp.setAttribute(ASSISTANT_TIMESTAMP_ATTR, "assistant");
      stamp.setAttribute("data-qqrm-message-time-variant", "assistant");
      messageEl.appendChild(stamp);
    }

    stamp.textContent = text;
    stamp.title = title;
  };

  const removeRenderedTimestamp = (messageEl: HTMLElement) => {
    const bubble = findUserMessageBubble(messageEl);
    bubble?.removeAttribute(USER_BUBBLE_ATTR);
    bubble?.querySelector<HTMLElement>(`[${TIMESTAMP_ATTR}]`)?.remove();
    messageEl
      .querySelector<HTMLElement>(`[${TIMESTAMP_ATTR}][${ASSISTANT_TIMESTAMP_ATTR}="assistant"]`)
      ?.remove();
  };

  const renderMessage = (messageEl: HTMLElement) => {
    if (!ctx.settings.showMessageTimestamps) {
      removeRenderedTimestamp(messageEl);
      return;
    }

    const messageId = messageEl.getAttribute("data-message-id");
    const role = getMessageRole(messageEl);
    if (!messageId || !role) return;

    const record = state.currentRecords.get(messageId);
    const timestampMs = role === "user" ? record?.sentAt : record?.completedAt;
    if (!timestampMs) {
      removeRenderedTimestamp(messageEl);
      return;
    }

    const text = formatTimestamp(timestampMs);
    const title = new Date(timestampMs).toLocaleString();

    if (role === "user") {
      renderUserTimestamp(messageEl, text, title);
      return;
    }

    renderAssistantTimestamp(messageEl, text, title);
  };

  const renderCurrentConversation = () => {
    ensureStyle();
    const root = findMainRoot() ?? document;
    const messages = root.querySelectorAll<HTMLElement>(
      "[data-message-id][data-message-author-role]"
    );
    for (const messageEl of Array.from(messages)) renderMessage(messageEl);
  };

  const stopAssistantTracker = (messageId: string) => {
    const tracker = state.assistantTrackers.get(messageId);
    if (!tracker) return;
    if (tracker.quietTimerId !== null) {
      window.clearTimeout(tracker.quietTimerId);
    }
    tracker.observer.disconnect();
    state.assistantTrackers.delete(messageId);
  };

  const stopAllAssistantTrackers = () => {
    for (const messageId of Array.from(state.assistantTrackers.keys())) {
      stopAssistantTracker(messageId);
    }
  };

  const finalizeAssistantTracker = (messageId: string) => {
    const tracker = state.assistantTrackers.get(messageId);
    if (!tracker) return;
    stopAssistantTracker(messageId);
    const nowMs = Date.now();
    const previous = state.currentRecords.get(messageId);
    const next: MessageTimestampRecord = {
      ...(previous ?? { role: "assistant" as const }),
      role: "assistant",
      completedAt: nowMs
    };
    setCurrentRecord(tracker.conversationId, messageId, next);
    const messageEl = document.querySelector<HTMLElement>(`[data-message-id="${messageId}"]`);
    if (messageEl) renderMessage(messageEl);
    void persistRecord(tracker.conversationId, messageId, {
      role: "assistant",
      completedAt: nowMs
    });
  };

  const scheduleAssistantFinalize = (messageId: string) => {
    const tracker = state.assistantTrackers.get(messageId);
    if (!tracker) return;
    if (tracker.quietTimerId !== null) {
      window.clearTimeout(tracker.quietTimerId);
    }
    tracker.quietTimerId = window.setTimeout(() => {
      finalizeAssistantTracker(messageId);
    }, ASSISTANT_COMPLETION_QUIET_MS);
  };

  const trackAssistantMessage = (messageEl: HTMLElement) => {
    const conversationKey = state.currentConversationKey;
    const messageId = messageEl.getAttribute("data-message-id");
    if (!messageId) return;
    if (state.assistantTrackers.has(messageId)) return;
    if (state.currentRecords.get(messageId)?.completedAt) return;
    if (!consumeExpectedAssistant(conversationKey)) return;

    const root = findMessageTurn(messageEl) ?? messageEl;
    const observer = new MutationObserver(() => {
      scheduleAssistantFinalize(messageId);
    });

    observer.observe(root, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true
    });

    state.assistantTrackers.set(messageId, {
      messageId,
      conversationId: conversationKey,
      root,
      observer,
      quietTimerId: null
    });

    scheduleAssistantFinalize(messageId);
  };

  const adoptPendingUserMessages = async (conversationKey: string) => {
    const root = findMainRoot() ?? document;
    const userMessages = root.querySelectorAll<HTMLElement>(
      '[data-message-author-role="user"][data-message-id]'
    );
    for (const messageEl of Array.from(userMessages)) {
      const messageId = messageEl.getAttribute("data-message-id");
      if (!messageId) continue;
      if (state.currentRecords.get(messageId)?.sentAt) continue;
      const pending = takePendingUserSend(conversationKey);
      if (!pending) continue;
      incrementExpectedAssistant(conversationKey);
      const record: MessageTimestampRecord = { role: "user", sentAt: pending.sentAt };
      setCurrentRecord(conversationKey, messageId, record);
      renderMessage(messageEl);
      await persistRecord(conversationKey, messageId, record);
    }
  };

  const handleMainDelta = (delta: DomDelta) => {
    const addedMessages = new Map<string, HTMLElement>();

    for (const node of delta.added) {
      for (const messageEl of collectMessageElementsFromNode(node)) {
        const messageId = messageEl.getAttribute("data-message-id");
        if (!messageId) continue;
        addedMessages.set(messageId, messageEl);
      }
    }

    for (const messageEl of addedMessages.values()) {
      const role = getMessageRole(messageEl);
      if (!role) continue;
      renderMessage(messageEl);

      if (role === "user") {
        void adoptPendingUserMessages(state.currentConversationKey);
        continue;
      }

      trackAssistantMessage(messageEl);
    }
  };

  const handleSubmitCapture = (event: Event) => {
    const form = findMainComposerForm();
    if (!form) return;
    if (event.target !== form) return;
    capturePendingUserSend();
  };

  const handleClickCapture = (event: Event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const button = target.closest<HTMLElement>("button, [role='button']");
    if (!button) return;
    const sendButton = findMainSendButton();
    if (!sendButton || button !== sendButton) return;
    capturePendingUserSend();
  };

  const start = () => {
    if (state.started) return;
    state.started = true;
    ensureStyle();
    window.addEventListener("submit", handleSubmitCapture, true);
    window.addEventListener("click", handleClickCapture, true);

    state.unsubPath = ctx.helpers.onPathChange(() => {
      stopAllAssistantTrackers();
      void loadCurrentConversation();
    });

    state.unsubRoots =
      ctx.domBus?.onRoots(() => {
        renderCurrentConversation();
      }) ?? null;

    state.unsubMainDelta =
      ctx.domBus?.onDelta("main", (delta) => {
        if (delta.reason === "initial" || delta.reason === "route") {
          renderCurrentConversation();
          return;
        }
        handleMainDelta(delta);
      }) ?? null;

    void loadCurrentConversation();
  };

  const stop = () => {
    if (!state.started) return;
    state.started = false;
    state.unsubMainDelta?.();
    state.unsubMainDelta = null;
    state.unsubRoots?.();
    state.unsubRoots = null;
    state.unsubPath?.();
    state.unsubPath = null;
    stopAllAssistantTrackers();
    window.removeEventListener("submit", handleSubmitCapture, true);
    window.removeEventListener("click", handleClickCapture, true);

    removeAllRenderedTimestamps();
    document.getElementById(STYLE_ID)?.remove();
  };

  if (ctx.settings.showMessageTimestamps) start();

  return {
    name: "messageTimestamps",
    dispose: () => stop(),
    onSettingsChange: (next, prev) => {
      if (next.showMessageTimestamps === prev.showMessageTimestamps) return;
      if (next.showMessageTimestamps) start();
      else stop();
    },
    getStatus: () => ({ active: ctx.settings.showMessageTimestamps })
  };
}
