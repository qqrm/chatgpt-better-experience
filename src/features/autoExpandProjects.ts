import { FeatureContext, FeatureHandle } from "../application/featureContext";
import { isElementVisible, norm } from "../lib/utils";

const AUTO_EXPAND_START_TIMEOUT_MS = 3500;
const AUTO_EXPAND_NAV_TIMEOUT_MS = 1500;
const AUTO_EXPAND_DEBOUNCE_MS = 250;
const AUTO_EXPAND_USER_COOLDOWN_MS = 5000;
const AUTO_EXPAND_POST_CLICK_DELAY_MS = 500;
const AUTO_EXPAND_NOOP_RETRY_DELAY_MS = 1200;
const AUTO_EXPAND_AUTO_CLICK_COOLDOWN_MS = 250;
const AUTO_EXPAND_MAX_ATTEMPTS = 140;
const AUTO_EXPAND_REARM_RETRY_MS = 900;

const PROJECT_LINK_SELECTOR = [
  'a[href*="/project"]',
  // Newer ChatGPT builds can render project links as /g/g-p-<id>.
  'a[href*="/g/g-p-"]'
].join(", ");
const PROJECT_SECTION_HINT_SELECTOR = [
  '[class*="sidebar-expando-section"]',
  '[class*="expando-section"]',
  '[class*="sidebar-section"]',
  "[data-sidebar-section]",
  '[data-section="projects"]'
].join(", ");

const RELEVANT_NAV_DELTA_SELECTOR = [
  'nav[aria-label="Chat history"]',
  PROJECT_LINK_SELECTOR,
  '[class*="sidebar-expando-section"]',
  "button[aria-expanded]",
  '[data-state="open"]',
  '[data-state="closed"]'
].join(", ");

type ExpandStats = {
  projectsExpanded: boolean;
  sectionClicked: boolean;
  projectRows: number;
  expandableProjectRows: number;
  collapsedProjectRows: number;
  folderClicks: number;
};

type RunResult = {
  stats: ExpandStats;
  done: boolean;
};

type ProjectRowsResult = {
  projectRows: number;
  expandableProjectRows: number;
  collapsedProjectRows: number;
  folderClicks: number;
};

function isFeatureEnabled(ctx: FeatureContext): boolean {
  return !!ctx.settings.autoExpandProjects || !!ctx.settings.autoExpandProjectItems;
}

function isProjectsDebugEnabled(ctx: FeatureContext): boolean {
  return ctx.logger.isTraceEnabled("projects");
}

function traceProjects(
  ctx: FeatureContext,
  scope: string,
  message: string,
  fields?: Record<string, unknown>,
  level: "log" | "warn" | "info" | "error" = "log"
): void {
  if (!isProjectsDebugEnabled(ctx)) return;
  ctx.logger.trace("projects", scope, message, fields, level);
}

function matchesSelectorOrDescendant(el: Element, selector: string): boolean {
  try {
    return el.matches(selector) || el.querySelector(selector) !== null;
  } catch {
    return false;
  }
}

export function isAutoExpandProjectsRelevantNavDelta(
  added: Element[],
  removed: Element[]
): boolean {
  // Synthetic empty deltas are used in tests and mocked integrations.
  if (added.length === 0 && removed.length === 0) return true;

  for (const el of added) {
    if (matchesSelectorOrDescendant(el, RELEVANT_NAV_DELTA_SELECTOR)) return true;
  }
  for (const el of removed) {
    if (matchesSelectorOrDescendant(el, RELEVANT_NAV_DELTA_SELECTOR)) return true;
  }
  return false;
}

function canInteract(el: HTMLElement | null): boolean {
  if (!el) return false;
  if (!el.isConnected) return false;
  return isElementVisible(el);
}

function dispatchSyntheticClick(el: HTMLElement): void {
  const anchor = el.closest<HTMLAnchorElement>("a[href]");
  const preventIfFromToggle = (event: Event) => {
    const target = event.target;
    if (!(target instanceof Node)) return;
    if (target === el || el.contains(target)) {
      event.preventDefault();
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
      window.setTimeout(() => {
        anchor.removeEventListener("pointerdown", preventIfFromToggle, true);
        anchor.removeEventListener("mousedown", preventIfFromToggle, true);
        anchor.removeEventListener("click", preventIfFromToggle, true);
      }, 0);
    }
  }
}

