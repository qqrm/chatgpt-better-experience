import { FeatureContext, FeatureHandle } from "../application/featureContext";
import { isElementVisible, norm } from "../lib/utils";

const AUTO_EXPAND_LOOP_MS = 400;
const AUTO_EXPAND_CLICK_COOLDOWN_MS = 1500;

export function initAutoExpandChatsFeature(ctx: FeatureContext): FeatureHandle {
  const qs = <T extends Element = Element>(sel: string, root: Document | Element = document) =>
    root.querySelector<T>(sel);

  const state: {
    running: boolean;
    started: boolean;
    completed: boolean;
    lastClickAtByKey: Map<string, number>;
    intervalId: number | null;
    observer: MutationObserver | null;
    domReady: boolean;
  } = {
    running: false,
    started: false,
    completed: false,
    lastClickAtByKey: new Map(),
    intervalId: null,
    observer: null,
    domReady: document.readyState !== "loading"
  };

  const autoExpandCanClick = (key: string) => {
    const t = state.lastClickAtByKey.get(key) || 0;
    return Date.now() - t > AUTO_EXPAND_CLICK_COOLDOWN_MS;
  };

  const autoExpandMarkClick = (key: string) => {
    state.lastClickAtByKey.set(key, Date.now());
  };

  const autoExpandDispatchClick = (el: HTMLElement) => {
    const seq = ["pointerdown", "mousedown", "mouseup", "click"];
    for (const t of seq) {
      el.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window }));
    }
  };

  const autoExpandReset = () => {
    state.running = false;
    state.started = false;
    state.completed = false;
    state.lastClickAtByKey.clear();
  };

  const autoExpandClickIfPossible = (key: string, el: HTMLElement | null, reason: string) => {
    if (!el) return false;
    if (!isElementVisible(el)) return false;
    if (!autoExpandCanClick(key)) return false;
    autoExpandMarkClick(key);
    ctx.logger.debug("AUTOEXPAND", `click ${key}`, { preview: reason });
    autoExpandDispatchClick(el);
    return true;
  };

  const autoExpandSidebarEl = () => qs<HTMLElement>("#stage-slideover-sidebar");

  const autoExpandSidebarIsOpen = () => {
    const sb = autoExpandSidebarEl();
    if (!sb) return false;
    if (!isElementVisible(sb)) return false;
    return sb.getBoundingClientRect().width >= 120;
  };

  const autoExpandOpenSidebarButton = () =>
    qs<HTMLButtonElement>(
      '#stage-sidebar-tiny-bar button[aria-label="Open sidebar"][aria-controls="stage-slideover-sidebar"]'
    ) ||
    qs<HTMLButtonElement>(
      'button[aria-label="Open sidebar"][aria-controls="stage-slideover-sidebar"]'
    );

  const autoExpandEnsureSidebarOpen = () => {
    if (autoExpandSidebarIsOpen()) return false;
    const btn = autoExpandOpenSidebarButton();
    return autoExpandClickIfPossible("openSidebar", btn, "sidebar closed by geometry");
  };

  const autoExpandChatHistoryNav = () => {
    const sb = autoExpandSidebarEl();
    if (!sb) return null;
    return sb.querySelector('nav[aria-label="Chat history"]');
  };

  const autoExpandFindYourChatsSection = (nav: Element | null) => {
    if (!nav) return null;

    const sections = Array.from(nav.querySelectorAll("div.group\\/sidebar-expando-section"));
    for (const sec of sections) {
      const t = norm(sec.textContent);
      if (
        t.includes("your chats") ||
        t.includes("your charts") ||
        t.includes("чаты") ||
        t.includes("история")
      ) {
        return sec;
      }
    }

    if (sections.length >= 4) return sections[3];
    return null;
  };

  const autoExpandSectionCollapsed = (sec: Element) => {
    const cls = String((sec as HTMLElement).className || "");
    if (cls.includes("sidebar-collapsed-section-margin-bottom")) return true;
    if (cls.includes("sidebar-expanded-section-margin-bottom")) return false;

    if (cls.includes("--sidebar-collapsed-section-margin-bottom")) return true;
    if (cls.includes("--sidebar-expanded-section-margin-bottom")) return false;

    return false;
  };

  const autoExpandExpandYourChats = () => {
    if (!autoExpandSidebarIsOpen()) return false;

    const nav = autoExpandChatHistoryNav();
    if (!nav || !isElementVisible(nav)) return false;

    const sec = autoExpandFindYourChatsSection(nav);
    if (!sec) return false;

    if (!autoExpandSectionCollapsed(sec)) return false;

    const btn =
      (sec as HTMLElement).querySelector("button.text-token-text-tertiary.flex.w-full") ||
      (sec as HTMLElement).querySelector("button") ||
      (sec as HTMLElement).querySelector('[role="button"]');

    return autoExpandClickIfPossible(
      "expandYourChats",
      btn as HTMLElement | null,
      "section looks collapsed"
    );
  };

  const autoExpandTryFinish = () => {
    if (!autoExpandSidebarIsOpen()) {
      autoExpandEnsureSidebarOpen();
      return false;
    }

    const nav = autoExpandChatHistoryNav();
    if (!nav || !isElementVisible(nav)) return false;

    const sec = autoExpandFindYourChatsSection(nav);
    if (!sec) return false;

    if (!autoExpandSectionCollapsed(sec)) return true;

    return autoExpandExpandYourChats();
  };

  const stopAutoExpand = () => {
    if (state.intervalId !== null) {
      window.clearInterval(state.intervalId);
      state.intervalId = null;
    }
    if (state.observer) {
      state.observer.disconnect();
      state.observer = null;
    }
  };

  const autoExpandTick = () => {
    if (!ctx.settings.autoExpandChats) return;
    if (state.completed) return;
    if (state.running) return;
    state.running = true;
    try {
      const done = autoExpandTryFinish();
      if (done) {
        state.completed = true;
        stopAutoExpand();
      }
    } catch (e) {
      ctx.logger.debug("AUTOEXPAND", "tick error", {
        preview: String((e && (e as Error).stack) || (e as Error).message || e)
      });
    } finally {
      state.running = false;
    }
  };

  const startAutoExpand = () => {
    if (state.started) return;
    state.started = true;
    autoExpandTick();

    state.intervalId = window.setInterval(autoExpandTick, AUTO_EXPAND_LOOP_MS);

    state.observer = new MutationObserver(() => autoExpandTick());
    state.observer.observe(document.documentElement, { childList: true, subtree: true });
  };

  const ensureStarted = () => {
    if (!ctx.settings.autoExpandChats) return;
    if (state.domReady) {
      startAutoExpand();
      return;
    }
    document.addEventListener(
      "DOMContentLoaded",
      () => {
        state.domReady = true;
        startAutoExpand();
      },
      { once: true }
    );
  };

  ensureStarted();

  return {
    name: "autoExpandChats",
    dispose: () => {
      stopAutoExpand();
    },
    onSettingsChange: (next, prev) => {
      if (!prev.autoExpandChats && next.autoExpandChats) {
        autoExpandReset();
        ensureStarted();
      }
      if (prev.autoExpandChats && !next.autoExpandChats) {
        stopAutoExpand();
      }
    },
    getStatus: () => ({ active: ctx.settings.autoExpandChats })
  };
}
