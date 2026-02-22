import { FeatureContext, FeatureHandle } from "../application/featureContext";
import { isElementVisible, norm } from "../lib/utils";

const AUTO_EXPAND_START_TIMEOUT_MS = 3500;
const AUTO_EXPAND_NAV_TIMEOUT_MS = 1500;
const AUTO_EXPAND_DEBOUNCE_MS = 250;
const AUTO_EXPAND_USER_COOLDOWN_MS = 5000;
const AUTO_EXPAND_MAX_ATTEMPTS = 25;

const AUTO_EXPAND_SIDEBAR_SELECTOR = "#stage-slideover-sidebar";
const AUTO_EXPAND_OPEN_BUTTON_SELECTOR =
  '#stage-sidebar-tiny-bar button[aria-label="Open sidebar"][aria-controls="stage-slideover-sidebar"], button[aria-label="Open sidebar"][aria-controls="stage-slideover-sidebar"]';

function dispatchHumanClick(el: HTMLElement): void {
  el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
  el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  el.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
  el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

function getSidebar(ctx: FeatureContext): HTMLElement | null {
  return ctx.helpers.safeQuery<HTMLElement>(AUTO_EXPAND_SIDEBAR_SELECTOR);
}

function getSidebarOpenButton(ctx: FeatureContext): HTMLButtonElement | null {
  return ctx.helpers.safeQuery<HTMLButtonElement>(AUTO_EXPAND_OPEN_BUTTON_SELECTOR);
}

function isSidebarOpen(ctx: FeatureContext): boolean {
  const sidebar = getSidebar(ctx);
  if (!sidebar) return false;
  if (!isElementVisible(sidebar)) return false;
  return sidebar.getBoundingClientRect().width >= 120;
}

function getChatHistoryNav(ctx: FeatureContext): HTMLElement | null {
  const busNav = ctx.domBus?.getNavRoot() as HTMLElement | null;
  const liveNav = ctx.helpers.safeQuery<HTMLElement>('nav[aria-label="Chat history"]');

  if (busNav && canInteract(busNav)) return busNav;
  if (liveNav && canInteract(liveNav)) return liveNav;

  if (busNav?.isConnected) return busNav;
  if (liveNav?.isConnected) return liveNav;

  return liveNav ?? busNav ?? null;
}

function findYourChatsToggle(nav: HTMLElement): HTMLButtonElement | null {
  const sections = Array.from(
    nav.querySelectorAll<HTMLElement>('[class*="sidebar-expando-section"]')
  );

  for (const section of sections) {
    const text = norm(section.textContent);
    if (!text.includes("your chats") && !text.includes("чаты") && !text.includes("история")) {
      continue;
    }

    const headerBtn = section.querySelector<HTMLButtonElement>("button[aria-expanded]");
    if (headerBtn) return headerBtn;

    const fallbackBtn = section.querySelector<HTMLButtonElement>("button");
    if (fallbackBtn) return fallbackBtn;
  }

  return null;
}

function isToggleExpanded(toggle: HTMLElement): boolean {
  const aria = toggle.getAttribute("aria-expanded");
  if (aria === "true") return true;

  const cls = String(toggle.className || "");
  if (cls.includes("sidebar-expanded-section")) return true;
  return false;
}

function isToggleCollapsed(toggle: HTMLElement): boolean {
  const aria = toggle.getAttribute("aria-expanded");
  if (aria === "false") return true;

  const cls = String(toggle.className || "");
  if (cls.includes("sidebar-collapsed-section")) return true;
  return false;
}

function canInteract(el: HTMLElement | null): boolean {
  if (!el) return false;
  if (!el.isConnected) return false;
  if (!isElementVisible(el)) return false;
  return true;
}

export function initAutoExpandChatsFeature(ctx: FeatureContext): FeatureHandle {
  let stopped = false;
  let goalReached = false;
  let attempts = 0;
  let debounceTimer: number | null = null;
  let startTimer: number | null = null;
  let navReadyTimer: number | null = null;
  let lastUserInteractionAt = 0;
  let cleanupUserListeners: (() => void) | null = null;
  let unsubNavDelta: (() => void) | null = null;
  let unsubRoots: (() => void) | null = null;

  const cancelTimers = (): void => {
    if (debounceTimer !== null) window.clearTimeout(debounceTimer);
    debounceTimer = null;
    if (startTimer !== null) window.clearTimeout(startTimer);
    startTimer = null;
    if (navReadyTimer !== null) window.clearTimeout(navReadyTimer);
    navReadyTimer = null;
  };

  const bindUserInteractionGuards = (): void => {
    cleanupUserListeners?.();
    cleanupUserListeners = null;

    const targets = [getSidebar(ctx), getChatHistoryNav(ctx)].filter(Boolean) as HTMLElement[];
    if (targets.length === 0) return;

    const onUser = () => {
      lastUserInteractionAt = Date.now();
    };

    for (const target of targets) {
      target.addEventListener("pointerdown", onUser, true);
      target.addEventListener("mousedown", onUser, true);
      target.addEventListener("click", onUser, true);
    }

    cleanupUserListeners = () => {
      for (const target of targets) {
        target.removeEventListener("pointerdown", onUser, true);
        target.removeEventListener("mousedown", onUser, true);
        target.removeEventListener("click", onUser, true);
      }
    };
  };

  const runOnce = (reason: string): boolean => {
    const nav = getChatHistoryNav(ctx);
    if (nav && canInteract(nav)) {
      const toggle = findYourChatsToggle(nav);
      if (!toggle) {
        ctx.logger.debug("autoExpandChats", `skip (${reason}): Your chats toggle missing`);
        return false;
      }
      if (!canInteract(toggle)) {
        ctx.logger.debug("autoExpandChats", `skip (${reason}): Your chats toggle not interactable`);
        return false;
      }

      if (isToggleExpanded(toggle)) {
        ctx.logger.debug("autoExpandChats", `already expanded (${reason})`);
        return true;
      }

      if (!isToggleCollapsed(toggle)) {
        ctx.logger.debug("autoExpandChats", `skip (${reason}): toggle state unknown`);
        return false;
      }

      ctx.logger.debug("autoExpandChats", `click Your chats toggle (${reason})`);
      dispatchHumanClick(toggle);

      const success = isToggleExpanded(toggle);
      ctx.logger.debug(
        "autoExpandChats",
        `post-click expanded=${success ? "true" : "false"} (${reason})`
      );

      return success;
    }

    if (nav) {
      ctx.logger.debug(
        "autoExpandChats",
        `skip (${reason}): chat history nav not interactable yet`
      );
    }

    const sidebar = getSidebar(ctx);
    if (!sidebar) {
      ctx.logger.debug("autoExpandChats", `skip (${reason}): missing sidebar root`);
      return false;
    }

    const sidebarOpen = isSidebarOpen(ctx);
    if (!sidebarOpen) {
      const openBtn = getSidebarOpenButton(ctx);
      if (!openBtn || !canInteract(openBtn)) {
        ctx.logger.debug(
          "autoExpandChats",
          `skip (${reason}): sidebar closed and no usable open button`
        );
        return false;
      }

      ctx.logger.debug("autoExpandChats", `click sidebar open (${reason})`);
      dispatchHumanClick(openBtn);
      return false;
    }

    ctx.logger.debug("autoExpandChats", `skip (${reason}): chat history nav missing/unready`);
    return false;
  };

  const schedule = (reason: string): void => {
    if (stopped) return;
    if (!ctx.settings.autoExpandChats) return;
    if (goalReached) return;

    if (debounceTimer !== null) window.clearTimeout(debounceTimer);

    debounceTimer = window.setTimeout(() => {
      debounceTimer = null;
      if (stopped || !ctx.settings.autoExpandChats || goalReached) return;

      if (Date.now() - lastUserInteractionAt < AUTO_EXPAND_USER_COOLDOWN_MS) {
        ctx.logger.debug("autoExpandChats", `cooldown active, skip (${reason})`);
        return;
      }

      attempts += 1;
      if (attempts > AUTO_EXPAND_MAX_ATTEMPTS) {
        ctx.logger.debug("autoExpandChats", "max attempts reached, stop retries");
        return;
      }

      const done = runOnce(reason);
      if (done) {
        goalReached = true;
        attempts = 0;
      }
    }, AUTO_EXPAND_DEBOUNCE_MS);
  };

  const reset = () => {
    goalReached = false;
    attempts = 0;
    bindUserInteractionGuards();
  };

  bindUserInteractionGuards();

  startTimer = window.setTimeout(() => {
    startTimer = null;
    schedule("start");
  }, AUTO_EXPAND_START_TIMEOUT_MS);

  navReadyTimer = window.setTimeout(() => {
    navReadyTimer = null;
    schedule("nav-ready");
  }, AUTO_EXPAND_NAV_TIMEOUT_MS);

  unsubRoots =
    ctx.domBus?.onRoots(() => {
      reset();
      schedule("route");
    }) ?? null;

  unsubNavDelta =
    ctx.domBus?.onDelta("nav", () => {
      schedule("mutation");
    }) ?? null;

  schedule("init");

  return {
    name: "autoExpandChats",
    dispose: () => {
      stopped = true;
      cancelTimers();
      cleanupUserListeners?.();
      cleanupUserListeners = null;
      unsubNavDelta?.();
      unsubNavDelta = null;
      unsubRoots?.();
      unsubRoots = null;
    },
    onSettingsChange: (next, prev) => {
      if (!prev.autoExpandChats && next.autoExpandChats) {
        stopped = false;
        reset();
        schedule("settings");
      }

      if (prev.autoExpandChats && !next.autoExpandChats) {
        goalReached = true;
        attempts = 0;
        cancelTimers();
      }
    },
    getStatus: () => ({ active: ctx.settings.autoExpandChats }),
    __test: {
      runOnce,
      findYourChatsToggle,
      isToggleExpanded
    }
  };
}
