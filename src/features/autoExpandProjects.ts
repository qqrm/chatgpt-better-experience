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
  collapsedProjectRows: number;
  folderClicks: number;
};

function isFeatureEnabled(ctx: FeatureContext): boolean {
  return ctx.settings.autoExpandProjects || ctx.settings.autoExpandProjectItems;
}

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
  // Do not report success until the DOM confirms aria-expanded="true" on a later run.
  return false;
}

function isProjectExpanded(
  projectLink: HTMLAnchorElement,
  rowFolderButton?: HTMLButtonElement | null
): boolean {
  const folderButton = rowFolderButton ?? findFolderToggleButtonForProject(projectLink);
  const folderState = folderButton?.getAttribute("data-state");
  if (folderState === "open") return true;
  if (folderState === "closed") return false;

  const sib = projectLink.nextElementSibling as HTMLElement | null;
  if (!sib) return false;
  if (!sib.className.includes("overflow-hidden")) return false;

  // ChatGPT can keep project chats mounted in the DOM even when the folder is collapsed.
  // Presence of /c/ links alone is not a reliable expansion signal.
  if (sib.querySelector('a[href*="/c/"]') === null) return false;

  const ariaHidden = sib.getAttribute("aria-hidden");
  if (ariaHidden === "true") return false;
  if (sib.hasAttribute("hidden")) return false;

  const inlineDisplay = norm(sib.style.display);
  const inlineVisibility = norm(sib.style.visibility);
  const inlineOpacity = norm(sib.style.opacity);
  if (inlineDisplay === "none") return false;
  if (inlineVisibility === "hidden") return false;
  if (inlineOpacity === "0") return false;

  const inlineHeight = sib.style.height.trim();
  if (/^0(?:px|rem|em|%)?$/.test(inlineHeight)) return false;
  const inlineMaxHeight = sib.style.maxHeight.trim();
  if (/^0(?:px|rem|em|%)?$/.test(inlineMaxHeight)) return false;

  return true;
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
  const byStatefulIcon = rowScope.querySelector<HTMLButtonElement>("button.icon[data-state]");
  if (byStatefulIcon) return byStatefulIcon;

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

function findFolderToggleButtonForProject(
  projectLink: HTMLAnchorElement
): HTMLButtonElement | null {
  // Current ChatGPT DOM usually nests the folder toggle inside the project row anchor.
  let btn = findFolderToggleButton(projectLink);
  if (btn) return btn;

  const li = projectLink.closest<HTMLElement>("li");
  if (li) {
    btn = findFolderToggleButton(li);
    if (btn) return btn;
  }

  const parent = projectLink.parentElement;
  if (parent) {
    // Avoid searching the whole Projects section (it makes us click the first row repeatedly).
    const projectLinksInParent = parent.querySelectorAll('a[href*="/project"]').length;
    if (projectLinksInParent <= 1) {
      btn = findFolderToggleButton(parent);
      if (btn) return btn;
    }
  }

  return null;
}

function isExpandableProjectRow(
  projectLink: HTMLAnchorElement,
  rowFolderButton: HTMLButtonElement | null
): boolean {
  const sib = projectLink.nextElementSibling as HTMLElement | null;
  if (sib && sib.className.includes("overflow-hidden")) return true;
  return rowFolderButton?.matches("button.icon[data-state]") ?? false;
}

function expandCollapsedProjectFolders(
  ctx: FeatureContext,
  section: HTMLElement
): { totalRows: number; collapsedRows: number; folderClicks: number } {
  const projects = Array.from(section.querySelectorAll<HTMLAnchorElement>('a[href*="/project"]'));
  if (projects.length === 0) {
    return { totalRows: 0, collapsedRows: 0, folderClicks: 0 };
  }

  let collapsedRows = 0;
  let folderClicks = 0;

  for (const projectLink of [...projects].reverse()) {
    const href = projectLink.getAttribute("href") ?? "";
    const btn = findFolderToggleButtonForProject(projectLink);

    // Skip non-expandable rows like "New project" (different icon/no folder state).
    if (!isExpandableProjectRow(projectLink, btn)) {
      continue;
    }

    if (isProjectExpanded(projectLink, btn)) continue;

    collapsedRows += 1;

    // Click at most one folder toggle per run to avoid sidebar jitter/rerenders.
    if (folderClicks > 0) continue;

    if (!btn) {
      ctx.logger.debug("autoExpandProjects", `no folder button found for project: ${href}`);
      continue;
    }
    if (!isElementVisible(btn)) {
      ctx.logger.debug("autoExpandProjects", `folder button not visible for project: ${href}`);
      continue;
    }

    ctx.logger.debug("autoExpandProjects", `click folder icon for project: ${href}`);
    dispatchHumanClick(btn);
    folderClicks = 1;
  }

  return { totalRows: projects.length, collapsedRows, folderClicks };
}

function runOnce(ctx: FeatureContext, reason: string): { stats: ExpandStats; done: boolean } {
  const nav = getChatHistoryNav(ctx);
  if (!nav) {
    ctx.logger.debug("autoExpandProjects", `no sidebar nav yet (${reason})`);
    return {
      stats: { projectsExpanded: false, projectRows: 0, collapsedProjectRows: 0, folderClicks: 0 },
      done: false
    };
  }

  const section = findProjectsSection(nav);
  if (!section) {
    ctx.logger.debug("autoExpandProjects", `no Projects section yet (${reason})`);
    return {
      stats: { projectsExpanded: false, projectRows: 0, collapsedProjectRows: 0, folderClicks: 0 },
      done: false
    };
  }

  const wantProjects = ctx.settings.autoExpandProjects;
  const wantItems = ctx.settings.autoExpandProjectItems;

  if (!wantProjects && !wantItems) {
    return {
      stats: { projectsExpanded: false, projectRows: 0, collapsedProjectRows: 0, folderClicks: 0 },
      done: true
    };
  }

  let expanded = !isSectionCollapsed(section);
  if (wantProjects && !expanded) {
    expanded = expandSectionIfNeeded(ctx, section);
  }

  let rows = section.querySelectorAll('a[href*="/project"]').length;
  let collapsedRows = 0;
  let folderClicks = 0;
  if (expanded && wantItems) {
    const projectExpansion = expandCollapsedProjectFolders(ctx, section);
    rows = projectExpansion.totalRows;
    collapsedRows = projectExpansion.collapsedRows;
    folderClicks = projectExpansion.folderClicks;
  }

  const done = wantItems ? expanded && rows > 0 && collapsedRows === 0 : expanded;

  ctx.logger.debug(
    "autoExpandProjects",
    `${reason} expanded=${expanded} rows=${rows} collapsedRows=${collapsedRows} folderClicks=${folderClicks} done=${done}`
  );

  return {
    stats: {
      projectsExpanded: expanded,
      projectRows: rows,
      collapsedProjectRows: collapsedRows,
      folderClicks
    },
    done
  };
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
  let goalReached = false;

  const bindUserInteractionGuards = (nav: HTMLElement | null) => {
    cleanupUserListeners?.();
    cleanupUserListeners = null;
    if (!nav) return;
    const onUser = (event: Event) => {
      // Ignore synthetic clicks dispatched by this feature itself.
      if (!event.isTrusted) return;
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

  const cancelTimers = (): void => {
    if (debounceTimer !== null) window.clearTimeout(debounceTimer);
    debounceTimer = null;
    if (navRetryTimeout !== null) window.clearTimeout(navRetryTimeout);
    navRetryTimeout = null;
    if (startTimer !== null) window.clearTimeout(startTimer);
    startTimer = null;
    if (navReadyTimer !== null) window.clearTimeout(navReadyTimer);
    navReadyTimer = null;
  };

  const stop = (): void => {
    stopped = true;
    cancelTimers();
    unsubNavDelta?.();
    unsubNavDelta = null;
    unsubRoots?.();
    unsubRoots = null;
    cleanupUserListeners?.();
    cleanupUserListeners = null;
  };

  const schedule = (reason: string): void => {
    if (stopped) return;
    if (!isFeatureEnabled(ctx)) return;
    if (goalReached) return;
    if (debounceTimer !== null) window.clearTimeout(debounceTimer);

    debounceTimer = window.setTimeout(() => {
      debounceTimer = null;
      if (stopped) return;
      if (!isFeatureEnabled(ctx)) return;
      if (goalReached) return;

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
        ctx.logger.debug("autoExpandProjects", "goal reached, idle until route/settings change");
        goalReached = true;
        attempts = 0;
      }
    }, AUTO_EXPAND_DEBOUNCE_MS);
  };

  startTimer = window.setTimeout(() => {
    startTimer = null;
    if (stopped) return;
    if (!isFeatureEnabled(ctx)) return;
    if (goalReached) return;
    schedule("start");
  }, AUTO_EXPAND_START_TIMEOUT_MS);
  navReadyTimer = window.setTimeout(() => {
    navReadyTimer = null;
    if (stopped) return;
    if (!isFeatureEnabled(ctx)) return;
    if (goalReached) return;
    schedule("nav-ready");
  }, AUTO_EXPAND_NAV_TIMEOUT_MS);

  const refreshNavBindings = () => {
    const nav = getChatHistoryNav(ctx);
    bindUserInteractionGuards(nav);
    if (!isFeatureEnabled(ctx)) return;
    if (!nav && navRetryTimeout === null && !stopped) {
      navRetryTimeout = window.setTimeout(() => {
        navRetryTimeout = null;
        if (stopped) return;
        if (!isFeatureEnabled(ctx)) return;
        if (goalReached) return;
        schedule("late-nav");
      }, 1000);
    }
  };

  refreshNavBindings();

  unsubRoots =
    ctx.domBus?.onRoots((roots) => {
      bindUserInteractionGuards((roots.nav as HTMLElement | null) ?? null);
      if (!isFeatureEnabled(ctx)) return;
      goalReached = false;
      attempts = 0;
      schedule("route");
    }) ?? null;

  unsubNavDelta =
    ctx.domBus?.onDelta("nav", () => {
      schedule("mutation");
    }) ?? null;

  return {
    name: "autoExpandProjects",
    dispose: () => stop(),
    onSettingsChange: (next, prev) => {
      const prevEnabled = prev.autoExpandProjects || prev.autoExpandProjectItems;
      const nextEnabled = next.autoExpandProjects || next.autoExpandProjectItems;

      if (!nextEnabled) {
        goalReached = true;
        attempts = 0;
        cancelTimers();
        return;
      }

      const goalChanged =
        prev.autoExpandProjects !== next.autoExpandProjects ||
        prev.autoExpandProjectItems !== next.autoExpandProjectItems;

      if (!prevEnabled || goalChanged) {
        goalReached = false;
        attempts = 0;
        refreshNavBindings();
        schedule("settings");
      }
    },
    getStatus: () => ({ active: isFeatureEnabled(ctx) }),
    __test: {
      getChatHistoryNav,
      findProjectsSection,
      isSectionCollapsed,
      runOnce
    }
  };
}
