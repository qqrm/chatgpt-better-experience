import { FeatureContext, FeatureHandle } from "../application/featureContext";
import { updateWideChatStyle } from "../application/wideChat";

const WIDE_CHAT_STYLE_ID = "qqrm-wide-chat-style";
const CONTENT_SELECTOR = '[class*="max-w-(--thread-content-max-width)"]';

export function initWideChatFeature(ctx: FeatureContext): FeatureHandle {
  const state: {
    started: boolean;
    resizeObserver: ResizeObserver | null;
    resizeHandler: (() => void) | null;
    watchedContent: Element | null;
    baseWidthPx: number | null;
    unsubMainDelta: (() => void) | null;
    unsubRoots: (() => void) | null;
    stats: { applyRuns: number; nodesProcessed: number; busEvents: number };
  } = {
    started: false,
    resizeObserver: null,
    resizeHandler: null,
    watchedContent: null,
    baseWidthPx: null,
    unsubMainDelta: null,
    unsubRoots: null,
    stats: { applyRuns: 0, nodesProcessed: 0, busEvents: 0 }
  };

  const scheduleApply = ctx.helpers.createRafScheduler(() => applyWideChatWidth());

  const findWideChatContentEl = () =>
    document.querySelector(`main ${CONTENT_SELECTOR}`) ?? document.querySelector(CONTENT_SELECTOR);

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
      (document.head ?? document.documentElement)?.appendChild(style);
    }
    return style;
  };

  const removeWideChatStyle = () => {
    document.getElementById(WIDE_CHAT_STYLE_ID)?.remove();
  };

  const applyWideChatWidth = () => {
    if (!state.started || ctx.settings.wideChatWidth <= 0) return;
    state.stats.applyRuns += 1;
    const basePx = ensureWideChatBaseWidth();
    if (!basePx) return;
    const style = ensureWideChatStyle();
    updateWideChatStyle(style, {
      basePx,
      wideChatWidth: ctx.settings.wideChatWidth,
      windowWidth: window.innerWidth
    });
  };

  const bindResizeObserver = () => {
    const nextContent = findWideChatContentEl();
    if (!nextContent || nextContent === state.watchedContent) return;

    state.resizeObserver?.disconnect();
    state.watchedContent = nextContent;
    state.baseWidthPx = null;
    state.resizeObserver = new ResizeObserver(() => {
      state.baseWidthPx = null;
      scheduleApply.schedule();
    });
    state.resizeObserver.observe(nextContent);
    scheduleApply.schedule();
  };

  const containsContentSelector = (el: Element) =>
    el.matches(CONTENT_SELECTOR) || !!el.querySelector(CONTENT_SELECTOR);

  const startWideChat = () => {
    if (state.started) return;
    state.started = true;

    state.resizeHandler = () => {
      state.baseWidthPx = null;
      scheduleApply.schedule();
    };
    window.addEventListener("resize", state.resizeHandler, { passive: true });

    state.unsubMainDelta =
      ctx.domBus?.onDelta("main", (delta) => {
        state.stats.busEvents += 1;
        state.stats.nodesProcessed += delta.added.length + delta.removed.length;
        for (const el of delta.added) {
          if (!containsContentSelector(el)) continue;
          state.baseWidthPx = null;
          bindResizeObserver();
          scheduleApply.schedule();
          return;
        }
      }) ?? null;

    state.unsubRoots =
      ctx.domBus?.onRoots(() => {
        state.baseWidthPx = null;
        bindResizeObserver();
        scheduleApply.schedule();
      }) ?? null;

    bindResizeObserver();
    scheduleApply.schedule();
  };

  const stopWideChat = () => {
    if (!state.started) return;
    state.started = false;

    if (state.resizeHandler) {
      window.removeEventListener("resize", state.resizeHandler);
      state.resizeHandler = null;
    }
    state.resizeObserver?.disconnect();
    state.resizeObserver = null;
    state.unsubMainDelta?.();
    state.unsubMainDelta = null;
    state.unsubRoots?.();
    state.unsubRoots = null;
    state.watchedContent = null;
    state.baseWidthPx = null;
    scheduleApply.cancel();
    removeWideChatStyle();

    if (ctx.logger.isEnabled) {
      ctx.logger.debug("wideChat", "stopped", {
        preview: `bus=${state.stats.busEvents} apply=${state.stats.applyRuns} nodes=${state.stats.nodesProcessed}`
      });
    }
  };

  const updateWideChatState = () => {
    if (ctx.settings.wideChatWidth > 0) {
      if (!state.started) startWideChat();
      else scheduleApply.schedule();
      return;
    }
    stopWideChat();
  };

  updateWideChatState();

  return {
    name: "wideChat",
    dispose: () => stopWideChat(),
    onSettingsChange: (next, prev) => {
      if (next.wideChatWidth !== prev.wideChatWidth) updateWideChatState();
    },
    getStatus: () => ({
      active: ctx.settings.wideChatWidth > 0,
      details: ctx.settings.wideChatWidth > 0 ? String(ctx.settings.wideChatWidth) : undefined
    })
  };
}
