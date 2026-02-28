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
const AUTO_EXPAND_POST_CLICK_DELAY_MS = 1700;
const AUTO_EXPAND_DEBOUNCE_MS = 250;
// User interaction cooldown must be long enough to cover React re-renders caused
// by project toggle clicks. Otherwise we can end up clicking the same toggle
// multiple times while the UI is still animating, causing jitter/shake.
const AUTO_EXPAND_USER_COOLDOWN_MS = 5000;
const AUTO_EXPAND_MAX_ATTEMPTS = 120;
const AUTO_EXPAND_REPEAT_CLICK_COOLDOWN_MS = 8000;

let lastClickedProjectHref: string | null = null;
let lastClickedProjectAt = 0;

type ExpandStats = {
  projectsExpanded: boolean;
  sectionClicked: boolean;
  projectRows: number;
  collapsedProjectRows: number;
  folderClicks: number;
};

type ExpandSectionResult = { expanded: boolean; clicked: boolean };

function isFeatureEnabled(ctx: FeatureContext): boolean {
  return ctx.settings.autoExpandProjects || ctx.settings.autoExpandProjectItems;
}

function dispatchHumanClick(el: HTMLElement): void {
  // Some ChatGPT sidebar toggles are nested inside <a>. Clicking the toggle can bubble
  // and trigger anchor navigation (sometimes resulting in a full reload). Guard by
  // temporarily preventing default on the closest anchor.
  const anchor = el.closest<HTMLAnchorElement>("a[href]");
  const preventIfFromToggle = (event: Event) => {
    const target = event.target;
    if (!(target instanceof Node)) return;
    if (target === el) {
      // Keep target handlers on the toggle working while still canceling anchor navigation.
      event.preventDefault();
      return;
    }
    if (el.contains(target)) {
      event.preventDefault();
      event.stopPropagation();
      if (
        "stopImmediatePropagation" in event &&
        typeof event.stopImmediatePropagation === "function"
      ) {
        event.stopImmediatePropagation();
      }
    }
  };

  if (anchor) {
    anchor.addEventListener("pointerdown", preventIfFromToggle, true);
    anchor.addEventListener("mousedown", preventIfFromToggle, true);
    anchor.addEventListener("click", preventIfFromToggle, true);
  }

  try {
    el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true }));
    el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    el.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true }));
    el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true }));
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  } finally {
    if (anchor) {
      // Remove on next tick to avoid interfering with any async handlers.
      window.setTimeout(() => {
        anchor.removeEventListener("pointerdown", preventIfFromToggle, true);
        anchor.removeEventListener("mousedown", preventIfFromToggle, true);
        anchor.removeEventListener("click", preventIfFromToggle, true);
      }, 0);
    }
  }
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

function expandSectionIfNeeded(ctx: FeatureContext, section: HTMLElement): ExpandSectionResult {
  const headerBtn = section.querySelector<HTMLButtonElement>("button[aria-expanded]");
  if (!headerBtn) return { expanded: false, clicked: false };

  const expanded = headerBtn.getAttribute("aria-expanded") === "true";
  if (expanded) return { expanded: true, clicked: false };

  if (!isElementVisible(headerBtn)) return { expanded: false, clicked: false };

  ctx.logger.debug("autoExpandProjects", "expanding Projects section");
  dispatchHumanClick(headerBtn);
  // Do not report success until the DOM confirms aria-expanded="true" on a later run.
  return { expanded: false, clicked: true };
}

function isLikelyOptionsButton(btn: HTMLButtonElement): boolean {
  const aria = norm(btn.getAttribute("aria-label"));
  const title = norm(btn.getAttribute("title"));
  const hint = `${aria} ${title}`;
  if (!hint) return false;

  // Avoid clicking trailing "..." / options / menu buttons.
  return (
    hint.includes("options") ||
    hint.includes("option") ||
    hint.includes("menu") ||
    hint.includes("more") ||
    hint.includes("ellipsis")
  );
}

function isInsideOverflowHidden(el: HTMLElement): boolean {
  return el.closest('[class*="overflow-hidden"]') !== null;
}

