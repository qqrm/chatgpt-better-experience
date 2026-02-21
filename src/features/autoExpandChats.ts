import { FeatureContext, FeatureHandle } from "../application/featureContext";
import { isElementVisible, norm } from "../lib/utils";

const AUTO_EXPAND_START_TIMEOUT_MS = 3500;
const AUTO_EXPAND_NAV_TIMEOUT_MS = 1500;

export function initAutoExpandChatsFeature(ctx: FeatureContext): FeatureHandle {
  const qs = <T extends Element = Element>(sel: string, root: Document | Element = document) =>
    root.querySelector<T>(sel);

  const state: {
    started: boolean;
    runId: number;
  } = {
    started: false,
    runId: 0
  };

  const waitForSpaReady = async (): Promise<boolean> => {
    // ChatGPT UI changed multiple times: the historical readiness marker
    // ([data-testid="blocking-initial-modals-done"]) is not always present,
    // and the chat-history nav can be lazily mounted only after the sidebar opens.
    // We only need the sidebar shell or its open button to exist; runOnce() will
    // handle opening the sidebar and waiting for the nav.
    const ready = await ctx.helpers.waitPresent(
      '#stage-slideover-sidebar, #stage-sidebar-tiny-bar button[aria-label="Open sidebar"][aria-controls="stage-slideover-sidebar"], button[aria-label="Open sidebar"][aria-controls="stage-slideover-sidebar"]',
      document,
      12000
    );

    return !!ready;
  };

  const autoExpandDispatchClick = (el: HTMLElement) => {
    const seq = ["pointerdown", "mousedown", "mouseup", "click"];
    for (const t of seq) {
      el.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window }));
    }
  };

  const autoExpandReset = () => {
    state.started = false;
    state.runId += 1;
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
    if (!btn || !isElementVisible(btn)) return false;
    autoExpandDispatchClick(btn);
    return true;
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

    if (!btn || !isElementVisible(btn as HTMLElement)) return false;

    autoExpandDispatchClick(btn as HTMLElement);
    return true;
  };

  const autoExpandWaitForSidebar = async () => {
    const sidebarSelector = "#stage-slideover-sidebar";
    const openButtonSelector =
      '#stage-sidebar-tiny-bar button[aria-label="Open sidebar"][aria-controls="stage-slideover-sidebar"], button[aria-label="Open sidebar"][aria-controls="stage-slideover-sidebar"]';
    const selector = `${sidebarSelector}, ${openButtonSelector}`;
    return ctx.helpers.waitPresent(selector, document, AUTO_EXPAND_START_TIMEOUT_MS);
  };

  const autoExpandRunOnce = async (runId: number): Promise<boolean> => {
    if (!ctx.settings.autoExpandChats) return false;

    const present = await autoExpandWaitForSidebar();
    if (!present || runId !== state.runId || !ctx.settings.autoExpandChats) {
      if (runId === state.runId && ctx.settings.autoExpandChats) {
        ctx.logger.debug("AUTOEXPAND", "sidebar not found on start (timeout)");
      }
      return false;
    }

    if (autoExpandSidebarIsOpen()) {
      const nav = await ctx.helpers.waitPresent(
        'nav[aria-label="Chat history"]',
        document,
        AUTO_EXPAND_NAV_TIMEOUT_MS
      );
      if (!nav || runId !== state.runId || !ctx.settings.autoExpandChats) {
        if (runId === state.runId && ctx.settings.autoExpandChats) {
          ctx.logger.debug("AUTOEXPAND", "sidebar not found on start (timeout)");
        }
        return false;
      }

      const sec = autoExpandFindYourChatsSection(nav);
      if (sec && !autoExpandSectionCollapsed(sec)) {
        ctx.logger.debug("AUTOEXPAND", "already expanded on start");
        return true;
      }
    }

    if (!autoExpandSidebarIsOpen()) {
      autoExpandEnsureSidebarOpen();
    }

    const nav = await ctx.helpers.waitPresent(
      'nav[aria-label="Chat history"]',
      document,
      AUTO_EXPAND_NAV_TIMEOUT_MS
    );
    if (!nav || runId !== state.runId || !ctx.settings.autoExpandChats) {
      if (runId === state.runId && ctx.settings.autoExpandChats) {
        ctx.logger.debug("AUTOEXPAND", "sidebar not found on start (timeout)");
      }
      return false;
    }

    const sec = autoExpandFindYourChatsSection(nav);
    if (sec && !autoExpandSectionCollapsed(sec)) {
      ctx.logger.debug("AUTOEXPAND", "already expanded on start");
      return true;
    }

    if (autoExpandExpandYourChats()) {
      ctx.logger.debug("AUTOEXPAND", "expanded on start");
      return true;
    }

    return false;
  };

  const startAutoExpand = () => {
    if (state.started) return;
    state.started = true;
    const currentRun = state.runId;

    void (async () => {
      if (!ctx.settings.autoExpandChats) return;
      if (currentRun !== state.runId) return;

      const spaReady = await waitForSpaReady();
      if (!spaReady) {
        if (currentRun === state.runId && ctx.settings.autoExpandChats) {
          ctx.logger.debug("AUTOEXPAND", "spa not ready (timeout), skip");
        }
        return;
      }

      if (currentRun !== state.runId || !ctx.settings.autoExpandChats) return;

      const done = await autoExpandRunOnce(currentRun);
      if (!done) {
        ctx.logger.debug("AUTOEXPAND", "runOnce returned false");
      }
    })();
  };

  const ensureStarted = () => {
    if (!ctx.settings.autoExpandChats) return;
    startAutoExpand();
  };

  ensureStarted();

  return {
    name: "autoExpandChats",
    dispose: () => {
      state.runId += 1;
    },
    onSettingsChange: (next, prev) => {
      if (!prev.autoExpandChats && next.autoExpandChats) {
        autoExpandReset();
        ensureStarted();
      }
      if (prev.autoExpandChats && !next.autoExpandChats) {
        state.runId += 1;
      }
    },
    getStatus: () => ({ active: ctx.settings.autoExpandChats })
  };
}
