import { FeatureContext, FeatureHandle } from "../application/featureContext";
import { isElementVisible } from "../lib/utils";

const TEMP_CHAT_ON_SELECTOR = 'button[aria-label="Turn on temporary chat"]';
const TEMP_CHAT_OFF_SELECTOR = 'button[aria-label="Turn off temporary chat"]';
const NAVIGATION_EVENT_NAME = "qqrm:navigation";
const NAVIGATION_FALLBACK_DELAY_MS = 10000;
const NAVIGATION_FALLBACK_INTERVAL_MS = 2500;

export function initAutoTempChatFeature(ctx: FeatureContext): FeatureHandle {
  const qs = <T extends Element = Element>(sel: string, root: Document | Element = document) =>
    root.querySelector<T>(sel);
  const qsa = <T extends Element = Element>(sel: string, root: Document | Element = document) =>
    Array.from(root.querySelectorAll<T>(sel));

  const state: {
    started: boolean;
    observer: MutationObserver | null;
    lastPath: string;
    domReady: boolean;
    lastNavigationEventAt: number;
    fallbackTimeoutId: number | null;
    fallbackIntervalId: number | null;
    historyPatched: boolean;
    originalPushState: History["pushState"] | null;
    originalReplaceState: History["replaceState"] | null;
  } = {
    started: false,
    observer: null,
    lastPath: "",
    domReady: document.readyState !== "loading",
    lastNavigationEventAt: Date.now(),
    fallbackTimeoutId: null,
    fallbackIntervalId: null,
    historyPatched: false,
    originalPushState: null,
    originalReplaceState: null
  };

  const isTempChatActive = () => !!qs(TEMP_CHAT_OFF_SELECTOR);

  const findVisibleBySelector = (sel: string) =>
    qsa<HTMLElement>(sel).find((el) => isElementVisible(el) && !el.hasAttribute("disabled")) ||
    null;

  const ensureTempChatOn = () => {
    if (isTempChatActive()) return;
    const btn = findVisibleBySelector(TEMP_CHAT_ON_SELECTOR);
    if (!btn) return;
    ctx.helpers.humanClick(btn, "tempchat-enable");
    ctx.logger.debug("TEMPCHAT", "forced on");
  };

  const ensureTempChatOff = () => {
    if (!isTempChatActive()) return;
    const btn = findVisibleBySelector(TEMP_CHAT_OFF_SELECTOR);
    if (!btn) return;
    ctx.helpers.humanClick(btn, "tempchat-disable");
    ctx.logger.debug("TEMPCHAT", "forced off");
  };

  const applyAutoTempChatState = () => {
    if (ctx.settings.autoTempChat) {
      ensureTempChatOn();
    } else {
      ensureTempChatOff();
    }
  };

  const handleNavigationChange = () => {
    const current = location.pathname + location.search;
    if (current === state.lastPath) return;
    state.lastPath = current;
    applyAutoTempChatState();
  };

  const scheduleFallbackNavigationCheck = () => {
    if (state.fallbackTimeoutId !== null) {
      window.clearTimeout(state.fallbackTimeoutId);
    }
    state.fallbackTimeoutId = window.setTimeout(() => {
      if (Date.now() - state.lastNavigationEventAt < NAVIGATION_FALLBACK_DELAY_MS) return;
      if (state.fallbackIntervalId !== null) return;
      state.fallbackIntervalId = window.setInterval(() => {
        handleNavigationChange();
      }, NAVIGATION_FALLBACK_INTERVAL_MS);
    }, NAVIGATION_FALLBACK_DELAY_MS);
  };

  const handleNavigationEvent = () => {
    state.lastNavigationEventAt = Date.now();
    if (state.fallbackIntervalId !== null) {
      window.clearInterval(state.fallbackIntervalId);
      state.fallbackIntervalId = null;
    }
    scheduleFallbackNavigationCheck();
    handleNavigationChange();
  };

  const patchHistory = () => {
    if (state.historyPatched) return;
    state.historyPatched = true;
    state.originalPushState = history.pushState.bind(history);
    state.originalReplaceState = history.replaceState.bind(history);
    history.pushState = (...args) => {
      const result = state.originalPushState?.(...args);
      window.dispatchEvent(new CustomEvent(NAVIGATION_EVENT_NAME));
      return result;
    };
    history.replaceState = (...args) => {
      const result = state.originalReplaceState?.(...args);
      window.dispatchEvent(new CustomEvent(NAVIGATION_EVENT_NAME));
      return result;
    };
  };

  const startAutoTempChat = () => {
    if (state.started) return;
    state.started = true;
    state.lastPath = location.pathname + location.search;

    patchHistory();
    window.addEventListener("popstate", handleNavigationEvent);
    window.addEventListener(NAVIGATION_EVENT_NAME, handleNavigationEvent);

    state.observer = new MutationObserver(() => applyAutoTempChatState());
    state.observer.observe(document.documentElement, { childList: true, subtree: true });

    scheduleFallbackNavigationCheck();

    applyAutoTempChatState();
  };

  const stopAutoTempChat = () => {
    if (!state.started) return;
    state.started = false;

    window.removeEventListener("popstate", handleNavigationEvent);
    window.removeEventListener(NAVIGATION_EVENT_NAME, handleNavigationEvent);

    if (state.observer) {
      state.observer.disconnect();
      state.observer = null;
    }
    if (state.fallbackIntervalId !== null) {
      window.clearInterval(state.fallbackIntervalId);
      state.fallbackIntervalId = null;
    }
    if (state.fallbackTimeoutId !== null) {
      window.clearTimeout(state.fallbackTimeoutId);
      state.fallbackTimeoutId = null;
    }
    if (state.historyPatched) {
      if (state.originalPushState) {
        history.pushState = state.originalPushState;
      }
      if (state.originalReplaceState) {
        history.replaceState = state.originalReplaceState;
      }
      state.historyPatched = false;
    }
  };

  const ensureStarted = () => {
    if (state.domReady) {
      startAutoTempChat();
      applyAutoTempChatState();
      return;
    }
    document.addEventListener(
      "DOMContentLoaded",
      () => {
        state.domReady = true;
        startAutoTempChat();
        applyAutoTempChatState();
      },
      { once: true }
    );
  };

  ensureStarted();
  applyAutoTempChatState();

  return {
    name: "autoTempChat",
    dispose: () => {
      stopAutoTempChat();
    },
    onSettingsChange: (next, prev) => {
      if (!prev.autoTempChat && next.autoTempChat) {
        ensureStarted();
      }
      if (prev.autoTempChat !== next.autoTempChat) {
        applyAutoTempChatState();
      }
    },
    getStatus: () => ({
      active: ctx.settings.autoTempChat,
      details: ctx.settings.autoTempChat ? "enabled" : "disabled"
    })
  };
}
