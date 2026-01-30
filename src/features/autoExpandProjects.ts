import { FeatureContext, FeatureHandle } from "../application/featureContext";
import { isElementVisible, norm } from "../lib/utils";

const AUTO_EXPAND_START_TIMEOUT_MS = 3500;
const AUTO_EXPAND_NAV_TIMEOUT_MS = 1500;

export function initAutoExpandProjectsFeature(ctx: FeatureContext): FeatureHandle {
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
    const ok1 = await ctx.helpers.waitPresent(
      '[data-testid="blocking-initial-modals-done"]',
      document,
      12000
    );
    if (!ok1) return false;

    const ok2 = await ctx.helpers.waitPresent("#stage-slideover-sidebar", document, 12000);
    if (!ok2) return false;

    const ok3 = await ctx.helpers.waitPresent('nav[aria-label="Chat history"]', document, 12000);
    if (!ok3) return false;

    return true;
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

  const autoExpandFindProjectsSection = (nav: Element | null) => {
    if (!nav) return null;

    const sections = Array.from(nav.querySelectorAll("div.group\\/sidebar-expando-section"));
    for (const sec of sections) {
      const t = norm(sec.textContent);
      if (t.includes("projects") || t.includes("project") || t.includes("проекты")) {
        return sec;
      }
    }

    return null;
  };

  const autoExpandFindProjectExpanders = (sec: Element) => {
    const buttons = Array.from(
      sec.querySelectorAll<HTMLElement>(
        'button[aria-expanded="false"], [role="button"][aria-expanded="false"]'
      )
    ).filter((el) => isElementVisible(el));
    if (buttons.length) return buttons;

    return Array.from(sec.querySelectorAll<HTMLElement>('a[aria-expanded="false"]')).filter((el) =>
      isElementVisible(el)
    );
  };

  const autoExpandSectionCollapsed = (sec: Element) => {
    const cls = String((sec as HTMLElement).className || "");
    if (cls.includes("sidebar-collapsed-section-margin-bottom")) return true;
    if (cls.includes("sidebar-expanded-section-margin-bottom")) return false;

    if (cls.includes("--sidebar-collapsed-section-margin-bottom")) return true;
    if (cls.includes("--sidebar-expanded-section-margin-bottom")) return false;

    return false;
  };

  const autoExpandExpandProjectItems = (sec: Element) => {
    if (!ctx.settings.autoExpandProjectItems) return false;
    const targets = autoExpandFindProjectExpanders(sec);
    if (!targets.length) return false;
    for (const target of targets) {
      autoExpandDispatchClick(target);
    }
    return true;
  };

  const autoExpandExpandProjects = () => {
    if (!autoExpandSidebarIsOpen()) return false;

    const nav = autoExpandChatHistoryNav();
    if (!nav || !isElementVisible(nav)) return false;

    const sec = autoExpandFindProjectsSection(nav);
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
    if (!ctx.settings.autoExpandProjects) return false;

    const present = await autoExpandWaitForSidebar();
    if (!present || runId !== state.runId || !ctx.settings.autoExpandProjects) {
      if (runId === state.runId && ctx.settings.autoExpandProjects) {
        ctx.logger.debug("AUTOEXPAND_PROJECTS", "sidebar not found on start (timeout)");
      }
      return false;
    }

    if (autoExpandSidebarIsOpen()) {
      const nav = await ctx.helpers.waitPresent(
        'nav[aria-label="Chat history"]',
        document,
        AUTO_EXPAND_NAV_TIMEOUT_MS
      );
      if (!nav || runId !== state.runId || !ctx.settings.autoExpandProjects) {
        if (runId === state.runId && ctx.settings.autoExpandProjects) {
          ctx.logger.debug("AUTOEXPAND_PROJECTS", "sidebar not found on start (timeout)");
        }
        return false;
      }

      const sec = autoExpandFindProjectsSection(nav);
      if (sec && !autoExpandSectionCollapsed(sec)) {
        if (autoExpandExpandProjectItems(sec)) {
          ctx.logger.debug("AUTOEXPAND_PROJECTS", "expanded project items on start");
        }
        ctx.logger.debug("AUTOEXPAND_PROJECTS", "already expanded on start");
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
    if (!nav || runId !== state.runId || !ctx.settings.autoExpandProjects) {
      if (runId === state.runId && ctx.settings.autoExpandProjects) {
        ctx.logger.debug("AUTOEXPAND_PROJECTS", "sidebar not found on start (timeout)");
      }
      return false;
    }

    const sec = autoExpandFindProjectsSection(nav);
    if (sec && !autoExpandSectionCollapsed(sec)) {
      if (autoExpandExpandProjectItems(sec)) {
        ctx.logger.debug("AUTOEXPAND_PROJECTS", "expanded project items on start");
      }
      ctx.logger.debug("AUTOEXPAND_PROJECTS", "already expanded on start");
      return true;
    }

    if (autoExpandExpandProjects()) {
      ctx.logger.debug("AUTOEXPAND_PROJECTS", "expanded on start");
      if (sec && ctx.settings.autoExpandProjectItems) {
        const expanderSelector =
          'button[aria-expanded="false"], [role="button"][aria-expanded="false"], a[aria-expanded="false"]';
        await ctx.helpers.waitPresent(expanderSelector, sec, 1000);
        if (runId !== state.runId || !ctx.settings.autoExpandProjects) {
          return true;
        }
        if (autoExpandExpandProjectItems(sec)) {
          ctx.logger.debug("AUTOEXPAND_PROJECTS", "expanded project items on start");
        }
      }
      return true;
    }

    return false;
  };

  const startAutoExpand = () => {
    if (state.started) return;
    state.started = true;
    const currentRun = state.runId;

    void (async () => {
      if (!ctx.settings.autoExpandProjects) return;
      if (currentRun !== state.runId) return;

      const spaReady = await waitForSpaReady();
      if (!spaReady) {
        if (currentRun === state.runId && ctx.settings.autoExpandProjects) {
          ctx.logger.debug("AUTOEXPAND_PROJECTS", "spa not ready (timeout), skip");
        }
        return;
      }

      if (currentRun !== state.runId || !ctx.settings.autoExpandProjects) return;

      const done = await autoExpandRunOnce(currentRun);
      if (!done) {
        ctx.logger.debug("AUTOEXPAND_PROJECTS", "runOnce returned false");
      }
    })();
  };

  const ensureStarted = () => {
    if (!ctx.settings.autoExpandProjects) return;
    startAutoExpand();
  };

  ensureStarted();

  return {
    name: "autoExpandProjects",
    dispose: () => {
      state.runId += 1;
    },
    onSettingsChange: (next, prev) => {
      if (!prev.autoExpandProjects && next.autoExpandProjects) {
        autoExpandReset();
        ensureStarted();
      }
      if (
        prev.autoExpandProjectItems !== next.autoExpandProjectItems &&
        next.autoExpandProjects &&
        next.autoExpandProjectItems
      ) {
        autoExpandReset();
        ensureStarted();
      }
      if (prev.autoExpandProjects && !next.autoExpandProjects) {
        state.runId += 1;
      }
    },
    getStatus: () => ({ active: ctx.settings.autoExpandProjects })
  };
}
