import { FeatureContext, FeatureHandle } from "../application/featureContext";

const TEMP_CHAT_CHECKBOX_SELECTOR = "#temporary-chat-checkbox";
const TEMP_CHAT_LABEL_SELECTOR = 'h1[data-testid="temporary-chat-label"]';
const MAX_RETRIES = 10;

export function initAutoTempChatFeature(ctx: FeatureContext): FeatureHandle {
  const state: {
    started: boolean;
    retryTimerId: number | null;
    retryAttempt: number;
    unsubMainDelta: (() => void) | null;
    unsubRoots: (() => void) | null;
    stats: { applyRuns: number; busEvents: number; nodesProcessed: number };
  } = {
    started: false,
    retryTimerId: null,
    retryAttempt: 0,
    unsubMainDelta: null,
    unsubRoots: null,
    stats: { applyRuns: 0, busEvents: 0, nodesProcessed: 0 }
  };

  const applyScheduler = ctx.helpers.debounceScheduler(() => applyAutoTempChatState(), 200);

  const getTempChatCheckbox = () =>
    document.querySelector<HTMLInputElement>(TEMP_CHAT_CHECKBOX_SELECTOR);

  const getTempChatClickTarget = () => {
    const checkbox = getTempChatCheckbox();
    if (!checkbox) return null;
    return (checkbox.closest<HTMLElement>("label") ??
      checkbox.closest<HTMLElement>(TEMP_CHAT_LABEL_SELECTOR) ??
      checkbox.closest<HTMLElement>("button") ??
      checkbox) as unknown as HTMLElement;
  };

  const ensureTempChatOn = () => {
    const checkbox = getTempChatCheckbox();
    if (!checkbox || checkbox.disabled) return false;
    if (checkbox.checked) return true;
    const target = getTempChatClickTarget();
    if (!target) return false;
    return ctx.helpers.humanClick(target, "tempchat-enable");
  };

  const scheduleRetry = () => {
    if (!state.started || !ctx.settings.autoTempChat || state.retryAttempt >= MAX_RETRIES) return;
    if (state.retryTimerId !== null) return;
    const delay = Math.min(200 * 2 ** state.retryAttempt, 2000);
    state.retryAttempt += 1;
    state.retryTimerId = window.setTimeout(() => {
      state.retryTimerId = null;
      const ok = ensureTempChatOn();
      if (!ok || !getTempChatCheckbox()?.checked) scheduleRetry();
    }, delay);
  };

  const clearRetry = () => {
    if (state.retryTimerId !== null) {
      window.clearTimeout(state.retryTimerId);
      state.retryTimerId = null;
    }
    state.retryAttempt = 0;
  };

  const applyAutoTempChatState = () => {
    if (!state.started || !ctx.settings.autoTempChat) return;
    state.stats.applyRuns += 1;
    const ok = ensureTempChatOn();
    if (!ok || !getTempChatCheckbox()?.checked) scheduleRetry();
    else clearRetry();

    if (ctx.logger.isEnabled) {
      ctx.logger.debug("autoTempChat", "apply", {
        preview: `bus=${state.stats.busEvents} apply=${state.stats.applyRuns} nodes=${state.stats.nodesProcessed}`
      });
    }
  };

  const isRelevantDelta = (elements: Element[]) => {
    for (const el of elements) {
      if (
        el.matches(TEMP_CHAT_CHECKBOX_SELECTOR) ||
        el.querySelector(TEMP_CHAT_CHECKBOX_SELECTOR)
      ) {
        return true;
      }
    }
    return false;
  };

  const startAutoTempChat = () => {
    if (state.started || !ctx.settings.autoTempChat) return;
    state.started = true;

    state.unsubMainDelta =
      ctx.domBus?.onDelta("main", (delta) => {
        state.stats.busEvents += 1;
        state.stats.nodesProcessed += delta.added.length + delta.removed.length;
        if (isRelevantDelta(delta.added)) applyScheduler.schedule();
      }) ?? null;

    state.unsubRoots =
      ctx.domBus?.onRoots(() => {
        applyScheduler.schedule();
      }) ?? null;

    applyScheduler.schedule();
  };

  const stopAutoTempChat = () => {
    if (!state.started) return;
    state.started = false;
    state.unsubMainDelta?.();
    state.unsubMainDelta = null;
    state.unsubRoots?.();
    state.unsubRoots = null;
    applyScheduler.cancel();
    clearRetry();
  };

  if (ctx.settings.autoTempChat) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => startAutoTempChat(), { once: true });
    } else {
      startAutoTempChat();
    }
  }

  return {
    name: "autoTempChat",
    dispose: () => stopAutoTempChat(),
    onSettingsChange: (next, prev) => {
      if (!prev.autoTempChat && next.autoTempChat) startAutoTempChat();
      if (prev.autoTempChat && !next.autoTempChat) stopAutoTempChat();
    },
    getStatus: () => ({
      active: ctx.settings.autoTempChat,
      details: ctx.settings.autoTempChat ? "enabled" : "disabled"
    })
  };
}
