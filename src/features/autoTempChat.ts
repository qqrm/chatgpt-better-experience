import { FeatureContext, FeatureHandle } from "../application/featureContext";

const TEMP_CHAT_CHECKBOX_SELECTOR = "#temporary-chat-checkbox";
const TEMP_CHAT_LABEL_SELECTOR = 'h1[data-testid="temporary-chat-label"]';
const MAX_RETRIES = 10;

export function initAutoTempChatFeature(ctx: FeatureContext): FeatureHandle {
  const state: {
    started: boolean;
    observer: MutationObserver | null;
    pathUnsubscribe: (() => void) | null;
    retryTimerId: number | null;
    retryAttempt: number;
    stats: { observerCalls: number; applyRuns: number; nodesProcessed: number };
  } = {
    started: false,
    observer: null,
    pathUnsubscribe: null,
    retryTimerId: null,
    retryAttempt: 0,
    stats: { observerCalls: 0, applyRuns: 0, nodesProcessed: 0 }
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
    if (!checkbox || checkbox.disabled || checkbox.checked) return true;
    const target = getTempChatClickTarget();
    if (!target) return false;
    ctx.helpers.humanClick(target, "tempchat-enable");
    return true;
  };

  const scheduleRetry = () => {
    if (!state.started || !ctx.settings.autoTempChat || state.retryAttempt >= MAX_RETRIES) return;
    if (state.retryTimerId !== null) return;
    const delay = Math.min(200 * 2 ** state.retryAttempt, 2000);
    state.retryAttempt += 1;
    state.retryTimerId = window.setTimeout(() => {
      state.retryTimerId = null;
      const ok = ensureTempChatOn();
      if (!ok || !getTempChatCheckbox()?.checked) {
        scheduleRetry();
      }
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
    if (!ok || !getTempChatCheckbox()?.checked) {
      scheduleRetry();
    } else {
      clearRetry();
    }
    if (ctx.logger.isEnabled) {
      ctx.logger.debug("autoTempChat", "apply", {
        preview: `observer=${state.stats.observerCalls} apply=${state.stats.applyRuns} nodes=${state.stats.nodesProcessed}`
      });
    }
  };

  const bindObserver = () => {
    const root =
      (document.querySelector("main") as HTMLElement | null) ||
      (document.querySelector("header") as HTMLElement | null);
    if (!root) return;
    state.observer?.disconnect();
    state.observer = new MutationObserver((records) => {
      state.stats.observerCalls += 1;
      let relevant = false;
      for (const record of records) {
        if (record.type !== "childList") continue;
        state.stats.nodesProcessed += record.addedNodes.length;
        for (const node of Array.from(record.addedNodes)) {
          if (!(node instanceof Element)) continue;
          if (
            node.matches(TEMP_CHAT_CHECKBOX_SELECTOR) ||
            node.querySelector(TEMP_CHAT_CHECKBOX_SELECTOR)
          ) {
            relevant = true;
            break;
          }
        }
        if (relevant) break;
      }
      if (relevant) applyScheduler.schedule();
    });
    state.observer.observe(root, { childList: true, subtree: true });
  };

  const startAutoTempChat = () => {
    if (state.started || !ctx.settings.autoTempChat) return;
    state.started = true;
    bindObserver();
    state.pathUnsubscribe = ctx.helpers.onPathChange(() => {
      bindObserver();
      applyScheduler.schedule();
    });
    applyScheduler.schedule();
  };

  const stopAutoTempChat = () => {
    if (!state.started) return;
    state.started = false;
    state.observer?.disconnect();
    state.observer = null;
    state.pathUnsubscribe?.();
    state.pathUnsubscribe = null;
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
    dispose: () => {
      stopAutoTempChat();
    },
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
