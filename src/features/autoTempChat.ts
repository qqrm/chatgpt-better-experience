import { FeatureContext, FeatureHandle } from "../application/featureContext";

const TEMP_CHAT_CHECKBOX_SELECTOR = "#temporary-chat-checkbox";
const TEMP_CHAT_LABEL_SELECTOR = 'h1[data-testid="temporary-chat-label"]';
const NAVIGATION_EVENT_NAME = "qqrm:navigation";
const NAVIGATION_FALLBACK_DELAY_MS = 10000;
const NAVIGATION_FALLBACK_INTERVAL_MS = 2500;

export function initAutoTempChatFeature(ctx: FeatureContext): FeatureHandle {
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
    if (!checkbox) return;
    if (checkbox.disabled) return;
    if (checkbox.checked) return;
    const target = getTempChatClickTarget();
    if (!target) return;
    ctx.helpers.humanClick(target, "tempchat-enable");
    ctx.logger.debug("TEMPCHAT", "forced on");
  };

  const ensureTempChatOff = () => {
    const checkbox = getTempChatCheckbox();
    if (!checkbox) return;
    if (checkbox.disabled) return;
    if (!checkbox.checked) return;
    const target = getTempChatClickTarget();
    if (!target) return;
    ctx.helpers.humanClick(target, "tempchat-disable");
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
    let applyScheduled = false;
    const scheduleApply = () => {
      if (applyScheduled) return;
      applyScheduled = true;
      window.setTimeout(() => {
        applyScheduled = false;
        if (!state.started) return;
        applyAutoTempChatState();
      }, 200);
    };

    patchHistory();
    window.addEventListener("popstate", handleNavigationEvent);
    window.addEventListener(NAVIGATION_EVENT_NAME, handleNavigationEvent);

    state.observer = new MutationObserver(() => scheduleApply());
    state.observer.observe(document.documentElement, { childList: true, subtree: true });

    scheduleFallbackNavigationCheck();

    applyAutoTempChatState();
  };

  const stopAutoTempChat = () => {
    if (!state.started) return;
    state.started = false;

    window.removeEventListener("popstate", handleNavigationEvent);
    window.removeEventListener(NAVIGATION_EVENT_NAME, handleNavigationEvent);

    if (state.historyPatched) {
      if (state.originalPushState) {
        history.pushState = state.originalPushState;
      }
      if (state.originalReplaceState) {
        history.replaceState = state.originalReplaceState;
      }
      state.historyPatched = false;
    }

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