function isProjectExpanded(
  projectLink: HTMLAnchorElement,
  rowFolderButton?: HTMLButtonElement | null
): boolean {
  const folderButton = rowFolderButton ?? findFolderToggleButtonForProject(projectLink);
  const folderState = folderButton?.getAttribute("data-state");
  if (folderState === "open") return true;
  if (folderState === "closed") return false;

  const ariaExpanded = folderButton?.getAttribute("aria-expanded");
  if (ariaExpanded === "true") return true;
  if (ariaExpanded === "false") return false;

  const sib = projectLink.nextElementSibling as HTMLElement | null;
  if (!sib) return false;
  if (!sib.className.includes("overflow-hidden")) return false;

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

function isTrailingMenuButton(b: HTMLButtonElement): boolean {
  // ChatGPT uses a trailing “…” options button with these markers.
  if (b.hasAttribute("data-trailing-button")) return true;
  if (b.getAttribute("aria-haspopup") === "menu") return true;
  return false;
}

function findFolderToggleButton(rowScope: HTMLElement): HTMLButtonElement | null {
  const buttons = Array.from(rowScope.querySelectorAll<HTMLButtonElement>("button")).filter(
    (b) => !isTrailingMenuButton(b) && !isInsideOverflowHidden(b)
  );

  // Prefer explicit toggles first.
  for (const b of buttons) {
    if (isLikelyOptionsButton(b) || isTrailingMenuButton(b) || isInsideOverflowHidden(b)) continue;
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

  // Common case in current UI: <button class="icon" data-state="open|closed">
  const byStatefulIcon = rowScope.querySelector<HTMLButtonElement>(
    "button.icon[data-state]:not([data-trailing-button]):not([aria-haspopup])"
  );
  if (
    byStatefulIcon &&
    !isTrailingMenuButton(byStatefulIcon) &&
    !isInsideOverflowHidden(byStatefulIcon)
  )
    return byStatefulIcon;

  const byIcon = rowScope.querySelector<HTMLButtonElement>(
    "button.icon:not([data-trailing-button]):not([aria-haspopup])"
  );
  if (byIcon && !isTrailingMenuButton(byIcon) && !isInsideOverflowHidden(byIcon)) return byIcon;

  // Fallback: only accept small icon-like buttons with an svg.
  // Avoid clicking wide buttons (often navigation) to prevent rerender jitter.
  for (const b of buttons) {
    if (isLikelyOptionsButton(b) || isTrailingMenuButton(b) || isInsideOverflowHidden(b)) continue;
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
  return (
    rowFolderButton?.hasAttribute("data-state") === true ||
    rowFolderButton?.hasAttribute("aria-expanded") === true
  );
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
    const now = Date.now();
    if (
      href &&
      href === lastClickedProjectHref &&
      now - lastClickedProjectAt < AUTO_EXPAND_REPEAT_CLICK_COOLDOWN_MS
    ) {
      ctx.logger.debug("autoExpandProjects", `skip repeat click for project: ${href}`);
      continue;
    }

    ctx.logger.debug("autoExpandProjects", `click folder icon for project: ${href}`);
    dispatchHumanClick(btn);
    folderClicks = 1;
    lastClickedProjectHref = href;
    lastClickedProjectAt = now;
  }

  return { totalRows: projects.length, collapsedRows, folderClicks };
}

function getBottomExpandableProjectHref(section: HTMLElement): string | null {
  const projects = Array.from(section.querySelectorAll<HTMLAnchorElement>('a[href*="/project"]'));
  for (let i = projects.length - 1; i >= 0; i -= 1) {
    const link = projects[i]!;
    // Fast, layout-free heuristic:
    // - Prefer rows that have the collapsible sibling container.
    // - Otherwise, accept rows with a stateful icon button (excluding trailing menu),
    //   either nested in the anchor or in the closest <li>.
    const sib = link.nextElementSibling as HTMLElement | null;
    if (sib && sib.className.includes("overflow-hidden")) return link.getAttribute("href") ?? null;

    const btnInLink = link.querySelector<HTMLButtonElement>(
      "button.icon[data-state]:not([data-trailing-button]):not([aria-haspopup])"
    );
    if (btnInLink && !isInsideOverflowHidden(btnInLink)) return link.getAttribute("href") ?? null;

    const li = link.closest<HTMLElement>("li");
    const btnInLi = li?.querySelector<HTMLButtonElement>(
      "button.icon[data-state]:not([data-trailing-button]):not([aria-haspopup])"
    );
    if (btnInLi && !isInsideOverflowHidden(btnInLi)) return link.getAttribute("href") ?? null;
  }
  return null;
}

function runOnce(ctx: FeatureContext, reason: string): { stats: ExpandStats; done: boolean } {
  const nav = getChatHistoryNav(ctx);
  if (!nav) {
    ctx.logger.debug("autoExpandProjects", `no sidebar nav yet (${reason})`);
    return {
      stats: {
        projectsExpanded: false,
        sectionClicked: false,
        projectRows: 0,
        collapsedProjectRows: 0,
        folderClicks: 0
      },
      done: false
    };
  }

  const section = findProjectsSection(nav);
  if (!section) {
    ctx.logger.debug("autoExpandProjects", `no Projects section yet (${reason})`);
    return {
      stats: {
        projectsExpanded: false,
        sectionClicked: false,
        projectRows: 0,
        collapsedProjectRows: 0,
        folderClicks: 0
      },
      done: false
    };
  }

  const wantProjects = ctx.settings.autoExpandProjects;
  const wantItems = ctx.settings.autoExpandProjectItems;

  if (!wantProjects && !wantItems) {
    return {
      stats: {
        projectsExpanded: false,
        sectionClicked: false,
        projectRows: 0,
        collapsedProjectRows: 0,
        folderClicks: 0
      },
      done: true
    };
  }

  let expanded = !isSectionCollapsed(section);
  let sectionClicked = false;
  if (wantProjects && !expanded) {
    const res = expandSectionIfNeeded(ctx, section);
    expanded = res.expanded;
    sectionClicked = res.clicked;
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
      sectionClicked,
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
  let postClickTimer: number | null = null;
  let goalReached = false;
  let rowsAtGoal = 0;
  let bottomHrefAtGoal: string | null = null;

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
    if (postClickTimer !== null) window.clearTimeout(postClickTimer);
    postClickTimer = null;
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

      if (stats.folderClicks > 0 || stats.sectionClicked) {
        lastAutoClickAt = Date.now();

        if (postClickTimer !== null) window.clearTimeout(postClickTimer);
        postClickTimer = window.setTimeout(() => {
          postClickTimer = null;
          schedule("post-click");
        }, AUTO_EXPAND_POST_CLICK_DELAY_MS);
      }

      if (done) {
        ctx.logger.debug("autoExpandProjects", "goal reached, idle until route/settings change");
        goalReached = true;
        attempts = 0;
        rowsAtGoal = stats.projectRows;
        const navNow = getChatHistoryNav(ctx);
        const secNow = navNow ? findProjectsSection(navNow) : null;
        bottomHrefAtGoal = secNow ? getBottomExpandableProjectHref(secNow) : null;
        if (postClickTimer !== null) window.clearTimeout(postClickTimer);
        postClickTimer = null;
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
      rowsAtGoal = 0;
      bottomHrefAtGoal = null;
      schedule("route");
    }) ?? null;

  unsubNavDelta =
    ctx.domBus?.onDelta("nav", () => {
      if (!isFeatureEnabled(ctx)) return;

      if (goalReached) {
        const nav = getChatHistoryNav(ctx);
        const section = nav ? findProjectsSection(nav) : null;
        if (!section) return;

        const rows = section.querySelectorAll('a[href*="/project"]').length;
        const bottomHref = getBottomExpandableProjectHref(section);

        if (rows !== rowsAtGoal || bottomHref !== bottomHrefAtGoal) {
          goalReached = false;
          attempts = 0;
          rowsAtGoal = 0;
          bottomHrefAtGoal = null;
          schedule("mutation-rearm");
        }

        return;
      }

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
        if (postClickTimer !== null) window.clearTimeout(postClickTimer);
        postClickTimer = null;
        cancelTimers();
        return;
      }

      const goalChanged =
        prev.autoExpandProjects !== next.autoExpandProjects ||
        prev.autoExpandProjectItems !== next.autoExpandProjectItems;

      if (!prevEnabled || goalChanged) {
        goalReached = false;
        attempts = 0;
        rowsAtGoal = 0;
        bottomHrefAtGoal = null;
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
