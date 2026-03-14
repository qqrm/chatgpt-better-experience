import { FeatureContext, FeatureHandle } from "../application/featureContext";
import type { DomDelta } from "../application/domEventBus";
import { buildWideChatStyleText } from "../application/wideChat";
import {
  detectWideChatOverlaps,
  WIDE_CHAT_CONTENT_CLASS,
  WIDE_CHAT_CONTENT_PAD_RIGHT_VAR,
  WIDE_CHAT_CONTENT_PAD_TOP_VAR,
  WIDE_CHAT_OVERLAP_TURN_ATTR,
  WIDE_CHAT_OVERLAP_TURN_CLASS,
  WIDE_CHAT_SHELF_BG_VAR,
  WIDE_CHAT_SHELF_CLASS
} from "../application/wideChatOverlap";

const WIDE_CHAT_CONTENT_SELECTOR = 'main div[class*="max-w-(--thread-content-max-width)"]';
const WIDE_CHAT_STYLE_ID = "tm-wide-chat-style";
const WIDE_CHAT_RELEVANT_SELECTOR =
  "article, [data-message-author-role], button, [role='button'], .markdown";

export function initWideChatFeature(ctx: FeatureContext): FeatureHandle {
  const state = {
    started: false,
    baseWidthPx: null as number | null,
    resizeHandler: null as (() => void) | null,
    unsubMainDelta: null as (() => void) | null,
    unsubRoots: null as (() => void) | null,
    overlapTurns: new Set<HTMLElement>(),
    overlapContents: new Set<HTMLElement>(),
    overlapShelfHosts: new Set<HTMLElement>(),
    stats: {
      busEvents: 0,
      applyRuns: 0,
      nodesProcessed: 0
    }
  };

  const containsRelevantSelector = (node: Node): boolean => {
    if (node.nodeType !== Node.ELEMENT_NODE) return false;
    const el = node as Element;
    if (el.matches(WIDE_CHAT_CONTENT_SELECTOR) || el.matches(WIDE_CHAT_RELEVANT_SELECTOR)) {
      return true;
    }
    return (
      el.querySelector(`${WIDE_CHAT_CONTENT_SELECTOR}, ${WIDE_CHAT_RELEVANT_SELECTOR}`) !== null
    );
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

  const clearWideChatOverlapState = () => {
    for (const turn of state.overlapTurns) {
      turn.classList.remove(WIDE_CHAT_OVERLAP_TURN_CLASS);
      turn.removeAttribute(WIDE_CHAT_OVERLAP_TURN_ATTR);
    }
    for (const content of state.overlapContents) {
      content.classList.remove(WIDE_CHAT_CONTENT_CLASS);
      content.style.removeProperty(WIDE_CHAT_CONTENT_PAD_TOP_VAR);
      content.style.removeProperty(WIDE_CHAT_CONTENT_PAD_RIGHT_VAR);
    }
    for (const shelfHost of state.overlapShelfHosts) {
      shelfHost.classList.remove(WIDE_CHAT_SHELF_CLASS);
      shelfHost.style.removeProperty(WIDE_CHAT_SHELF_BG_VAR);
    }
    state.overlapTurns.clear();
    state.overlapContents.clear();
    state.overlapShelfHosts.clear();
  };

  const applyWideChatOverlapState = () => {
    clearWideChatOverlapState();

    for (const match of detectWideChatOverlaps(document)) {
      match.turn.classList.add(WIDE_CHAT_OVERLAP_TURN_CLASS);
      match.turn.setAttribute(WIDE_CHAT_OVERLAP_TURN_ATTR, "1");
      state.overlapTurns.add(match.turn);

      match.content.classList.add(WIDE_CHAT_CONTENT_CLASS);
      match.content.style.setProperty(WIDE_CHAT_CONTENT_PAD_TOP_VAR, `${match.topPadPx}px`);
      match.content.style.setProperty(WIDE_CHAT_CONTENT_PAD_RIGHT_VAR, `${match.rightPadPx}px`);
      state.overlapContents.add(match.content);

      for (const shelfHost of match.shelfHosts) {
        shelfHost.classList.add(WIDE_CHAT_SHELF_CLASS);
        shelfHost.style.setProperty(WIDE_CHAT_SHELF_BG_VAR, match.shelfBg);
        state.overlapShelfHosts.add(shelfHost);
      }
    }
  };

  const applyWideChatWidth = () => {
    state.stats.applyRuns += 1;

    const widthPercent = ctx.settings.wideChatWidth ?? 0;
    if (!state.started || widthPercent <= 0) {
      clearWideChatOverlapState();
      removeWideChatStyle();
      return;
    }

    const basePx = ensureWideChatBaseWidth();
    if (!basePx) {
      clearWideChatOverlapState();
      return;
    }

    const styleEl = ensureWideChatStyleEl();
    const next = buildWideChatStyleText({
      basePx,
      wideChatWidth: widthPercent,
      windowWidth: window.innerWidth
    });

    if (!next) {
      clearWideChatOverlapState();
      removeWideChatStyle();
      return;
    }
    if (styleEl.textContent !== next) styleEl.textContent = next;
    applyWideChatOverlapState();
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
      if (containsRelevantSelector(node)) {
        scheduleApply();
        return;
      }
    }

    for (const node of delta.removed) {
      state.stats.nodesProcessed += 1;
      if (containsRelevantSelector(node)) {
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
    clearWideChatOverlapState();
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

    clearWideChatOverlapState();
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
