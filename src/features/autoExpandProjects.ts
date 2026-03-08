import { FeatureContext, FeatureHandle } from "../application/featureContext";
import { isElementVisible, norm } from "../lib/utils";

const AUTO_EXPAND_START_TIMEOUT_MS = 3500;
const AUTO_EXPAND_NAV_TIMEOUT_MS = 1500;
const AUTO_EXPAND_POST_CLICK_DELAY_MS = 1700;
const AUTO_EXPAND_NOOP_RETRY_DELAY_MS = 1200;
const AUTO_EXPAND_DEBOUNCE_MS = 250;
const AUTO_EXPAND_USER_COOLDOWN_MS = 5000;
const AUTO_EXPAND_MAX_ATTEMPTS = 120;
const AUTO_EXPAND_REPEAT_CLICK_COOLDOWN_MS = 8000;

const DBG_DUMP_THROTTLE_MS = 2200;
const DBG_MAX_OUTERHTML_CHARS = 1200;
const DBG_MAX_TREE_DEPTH = 4;
const DBG_MAX_TREE_LINES = 40;
const DBG_MUTATION_SUMMARY_MAX_TARGETS = 5;
const DBG_MUTATION_SUMMARY_MAX_ATTR_CHANGES = 12;
const AUTO_EXPAND_PROJECTS_RELEVANT_SELECTOR = [
  'nav[aria-label="Chat history"]',
  'a[href*="/project"]',
  '[class*="sidebar-expando-section"]',
  "button[aria-expanded]",
  '[data-state="open"]',
  '[data-state="closed"]'
].join(", ");

let lastClickedProjectHref: string | null = null;
let lastClickedProjectAt = 0;

let dbgLastDumpAt = 0;
let dbgObserverDisconnect: (() => void) | null = null;
let dbgObservedRoot: Element | null = null;

type ExpandStats = {
  projectsExpanded: boolean;
  sectionClicked: boolean;
  projectRows: number;
  expandableProjectRows: number;
  collapsedProjectRows: number;
  folderClicks: number;
};

type ExpandSectionResult = { expanded: boolean; clicked: boolean };
const matchesSelectorOrDescendant = (el: Element, selector: string) => {
  try {
    return el.matches(selector) || el.querySelector(selector) !== null;
  } catch {
    return false;
  }
};

export const isAutoExpandProjectsRelevantNavDelta = (added: Element[], removed: Element[]) => {
  // Keep synthetic empty deltas (used in tests and some mocked integrations) as relevant.
  if (added.length === 0 && removed.length === 0) return true;

  for (const el of added) {
    if (matchesSelectorOrDescendant(el, AUTO_EXPAND_PROJECTS_RELEVANT_SELECTOR)) return true;
  }
  for (const el of removed) {
    if (matchesSelectorOrDescendant(el, AUTO_EXPAND_PROJECTS_RELEVANT_SELECTOR)) return true;
  }

  return false;
};

function isFeatureEnabled(ctx: FeatureContext): boolean {
  return ctx.settings.autoExpandProjects || ctx.settings.autoExpandProjectItems;
}

function isProjectsDebugEnabled(ctx: FeatureContext): boolean {
  return ctx.logger.isTraceEnabled("projects");
}

