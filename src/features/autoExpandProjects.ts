import { FeatureContext, FeatureHandle } from "../application/featureContext";
import {
  AUTO_EXPAND_PROJECTS_PREFS_DEFAULTS,
  AUTO_EXPAND_PROJECTS_PREFS_KEY,
  AUTO_EXPAND_PROJECTS_REGISTRY_DEFAULTS,
  AUTO_EXPAND_PROJECTS_REGISTRY_KEY,
  AutoExpandProjectsPrefs,
  AutoExpandProjectsRegistry
} from "../domain/settings";
import {
  isElementVisible,
  isNewProjectHref,
  norm,
  normalizeAutoExpandProjectsPrefs,
  normalizeAutoExpandProjectsRegistry,
  normalizeProjectHref
} from "../lib/utils";

const AUTO_EXPAND_START_TIMEOUT_MS = 3500;
const AUTO_EXPAND_NAV_TIMEOUT_MS = 1500;
const AUTO_EXPAND_DEBOUNCE_MS = 250;
const AUTO_EXPAND_USER_COOLDOWN_MS = 5000;
const AUTO_EXPAND_POST_CLICK_DELAY_MS = 500;
const AUTO_EXPAND_NOOP_RETRY_DELAY_MS = 1200;
const AUTO_EXPAND_AUTO_CLICK_COOLDOWN_MS = 250;
const AUTO_EXPAND_MAX_ATTEMPTS = 140;
const AUTO_EXPAND_REARM_RETRY_MS = 900;

const PROJECT_LINK_SELECTOR = ['a[href*="/project"]', 'a[href*="/g/g-p-"]'].join(", ");
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
  expandedProjectRows: number;
  mismatchedProjectRows: number;
  folderClicks: number;
  registryEntries: number;
};

type RunResult = {
  stats: ExpandStats;
  done: boolean;
};

type RunOptions = {
  allowClicks?: boolean;
};

type ProjectRowsResult = {
  projectRows: number;
  expandableProjectRows: number;
  collapsedProjectRows: number;
  expandedProjectRows: number;
  mismatchedProjectRows: number;
  folderClicks: number;
};

type ProjectSidebarRow = {
  href: string;
  title: string;
  order: number;
  link: HTMLAnchorElement;
  toggle: HTMLElement | null;
  expandable: boolean;
  expanded: boolean;
};

type RegistrySyncResult = {
  visibleRows: ProjectSidebarRow[];
  processedRemovalCandidates: string[];
};

type LocalProjectStateCache = {
  registry: AutoExpandProjectsRegistry;
  prefs: AutoExpandProjectsPrefs;
  loaded: boolean;
};

function isFeatureEnabled(ctx: FeatureContext): boolean {
  return !!ctx.settings.autoExpandProjects || !!ctx.settings.autoExpandProjectItems;
}

