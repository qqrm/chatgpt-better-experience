import { FeatureContext, FeatureHandle } from "../application/featureContext";
import { updateWideChatStyle } from "../application/wideChat";

const WIDE_CHAT_STYLE_ID = "qqrm-wide-chat-style";

export function initWideChatFeature(ctx: FeatureContext): FeatureHandle {
  const state: {
    started: boolean;
    observer: MutationObserver | null;
    resizeHandler: (() => void) | null;
    baseWidthPx: number | null;
    scheduled: boolean;
  } = {
    started: false,
    observer: null,
    resizeHandler: null,
    baseWidthPx: null,
    scheduled: false
  };

  const findWideChatContentEl = () =>
    document.querySelector('main [class*="max-w-(--thread-content-max-width)"]') ||
    document.querySelector('[class*="max-w-(--thread-content-max-width)"]');

  const ensureWideChatBaseWidth = () => {
    if (state.baseWidthPx !== null) return state.baseWidthPx;
    const contentEl = findWideChatContentEl();
    if (!contentEl) return null;
    const rect = contentEl.getBoundingClientRect();
    if (rect.width <= 1) return null;
    state.baseWidthPx = Math.round(rect.width);
    return state.baseWidthPx;
  };

  const ensureWideChatStyle = () => {
    let style = document.getElementById(WIDE_CHAT_STYLE_ID) as HTMLStyleElement | null;
    if (!style) {
      style = document.createElement("style");
      style.id = WIDE_CHAT_STYLE_ID;
      document.documentElement.appendChild(style);
    }
    return style;
  };

  const removeWideChatStyle = () => {
    const style = document.getElementById(WIDE_CHAT_STYLE_ID);
    if (style) style.remove();
  };

  const applyWideChatWidth = () => {
    if (ctx.settings.wideChatWidth <= 0) return;
    const basePx = ensureWideChatBaseWidth();
    if (!basePx) return;
    const style = ensureWideChatStyle();
    updateWideChatStyle(style, {
      basePx,
      wideChatWidth: ctx.settings.wideChatWidth,
      windowWidth: window.innerWidth
    });
  };

  const scheduleWideChatUpdate = () => {
    if (state.scheduled) return;
    state.scheduled = true;
    requestAnimationFrame(() => {
      state.scheduled = false;
      applyWideChatWidth();
    });
  };

  const startWideChat = () => {
    if (state.started) return;
    state.started = true;
    state.baseWidthPx = null;
    state.resizeHandler = () => scheduleWideChatUpdate();
    window.addEventListener("resize", state.resizeHandler, { passive: true });
    state.observer = new MutationObserver((mutations) => {
      const style = document.getElementById(WIDE_CHAT_STYLE_ID);
      if (
        style &&
        mutations.length > 0 &&
        mutations.every((mutation) => style.contains(mutation.target))
      ) {
        return;
      }
      scheduleWideChatUpdate();
    });
    state.observer.observe(document.documentElement, { childList: true, subtree: true });
    scheduleWideChatUpdate();
  };

  const stopWideChat = () => {
    if (!state.started) return;
    state.started = false;
    if (state.resizeHandler) {
      window.removeEventListener("resize", state.resizeHandler);
      state.resizeHandler = null;
    }
    if (state.observer) {
      state.observer.disconnect();
      state.observer = null;
    }
    state.baseWidthPx = null;
    removeWideChatStyle();
  };

  const updateWideChatState = () => {
    if (ctx.settings.wideChatWidth > 0) {
      if (!state.started) startWideChat();
      else scheduleWideChatUpdate();
      return;
    }
    stopWideChat();
  };

  updateWideChatState();

  return {
    name: "wideChat",
    dispose: () => {
      stopWideChat();
    },
    onSettingsChange: (next, prev) => {
      if (next.wideChatWidth !== prev.wideChatWidth) {
        updateWideChatState();
      }
    },
    getStatus: () => ({
      active: ctx.settings.wideChatWidth > 0,
      details: ctx.settings.wideChatWidth > 0 ? String(ctx.settings.wideChatWidth) : undefined
    })
  };
}
