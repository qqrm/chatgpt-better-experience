import { FeatureContext, FeatureHandle } from "../application/featureContext";
import { isElementVisible, norm } from "../lib/utils";

const AUTO_EXPAND_START_TIMEOUT_MS = 3500;
const AUTO_EXPAND_NAV_TIMEOUT_MS = 1500;
const AUTO_EXPAND_RETRY_DEBOUNCE_MS = 250;

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
  return ctx.helpers.safeQuery<HTMLElement>('nav[aria-label="Chat history"]');
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

  // Единственный надёжный индикатор: в блоке есть ссылки на чаты /c/
  return sib.querySelector('a[href*="/c/"]') !== null;
}

function findFolderToggleButton(rowScope: HTMLElement): HTMLButtonElement | null {
  const buttons = Array.from(rowScope.querySelectorAll<HTMLButtonElement>("button"));

  // 1) "Show/Hide chats" по aria-label/title (если вдруг появится)
  for (const b of buttons) {
    const aria = norm(b.getAttribute("aria-label"));
    const title = norm(b.getAttribute("title"));
    const hint = `${aria} ${title}`;
    if ((hint.includes("show") || hint.includes("hide")) && hint.includes("chat")) {
      return b;
    }
  }

  // 2) типовой кейс из твоего HTML: <button class="icon" data-state="...">
  const byIcon = rowScope.querySelector<HTMLButtonElement>("button.icon");
  if (byIcon) return byIcon;

  // 3) фолбэк: любая кнопка с svg внутри
  for (const b of buttons) {
    if (b.querySelector("svg")) return b;
  }

  return null;
}

function pickTargetProject(section: HTMLElement): HTMLAnchorElement | null {
  const projects = Array.from(section.querySelectorAll<HTMLAnchorElement>('a[href*="/project"]'));
  if (projects.length === 0) return null;

  // Приоритет: VPN (по href и/или по тексту)
  for (const a of projects) {
    const href = a.getAttribute("href") ?? "";
    if (href.includes("/vpn/project") || href.includes("-vpn/")) return a;
  }

  for (const a of projects) {
    const label = norm(a.textContent);
    if (label === "vpn" || label.includes(" vpn ")) return a;
  }

  // иначе — первый проект в списке
  return projects[0];
}

function expandTargetProject(ctx: FeatureContext, section: HTMLElement): number {
  const target = pickTargetProject(section);
  if (!target) return 0;

  const href = target.getAttribute("href") ?? "";

  // Если уже раскрыт — НИЧЕГО НЕ ДЕЛАЕМ (это критично, иначе будут лишние клики и churn)
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

function runOnce(ctx: FeatureContext, reason: string): ExpandStats {
  const nav = getChatHistoryNav(ctx);
  if (!nav) {
    ctx.logger.debug("autoExpandProjects", `no sidebar nav yet (${reason})`);
    return { projectsExpanded: false, projectRows: 0, folderClicks: 0 };
  }

  const section = findProjectsSection(nav);
  if (!section) {
    ctx.logger.debug("autoExpandProjects", `no Projects section yet (${reason})`);
    return { projectsExpanded: false, projectRows: 0, folderClicks: 0 };
  }

  const wantProjects = ctx.settings.autoExpandProjects;
  const wantItems = ctx.settings.autoExpandProjectItems;

  if (!wantProjects && !wantItems) {
    return { projectsExpanded: false, projectRows: 0, folderClicks: 0 };
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

  ctx.logger.debug(
    "autoExpandProjects",
    `${reason} expanded=${expanded} rows=${rows} folderClicks=${folderClicks}`
  );

  return { projectsExpanded: expanded, projectRows: rows, folderClicks };
}

export function initAutoExpandProjectsFeature(ctx: FeatureContext): FeatureHandle {
  let stopped = false;
  let debounceTimer: number | null = null;
  let intervalId: number | null = null;
  let observer: MutationObserver | null = null;

  const schedule = (reason: string): void => {
    if (stopped) return;

    if (debounceTimer !== null) window.clearTimeout(debounceTimer);

    debounceTimer = window.setTimeout(() => {
      debounceTimer = null;
      runOnce(ctx, reason);
    }, AUTO_EXPAND_RETRY_DEBOUNCE_MS);
  };

  window.setTimeout(() => schedule("start"), AUTO_EXPAND_START_TIMEOUT_MS);
  window.setTimeout(() => schedule("nav-ready"), AUTO_EXPAND_NAV_TIMEOUT_MS);

  intervalId = window.setInterval(() => {
    schedule("interval");
  }, 2000);

  const nav = getChatHistoryNav(ctx);
  if (nav) {
    observer = new MutationObserver(() => schedule("mutation"));
    observer.observe(nav, { subtree: true, childList: true, attributes: true });
  } else {
    window.setTimeout(() => schedule("late-nav"), 1000);
  }

  return {
    name: "autoExpandProjects",
    dispose: () => {
      stopped = true;
      if (debounceTimer !== null) window.clearTimeout(debounceTimer);
      if (intervalId !== null) window.clearInterval(intervalId);
      observer?.disconnect();
      observer = null;
    },
    __test: {
      getChatHistoryNav,
      findProjectsSection,
      isSectionCollapsed,
      runOnce
    }
  };
}