function getChatHistoryNav(ctx: FeatureContext): HTMLElement | null {
  const navFromBus = (ctx.domBus?.getNavRoot() as HTMLElement | null) ?? null;
  if (navFromBus) return navFromBus;

  const direct =
    ctx.helpers.safeQuery<HTMLElement>('nav[aria-label="Chat history"]') ??
    ctx.helpers.safeQuery<HTMLElement>('nav[aria-label*="history" i]') ??
    ctx.helpers.safeQuery<HTMLElement>('nav[aria-label*="чат" i]') ??
    ctx.helpers.safeQuery<HTMLElement>('nav[aria-label*="история" i]');
  if (direct) return direct;

  const link = ctx.helpers.safeQuery<HTMLAnchorElement>(PROJECT_LINK_SELECTOR);
  return link?.closest<HTMLElement>("nav") ?? null;
}

function findProjectsSection(nav: HTMLElement): HTMLElement | null {
  const hinted = Array.from(nav.querySelectorAll<HTMLElement>(PROJECT_SECTION_HINT_SELECTOR));

  for (const sec of hinted) {
    if (sec.querySelector(PROJECT_LINK_SELECTOR)) return sec;
  }

  for (const sec of hinted) {
    const heading =
      sec.querySelector<HTMLElement>('button[aria-expanded], h1, h2, h3, [role="heading"]') ?? sec;
    const text = norm(`${heading.textContent ?? ""} ${heading.getAttribute("aria-label") ?? ""}`);
    if (text.includes("projects") || text.includes("проекты")) return sec;
  }

  const projectLink = nav.querySelector<HTMLAnchorElement>(PROJECT_LINK_SELECTOR);
  if (projectLink) {
    let cur: HTMLElement | null = projectLink.parentElement;
    while (cur && cur !== nav) {
      if (cur.querySelectorAll(PROJECT_LINK_SELECTOR).length >= 2) return cur;

      const heading = cur.querySelector<HTMLElement>(
        'button[aria-expanded], h1, h2, h3, [role="heading"], [aria-label], [title]'
      );
      const headingText = norm(
        `${heading?.textContent ?? ""} ${heading?.getAttribute("aria-label") ?? ""} ${heading?.getAttribute("title") ?? ""}`
      );
      if (headingText.includes("projects") || headingText.includes("проекты")) return cur;
      cur = cur.parentElement;
    }
  }

  return null;
}

function findProjectsHeaderButton(section: HTMLElement): HTMLButtonElement | null {
  const explicit = section.querySelector<HTMLButtonElement>("button[aria-expanded]");
  if (explicit) return explicit;

  const buttons = Array.from(section.querySelectorAll<HTMLButtonElement>("button"));
  for (const btn of buttons) {
    const text = norm(`${btn.textContent ?? ""} ${btn.getAttribute("aria-label") ?? ""}`);
    if (text.includes("projects") || text.includes("проекты")) return btn;
  }

  return buttons[0] ?? null;
}

function isSectionCollapsed(section: HTMLElement): boolean {
  const cls = String(section.className || "");
  if (cls.includes("sidebar-collapsed-section")) return true;
  if (cls.includes("sidebar-expanded-section")) return false;

  const header = findProjectsHeaderButton(section);
  if (!header) return false;
  return header.getAttribute("aria-expanded") === "false";
}

function expandSectionIfNeeded(
  ctx: FeatureContext,
  section: HTMLElement
): { expanded: boolean; clicked: boolean } {
  if (!isSectionCollapsed(section)) return { expanded: true, clicked: false };

  const header = findProjectsHeaderButton(section);
  if (!header || !canInteract(header)) return { expanded: false, clicked: false };

  dispatchSyntheticClick(header);
  // Keep one-cycle lag by design: treat section as not expanded until the next run.
  return { expanded: false, clicked: true };
}

function normalizeProjectHref(rawHref: string): string {
  const raw = String(rawHref || "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw, window.location.origin);
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return raw;
  }
}

function collectProjectHrefs(section: HTMLElement): Set<string> {
  const out = new Set<string>();
  for (const link of Array.from(
    section.querySelectorAll<HTMLAnchorElement>(PROJECT_LINK_SELECTOR)
  )) {
    const href = normalizeProjectHref(link.getAttribute("href") ?? link.href ?? "");
    if (href) out.add(href);
  }
  return out;
}