function getProjectsMode(pathname: string): string {
  if (/\/c\/[^/?#]+/.test(pathname)) return "chat";
  if (pathname.includes("/codex") || pathname.includes("/codecs")) return "codex";
  if (pathname === "/" || pathname === "") return "home";
  return "other";
}

function getProjectsSendButtonState(): string {
  const btn =
    document.querySelector<HTMLElement>('[data-testid="send-button"]') ??
    document.querySelector<HTMLElement>("#composer-submit-button") ??
    document.querySelector<HTMLElement>("button.composer-submit-btn");
  if (!btn) return "missing";
  if (!isElementVisible(btn)) return "hidden";
  if (
    btn.hasAttribute("disabled") ||
    (btn.getAttribute("aria-disabled") || "").toLowerCase() === "true"
  ) {
    return "disabled";
  }
  return "ready";
}

function traceProjects(
  ctx: FeatureContext,
  scope: string,
  message: string,
  fields?: Record<string, unknown>,
  level: "log" | "warn" | "info" | "error" = "log"
): void {
  ctx.logger.trace("projects", scope, message, fields, level);
}

function traceProjectsContract(
  ctx: FeatureContext,
  scope: string,
  fields?: Record<string, unknown>
): void {
  ctx.logger.contractSnapshot("projects", scope, {
    path: location.pathname,
    mode: getProjectsMode(location.pathname),
    dictationState: "n/a",
    composerKind: "n/a",
    sendButtonState: getProjectsSendButtonState(),
    ...(fields ?? {})
  });
}

function short(value: string, n: number): string {
  const t = String(value || "")
    .replace(/\s+/g, " ")
    .trim();
  if (t.length <= n) return t;
  return `${t.slice(0, n)}...`;
}

function elFingerprint(el: Element | null): string {
  if (!el) return "null";
  const h = el as HTMLElement;
  const tag = el.tagName ? el.tagName.toLowerCase() : "node";
  const id = h.id ? `#${h.id}` : "";
  const cls = h.className
    ? `.${String(h.className).trim().split(/\s+/).slice(0, 3).join(".")}`
    : "";
  const role = el.getAttribute?.("role") || "";
  const aria = el.getAttribute?.("aria-label") || "";
  const title = el.getAttribute?.("title") || "";
  const href = (el as HTMLAnchorElement).getAttribute?.("href") || "";
  const ds = el.getAttribute?.("data-state") || "";
  const ae = el.getAttribute?.("aria-expanded") || "";

  const bits: string[] = [`${tag}${id}${cls}`];
  if (role) bits.push(`role=${role}`);
  if (ds) bits.push(`data-state=${ds}`);
  if (ae) bits.push(`aria-expanded=${ae}`);
  if (href) bits.push(`href=${short(href, 60)}`);
  if (aria) bits.push(`aria="${short(aria, 60)}"`);
  if (title) bits.push(`title="${short(title, 60)}"`);
  return bits.join(" ");
}

function dumpTree(root: Element): string {
  const lines: string[] = [];
  const visit = (el: Element, depth: number) => {
    if (lines.length >= DBG_MAX_TREE_LINES) return;
    lines.push(`${"  ".repeat(depth)}${elFingerprint(el)}`);
    if (depth >= DBG_MAX_TREE_DEPTH) return;
    for (const ch of Array.from(el.children)) {
      visit(ch, depth + 1);
      if (lines.length >= DBG_MAX_TREE_LINES) return;
    }
  };
  visit(root, 0);
  if (lines.length >= DBG_MAX_TREE_LINES) lines.push("[TRUNCATED: too many nodes]");
  return lines.join("\n");
}

function maybeDumpProjectsSubtree(ctx: FeatureContext, section: HTMLElement, reason: string): void {
  if (!isProjectsDebugEnabled(ctx)) return;
  const now = Date.now();
  if (now - dbgLastDumpAt < DBG_DUMP_THROTTLE_MS) return;
  dbgLastDumpAt = now;

  const html = section.outerHTML;
  const htmlPreview =
    html.length > DBG_MAX_OUTERHTML_CHARS
      ? `${html.slice(0, DBG_MAX_OUTERHTML_CHARS)}...(+${html.length - DBG_MAX_OUTERHTML_CHARS})`
      : html;
  const tree = dumpTree(section);
  const treePreview = short(tree, 420);

  traceProjects(ctx, "DUMP", "projects subtree snapshot", {
    reason,
    outerHtmlLen: html.length,
    outerHtmlPreview: htmlPreview,
    treePreview
  });
  traceProjectsContract(ctx, "DUMP", {
    reason,
    outerHtmlLen: html.length
  });
}

function isRelevantAttribute(attrName: string | null): boolean {
  if (!attrName) return false;
  return (
    attrName === "data-state" ||
    attrName === "aria-expanded" ||
    attrName === "class" ||
    attrName === "role" ||
    attrName === "hidden" ||
    attrName === "style" ||
    attrName.startsWith("aria-") ||
    attrName.startsWith("data-")
  );
}

function summarizeMutations(records: MutationRecord[]): string {
  let childList = 0;
  let attrs = 0;
  let text = 0;
  const attrNames: Record<string, number> = {};
  const targets: Record<string, { childAdds: number; childRemoves: number; attrChanges: number }> =
    {};

  for (const r of records) {
    if (r.type === "childList") {
      childList += 1;
      const key = elFingerprint(r.target as Element);
      targets[key] = targets[key] ?? { childAdds: 0, childRemoves: 0, attrChanges: 0 };
      targets[key].childAdds += r.addedNodes?.length ?? 0;
      targets[key].childRemoves += r.removedNodes?.length ?? 0;
    } else if (r.type === "attributes") {
      attrs += 1;
      const name = r.attributeName ?? "";
      if (name) attrNames[name] = (attrNames[name] ?? 0) + 1;
      const key = elFingerprint(r.target as Element);
      targets[key] = targets[key] ?? { childAdds: 0, childRemoves: 0, attrChanges: 0 };
      targets[key].attrChanges += 1;
    } else if (r.type === "characterData") {
      text += 1;
    }
  }

  const topAttrs = Object.entries(attrNames)
    .sort((a, b) => b[1] - a[1])
    .slice(0, DBG_MUTATION_SUMMARY_MAX_ATTR_CHANGES)
    .map(([k, v]) => `${k}:${v}`)
    .join(", ");

  const topTargets = Object.entries(targets)
    .sort(
      (a, b) =>
        b[1].childAdds +
        b[1].childRemoves +
        b[1].attrChanges -
        (a[1].childAdds + a[1].childRemoves + a[1].attrChanges)
    )
    .slice(0, DBG_MUTATION_SUMMARY_MAX_TARGETS)
    .map(([k, v]) => `${k} (+${v.childAdds}/-${v.childRemoves} attrs=${v.attrChanges})`)
    .join(" | ");

  return `mutations=${records.length} childList=${childList} attrs=${attrs} text=${text}${
    topAttrs ? ` attrs=[${topAttrs}]` : ""
  }${topTargets ? ` targets=[${topTargets}]` : ""}`;
}

function dispatchHumanClick(el: HTMLElement): void {
  const anchor = el.closest<HTMLAnchorElement>("a[href]");
  const preventIfFromToggle = (event: Event) => {
    const target = event.target;
    if (!(target instanceof Node)) return;
    if (target === el) {
      event.preventDefault();
      return;
    }
    if (el.contains(target)) {
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
  return (
    (ctx.domBus?.getNavRoot() as HTMLElement | null) ??
    ctx.helpers.safeQuery<HTMLElement>('nav[aria-label="Chat history"]')
  );
}

function findProjectsSection(nav: HTMLElement): HTMLElement | null {
  const sections = Array.from(
    nav.querySelectorAll<HTMLElement>('[class*="sidebar-expando-section"]')
  );
  for (const sec of sections) if (sec.querySelector('a[href*="/project"]')) return sec;
  for (const sec of sections) {
    const t = norm(sec.textContent);
    if (t.includes("projects") || t.includes("проекты")) return sec;
  }
  return null;
}

function normalizeProjectHref(href: string): string {
  const raw = String(href || "").trim();
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
    section.querySelectorAll<HTMLAnchorElement>('a[href*="/project"]')
  )) {
    const href = normalizeProjectHref(link.getAttribute("href") ?? link.href ?? "");
    if (href) out.add(href);
  }
  return out;
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
  dispatchHumanClick(headerBtn);
  return { expanded: false, clicked: true };
}

function isLikelyOptionsButton(el: HTMLElement): boolean {
  const aria = norm(el.getAttribute("aria-label"));
  const title = norm(el.getAttribute("title"));
  const hint = `${aria} ${title}`;
  return (
    !!hint &&
    (hint.includes("options") ||
      hint.includes("option") ||
      hint.includes("menu") ||
      hint.includes("more") ||
      hint.includes("ellipsis"))
  );
}

function isInsideOverflowHidden(el: HTMLElement): boolean {
  return el.closest('[class*="overflow-hidden"]') !== null;
}

function isTrailingMenuEl(el: HTMLElement): boolean {
  // ChatGPT sidebar rows often contain a trailing "..." menu button which also has data-state/
  // aria-expanded. Treat it as non-toggle to avoid clicking it when trying to expand project folders.
  if (el.hasAttribute("data-trailing-button")) return true;
  if (el.getAttribute("aria-haspopup") === "menu") return true;

  const cls = String(el.className || "");
  if (cls.includes("__menu-item-trailing-btn")) return true;
  if (el.closest(".trailing") !== null) return true;

  const ariaLabel = norm(el.getAttribute("aria-label"));
  const title = norm(el.getAttribute("title"));
  // Some builds use a non-standard `aria` attribute instead of aria-label.
  const ariaLoose = norm(el.getAttribute("aria"));
  const hint = `${ariaLabel} ${title} ${ariaLoose}`;
  if (
    hint.includes("open conversation options") ||
    hint.includes("conversation options") ||
    hint.includes("options") ||
    hint.includes("archive") ||
    hint.includes("pin")
  )
    return true;

  return false;
}

function pickLeftmost(els: HTMLElement[]): HTMLElement | null {
  let best: { el: HTMLElement; x: number; y: number; w: number; h: number } | null = null;
  for (const el of els) {
    if (!isElementVisible(el)) continue;
    const r = el.getBoundingClientRect();
    const x = r.left;
    const y = r.top;
    const w = r.width;
    const h = r.height;
    if (w <= 0 || h <= 0) continue;
    if (!best) {
      best = { el, x, y, w, h };
      continue;
    }
    // Prefer smaller X (leftmost). Tie-break with smaller Y.
    if (x < best.x - 1 || (Math.abs(x - best.x) <= 1 && y < best.y - 1)) {
      best = { el, x, y, w, h };
    }
  }
  return best?.el ?? null;
}

function isProjectExpanded(
  projectLink: HTMLAnchorElement,
  rowFolderEl?: HTMLElement | null
): boolean {
  const folderButton = rowFolderEl ?? findFolderToggleElForProject(projectLink);
  const folderState = folderButton?.getAttribute("data-state");
  if (folderState === "open") return true;
  if (folderState === "closed") return false;
  const ariaExpanded = folderButton?.getAttribute("aria-expanded");
  if (ariaExpanded === "true") return true;
  if (ariaExpanded === "false") return false;

  const sib = projectLink.nextElementSibling as HTMLElement | null;
  if (!sib || !sib.className.includes("overflow-hidden")) return false;
  if (sib.getAttribute("aria-hidden") === "true" || sib.hasAttribute("hidden")) return false;
  if (
    norm(sib.style.display) === "none" ||
    norm(sib.style.visibility) === "hidden" ||
    norm(sib.style.opacity) === "0"
  )
    return false;
  if (/^0(?:px|rem|em|%)?$/.test(sib.style.height.trim())) return false;
  if (/^0(?:px|rem|em|%)?$/.test(sib.style.maxHeight.trim())) return false;
  return true;
}

function findFolderToggleEl(rowScope: HTMLElement): HTMLElement | null {
  // Fast-path: in the current sidebar DOM the folder toggle is usually a left icon button
  // (`button.icon`) with `data-state=open|closed`. There is also a trailing options button
  // that matches generic selectors; we must avoid that.
  const iconToggles = Array.from(
    rowScope.querySelectorAll<HTMLElement>(
      'button.icon[data-state="open"], button.icon[data-state="closed"], button.icon[aria-expanded="true"], button.icon[aria-expanded="false"]'
    )
  ).filter((el) => !isTrailingMenuEl(el) && !isInsideOverflowHidden(el));
  const leftIconToggle = pickLeftmost(iconToggles);
  if (leftIconToggle) return leftIconToggle;

  const candidates = Array.from(
    rowScope.querySelectorAll<HTMLElement>('button, [role="button"], [data-state], [aria-expanded]')
  ).filter((el) => !isTrailingMenuEl(el) && !isInsideOverflowHidden(el));

  for (const el of candidates) {
    if (isLikelyOptionsButton(el) || isTrailingMenuEl(el) || isInsideOverflowHidden(el)) continue;
    const hint = `${norm(el.getAttribute("aria-label"))} ${norm(el.getAttribute("title"))}`;
    if (
      (hint.includes("show") ||
        hint.includes("hide") ||
        hint.includes("expand") ||
        hint.includes("collapse")) &&
      (hint.includes("chat") || hint.includes("project") || hint.includes("folder"))
    )
      return el;
  }

  const byStatefulAll = Array.from(
    rowScope.querySelectorAll<HTMLElement>(
      '[data-state="open"], [data-state="closed"], [aria-expanded="true"], [aria-expanded="false"]'
    )
  ).filter((el) => !isTrailingMenuEl(el) && !isInsideOverflowHidden(el));
  const byStateful = pickLeftmost(byStatefulAll);
  if (byStateful) return byStateful;

  const byIcon = rowScope.querySelector<HTMLElement>(
    ".icon:not([data-trailing-button]):not([aria-haspopup])"
  );
  if (byIcon && !isTrailingMenuEl(byIcon) && !isInsideOverflowHidden(byIcon)) return byIcon;

  for (const el of candidates) {
    if (
      isLikelyOptionsButton(el) ||
      isTrailingMenuEl(el) ||
      isInsideOverflowHidden(el) ||
      !el.querySelector("svg")
    )
      continue;
    const r = el.getBoundingClientRect();
    if (r.width <= 48 && r.height <= 48) return el;
  }
  return null;
}

function findFolderToggleElForProject(projectLink: HTMLAnchorElement): HTMLElement | null {
  let el = findFolderToggleEl(projectLink);
  if (el) return el;
  const li = projectLink.closest<HTMLElement>("li");
  if (li) {
    el = findFolderToggleEl(li);
    if (el) return el;
  }
  const parent = projectLink.parentElement;
  if (parent && parent.querySelectorAll('a[href*="/project"]').length <= 1)
    return findFolderToggleEl(parent);
  return null;
}

function isExpandableProjectRow(
  projectLink: HTMLAnchorElement,
  rowFolderEl: HTMLElement | null
): boolean {
  const sib = projectLink.nextElementSibling as HTMLElement | null;
  if (sib && sib.className.includes("overflow-hidden")) return true;
  return (
    rowFolderEl?.hasAttribute("data-state") === true ||
    rowFolderEl?.hasAttribute("aria-expanded") === true
  );
}

function getElementStateSnapshot(
  toggle: HTMLElement | null,
  projectLink: HTMLAnchorElement
): string {
  const sib = projectLink.nextElementSibling as HTMLElement | null;
  const sibCls = sib?.className ?? "";
  return `toggle(data-state=${toggle?.getAttribute("data-state") ?? ""} aria-expanded=${toggle?.getAttribute("aria-expanded") ?? ""}) sib(cls~overflow-hidden=${sibCls.includes("overflow-hidden") ? "1" : "0"} aria-hidden=${sib?.getAttribute("aria-hidden") ?? ""} hidden=${sib?.hasAttribute("hidden") ? "1" : "0"})`;
}

function expandCollapsedProjectFolders(
  ctx: FeatureContext,
  section: HTMLElement
): {
  totalRows: number;
  expandableRows: number;
  collapsedRows: number;
  folderClicks: number;
  missingToggleRows: number;
  clickNoEffectRows: number;
} {
  const projects = Array.from(section.querySelectorAll<HTMLAnchorElement>('a[href*="/project"]'));
  if (projects.length === 0)
    return {
      totalRows: 0,
      expandableRows: 0,
      collapsedRows: 0,
      folderClicks: 0,
      missingToggleRows: 0,
      clickNoEffectRows: 0
    };

  let expandableRows = 0;
  let collapsedRows = 0;
  let folderClicks = 0;
  let missingToggleRows = 0;
  let clickNoEffectRows = 0;

  for (const projectLink of [...projects].reverse()) {
    const href = projectLink.getAttribute("href") ?? "";
    const toggle = findFolderToggleElForProject(projectLink);
    if (!isExpandableProjectRow(projectLink, toggle)) continue;
    expandableRows += 1;

    if (isProjectsDebugEnabled(ctx)) {
      traceProjects(ctx, "FLOW", "project row discovered", {
        href: href || "(no-href)",
        expandable: true,
        toggle: toggle ? elFingerprint(toggle) : "null"
      });
    }

    if (isProjectExpanded(projectLink, toggle)) continue;
    collapsedRows += 1;
    if (folderClicks > 0) continue;

    if (!toggle) {
      missingToggleRows += 1;
      if (isProjectsDebugEnabled(ctx))
        traceProjects(
          ctx,
          "FLOW",
          "missing toggle for expandable project",
          { href: href || "(no-href)" },
          "warn"
        );
      continue;
    }

    const now = Date.now();
    if (
      href &&
      href === lastClickedProjectHref &&
      now - lastClickedProjectAt < AUTO_EXPAND_REPEAT_CLICK_COOLDOWN_MS
    )
      continue;

    const before = getElementStateSnapshot(toggle, projectLink);
    if (isProjectsDebugEnabled(ctx)) {
      const r = toggle.getBoundingClientRect();
      traceProjects(ctx, "FLOW", "click toggle", {
        href: href || "(no-href)",
        bbox: `${Math.round(r.width)}x${Math.round(r.height)}`,
        before
      });
    }
    dispatchHumanClick(toggle);
    folderClicks = 1;
    lastClickedProjectHref = href;
    lastClickedProjectAt = now;

    window.setTimeout(() => {
      if (!isProjectsDebugEnabled(ctx)) return;
      const after = getElementStateSnapshot(toggle, projectLink);
      const changed = after !== before;
      traceProjects(ctx, "FLOW", "post-click", {
        href: href || "(no-href)",
        changed,
        after
      });
      if (!changed) clickNoEffectRows += 1;
    }, 380);
  }

  return {
    totalRows: projects.length,
    expandableRows,
    collapsedRows,
    folderClicks,
    missingToggleRows,
    clickNoEffectRows
  };
}

function ensureDebugObserver(ctx: FeatureContext, section: HTMLElement): void {
  if (!isProjectsDebugEnabled(ctx)) {
    dbgObserverDisconnect?.();
    dbgObserverDisconnect = null;
    dbgObservedRoot = null;
    return;
  }
  if (dbgObservedRoot === section && dbgObserverDisconnect) return;

  dbgObserverDisconnect?.();
  dbgObservedRoot = section;

  const { disconnect } = ctx.helpers.observe(
    section,
    (records) => {
      if (!isProjectsDebugEnabled(ctx)) return;
      const relevant = records.filter((r) =>
        r.type === "attributes" ? isRelevantAttribute(r.attributeName) : r.type === "childList"
      );
      if (relevant.length === 0) return;
      traceProjects(ctx, "OBS", "mutation", { summary: summarizeMutations(relevant) });
      maybeDumpProjectsSubtree(ctx, section, "mutation");
    },
    {
      subtree: true,
      childList: true,
      attributes: true,
      attributeOldValue: true,
      characterData: false
    }
  );
  dbgObserverDisconnect = disconnect;
  traceProjects(ctx, "OBS", "debug observer attached", {
    section: elFingerprint(section)
  });
  traceProjectsContract(ctx, "OBS", { phase: "observer-attached" });
  maybeDumpProjectsSubtree(ctx, section, "attach");
}

function runOnce(ctx: FeatureContext, reason: string): { stats: ExpandStats; done: boolean } {
  const nav = getChatHistoryNav(ctx);
  if (!nav) {
    if (isProjectsDebugEnabled(ctx))
      traceProjects(ctx, "FLOW", "runOnce no sidebar nav", { reason });
    return {
      stats: {
        projectsExpanded: false,
        sectionClicked: false,
        projectRows: 0,
        expandableProjectRows: 0,
        collapsedProjectRows: 0,
        folderClicks: 0
      },
      done: false
    };
  }

  const section = findProjectsSection(nav);
  if (!section) {
    if (isProjectsDebugEnabled(ctx))
      traceProjects(ctx, "FLOW", "runOnce no Projects section", { reason });
    return {
      stats: {
        projectsExpanded: false,
        sectionClicked: false,
        projectRows: 0,
        expandableProjectRows: 0,
        collapsedProjectRows: 0,
        folderClicks: 0
      },
      done: false
    };
  }

  ensureDebugObserver(ctx, section);

  const wantProjects = ctx.settings.autoExpandProjects;
  const wantItems = ctx.settings.autoExpandProjectItems;
  if (!wantProjects && !wantItems) {
    if (isProjectsDebugEnabled(ctx))
      traceProjects(ctx, "FLOW", "runOnce disabled by settings", { reason });
    return {
      stats: {
        projectsExpanded: false,
        sectionClicked: false,
        projectRows: 0,
        expandableProjectRows: 0,
        collapsedProjectRows: 0,
        folderClicks: 0
      },
      done: true
    };
  }

  let expanded = !isSectionCollapsed(section);
  let sectionClicked = false;
  if (!expanded) {
    const res = expandSectionIfNeeded(ctx, section);
    expanded = res.expanded;
    sectionClicked = res.clicked;
  }

  let rows = section.querySelectorAll('a[href*="/project"]').length;
  let expandableRows = 0;
  let collapsedRows = 0;
  let folderClicks = 0;
  if (expanded && wantItems) {
    const result = expandCollapsedProjectFolders(ctx, section);
    rows = result.totalRows;
    expandableRows = result.expandableRows;
    collapsedRows = result.collapsedRows;
    folderClicks = result.folderClicks;
    if (isProjectsDebugEnabled(ctx)) {
      traceProjects(ctx, "FLOW", "runOnce rows stats", {
        reason,
        rows,
        expandableRows,
        collapsedRows,
        missingToggleRows: result.missingToggleRows,
        folderClicks
      });
      if (rows > 0 && expandableRows === 0) {
        traceProjects(
          ctx,
          "FLOW",
          "rows>0 but expandableRows==0 (selector drift?)",
          { reason, rows, expandableRows },
          "warn"
        );
        maybeDumpProjectsSubtree(ctx, section, "no-expandable-rows");
      }
    }
  }

  const done = wantItems
    ? expanded && rows > 0 && expandableRows > 0 && collapsedRows === 0
    : expanded;
  if (isProjectsDebugEnabled(ctx)) {
    traceProjects(ctx, "FLOW", "runOnce summary", {
      reason,
      expanded,
      wantProjects,
      wantItems,
      done
    });
    traceProjectsContract(ctx, "FLOW", {
      reason,
      projectsExpanded: expanded,
      projectRows: rows,
      collapsedRows
    });
  }

  return {
    stats: {
      projectsExpanded: expanded,
      sectionClicked,
      projectRows: rows,
      expandableProjectRows: expandableRows,
      collapsedProjectRows: collapsedRows,
      folderClicks
    },
    done
  };
}

export function initAutoExpandProjectsFeature(ctx: FeatureContext): FeatureHandle {
  lastClickedProjectHref = null;
  lastClickedProjectAt = 0;

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
  let goalSnapshotProjectHrefs = new Set<string>();

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

  const tryRearmAfterGoal = (reason: string): boolean => {
    if (!goalReached) return true;
    if (!hasNewProjectRowsSinceGoal()) return false;
    goalReached = false;
    attempts = 0;
    if (isProjectsDebugEnabled(ctx)) {
      traceProjects(ctx, "FLOW", "rearm after goal due to new project rows", { reason });
    }
    return true;
  };

  const bindUserInteractionGuards = (nav: HTMLElement | null) => {
    cleanupUserListeners?.();
    cleanupUserListeners = null;
    if (!nav) return;
    const onUser = (event: Event) => {
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
    dbgObserverDisconnect?.();
    dbgObserverDisconnect = null;
    dbgObservedRoot = null;
  };

  const schedule = (reason: string): void => {
    if (stopped || !isFeatureEnabled(ctx) || goalReached) return;
    if (debounceTimer !== null) window.clearTimeout(debounceTimer);

    debounceTimer = window.setTimeout(() => {
      debounceTimer = null;
      if (stopped || !isFeatureEnabled(ctx) || goalReached) return;
      if (Date.now() - lastUserInteractionAt < AUTO_EXPAND_USER_COOLDOWN_MS) return;
      if (Date.now() - lastAutoClickAt < 1500) return;

      attempts += 1;
      if (attempts > AUTO_EXPAND_MAX_ATTEMPTS) {
        if (isProjectsDebugEnabled(ctx))
          traceProjects(ctx, "FLOW", "max attempts reached, stop", { attempts }, "warn");
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
      } else if (!done) {
        // Keep probing while sidebar content is still settling, even when nav deltas are sparse.
        if (postClickTimer !== null) window.clearTimeout(postClickTimer);
        postClickTimer = window.setTimeout(() => {
          postClickTimer = null;
          schedule("noop-retry");
        }, AUTO_EXPAND_NOOP_RETRY_DELAY_MS);
      }

      if (done) {
        if (isProjectsDebugEnabled(ctx))
          traceProjects(ctx, "FLOW", "goal reached; idle until reload or re-enable", {
            reason
          });
        refreshGoalSnapshot();
        goalReached = true;
        attempts = 0;
        if (postClickTimer !== null) window.clearTimeout(postClickTimer);
        postClickTimer = null;
      }
    }, AUTO_EXPAND_DEBOUNCE_MS);
  };

  startTimer = window.setTimeout(() => {
    startTimer = null;
    if (stopped || !isFeatureEnabled(ctx) || goalReached) return;
    schedule("start");
  }, AUTO_EXPAND_START_TIMEOUT_MS);

  navReadyTimer = window.setTimeout(() => {
    navReadyTimer = null;
    if (stopped || !isFeatureEnabled(ctx) || goalReached) return;
    schedule("nav-ready");
  }, AUTO_EXPAND_NAV_TIMEOUT_MS);

  const refreshNavBindings = () => {
    const nav = getChatHistoryNav(ctx);
    bindUserInteractionGuards(nav);
    if (!isFeatureEnabled(ctx)) return;
    if (!nav && navRetryTimeout === null && !stopped) {
      navRetryTimeout = window.setTimeout(() => {
        navRetryTimeout = null;
        if (stopped || !isFeatureEnabled(ctx) || goalReached) return;
        schedule("late-nav");
      }, 1000);
    }
  };

  refreshNavBindings();

  unsubRoots =
    ctx.domBus?.onRoots((roots) => {
      bindUserInteractionGuards((roots.nav as HTMLElement | null) ?? null);
      if (!isFeatureEnabled(ctx)) return;
      if (!tryRearmAfterGoal("route")) return;
      attempts = 0;
      schedule("route");
    }) ?? null;

  unsubNavDelta =
    ctx.domBus?.onDelta("nav", (delta) => {
      if (!isFeatureEnabled(ctx)) return;
      if (!isAutoExpandProjectsRelevantNavDelta(delta.added, delta.removed)) return;
      if (!tryRearmAfterGoal("mutation")) return;
      schedule("mutation");
    }) ?? null;

  return {
    name: "autoExpandProjects",
    dispose: () => stop(),
    onSettingsChange: (next, prev) => {
      const prevMask = (prev.autoExpandProjects ? 1 : 0) | (prev.autoExpandProjectItems ? 2 : 0);
      const nextMask = (next.autoExpandProjects ? 1 : 0) | (next.autoExpandProjectItems ? 2 : 0);
      const prevEnabled = prevMask !== 0;
      const nextEnabled = nextMask !== 0;
      const prevDbg = !!prev.debugAutoExpandProjects;
      const nextDbg = !!next.debugAutoExpandProjects;

      if (prevDbg !== nextDbg && nextDbg) {
        traceProjects(ctx, "CFG", "debug enabled", undefined, "info");
      }
      if (prevDbg !== nextDbg && !nextDbg) {
        traceProjects(ctx, "CFG", "debug disabled", undefined, "info");
      }

      if (prevDbg && !nextDbg) {
        dbgObserverDisconnect?.();
        dbgObserverDisconnect = null;
        dbgObservedRoot = null;
      }

      if (!prevDbg && nextDbg) {
        const navNow = getChatHistoryNav(ctx);
        const secNow = navNow ? findProjectsSection(navNow) : null;
        if (secNow) ensureDebugObserver(ctx, secNow);
      }

      if (!nextEnabled) {
        goalReached = true;
        goalSnapshotProjectHrefs = new Set<string>();
        attempts = 0;
        if (postClickTimer !== null) window.clearTimeout(postClickTimer);
        postClickTimer = null;
        cancelTimers();
        dbgObserverDisconnect?.();
        dbgObserverDisconnect = null;
        dbgObservedRoot = null;
        return;
      }

      const addedCapabilities = prevEnabled && nextEnabled && (nextMask & ~prevMask) !== 0;

      if (!prevEnabled || addedCapabilities) {
        goalReached = false;
        goalSnapshotProjectHrefs = new Set<string>();
        attempts = 0;
        refreshNavBindings();
        schedule(!prevEnabled ? "settings-enable" : "settings-enable-added");
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
