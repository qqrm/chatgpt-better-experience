import { FeatureContext, FeatureHandle } from "../application/featureContext";
import { isElementVisible, norm } from "../lib/utils";

// Sidebar is very dynamic. If we keep clicking while the user interacts (or while React
// is rerendering), the UI can jitter/shake and sometimes trigger full rerenders.
// Therefore:
// - No periodic polling.
// - Shared DOM bus events are consumed only until the goal is reached.
// - We pause automation shortly after any user interaction inside the sidebar.
// - We stop completely once we have achieved the configured goal.

const AUTO_EXPAND_START_TIMEOUT_MS = 3500;
const AUTO_EXPAND_NAV_TIMEOUT_MS = 1500;
const AUTO_EXPAND_DEBOUNCE_MS = 250;
// User interaction cooldown must be long enough to cover React re-renders caused
// by project toggle clicks. Otherwise we can end up clicking the same toggle
// multiple times while the UI is still animating, causing jitter/shake.
const AUTO_EXPAND_USER_COOLDOWN_MS = 5000;
const AUTO_EXPAND_MAX_ATTEMPTS = 25;

type ExpandStats = {
  projectsExpanded: boolean;
  projectRows: number;
  folderClicks: number;
};

function dispatchHumanClick(el: HTMLElement): void {
  el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
  el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  el.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
  el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

function getChatHistoryNav(ctx: FeatureContext): HTMLElement | null {
  return (
    (ctx.domBus?.getNavRoot() as HTMLElement | null) ??
    ctx.helpers.safeQuery<HTMLElement>('nav[aria-label="Chat history"]')
  );
}

function findProjectsSection(nav: HTMLElement): HTMLElement | null {
  const sections = Array.from(
    nav.querySelectorAll<HTMLElement>('[class*="sidebar-expando-section"]')
  );

  for (const sec of sections) {
    if (sec.querySelector('a[href*="/project"]')) return sec;
  }

  for (const sec of sections) {
    const t = norm(sec.textContent);
    if (t.includes("projects") || t.includes("проекты")) return sec;
  }

  return null;
}

function isSectionCollapsed(section: HTMLElement): boolean {
  const cls = section.className;
  if (cls.includes("sidebar-collapsed-section")) return true;
  if (cls.includes("sidebar-expanded-section")) return false;

  const headerBtn = section.querySelector<HTMLButtonElement>("button[aria-expanded]");
  return headerBtn?.getAttribute("aria-expanded") === "false";
}

function expandSectionIfNeeded(ctx: FeatureContext, section: HTMLElement): boolean {
  const headerBtn = section.querySelector<HTMLButtonElement>("button[aria-expanded]");
  if (!headerBtn) return false;

  const expanded = headerBtn.getAttribute("aria-expanded") === "true";
  if (expanded) return true;

  if (!isElementVisible(headerBtn)) return false;

  ctx.logger.debug("autoExpandProjects", "expanding Projects section");
  dispatchHumanClick(headerBtn);
  return true;
}

function isProjectExpanded(projectLink: HTMLAnchorElement): boolean {
  const sib = projectLink.nextElementSibling as HTMLElement | null;
  if (!sib) return false;
  if (!sib.className.includes("overflow-hidden")) return false;
  return sib.querySelector('a[href*="/c/"]') !== null;
}

function findFolderToggleButton(rowScope: HTMLElement): HTMLButtonElement | null {
  const buttons = Array.from(rowScope.querySelectorAll<HTMLButtonElement>("button"));

  // Prefer explicit toggles first.
  for (const b of buttons) {
    const aria = norm(b.getAttribute("aria-label"));
    const title = norm(b.getAttribute("title"));
    const hint = `${aria} ${title}`;
    if (
      (hint.includes("show") ||
        hint.includes("hide") ||
        hint.includes("expand") ||
        hint.includes("collapse")) &&
      (hint.includes("chat") || hint.includes("project") || hint.includes("folder"))
    ) {
      return b;
    }
  }

  // Common case in current UI: <button class="icon" data-state="...">
  const byIcon = rowScope.querySelector<HTMLButtonElement>("button.icon");
  if (byIcon) return byIcon;

  // Fallback: only accept small icon-like buttons with an svg.
  // Avoid clicking wide buttons (often navigation) to prevent rerender jitter.
  for (const b of buttons) {
    if (!b.querySelector("svg")) continue;
    const r = b.getBoundingClientRect();
    if (r.width > 48 || r.height > 48) continue;
    return b;
  }

  return null;
}

function pickTargetProject(section: HTMLElement): HTMLAnchorElement | null {
  const projects = Array.from(section.querySelectorAll<HTMLAnchorElement>('a[href*="/project"]'));
  if (projects.length === 0) return null;

  // Prefer VPN project when present.
  for (const a of projects) {
    const href = a.getAttribute("href") ?? "";
    if (href.includes("/vpn/project") || href.includes("-vpn/")) return a;
  }
  for (const a of projects) {
    const label = norm(a.textContent);
    if (label === "vpn" || label.includes(" vpn ")) return a;
  }

  return projects[0];
}

function expandTargetProject(ctx: FeatureContext, section: HTMLElement): number {
  const target = pickTargetProject(section);
  if (!target) return 0;

  const href = target.getAttribute("href") ?? "";

  // Critical: do nothing if already expanded.
  if (isProjectExpanded(target)) {
    ctx.logger.debug("autoExpandProjects", `target already expanded: ${href}`);
    return 0;
  }

  const row =
    target.closest<HTMLElement>("li") ??
    target.closest<HTMLElement>("div") ??
    target.parentElement ??
    target;

  const scopeCandidates: HTMLElement[] = [row];
  if (row.parentElement) scopeCandidates.push(row.parentElement);

  let btn: HTMLButtonElement | null = null;
  for (const sc of scopeCandidates) {
    btn = findFolderToggleButton(sc);
    if (btn) break;
  }

  if (!btn) {
    ctx.logger.debug("autoExpandProjects", `no folder button found for target: ${href}`);
    return 0;
  }
  if (!isElementVisible(btn)) {
    ctx.logger.debug("autoExpandProjects", `folder button not visible for target: ${href}`);
    return 0;
  }

  ctx.logger.debug("autoExpandProjects", `click folder icon for target: ${href}`);
  dispatchHumanClick(btn);
  return 1;
}

function runOnce(ctx: FeatureContext, reason: string): { stats: ExpandStats; done: boolean } {
  const nav = getChatHistoryNav(ctx);
  if (!nav) {
    ctx.logger.debug("autoExpandProjects", `no sidebar nav yet (${reason})`);
    return { stats: { projectsExpanded: false, projectRows: 0, folderClicks: 0 }, done: false };
  }

  const section = findProjectsSection(nav);
  if (!section) {
    ctx.logger.debug("autoExpandProjects", `no Projects section yet (${reason})`);
    return { stats: { projectsExpanded: false, projectRows: 0, folderClicks: 0 }, done: false };
  }

  const wantProjects = ctx.settings.autoExpandProjects;
  const wantItems = ctx.settings.autoExpandProjectItems;

  if (!wantProjects && !wantItems) {
    return { stats: { projectsExpanded: false, projectRows: 0, folderClicks: 0 }, done: true };
  }

  let expanded = !isSectionCollapsed(section);
  if (wantProjects && !expanded) {
    expanded = expandSectionIfNeeded(ctx, section);
  }

  const rows = section.querySelectorAll('a[href*="/project"]').length;

  let folderClicks = 0;
  if (expanded && wantItems) {
    folderClicks = expandTargetProject(ctx, section);
  }

  const done = wantItems ? expanded && folderClicks === 0 && rows > 0 : expanded;

  ctx.logger.debug(
    "autoExpandProjects",
    `${reason} expanded=${expanded} rows=${rows} folderClicks=${folderClicks} done=${done}`
  );

  return { stats: { projectsExpanded: expanded, projectRows: rows, folderClicks }, done };
}

export function initAutoExpandProjectsFeature(ctx: FeatureContext): FeatureHandle {
  let stopped = false;
  let debounceTimer: number | null = null;
  let navRetryTimeout: number | null = null;
  let attempts = 0;
  let lastUserInteractionAt = 0;
  let lastAutoClickAt = 0;
  let cleanupUserListeners: (() => void) | null = null;
  let unsubNavDelta: (() => void) | null = null;
  let unsubRoots: (() => void) | null = null;
  let startTimer: number | null = null;
  let navReadyTimer: number | null = null;

  const bindUserInteractionGuards = (nav: HTMLElement | null) => {
    cleanupUserListeners?.();
    cleanupUserListeners = null;
    if (!nav) return;
    const onUser = () => {
      lastUserInteractionAt = Date.now();
    };
    nav.addEventListener("pointerdown", onUser, true);
    nav.addEventListener("mousedown", onUser, true);
    nav.addEventListener("click", onUser, true);
    cleanupUserListeners = () => {
      nav.removeEventListener("pointerdown", onUser, true);
      nav.removeEventListener("mousedown", onUser, true);
      nav.removeEventListener("click", onUser, true);
    };
  };

  const stop = (): void => {
    stopped = true;
    if (debounceTimer !== null) window.clearTimeout(debounceTimer);
    debounceTimer = null;
    if (navRetryTimeout !== null) window.clearTimeout(navRetryTimeout);
    navRetryTimeout = null;
    if (startTimer !== null) window.clearTimeout(startTimer);
    startTimer = null;
    if (navReadyTimer !== null) window.clearTimeout(navReadyTimer);
    navReadyTimer = null;
    unsubNavDelta?.();
    unsubNavDelta = null;
    unsubRoots?.();
    unsubRoots = null;
    cleanupUserListeners?.();
    cleanupUserListeners = null;
  };

  const schedule = (reason: string): void => {
    if (stopped) return;
    if (debounceTimer !== null) window.clearTimeout(debounceTimer);

    debounceTimer = window.setTimeout(() => {
      debounceTimer = null;
      if (stopped) return;

      if (Date.now() - lastUserInteractionAt < AUTO_EXPAND_USER_COOLDOWN_MS) return;
      if (Date.now() - lastAutoClickAt < 1500) return;

      attempts += 1;
      if (attempts > AUTO_EXPAND_MAX_ATTEMPTS) {
        ctx.logger.debug("autoExpandProjects", "max attempts reached, stop");
        stop();
        return;
      }

      const { stats, done } = runOnce(ctx, reason);
      if (stats.folderClicks > 0) lastAutoClickAt = Date.now();
      if (done) {
        ctx.logger.debug("autoExpandProjects", "goal reached, stop");
        stop();
      }
    }, AUTO_EXPAND_DEBOUNCE_MS);
  };

  startTimer = window.setTimeout(() => {
    startTimer = null;
    schedule("start");
  }, AUTO_EXPAND_START_TIMEOUT_MS);
  navReadyTimer = window.setTimeout(() => {
    navReadyTimer = null;
    schedule("nav-ready");
  }, AUTO_EXPAND_NAV_TIMEOUT_MS);

  const refreshNavBindings = () => {
    const nav = getChatHistoryNav(ctx);
    bindUserInteractionGuards(nav);
    if (!nav && navRetryTimeout === null && !stopped) {
      navRetryTimeout = window.setTimeout(() => {
        navRetryTimeout = null;
        schedule("late-nav");
      }, 1000);
    }
  };

  refreshNavBindings();

  unsubRoots =
    ctx.domBus?.onRoots((roots) => {
      bindUserInteractionGuards((roots.nav as HTMLElement | null) ?? null);
      schedule("route");
    }) ?? null;

  unsubNavDelta =
    ctx.domBus?.onDelta("nav", () => {
      schedule("mutation");
    }) ?? null;

  return {
    name: "autoExpandProjects",
    dispose: () => stop(),
    __test: {
      getChatHistoryNav,
      findProjectsSection,
      isSectionCollapsed,
      runOnce
    }
  };
}