function isLikelyOptionsButton(el: HTMLElement): boolean {
  if (el.hasAttribute("data-trailing-button")) return true;
  if (el.getAttribute("aria-haspopup") === "menu") return true;

  const cls = String(el.className || "");
  if (cls.includes("__menu-item-trailing-btn")) return true;
  if (el.closest(".trailing") !== null) return true;

  const hint = norm(
    `${el.getAttribute("aria-label") ?? ""} ${el.getAttribute("title") ?? ""} ${el.getAttribute("aria") ?? ""}`
  );

  return (
    hint.includes("open conversation options") ||
    hint.includes("conversation options") ||
    hint.includes("options") ||
    hint.includes("archive") ||
    hint.includes("pin") ||
    hint.includes("menu") ||
    hint.includes("more")
  );
}

function pickLeftmostVisible(els: HTMLElement[]): HTMLElement | null {
  let best: { el: HTMLElement; left: number; top: number } | null = null;

  for (const el of els) {
    if (!canInteract(el)) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;

    if (!best) {
      best = { el, left: rect.left, top: rect.top };
      continue;
    }

    if (
      rect.left < best.left - 1 ||
      (Math.abs(rect.left - best.left) <= 1 && rect.top < best.top)
    ) {
      best = { el, left: rect.left, top: rect.top };
    }
  }

  return best?.el ?? null;
}

function findFolderToggleForProject(projectLink: HTMLAnchorElement): HTMLElement | null {
  const scopes: HTMLElement[] = [projectLink];

  const li = projectLink.closest<HTMLElement>("li");
  if (li && !scopes.includes(li)) scopes.push(li);

  const parent = projectLink.parentElement;
  if (
    parent &&
    !scopes.includes(parent) &&
    parent.querySelectorAll(PROJECT_LINK_SELECTOR).length <= 1
  ) {
    scopes.push(parent);
  }

  for (const scope of scopes) {
    const statefulIcons = Array.from(
      scope.querySelectorAll<HTMLElement>(
        'button.icon[data-state], button.icon[aria-expanded], [role="button"].icon[data-state], [role="button"].icon[aria-expanded]'
      )
    ).filter((el) => !isLikelyOptionsButton(el));

    const leftIcon = pickLeftmostVisible(statefulIcons);
    if (leftIcon) return leftIcon;

    const stateful = Array.from(
      scope.querySelectorAll<HTMLElement>(
        'button[data-state], button[aria-expanded], [role="button"][data-state], [role="button"][aria-expanded]'
      )
    ).filter((el) => !isLikelyOptionsButton(el));

    const leftStateful = pickLeftmostVisible(stateful);
    if (leftStateful) return leftStateful;

    const fallbackIcons = Array.from(
      scope.querySelectorAll<HTMLElement>("button.icon, [role=button].icon")
    ).filter((el) => !isLikelyOptionsButton(el));

    const leftFallback = pickLeftmostVisible(fallbackIcons);
    if (leftFallback) return leftFallback;
  }

  return null;
}

function isExpandableProjectRow(
  projectLink: HTMLAnchorElement,
  toggle: HTMLElement | null
): boolean {
  if (toggle?.hasAttribute("data-state")) return true;
  if (toggle?.hasAttribute("aria-expanded")) return true;

  const next = projectLink.nextElementSibling as HTMLElement | null;
  if (!next) return false;
  return String(next.className || "").includes("overflow-hidden");
}

function isCollapsedByContainerSignals(container: HTMLElement | null): boolean {
  if (!container) return false;
  if (container.hasAttribute("hidden")) return true;
  if (container.getAttribute("aria-hidden") === "true") return true;

  const display = norm(container.style.display);
  const visibility = norm(container.style.visibility);
  const opacity = norm(container.style.opacity);
  if (display === "none" || visibility === "hidden" || opacity === "0") return true;

  const maxHeight = container.style.maxHeight.trim();
  const height = container.style.height.trim();
  if (/^0(?:px|rem|em|%)?$/.test(maxHeight)) return true;
  if (/^0(?:px|rem|em|%)?$/.test(height)) return true;

  return false;
}

function buildProjectChatPrefixes(projectLink: HTMLAnchorElement): string[] {
  const href = normalizeProjectHref(projectLink.getAttribute("href") ?? projectLink.href ?? "");
  if (!href) return [];

  const m = /^\/g\/([^/]+)\/project\/?$/i.exec(href);
  if (!m) return [];

  const token = m[1]!;
  const out = new Set<string>([`/g/${token}/c/`]);

  // In modern ChatGPT sidebar the row href can include a slug suffix:
  // /g/g-p-<id>-<name>/project, while child chats use /g/g-p-<id>/c/<chatId>.
  if (token.startsWith("g-p-")) {
    let cursor = token;
    for (let i = 0; i < 4; i += 1) {
      const cut = cursor.lastIndexOf("-");
      if (cut <= "g-p-".length) break;
      cursor = cursor.slice(0, cut);
      out.add(`/g/${cursor}/c/`);
    }
  }

  return Array.from(out);
}

