import { FeatureContext, FeatureHandle } from "../application/featureContext";
import { isElementVisible } from "../lib/utils";

const TEMP_CHAT_ON_SELECTOR = 'button[aria-label="Turn on temporary chat"]';
const TEMP_CHAT_OFF_SELECTOR = 'button[aria-label="Turn off temporary chat"]';
const TEMP_CHAT_MAX_RETRIES = 5;
const TEMP_CHAT_RETRY_MS = 300;

export function initAutoTempChatFeature(ctx: FeatureContext): FeatureHandle {
  const qs = <T extends Element = Element>(sel: string, root: Document | Element = document) =>
    root.querySelector<T>(sel);
  const qsa = <T extends Element = Element>(sel: string, root: Document | Element = document) =>
    Array.from(root.querySelectorAll<T>(sel));

  const state: {
    started: boolean;
    observer: MutationObserver | null;
    urlIntervalId: number | null;
    lastPath: string;
    retries: number;
    domReady: boolean;
  } = {
    started: false,
    observer: null,
    urlIntervalId: null,
    lastPath: "",
    retries: 0,
    domReady: document.readyState !== "loading"
  };

  let tempChatEnabled = ctx.settings.tempChatEnabled;

  const isTempChatActive = () => !!qs(TEMP_CHAT_OFF_SELECTOR);

  const findVisibleBySelector = (sel: string) =>
    qsa<HTMLElement>(sel).find((el) => isElementVisible(el) && !el.hasAttribute("disabled")) ||
    null;

  const persistTempChatEnabled = (value: boolean) => {
    tempChatEnabled = value;
    ctx.settings.tempChatEnabled = value;
    void ctx.storagePort.set({ tempChatEnabled });
    ctx.logger.debug("TEMPCHAT", "persist state", { ok: value });
  };

  const maybeEnableTempChat = () => {
    if (!ctx.settings.autoTempChat || !tempChatEnabled || isTempChatActive()) {
      state.retries = 0;
      return;
    }

    const btn = findVisibleBySelector(TEMP_CHAT_ON_SELECTOR);
    if (!btn) return;

    ctx.helpers.humanClick(btn, "tempchat-enable");
    ctx.logger.debug("TEMPCHAT", "auto-clicked on");

    setTimeout(() => {
      if (isTempChatActive()) {
        ctx.logger.debug("TEMPCHAT", "enabled");
        state.retries = 0;
      } else if (++state.retries <= TEMP_CHAT_MAX_RETRIES) {
        ctx.logger.debug("TEMPCHAT", `retry ${state.retries}`);
        maybeEnableTempChat();
      } else {
        ctx.logger.debug("TEMPCHAT", "failed after retries");
        state.retries = 0;
      }
    }, TEMP_CHAT_RETRY_MS);
  };

  const handleTempChatManualToggle = (e: MouseEvent) => {
    if (!e.isTrusted) return;
    const target = e.target;
    if (!(target instanceof Element) || !target.closest) return;
    if (target.closest(TEMP_CHAT_ON_SELECTOR)) return persistTempChatEnabled(true);
    if (target.closest(TEMP_CHAT_OFF_SELECTOR)) return persistTempChatEnabled(false);
  };

  const startAutoTempChat = () => {
    if (state.started) return;
    state.started = true;
    state.lastPath = location.pathname + location.search;

    document.addEventListener("click", handleTempChatManualToggle, true);

    state.observer = new MutationObserver(() => maybeEnableTempChat());
    state.observer.observe(document.documentElement, { childList: true, subtree: true });

    state.urlIntervalId = window.setInterval(() => {
      const cur = location.pathname + location.search;
      if (cur !== state.lastPath) {
        state.lastPath = cur;
        state.retries = 0;
        maybeEnableTempChat();
      }
    }, 100);

    maybeEnableTempChat();
  };

  const stopAutoTempChat = () => {
    if (!state.started) return;
    state.started = false;

    document.removeEventListener("click", handleTempChatManualToggle, true);

    if (state.observer) {
      state.observer.disconnect();
      state.observer = null;
    }
    if (state.urlIntervalId !== null) {
      window.clearInterval(state.urlIntervalId);
      state.urlIntervalId = null;
    }
    state.retries = 0;
  };

  const ensureStarted = () => {
    if (!ctx.settings.autoTempChat) return;
    if (state.domReady) {
      startAutoTempChat();
      return;
    }
    document.addEventListener(
      "DOMContentLoaded",
      () => {
        state.domReady = true;
        startAutoTempChat();
      },
      { once: true }
    );
  };

  ensureStarted();

  return {
    name: "autoTempChat",
    dispose: () => {
      stopAutoTempChat();
    },
    onSettingsChange: (next, prev) => {
      tempChatEnabled = next.tempChatEnabled;
      if (!prev.autoTempChat && next.autoTempChat) {
        ensureStarted();
        maybeEnableTempChat();
      }
      if (prev.autoTempChat && !next.autoTempChat) {
        stopAutoTempChat();
      }
      if (prev.tempChatEnabled !== next.tempChatEnabled) {
        maybeEnableTempChat();
      }
    },
    getStatus: () => ({
      active: ctx.settings.autoTempChat,
      details: tempChatEnabled ? "enabled" : "disabled"
    })
  };
}