function shouldEnforceProjectItems(ctx: FeatureContext): boolean {
  return !!ctx.settings.autoExpandProjectItems;
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
  section: HTMLElement,
  allowClicks: boolean
): { expanded: boolean; clicked: boolean } {
  if (!isSectionCollapsed(section)) return { expanded: true, clicked: false };
  if (!allowClicks) return { expanded: false, clicked: false };

  const header = findProjectsHeaderButton(section);
  if (!header || !canInteract(header)) return { expanded: false, clicked: false };

  dispatchSyntheticClick(header);
  return { expanded: false, clicked: true };
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

    if (
      !best ||
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
    return !isCollapsedByContainerSignals(mappedChatContainer);
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

function extractProjectTitle(projectLink: HTMLAnchorElement, href: string): string {
  const label =
    projectLink.textContent?.replace(/\s+/g, " ").trim() ||
    projectLink.getAttribute("aria-label")?.trim() ||
    projectLink.getAttribute("title")?.trim() ||
    href;

  return label || href;
}

function collectProjectRows(section: HTMLElement): ProjectSidebarRow[] {
  const rows: ProjectSidebarRow[] = [];
  let order = 0;

  for (const projectLink of Array.from(
    section.querySelectorAll<HTMLAnchorElement>(PROJECT_LINK_SELECTOR)
  )) {
    const href = normalizeProjectHref(projectLink.getAttribute("href") ?? projectLink.href ?? "");
    if (!href || isNewProjectHref(href)) continue;

    const toggle = findFolderToggleForProject(projectLink);
    const expandable = isExpandableProjectRow(projectLink, toggle);

    rows.push({
      href,
      title: extractProjectTitle(projectLink, href),
      order,
      link: projectLink,
      toggle,
      expandable,
      expanded: expandable ? isProjectExpanded(section, projectLink, toggle) : false
    });

    order += 1;
  }

  return rows;
}

function collectProjectHrefsFromElement(root: Element): Set<string> {
  const out = new Set<string>();

  const appendHref = (link: HTMLAnchorElement) => {
    const href = normalizeProjectHref(link.getAttribute("href") ?? link.href ?? "");
    if (!href || isNewProjectHref(href)) return;
    out.add(href);
  };

  if (root instanceof HTMLAnchorElement && root.matches(PROJECT_LINK_SELECTOR)) {
    appendHref(root);
  }

  for (const link of Array.from(root.querySelectorAll<HTMLAnchorElement>(PROJECT_LINK_SELECTOR))) {
    appendHref(link);
  }

  return out;
}

function reconcileProjectRows(
  rows: ProjectSidebarRow[],
  prefs: AutoExpandProjectsPrefs,
  allowClicks: boolean
): ProjectRowsResult {
  let expandableRows = 0;
  let collapsedRows = 0;
  let expandedRows = 0;
  let mismatchedRows = 0;
  let folderClicks = 0;
  let clickedThisRun = false;

  for (const row of [...rows].reverse()) {
    if (!row.expandable) continue;
    expandableRows += 1;

    const desiredExpanded = prefs.expandedByHref[row.href] === true;
    if (row.expanded === desiredExpanded) continue;

    mismatchedRows += 1;
    if (desiredExpanded) collapsedRows += 1;
    else expandedRows += 1;

    if (clickedThisRun || !allowClicks || !row.toggle || !canInteract(row.toggle)) continue;

    dispatchSyntheticClick(row.toggle);
    folderClicks += 1;
    clickedThisRun = true;
  }

  return {
    projectRows: rows.length,
    expandableProjectRows: expandableRows,
    collapsedProjectRows: collapsedRows,
    expandedProjectRows: expandedRows,
    mismatchedProjectRows: mismatchedRows,
    folderClicks
  };
}

export function initAutoExpandProjectsFeature(ctx: FeatureContext): FeatureHandle {
  let stopped = false;
  let debounceTimer: number | null = null;
  let retryTimer: number | null = null;
  let startTimer: number | null = null;
  let navReadyTimer: number | null = null;
  let loadLocalStatePromise: Promise<void> | null = null;
  let persistLocalStatePromise: Promise<void> | null = null;
  let persistLocalStateQueued = false;

  let attempts = 0;
  let lastUserInteractionAt = 0;
  let lastAutoClickAt = 0;
  let cleanupUserListeners: (() => void) | null = null;

  let unsubRoots: (() => void) | null = null;
  let unsubNavDelta: (() => void) | null = null;

  const pendingRemovalCandidates = new Set<string>();
  const localState: LocalProjectStateCache = {
    registry: {
      ...AUTO_EXPAND_PROJECTS_REGISTRY_DEFAULTS,
      entriesByHref: { ...AUTO_EXPAND_PROJECTS_REGISTRY_DEFAULTS.entriesByHref }
    },
    prefs: {
      ...AUTO_EXPAND_PROJECTS_PREFS_DEFAULTS,
      expandedByHref: { ...AUTO_EXPAND_PROJECTS_PREFS_DEFAULTS.expandedByHref }
    },
    loaded: false
  };

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

  const persistLocalState = (): void => {
    if (persistLocalStatePromise) {
      persistLocalStateQueued = true;
      return;
    }

    const payload = {
      [AUTO_EXPAND_PROJECTS_REGISTRY_KEY]: localState.registry,
      [AUTO_EXPAND_PROJECTS_PREFS_KEY]: localState.prefs
    };

    persistLocalStatePromise = ctx.storagePort
      .setLocal(payload)
      .catch(() => {})
      .finally(() => {
        persistLocalStatePromise = null;
        if (persistLocalStateQueued) {
          persistLocalStateQueued = false;
          persistLocalState();
        }
      });
  };

  const loadLocalState = async (): Promise<void> => {
    if (localState.loaded) return;
    if (loadLocalStatePromise) return loadLocalStatePromise;

    loadLocalStatePromise = ctx.storagePort
      .getLocal({
        [AUTO_EXPAND_PROJECTS_REGISTRY_KEY]: AUTO_EXPAND_PROJECTS_REGISTRY_DEFAULTS,
        [AUTO_EXPAND_PROJECTS_PREFS_KEY]: AUTO_EXPAND_PROJECTS_PREFS_DEFAULTS
      })
      .then((data) => {
        localState.registry = normalizeAutoExpandProjectsRegistry(
          data[AUTO_EXPAND_PROJECTS_REGISTRY_KEY]
        );
        localState.prefs = normalizeAutoExpandProjectsPrefs(data[AUTO_EXPAND_PROJECTS_PREFS_KEY]);
        localState.loaded = true;
      })
      .catch(() => {
        localState.registry = normalizeAutoExpandProjectsRegistry(undefined);
        localState.prefs = normalizeAutoExpandProjectsPrefs(undefined);
        localState.loaded = true;
      })
      .finally(() => {
        loadLocalStatePromise = null;
      });

    return loadLocalStatePromise;
  };

  const syncRegistryWithSection = (section: HTMLElement): RegistrySyncResult => {
    const visibleRows = collectProjectRows(section);
    const visibleHrefs = new Set(visibleRows.map((row) => row.href));
    const registryEntries = localState.registry.entriesByHref;
    const prefsExpandedByHref = localState.prefs.expandedByHref;

    const previousVisibleScanAt = Object.values(registryEntries).reduce(
      (max, entry) => Math.max(max, entry.lastSeenAt),
      0
    );
    const previousVisibleHrefs = new Set(
      Object.values(registryEntries)
        .filter((entry) => entry.lastSeenAt === previousVisibleScanAt)
        .map((entry) => entry.href)
    );

    const visibleSetChanged =
      previousVisibleHrefs.size !== visibleRows.length ||
      visibleRows.some((row) => !previousVisibleHrefs.has(row.href));
    const visibleMetadataChanged = visibleRows.some((row) => {
      const prev = registryEntries[row.href];
      return !prev || prev.title !== row.title || prev.lastSeenOrder !== row.order;
    });
    const shouldRefreshVisibleStamp =
      visibleRows.length > 0 && (visibleSetChanged || visibleMetadataChanged);
    const refreshedVisibleScanAt = shouldRefreshVisibleStamp
      ? Math.max(Date.now(), previousVisibleScanAt + 1)
      : previousVisibleScanAt;

    let nextRegistryEntries = registryEntries;
    let nextPrefsExpandedByHref = prefsExpandedByHref;
    let registryChanged = false;
    let prefsChanged = false;

    for (const row of visibleRows) {
      const prev = nextRegistryEntries[row.href];
      const nextEntry = {
        href: row.href,
        title: row.title,
        lastSeenAt: shouldRefreshVisibleStamp || !prev ? refreshedVisibleScanAt : prev.lastSeenAt,
        lastSeenOrder: row.order
      };

      if (
        !prev ||
        prev.title !== nextEntry.title ||
        prev.lastSeenAt !== nextEntry.lastSeenAt ||
        prev.lastSeenOrder !== nextEntry.lastSeenOrder
      ) {
        if (!registryChanged) nextRegistryEntries = { ...nextRegistryEntries };
        nextRegistryEntries[row.href] = nextEntry;
        registryChanged = true;
      }

      if (!(row.href in nextPrefsExpandedByHref)) {
        if (!prefsChanged) nextPrefsExpandedByHref = { ...nextPrefsExpandedByHref };
        nextPrefsExpandedByHref[row.href] = false;
        prefsChanged = true;
      }
    }

    const processedRemovalCandidates: string[] = [];
    if (visibleRows.length > 0) {
      for (const href of pendingRemovalCandidates) {
        processedRemovalCandidates.push(href);
        if (visibleHrefs.has(href)) continue;

        const hadRegistryEntry = href in nextRegistryEntries;
        const hadPrefEntry = href in nextPrefsExpandedByHref;
        if (!hadRegistryEntry && !hadPrefEntry) continue;

        if (hadRegistryEntry) {
          if (!registryChanged) nextRegistryEntries = { ...nextRegistryEntries };
          delete nextRegistryEntries[href];
          registryChanged = true;
        }

        if (hadPrefEntry) {
          if (!prefsChanged) nextPrefsExpandedByHref = { ...nextPrefsExpandedByHref };
          delete nextPrefsExpandedByHref[href];
          prefsChanged = true;
        }
      }
    }

    if (registryChanged) {
      localState.registry = {
        version: AUTO_EXPAND_PROJECTS_REGISTRY_DEFAULTS.version,
        entriesByHref: nextRegistryEntries
      };
    }

    if (prefsChanged) {
      localState.prefs = {
        version: AUTO_EXPAND_PROJECTS_PREFS_DEFAULTS.version,
        expandedByHref: nextPrefsExpandedByHref
      };
    }

    if (registryChanged || prefsChanged) {
      persistLocalState();
    }

    return {
      visibleRows,
      processedRemovalCandidates
    };
  };

  const runOnce = (reason: string, options: RunOptions = {}): RunResult => {
    const allowClicks = options.allowClicks ?? true;
    const baseStats: ExpandStats = {
      projectsExpanded: false,
      sectionClicked: false,
      projectRows: 0,
      expandableProjectRows: 0,
      collapsedProjectRows: 0,
      expandedProjectRows: 0,
      mismatchedProjectRows: 0,
      folderClicks: 0,
      registryEntries: Object.keys(localState.registry.entriesByHref).length
    };

    const nav = getChatHistoryNav(ctx);
    if (!nav) {
      ctx.logger.debug("autoExpandProjects", `skip (${reason}): nav not found`);
      traceProjects(ctx, "FLOW", "runOnce no sidebar nav", { reason });
      return { stats: baseStats, done: !isFeatureEnabled(ctx) };
    }

    const section = findProjectsSection(nav);
    if (!section) {
      ctx.logger.debug("autoExpandProjects", `skip (${reason}): section not found`);
      traceProjects(ctx, "FLOW", "runOnce no Projects section", { reason });
      return { stats: baseStats, done: !isFeatureEnabled(ctx) };
    }

    const registrySync = syncRegistryWithSection(section);
    for (const href of registrySync.processedRemovalCandidates) {
      pendingRemovalCandidates.delete(href);
    }

    const wantsSectionExpanded = isFeatureEnabled(ctx);
    const wantsProjectReconciliation = shouldEnforceProjectItems(ctx);

    const sectionResult = wantsSectionExpanded
      ? expandSectionIfNeeded(ctx, section, allowClicks)
      : { expanded: !isSectionCollapsed(section), clicked: false };

    let rowsResult: ProjectRowsResult = {
      projectRows: registrySync.visibleRows.length,
      expandableProjectRows: registrySync.visibleRows.filter((row) => row.expandable).length,
      collapsedProjectRows: 0,
      expandedProjectRows: 0,
      mismatchedProjectRows: 0,
      folderClicks: 0
    };

    if (sectionResult.expanded && wantsProjectReconciliation && localState.loaded) {
      rowsResult = reconcileProjectRows(registrySync.visibleRows, localState.prefs, allowClicks);
    }

    const stats: ExpandStats = {
      projectsExpanded: sectionResult.expanded,
      sectionClicked: sectionResult.clicked,
      projectRows: rowsResult.projectRows,
      expandableProjectRows: rowsResult.expandableProjectRows,
      collapsedProjectRows: rowsResult.collapsedProjectRows,
      expandedProjectRows: rowsResult.expandedProjectRows,
      mismatchedProjectRows: rowsResult.mismatchedProjectRows,
      folderClicks: rowsResult.folderClicks,
      registryEntries: Object.keys(localState.registry.entriesByHref).length
    };

    const done = (() => {
      if (!wantsSectionExpanded) return true;
      if (!sectionResult.expanded) return false;
      if (!wantsProjectReconciliation) return true;
      if (!localState.loaded) return false;
      return stats.mismatchedProjectRows === 0;
    })();

    traceProjects(ctx, "FLOW", "runOnce rows stats", {
      reason,
      rows: stats.projectRows,
      expandableRows: stats.expandableProjectRows,
      collapsedRows: stats.collapsedProjectRows,
      expandedRows: stats.expandedProjectRows,
      mismatchedRows: stats.mismatchedProjectRows,
      folderClicks: stats.folderClicks,
      registryEntries: stats.registryEntries
    });
    traceProjects(ctx, "FLOW", "runOnce summary", {
      reason,
      expanded: stats.projectsExpanded,
      done,
      loadedLocalState: localState.loaded,
      wantItems: wantsProjectReconciliation,
      wantProjects: !!ctx.settings.autoExpandProjects
    });

    ctx.logger.debug(
      "autoExpandProjects",
      `${reason}: expanded=${stats.projectsExpanded} rows=${stats.projectRows} mismatched=${stats.mismatchedProjectRows} clicks=${stats.folderClicks}`
    );

    return { stats, done };
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
    if (stopped) return;

    if (debounceTimer !== null) window.clearTimeout(debounceTimer);

    debounceTimer = window.setTimeout(() => {
      debounceTimer = null;
      if (stopped) return;

      const wantsAutomation = isFeatureEnabled(ctx);
      const now = Date.now();
      const cooldownLeft = wantsAutomation
        ? AUTO_EXPAND_USER_COOLDOWN_MS - (now - lastUserInteractionAt)
        : 0;
      const autoClickCooldownLeft = wantsAutomation
        ? AUTO_EXPAND_AUTO_CLICK_COOLDOWN_MS - (now - lastAutoClickAt)
        : 0;
      const allowClicks = wantsAutomation ? cooldownLeft <= 0 && autoClickCooldownLeft <= 0 : true;

      if (wantsAutomation && allowClicks) {
        attempts += 1;
        if (attempts > AUTO_EXPAND_MAX_ATTEMPTS) {
          ctx.logger.debug("autoExpandProjects", "max attempts reached; stop retries");
          return;
        }
      }

      const result = runOnce(reason, { allowClicks });

      if (result.stats.sectionClicked || result.stats.folderClicks > 0) {
        attempts = 0;
        lastAutoClickAt = Date.now();
        queueRetry("post-click", AUTO_EXPAND_POST_CLICK_DELAY_MS);
        return;
      }

      if (!wantsAutomation) return;

      if (!allowClicks) {
        const delayMs = Math.max(cooldownLeft, autoClickCooldownLeft) + 60;
        if (!result.done) queueRetry("cooldown", delayMs);
        return;
      }

      if (!result.done) {
        queueRetry("noop-retry", AUTO_EXPAND_NOOP_RETRY_DELAY_MS);
        return;
      }

      attempts = 0;
    }, AUTO_EXPAND_DEBOUNCE_MS);
  };

  const resetAndSchedule = (reason: string): void => {
    attempts = 0;
    schedule(reason);
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

  ctx.storagePort.onChanged?.((changes, areaName) => {
    if (stopped || areaName !== "local") return;

    let changed = false;

    if (AUTO_EXPAND_PROJECTS_REGISTRY_KEY in changes) {
      localState.registry = normalizeAutoExpandProjectsRegistry(
        changes[AUTO_EXPAND_PROJECTS_REGISTRY_KEY]?.newValue
      );
      localState.loaded = true;
      changed = true;
    }

    if (AUTO_EXPAND_PROJECTS_PREFS_KEY in changes) {
      localState.prefs = normalizeAutoExpandProjectsPrefs(
        changes[AUTO_EXPAND_PROJECTS_PREFS_KEY]?.newValue
      );
      localState.loaded = true;
      changed = true;
    }

    if (changed) {
      resetAndSchedule("storage-local");
    }
  });

  const navNow = getChatHistoryNav(ctx);
  bindUserInteractionGuards(navNow);

  void loadLocalState().then(() => {
    if (!stopped) resetAndSchedule("local-state-ready");
  });

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

      for (const removed of delta.removed) {
        for (const href of collectProjectHrefsFromElement(removed)) {
          pendingRemovalCandidates.add(href);
        }
      }

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
        attempts = 0;
        cancelTimers();
        schedule("settings-disable-sync");
        return;
      }

      const enabledNow = prevMask === 0 && nextMask !== 0;
      const addedCapabilities = prevMask !== 0 && (nextMask & ~prevMask) !== 0;
      if (enabledNow || addedCapabilities) {
        attempts = 0;
        bindUserInteractionGuards(getChatHistoryNav(ctx));
        queueRetry(
          enabledNow ? "settings-enable" : "settings-enable-added",
          AUTO_EXPAND_REARM_RETRY_MS
        );
      } else {
        resetAndSchedule("settings-change");
      }
    },
    getStatus: () => ({ active: isFeatureEnabled(ctx) }),
    __test: {
      getChatHistoryNav,
      findProjectsSection,
      isSectionCollapsed,
      runOnce: (testCtx: FeatureContext, reason: string, options?: RunOptions) => {
        void testCtx;
        return runOnce(reason, options);
      },
      loadLocalState,
      getLocalState: () => ({
        registry: localState.registry,
        prefs: localState.prefs
      }),
      captureRemovedProjectCandidates: (removed: Element[]) => {
        for (const el of removed) {
          for (const href of collectProjectHrefsFromElement(el)) {
            pendingRemovalCandidates.add(href);
          }
        }
        return Array.from(pendingRemovalCandidates);
      }
    }
  };
}