function findProjectChatContainer(
  section: HTMLElement,
  projectLink: HTMLAnchorElement
): HTMLElement | null {
  const prefixes = buildProjectChatPrefixes(projectLink);
  if (!prefixes.length) return null;

  const chatLinks = Array.from(section.querySelectorAll<HTMLAnchorElement>('a[href*="/c/"]'));
  for (const chatLink of chatLinks) {
    const href = normalizeProjectHref(chatLink.getAttribute("href") ?? chatLink.href ?? "");
    if (!href) continue;
    if (!prefixes.some((prefix) => href.includes(prefix))) continue;
    return (
      chatLink.closest<HTMLElement>("div.overflow-hidden, [class*='overflow-hidden']") ??
      chatLink.parentElement
    );
  }

  return null;
}

function isProjectExpanded(
  section: HTMLElement,
  projectLink: HTMLAnchorElement,
  toggle: HTMLElement | null
): boolean {
  const mappedChatContainer = findProjectChatContainer(section, projectLink);
  if (mappedChatContainer) {
    if (!isCollapsedByContainerSignals(mappedChatContainer)) return true;
    return false;
  }

  const next = projectLink.nextElementSibling as HTMLElement | null;
  if (next && String(next.className || "").includes("overflow-hidden")) {
    if (isCollapsedByContainerSignals(next)) return false;
    if (next.querySelector('a[href*="/c/"]')) return true;
  }

  const aria = toggle?.getAttribute("aria-expanded");
  if (aria === "true") return true;
  if (aria === "false") return false;

  const toggleState = toggle?.getAttribute("data-state");
  if (toggleState === "open") return true;
  if (toggleState === "closed") return false;

  return false;
}

function expandProjectItems(ctx: FeatureContext, section: HTMLElement): ProjectRowsResult {
  const projectLinks = Array.from(
    section.querySelectorAll<HTMLAnchorElement>(PROJECT_LINK_SELECTOR)
  );

  let expandableRows = 0;
  let collapsedRows = 0;
  let folderClicks = 0;
  let clickedThisRun = false;

  for (const projectLink of [...projectLinks].reverse()) {
    const href = normalizeProjectHref(projectLink.getAttribute("href") ?? projectLink.href ?? "");
    if (href.endsWith("/project/new") || href.includes("/project/new")) {
      continue;
    }

    const toggle = findFolderToggleForProject(projectLink);
    if (!isExpandableProjectRow(projectLink, toggle)) continue;

    expandableRows += 1;

    if (isProjectExpanded(section, projectLink, toggle)) continue;

    collapsedRows += 1;

    if (clickedThisRun) continue;
    if (!toggle || !canInteract(toggle)) continue;

    dispatchSyntheticClick(toggle);
    folderClicks += 1;
    clickedThisRun = true;
  }

  return {
    projectRows: projectLinks.length,
    expandableProjectRows: expandableRows,
    collapsedProjectRows: collapsedRows,
    folderClicks
  };
}

