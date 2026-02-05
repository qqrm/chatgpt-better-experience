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
  // максимально “похоже на человека”, чтобы React/Radix обработали как надо
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
  // В UI классы содержат "sidebar-expando-section" (иногда с "/")
  const sections = Array.from(
    nav.querySelectorAll<HTMLElement>('[class*="sidebar-expando-section"]')
  );

  // Самый устойчивый признак — наличие ссылок на /project
  for (const sec of sections) {
    const hasProjectLinks = sec.querySelector('a[href*="/project"]') !== null;
    if (hasProjectLinks) return sec;
  }

  // Фолбэк по тексту (на случай если структура поменяется)
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

  // фолбэк по aria-expanded у кнопки заголовка
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

function findFolderToggleButton(rowScope: HTMLElement): HTMLButtonElement | null {
  const buttons = Array.from(rowScope.querySelectorAll<HTMLButtonElement>("button"));

  // 1) сначала ищем явные "Show/Hide Chat" по aria-label/title
  for (const b of buttons) {
    const aria = norm(b.getAttribute("aria-label"));
    const title = norm(b.getAttribute("title"));
    const hint = `${aria} ${title}`;
    if ((hint.includes("show") || hint.includes("hide")) && hint.includes("chat")) {
      return b;
    }
  }

  // 2) затем ищем кнопку-иконку с data-state (в логах у вас это <button.icon data-state=closed>)
  const byIcon = rowScope.querySelector<HTMLButtonElement>("button.icon[data-state]");
  if (byIcon) return byIcon;

  // 3) фолбэк: любая button с data-state и svg внутри (обычно это и есть иконка папки)
  for (const b of buttons) {
    const ds = b.getAttribute("data-state");
    const hasSvg = b.querySelector("svg") !== null;
    if (ds && hasSvg) return b;
  }

  return null;
}

function shouldOpenFolder(btn: HTMLButtonElement): boolean {
  const ds = norm(btn.getAttribute("data-state"));
  const aria = norm(btn.getAttribute("aria-label"));
  const title = norm(btn.getAttribute("title"));

  // закрыто — открываем
  if (ds === "closed") return true;

  // даже если нет data-state, но текст говорит “show chat” — открываем
  const hint = `${aria} ${title}`;
  if (hint.includes("show") && hint.includes("chat")) return true;

  return false;
}

function expandProjectItems(ctx: FeatureContext, section: HTMLElement): number {
  const links = Array.from(section.querySelectorAll<HTMLAnchorElement>('a[href*="/project"]'));

  let clicks = 0;

  for (const a of links) {
    // строка проекта может быть вокруг ссылки, либо рядом
    const row =
      a.closest<HTMLElement>("li") ?? a.closest<HTMLElement>("div") ?? a.parentElement ?? a;

    // пробуем в пределах строки и чуть шире (родитель строки), потому что кнопка может be sibling
    const scopeCandidates: HTMLElement[] = [row];
    if (row.parentElement) scopeCandidates.push(row.parentElement);

    let btn: HTMLButtonElement | null = null;
    for (const sc of scopeCandidates) {
      btn = findFolderToggleButton(sc);
      if (btn) break;
    }

    if (!btn) continue;
    if (!isElementVisible(btn)) continue;

    if (shouldOpenFolder(btn)) {
      const href = a.getAttribute("href") ?? "";
      ctx.logger.debug("autoExpandProjects", `click folder icon for ${href}`);
      dispatchHumanClick(btn);
      clicks += 1;
    }
  }

  return clicks;
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
    folderClicks = expandProjectItems(ctx, section);
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

  // первичный прогон — с задержками под SPA
  window.setTimeout(() => schedule("start"), AUTO_EXPAND_START_TIMEOUT_MS);
  window.setTimeout(() => schedule("nav-ready"), AUTO_EXPAND_NAV_TIMEOUT_MS);

  // подстраховка: периодически дожимать (settings могут включиться позже)
  intervalId = window.setInterval(() => {
    schedule("interval");
  }, 2000);

  // наблюдаем за изменениями DOM сайдбара (из-за SPA/рендеров)
  const nav = getChatHistoryNav(ctx);
  if (nav) {
    observer = new MutationObserver(() => schedule("mutation"));
    observer.observe(nav, { subtree: true, childList: true, attributes: true });
  } else {
    // если nav ещё нет — попробуем поставить observer позже
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
