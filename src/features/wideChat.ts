import { FeatureContext, FeatureHandle } from "../application/featureContext";
import { updateWideChatStyle } from "../application/wideChat";

const WIDE_CHAT_STYLE_ID = "qqrm-wide-chat-style";

export function initWideChatFeature(ctx: FeatureContext): FeatureHandle {
  const state: {
    started: boolean;
    mainObserver: MutationObserver | null;
    resizeObserver: ResizeObserver | null;
    resizeHandler: (() => void) | null;
    pathUnsubscribe: (() => void) | null;
    watchedMain: Element | null;
    watchedContent: Element | null;
    baseWidthPx: number | null;
    stats: { observerCalls: number; applyRuns: number; nodesProcessed: number };
  } = {
    started: false,
    mainObserver: null,
    resizeObserver: null,
    resizeHandler: null,
    pathUnsubscribe: null,
    watchedMain: null,
    watchedContent: null,
    baseWidthPx: null,
    stats: { observerCalls: 0, applyRuns: 0, nodesProcessed: 0 }
  };

  const scheduleApply = ctx.helpers.createRafScheduler(() => applyWideChatWidth());

  const logStats = (reason: string) => {
    if (!ctx.logger.isEnabled) return;
    ctx.logger.debug("wideChat", `${reason}`, {
      preview: `observer=${state.stats.observerCalls} apply=${state.stats.applyRuns} nodes=${state.stats.nodesProcessed}`
    });
  };

  const findWideChatContentEl = () =>
    document.querySelector('main [class*="max-w-(--thread-content-max-width)"]') ||
    document.querySelector('[class*="max-w-(--thread-content-max-width)"]');

  const findMainRoot = () =>
    document.querySelector("main") || document.querySelector('[role="main"]');

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
    const style = document.getElementById(WIDE_CHAT_STYLE_ID);
    if (style) style.remove();
  };

  const applyWideChatWidth = () => {
    if (!state.started || ctx.settings.wideChatWidth <= 0) return;
    state.stats.applyRuns += 1;
    const basePx = ensureWideChatBaseWidth();
    if (!basePx) return;
    const style = ensureWideChatStyle();
    if (!style) return;
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

  const bindMainObserver = () => {
    const nextMain = findMainRoot();
    if (!nextMain || nextMain === state.watchedMain) return;

    state.mainObserver?.disconnect();
    state.watchedMain = nextMain;
    state.mainObserver = new MutationObserver((records) => {
      state.stats.observerCalls += 1;
      let relevant = false;
      for (const record of records) {
        state.stats.nodesProcessed += record.addedNodes.length + record.removedNodes.length;
        if (record.type !== "childList") continue;
        for (const node of Array.from(record.addedNodes)) {
          if (!(node instanceof Element)) continue;
          if (node.matches('[class*="max-w-(--thread-content-max-width)"]')) {
            relevant = true;
            break;
          }
          if (node.querySelector?.('[class*="max-w-(--thread-content-max-width)"]')) {
            relevant = true;
            break;
          }
        }
        if (relevant) break;
      }
      if (!relevant) return;
      state.baseWidthPx = null;
      bindResizeObserver();
      scheduleApply.schedule();
    });
    state.mainObserver.observe(nextMain, { childList: true, subtree: true });
  };

  const rebindAll = () => {
    state.baseWidthPx = null;
    bindMainObserver();
    bindResizeObserver();
    scheduleApply.schedule();
  };

  const startWideChat = () => {
    if (state.started) return;
    state.started = true;
    state.resizeHandler = () => {
      state.baseWidthPx = null;
      scheduleApply.schedule();
    };
    window.addEventListener("resize", state.resizeHandler, { passive: true });
    state.pathUnsubscribe = ctx.helpers.onPathChange(() => {
      rebindAll();
    });
    rebindAll();
  };

  const stopWideChat = () => {
    if (!state.started) return;
    state.started = false;

    if (state.resizeHandler) {
      window.removeEventListener("resize", state.resizeHandler);
      state.resizeHandler = null;
    }
    state.mainObserver?.disconnect();
    state.mainObserver = null;
    state.resizeObserver?.disconnect();
    state.resizeObserver = null;
    state.pathUnsubscribe?.();
    state.pathUnsubscribe = null;
    state.watchedMain = null;
    state.watchedContent = null;
    state.baseWidthPx = null;
    scheduleApply.cancel();
    removeWideChatStyle();
    logStats("stopped");
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