function runOnce(ctx: FeatureContext, reason: string): RunResult {
  const baseStats: ExpandStats = {
    projectsExpanded: false,
    sectionClicked: false,
    projectRows: 0,
    expandableProjectRows: 0,
    collapsedProjectRows: 0,
    folderClicks: 0
  };

  if (!isFeatureEnabled(ctx)) return { stats: baseStats, done: true };

  const nav = getChatHistoryNav(ctx);
  if (!nav) {
    ctx.logger.debug("autoExpandProjects", `skip (${reason}): nav not found`);
    traceProjects(ctx, "FLOW", "runOnce no sidebar nav", { reason });
    return { stats: baseStats, done: false };
  }

  const section = findProjectsSection(nav);
  if (!section) {
    ctx.logger.debug("autoExpandProjects", `skip (${reason}): section not found`);
    traceProjects(ctx, "FLOW", "runOnce no Projects section", { reason });
    return { stats: baseStats, done: false };
  }

  const wantItems = !!ctx.settings.autoExpandProjectItems;

  const sectionResult = expandSectionIfNeeded(ctx, section);
  const expanded = sectionResult.expanded;

  let rowsResult: ProjectRowsResult = {
    projectRows: section.querySelectorAll(PROJECT_LINK_SELECTOR).length,
    expandableProjectRows: 0,
    collapsedProjectRows: 0,
    folderClicks: 0
  };

  if (expanded && wantItems) {
    rowsResult = expandProjectItems(ctx, section);
  }

  const stats: ExpandStats = {
    projectsExpanded: expanded,
    sectionClicked: sectionResult.clicked,
    projectRows: rowsResult.projectRows,
    expandableProjectRows: rowsResult.expandableProjectRows,
    collapsedProjectRows: rowsResult.collapsedProjectRows,
    folderClicks: rowsResult.folderClicks
  };

  const done = wantItems
    ? expanded &&
      stats.projectRows > 0 &&
      stats.expandableProjectRows > 0 &&
      stats.collapsedProjectRows === 0
    : expanded;

  traceProjects(ctx, "FLOW", "runOnce rows stats", {
    reason,
    rows: stats.projectRows,
    expandableRows: stats.expandableProjectRows,
    collapsedRows: stats.collapsedProjectRows,
    folderClicks: stats.folderClicks
  });
  traceProjects(ctx, "FLOW", "runOnce summary", {
    reason,
    expanded,
    done,
    wantItems,
    wantProjects: !!ctx.settings.autoExpandProjects
  });

  ctx.logger.debug(
    "autoExpandProjects",
    `${reason}: expanded=${expanded} rows=${stats.projectRows} collapsed=${stats.collapsedProjectRows} clicks=${stats.folderClicks}`
  );

  return { stats, done };
}

