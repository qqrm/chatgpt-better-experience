import { FeatureContext, FeatureHandle } from "../application/featureContext";
import type { DomDelta } from "../application/domEventBus";
import { buildWideChatStyleText } from "../application/wideChat";

const WIDE_CHAT_CONTENT_SELECTOR = 'main div[class*="max-w-(--thread-content-max-width)"]';
const WIDE_CHAT_STYLE_ID = "tm-wide-chat-style";

export function initWideChatFeature(ctx: FeatureContext): FeatureHandle {
  const state = {
    started: false,
    baseWidthPx: null as number | null,
    resizeHandler: null as (() => void) | null,
    unsubMainDelta: null as (() => void) | null,
    unsubRoots: null as (() => void) | null,
    stats: {
      busEvents: 0,
      applyRuns: 0,
      nodesProcessed: 0
    }
  };

  const containsContentSelector = (node: Node): boolean => {
    if (node.nodeType !== Node.ELEMENT_NODE) return false;
    const el = node as Element;
    if (el.matches(WIDE_CHAT_CONTENT_SELECTOR)) return true;
    return el.querySelector(WIDE_CHAT_CONTENT_SELECTOR) !== null;
  };

  const findWideChatContentEl = () => ctx.helpers.safeQuery(WIDE_CHAT_CONTENT_SELECTOR);

  const ensureWideChatBaseWidth = (): number | null => {
    if (state.baseWidthPx !== null) return state.baseWidthPx;

    const contentEl = findWideChatContentEl();
    if (!contentEl) return null;

    const cs = window.getComputedStyle(contentEl as HTMLElement);
    const maxWidthStr = cs.maxWidth ?? "";
    const maxWidthPx =
      maxWidthStr.endsWith("px") && Number.isFinite(parseFloat(maxWidthStr))
        ? parseFloat(maxWidthStr)
        : NaN;

    const rectWidth = contentEl.getBoundingClientRect().width;
    const base = Number.isFinite(maxWidthPx) && maxWidthPx > 1 ? maxWidthPx : rectWidth;

    if (!Number.isFinite(base) || base <= 1) return null;

    state.baseWidthPx = Math.round(base);
    return state.baseWidthPx;
  };

  const ensureWideChatStyleEl = () => {
    let styleEl = document.getElementById(WIDE_CHAT_STYLE_ID) as HTMLStyleElement | null;

    if (!styleEl) {
      styleEl = document.createElement("style");
      styleEl.id = WIDE_CHAT_STYLE_ID;
      (document.head ?? document.documentElement)?.appendChild(styleEl);
    }

    return styleEl;
  };

  const removeWideChatStyle = () => {
    document.getElementById(WIDE_CHAT_STYLE_ID)?.remove();
  };

  const applyWideChatWidth = () => {
    state.stats.applyRuns += 1;

    const widthPercent = ctx.settings.wideChatWidth ?? 0;
    if (!state.started || widthPercent <= 0) {
      removeWideChatStyle();
      return;
    }

    const basePx = ensureWideChatBaseWidth();
    if (!basePx) return;

    const styleEl = ensureWideChatStyleEl();
    const next = buildWideChatStyleText({
      basePx,
      wideChatWidth: widthPercent,
      windowWidth: window.innerWidth
    });

    if (!next) {
      removeWideChatStyle();
      return;
    }
    if (styleEl.textContent !== next) styleEl.textContent = next;
  };

  const { schedule: scheduleApply, cancel: cancelApply } = ctx.helpers.debounceScheduler(
    applyWideChatWidth,
    60
  );

  const onMainDelta = (delta: DomDelta) => {
    state.stats.busEvents += 1;

    if (delta.reason === "initial" || delta.reason === "route") {
      scheduleApply();
      return;
    }

    for (const node of delta.added) {
      state.stats.nodesProcessed += 1;
      if (containsContentSelector(node)) {
        scheduleApply();
        return;
      }
    }
  };

  const onRoots = () => {
    scheduleApply();
  };

  const startWideChat = () => {
    if (state.started) return;
    state.started = true;

    removeWideChatStyle();
    state.baseWidthPx = null;

    state.resizeHandler = () => {
      scheduleApply();
    };
    window.addEventListener("resize", state.resizeHandler, { passive: true });

    state.unsubRoots = ctx.domBus?.onRoots(onRoots) ?? null;
    state.unsubMainDelta = ctx.domBus?.onDelta("main", onMainDelta) ?? null;

    scheduleApply();
  };

  const stopWideChat = () => {
    if (!state.started) return;
    state.started = false;

    cancelApply();

    state.unsubMainDelta?.();
    state.unsubMainDelta = null;

    state.unsubRoots?.();
    state.unsubRoots = null;

    if (state.resizeHandler) {
      window.removeEventListener("resize", state.resizeHandler);
      state.resizeHandler = null;
    }

    removeWideChatStyle();
    state.baseWidthPx = null;
  };

  const updateWideChatState = () => {
    if (ctx.settings.wideChatWidth > 0) startWideChat();
    else stopWideChat();
  };

  updateWideChatState();

  return {
    name: "wideChat",
    dispose: () => {
      stopWideChat();
    },
    onSettingsChange: (next, prev) => {
      if (next.wideChatWidth !== prev.wideChatWidth) updateWideChatState();
      scheduleApply();
    },
    getStatus: () => ({
      active: ctx.settings.wideChatWidth > 0,
      details: ctx.settings.wideChatWidth > 0 ? `width=${ctx.settings.wideChatWidth}%` : ""
    })
  };
}
