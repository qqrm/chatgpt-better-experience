import { FeatureContext, FeatureHandle } from "../application/featureContext";
import type { DomDelta } from "../application/domEventBus";
import { fetchConversationTimestampRecords } from "./chatgptApi";
import {
  collectMessageElementsFromNode,
  findConversationScrollRoot,
  findMainComposerForm,
  findMainRoot,
  findMainSendButton,
  findMessageTurn,
  findUserMessageBubble,
  getMessageRole,
  readConversationStorageKey,
  readCurrentConversationId
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
const API_SYNC_DEBOUNCE_MS = 400;
const ASSISTANT_COMPLETION_QUIET_MS = 1500;
const USER_SEND_CAPTURE_DEDUPE_MS = 750;
const MAX_PENDING_USER_SENDS = 12;
const VIEWPORT_STICK_BOTTOM_THRESHOLD_PX = 96;

type AssistantTracker = {
  messageId: string;
  conversationKey: string;
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
  (
    globalThis as typeof globalThis & {
      browser?: ExtensionLike;
      chrome?: ExtensionLike;
    }
  ).browser ??
  (
    globalThis as typeof globalThis & {
      browser?: ExtensionLike;
      chrome?: ExtensionLike;
    }
  ).chrome;

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

function mergeMessageRecord(
  previous: MessageTimestampRecord | undefined,
  patch: Partial<MessageTimestampRecord> & Pick<MessageTimestampRecord, "role">
): MessageTimestampRecord {
  const next: MessageTimestampRecord = {
    ...(previous ?? {}),
    role: patch.role ?? previous?.role ?? "assistant"
  };

  if (patch.sentAt !== undefined) next.sentAt = patch.sentAt;
  if (patch.completedAt !== undefined) next.completedAt = patch.completedAt;

  return next;
}

function recordsEqual(
  left: MessageTimestampRecord | undefined,
  right: MessageTimestampRecord | undefined
) {
  if (!left && !right) return true;
  if (!left || !right) return false;
  return (
    left.role === right.role &&
    left.sentAt === right.sentAt &&
    left.completedAt === right.completedAt
  );
}

export function initMessageTimestampsFeature(ctx: FeatureContext): FeatureHandle {
  const repo = createMessageTimestampRepository({
    localArea: extensionApi?.storage?.local ?? null
  });

  const state = {
    started: false,
    currentConversationId: readCurrentConversationId(),
    currentConversationKey: readConversationStorageKey(),
    currentRecords: new Map<string, MessageTimestampRecord>(),
    pendingUserSends: [] as Array<{ conversationKey: string; sentAt: number }>,
    lastUserSendCaptureAt: 0,
    assistantTrackers: new Map<string, AssistantTracker>(),
    apiSyncVersion: 0,
    apiSyncScheduler: null as {
      schedule: () => void;
      cancel: () => void;
    } | null,
    unsubMainDelta: null as (() => void) | null,
    unsubRoots: null as (() => void) | null,
    unsubPath: null as (() => void) | null
  };

  const trace = (
    scope: string,
    message: string,
    fields?: Record<string, unknown>,
    level: "log" | "info" | "warn" | "error" = "log"
  ) => {
    ctx.logger.trace(
      "timestamps",
      scope,
      message,
      {
        path: location.pathname,
        conversationId: state.currentConversationId ?? "",
        conversationKey: state.currentConversationKey,
        ...(fields ?? {})
      },
      level
    );
  };

  const recordSummary = (record: MessageTimestampRecord | undefined) => ({
    recordRole: record?.role ?? "",
    sentAt: record?.sentAt ?? 0,
    completedAt: record?.completedAt ?? 0
  });

  const readConversationScope = () => ({
    conversationId: readCurrentConversationId(),
    conversationKey: readConversationStorageKey()
  });

  const removeRenderedTimestamp = (messageEl: HTMLElement) => {
    preserveViewportNearBottom(() => {
      const bubble = findUserMessageBubble(messageEl);
      bubble?.removeAttribute(USER_BUBBLE_ATTR);
      bubble?.querySelector<HTMLElement>(`[${TIMESTAMP_ATTR}]`)?.remove();
      messageEl
        .querySelector<HTMLElement>(`[${TIMESTAMP_ATTR}][${ASSISTANT_TIMESTAMP_ATTR}="assistant"]`)
        ?.remove();
    });
  };

  const preserveViewportNearBottom = <T>(mutate: () => T): T => {
    const root = findConversationScrollRoot();
    if (!root) return mutate();

    const distanceFromBottom = Math.max(0, root.scrollHeight - root.clientHeight - root.scrollTop);
    const shouldStickToBottom = distanceFromBottom <= VIEWPORT_STICK_BOTTOM_THRESHOLD_PX;
    const result = mutate();

    if (shouldStickToBottom && root.isConnected) {
      root.scrollTop = Math.max(0, root.scrollHeight - root.clientHeight - distanceFromBottom);
    }

    return result;
  };

  const syncStampContent = (stamp: HTMLElement, text: string, title: string) => {
    if (stamp.textContent !== text) {
      stamp.textContent = text;
    }
    if (stamp.title !== title) {
      stamp.title = title;
    }
  };

  const renderUserTimestamp = (messageEl: HTMLElement, text: string, title: string) => {
    const bubble = findUserMessageBubble(messageEl);
    const messageId = messageEl.getAttribute("data-message-id") ?? "";
    if (!bubble) {
      trace("TS/RENDER", "user bubble not found", { messageId }, "warn");
      return;
    }

    preserveViewportNearBottom(() => {
      if (!bubble.hasAttribute(USER_BUBBLE_ATTR)) {
        bubble.setAttribute(USER_BUBBLE_ATTR, "1");
      }

      let stamp = bubble.querySelector<HTMLElement>(`[${TIMESTAMP_ATTR}]`);
      if (!stamp) {
        stamp = document.createElement("span");
        stamp.setAttribute(TIMESTAMP_ATTR, "1");
        stamp.setAttribute("data-qqrm-message-time-variant", "user");
        bubble.appendChild(stamp);
      }

      syncStampContent(stamp, text, title);
    });
    trace("TS/RENDER", "rendered user timestamp", { messageId, text, title });
  };

  const renderAssistantTimestamp = (messageEl: HTMLElement, text: string, title: string) => {
    const messageId = messageEl.getAttribute("data-message-id") ?? "";
    preserveViewportNearBottom(() => {
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

      syncStampContent(stamp, text, title);
    });
    trace("TS/RENDER", "rendered assistant timestamp", { messageId, text, title });
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
      trace("TS/RENDER", "skip render: missing timestamp", {
        messageId,
        role,
        ...recordSummary(record)
      });
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
    trace("TS/RENDER", "render current conversation", {
      messageCount: messages.length,
      recordCount: state.currentRecords.size
    });
    for (const messageEl of Array.from(messages)) renderMessage(messageEl);
  };

  const applyCurrentRecordPatch = (
    conversationKey: string,
    messageId: string,
    patch: Partial<MessageTimestampRecord> & Pick<MessageTimestampRecord, "role">
  ) => {
    if (conversationKey !== state.currentConversationKey) return false;

    const previous = state.currentRecords.get(messageId);
    const next = mergeMessageRecord(previous, patch);
    if (recordsEqual(previous, next)) return false;

    state.currentRecords.set(messageId, next);
    trace("TS/STATE", "record patch applied", {
      messageId,
      role: next.role,
      previousSentAt: previous?.sentAt ?? 0,
      previousCompletedAt: previous?.completedAt ?? 0,
      nextSentAt: next.sentAt ?? 0,
      nextCompletedAt: next.completedAt ?? 0
    });
    return true;
  };

  const renderMessageById = (messageId: string) => {
    const messageEl = document.querySelector<HTMLElement>(`[data-message-id="${messageId}"]`);
    if (messageEl) renderMessage(messageEl);
  };

  const persistRecordPatch = async (
    conversationKey: string,
    messageId: string,
    patch: Partial<MessageTimestampRecord> & Pick<MessageTimestampRecord, "role">
  ) => {
    trace("TS/STORE", "persist record patch", {
      messageId,
      role: patch.role,
      sentAt: patch.sentAt ?? 0,
      completedAt: patch.completedAt ?? 0
    });
    const next = await repo.upsertMessage(conversationKey, messageId, patch);
    if (conversationKey !== state.currentConversationKey) return;
    state.currentRecords.set(messageId, next);
    renderMessageById(messageId);
    trace("TS/STORE", "persist record patch complete", {
      messageId,
      role: next.role,
      ...recordSummary(next)
    });
  };

  const syncCurrentConversationFromApi = async () => {
    const conversationId = state.currentConversationId;
    const conversationKey = state.currentConversationKey;
    if (!conversationId) return;

    const version = ++state.apiSyncVersion;
    trace("TS/API", "sync conversation from api start", { version });
    const records = await fetchConversationTimestampRecords(
      conversationId,
      (message, fields, level) => trace("TS/API", message, fields, level)
    );
    if (!records) {
      trace("TS/API", "sync conversation from api returned no records", { version }, "warn");
      return;
    }
    if (
      version !== state.apiSyncVersion ||
      state.currentConversationId !== conversationId ||
      state.currentConversationKey !== conversationKey
    ) {
      trace("TS/API", "discarded stale api sync result", { version }, "warn");
      return;
    }

    let changedCount = 0;
    for (const [messageId, record] of Object.entries(records)) {
      const changed = applyCurrentRecordPatch(conversationKey, messageId, record);
      if (changed) {
        changedCount += 1;
        renderMessageById(messageId);
        void persistRecordPatch(conversationKey, messageId, record);
      }
    }
    trace("TS/API", "sync conversation from api complete", {
      version,
      apiRecordCount: Object.keys(records).length,
      changedCount
    });
  };

  const scheduleApiSync = () => {
    if (!state.currentConversationId) return;
    trace("TS/API", "schedule api sync", {
      pendingConversationId: state.currentConversationId
    });
    state.apiSyncScheduler?.schedule();
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

    const completedAt = Date.now();
    trace("TS/ASSISTANT", "finalize assistant tracker", {
      messageId,
      completedAt
    });
    const changed = applyCurrentRecordPatch(tracker.conversationKey, messageId, {
      role: "assistant",
      completedAt
    });
    if (changed) renderMessageById(messageId);

    void persistRecordPatch(tracker.conversationKey, messageId, {
      role: "assistant",
      completedAt
    });
    scheduleApiSync();
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
    trace("TS/ASSISTANT", "schedule assistant finalize", {
      messageId,
      quietMs: ASSISTANT_COMPLETION_QUIET_MS
    });
  };

  const trackAssistantMessage = (messageEl: HTMLElement) => {
    const conversationKey = state.currentConversationKey;
    const messageId = messageEl.getAttribute("data-message-id");
    if (!messageId) return;
    if (state.assistantTrackers.has(messageId)) return;
    if (state.currentRecords.get(messageId)?.completedAt) return;
    trace("TS/ASSISTANT", "start assistant tracker", {
      messageId,
      hasCompletedAt: !!state.currentRecords.get(messageId)?.completedAt
    });

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
      conversationKey,
      root,
      observer,
      quietTimerId: null
    });

    scheduleAssistantFinalize(messageId);
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
    trace("TS/USER", "captured pending user send", {
      sentAt,
      pendingCount: state.pendingUserSends.length
    });
  };

  const takePendingUserSend = (conversationKey: string) => {
    const exactIndex = state.pendingUserSends.findIndex(
      (entry) => entry.conversationKey === conversationKey
    );
    if (exactIndex >= 0) {
      const [pending] = state.pendingUserSends.splice(exactIndex, 1);
      return pending ?? null;
    }

    const [fallback] = state.pendingUserSends.splice(0, 1);
    return fallback ?? null;
  };

  const adoptUserMessage = (messageEl: HTMLElement, allowNowFallback: boolean) => {
    const messageId = messageEl.getAttribute("data-message-id");
    if (!messageId) return false;
    if (state.currentRecords.get(messageId)?.sentAt) return false;

    const pending = takePendingUserSend(state.currentConversationKey);
    const sentAt = pending?.sentAt ?? (allowNowFallback ? Date.now() : undefined);
    if (!sentAt) {
      trace(
        "TS/USER",
        "unable to adopt user message",
        {
          messageId,
          allowNowFallback,
          pendingCount: state.pendingUserSends.length
        },
        "warn"
      );
      return false;
    }

    trace("TS/USER", "adopt user message", {
      messageId,
      allowNowFallback,
      usedPendingSend: !!pending,
      sentAt
    });
    const changed = applyCurrentRecordPatch(state.currentConversationKey, messageId, {
      role: "user",
      sentAt
    });
    if (changed) renderMessage(messageEl);

    void persistRecordPatch(state.currentConversationKey, messageId, {
      role: "user",
      sentAt
    });
    return changed;
  };

  const adoptPendingUserMessages = (allowNowFallback: boolean, root: ParentNode = document) => {
    const userMessages = root.querySelectorAll<HTMLElement>(
      '[data-message-author-role="user"][data-message-id]'
    );
    for (const messageEl of Array.from(userMessages)) {
      adoptUserMessage(messageEl, allowNowFallback);
    }
  };

  const loadCurrentConversation = async () => {
    const scope = readConversationScope();
    const previousConversationKey = state.currentConversationKey;
    const localRecords = new Map(state.currentRecords);
    trace("TS/LOAD", "load current conversation start", {
      previousConversationKey,
      nextConversationKey: scope.conversationKey,
      nextConversationId: scope.conversationId ?? "",
      localRecordCount: localRecords.size
    });

    state.currentConversationId = scope.conversationId;
    state.currentConversationKey = scope.conversationKey;
    state.currentRecords.clear();
    state.apiSyncVersion += 1;

    const conversation = await repo.getConversation(scope.conversationKey);
    if (state.currentConversationKey !== scope.conversationKey) return;
    trace("TS/LOAD", "repo conversation loaded", {
      repoRecordCount: Object.keys(conversation?.messages ?? {}).length
    });

    for (const [messageId, record] of Object.entries(conversation?.messages ?? {})) {
      state.currentRecords.set(messageId, record);
    }

    if (scope.conversationKey === previousConversationKey) {
      for (const [messageId, record] of localRecords) {
        if (!state.currentRecords.has(messageId)) {
          state.currentRecords.set(messageId, record);
        }
      }
    }

    renderCurrentConversation();
    adoptPendingUserMessages(false, findMainRoot() ?? document);
    scheduleApiSync();
    trace("TS/LOAD", "load current conversation complete", {
      recordCount: state.currentRecords.size
    });
  };

  const refreshConversationScopeIfNeeded = () => {
    const nextScope = readConversationScope();
    if (
      nextScope.conversationId === state.currentConversationId &&
      nextScope.conversationKey === state.currentConversationKey
    ) {
      return false;
    }

    trace(
      "TS/SCOPE",
      "conversation scope changed",
      {
        previousConversationId: state.currentConversationId ?? "",
        nextConversationId: nextScope.conversationId ?? "",
        previousConversationKey: state.currentConversationKey,
        nextConversationKey: nextScope.conversationKey
      },
      "info"
    );
    stopAllAssistantTrackers();
    void loadCurrentConversation();
    return true;
  };

  const handleMainDelta = (delta: DomDelta) => {
    if (refreshConversationScopeIfNeeded()) return;

    const addedMessages = new Map<string, HTMLElement>();
    const candidateNodes = [...delta.added, ...(delta.touched ?? [])];

    for (const node of candidateNodes) {
      for (const messageEl of collectMessageElementsFromNode(node)) {
        const messageId = messageEl.getAttribute("data-message-id");
        if (!messageId) continue;
        addedMessages.set(messageId, messageEl);
      }
    }

    trace("TS/DELTA", "handle main delta", {
      reason: delta.reason,
      addedCount: delta.added.length,
      touchedCount: delta.touched?.length ?? 0,
      candidateNodeCount: candidateNodes.length,
      discoveredMessageCount: addedMessages.size
    });
    if (!addedMessages.size) return;

    for (const messageEl of addedMessages.values()) {
      const role = getMessageRole(messageEl);
      if (!role) continue;

      if (role === "user") {
        if (!adoptUserMessage(messageEl, true)) renderMessage(messageEl);
        continue;
      }

      renderMessage(messageEl);
      trackAssistantMessage(messageEl);
    }

    scheduleApiSync();
  };

  const handleSubmitCapture = (event: Event) => {
    const form = findMainComposerForm();
    if (!form) return;
    if (event.target !== form) return;
    trace("TS/USER", "submit captured from composer form");
    capturePendingUserSend();
  };

  const handleClickCapture = (event: Event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const button = target.closest<HTMLElement>("button, [role='button']");
    if (!button) return;
    const sendButton = findMainSendButton();
    if (!sendButton || button !== sendButton) return;
    trace("TS/USER", "click captured from send button");
    capturePendingUserSend();
  };

  const start = () => {
    if (state.started) return;
    state.started = true;
    ctx.logger.contractSnapshot("timestamps", "TS/BOOT", {
      mode: "chat",
      dictationState: "n/a",
      composerKind: "n/a",
      sendButtonState: "n/a",
      path: location.pathname,
      conversationId: state.currentConversationId ?? "",
      conversationKey: state.currentConversationKey
    });
    state.apiSyncScheduler = ctx.helpers.debounceScheduler(() => {
      void syncCurrentConversationFromApi();
    }, API_SYNC_DEBOUNCE_MS);

    ensureStyle();
    window.addEventListener("submit", handleSubmitCapture, true);
    window.addEventListener("click", handleClickCapture, true);

    state.unsubPath = ctx.helpers.onPathChange(() => {
      trace("TS/SCOPE", "path change observed", { nextPath: location.pathname }, "info");
      stopAllAssistantTrackers();
      void loadCurrentConversation();
    });

    state.unsubRoots =
      ctx.domBus?.onRoots(() => {
        if (refreshConversationScopeIfNeeded()) return;
        renderCurrentConversation();
        scheduleApiSync();
      }) ?? null;

    state.unsubMainDelta =
      ctx.domBus?.onDelta("main", (delta) => {
        if (delta.reason === "initial" || delta.reason === "route") {
          if (refreshConversationScopeIfNeeded()) return;
          renderCurrentConversation();
          scheduleApiSync();
          return;
        }
        handleMainDelta(delta);
      }) ?? null;

    void loadCurrentConversation();
  };

  const stop = () => {
    if (!state.started) return;
    state.started = false;
    trace("TS/BOOT", "stop feature");
    state.apiSyncVersion += 1;
    state.apiSyncScheduler?.cancel();
    state.apiSyncScheduler = null;
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