export function initAutoExpandProjectsFeature(ctx: FeatureContext): FeatureHandle {
  let stopped = false;
  let debounceTimer: number | null = null;
  let retryTimer: number | null = null;
  let startTimer: number | null = null;
  let navReadyTimer: number | null = null;

  let attempts = 0;
  let goalReached = false;
  let goalSnapshotProjectHrefs = new Set<string>();

  let lastUserInteractionAt = 0;
  let lastAutoClickAt = 0;
  let cleanupUserListeners: (() => void) | null = null;

  let unsubRoots: (() => void) | null = null;
  let unsubNavDelta: (() => void) | null = null;

  const cancelTimers = (): void => {
    if (debounceTimer !== null) window.clearTimeout(debounceTimer);
    debounceTimer = null;

    if (retryTimer !== null) window.clearTimeout(retryTimer);
    retryTimer = null;

    if (startTimer !== null) window.clearTimeout(startTimer);
    startTimer = null;

    if (navReadyTimer !== null) window.clearTimeout(navReadyTimer);
    navReadyTimer = null;
  };

  const stop = (): void => {
    stopped = true;
    cancelTimers();

    cleanupUserListeners?.();
    cleanupUserListeners = null;

    unsubRoots?.();
    unsubRoots = null;

    unsubNavDelta?.();
    unsubNavDelta = null;
  };

  const refreshGoalSnapshot = (): void => {
    const nav = getChatHistoryNav(ctx);
    const section = nav ? findProjectsSection(nav) : null;
    goalSnapshotProjectHrefs = section ? collectProjectHrefs(section) : new Set<string>();
  };

  const hasNewProjectRowsSinceGoal = (): boolean => {
    if (!goalReached) return false;

    const nav = getChatHistoryNav(ctx);
    const section = nav ? findProjectsSection(nav) : null;
    if (!section) return false;

    const current = collectProjectHrefs(section);
    if (current.size === 0) return false;

    for (const href of current) {
      if (!goalSnapshotProjectHrefs.has(href)) return true;
    }
    return false;
  };

  const bindUserInteractionGuards = (nav: HTMLElement | null): void => {
    cleanupUserListeners?.();
    cleanupUserListeners = null;

    if (!nav) return;

    const onUserInteraction = (event: Event) => {
      if (!event.isTrusted) return;
      lastUserInteractionAt = Date.now();
    };

    nav.addEventListener("pointerdown", onUserInteraction, true);
    nav.addEventListener("mousedown", onUserInteraction, true);
    nav.addEventListener("click", onUserInteraction, true);

    cleanupUserListeners = () => {
      nav.removeEventListener("pointerdown", onUserInteraction, true);
      nav.removeEventListener("mousedown", onUserInteraction, true);
      nav.removeEventListener("click", onUserInteraction, true);
    };
  };

  const queueRetry = (reason: string, delayMs: number): void => {
    if (stopped || !isFeatureEnabled(ctx)) return;
    if (retryTimer !== null) window.clearTimeout(retryTimer);

    retryTimer = window.setTimeout(
      () => {
        retryTimer = null;
        schedule(reason);
      },
      Math.max(50, delayMs)
    );
  };

  const schedule = (reason: string): void => {
    if (stopped || !isFeatureEnabled(ctx)) return;

    if (debounceTimer !== null) window.clearTimeout(debounceTimer);

    debounceTimer = window.setTimeout(() => {
      debounceTimer = null;
      if (stopped || !isFeatureEnabled(ctx)) return;

      if (goalReached && !hasNewProjectRowsSinceGoal()) return;
      if (goalReached && hasNewProjectRowsSinceGoal()) {
        goalReached = false;
        attempts = 0;
      }

      const now = Date.now();
      const cooldownLeft = AUTO_EXPAND_USER_COOLDOWN_MS - (now - lastUserInteractionAt);
      if (cooldownLeft > 0) {
        queueRetry("cooldown", cooldownLeft + 60);
        return;
      }

      const autoClickCooldownLeft = AUTO_EXPAND_AUTO_CLICK_COOLDOWN_MS - (now - lastAutoClickAt);
      if (autoClickCooldownLeft > 0) {
        queueRetry("auto-click-cooldown", autoClickCooldownLeft + 30);
        return;
      }

      attempts += 1;
      if (attempts > AUTO_EXPAND_MAX_ATTEMPTS) {
        ctx.logger.debug("autoExpandProjects", "max attempts reached; stop retries");
        return;
      }

      const result = runOnce(ctx, reason);

      if (result.stats.sectionClicked || result.stats.folderClicks > 0) {
        lastAutoClickAt = Date.now();
        queueRetry("post-click", AUTO_EXPAND_POST_CLICK_DELAY_MS);
      } else if (!result.done) {
        queueRetry("noop-retry", AUTO_EXPAND_NOOP_RETRY_DELAY_MS);
      }

      if (result.done) {
        goalReached = true;
        attempts = 0;
        refreshGoalSnapshot();
      }
    }, AUTO_EXPAND_DEBOUNCE_MS);
  };

  const resetAndSchedule = (reason: string): void => {
    if (!isFeatureEnabled(ctx)) return;

    if (goalReached && !hasNewProjectRowsSinceGoal()) return;
    if (goalReached && hasNewProjectRowsSinceGoal()) {
      goalReached = false;
      attempts = 0;
    }

    schedule(reason);
  };

  const navNow = getChatHistoryNav(ctx);
  bindUserInteractionGuards(navNow);

  startTimer = window.setTimeout(() => {
    startTimer = null;
    resetAndSchedule("start");
  }, AUTO_EXPAND_START_TIMEOUT_MS);

  navReadyTimer = window.setTimeout(() => {
    navReadyTimer = null;
    resetAndSchedule("nav-ready");
  }, AUTO_EXPAND_NAV_TIMEOUT_MS);

  unsubRoots =
    ctx.domBus?.onRoots((roots) => {
      bindUserInteractionGuards((roots.nav as HTMLElement | null) ?? null);
      resetAndSchedule("route");
    }) ?? null;

  unsubNavDelta =
    ctx.domBus?.onDelta("nav", (delta) => {
      if (!isAutoExpandProjectsRelevantNavDelta(delta.added, delta.removed)) return;
      resetAndSchedule("mutation");
    }) ?? null;

  schedule("init");

  return {
    name: "autoExpandProjects",
    dispose: () => stop(),
    onSettingsChange: (next, prev) => {
      const prevMask = (prev.autoExpandProjects ? 1 : 0) | (prev.autoExpandProjectItems ? 2 : 0);
      const nextMask = (next.autoExpandProjects ? 1 : 0) | (next.autoExpandProjectItems ? 2 : 0);

      if (nextMask === 0) {
        goalReached = true;
        goalSnapshotProjectHrefs = new Set<string>();
        attempts = 0;
        cancelTimers();
        return;
      }

      const enabledNow = prevMask === 0 && nextMask !== 0;
      const addedCapabilities = prevMask !== 0 && (nextMask & ~prevMask) !== 0;
      if (enabledNow || addedCapabilities) {
        goalReached = false;
        attempts = 0;
        bindUserInteractionGuards(getChatHistoryNav(ctx));
        queueRetry(
          enabledNow ? "settings-enable" : "settings-enable-added",
          AUTO_EXPAND_REARM_RETRY_MS
        );
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
