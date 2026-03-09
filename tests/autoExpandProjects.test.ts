import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DomDelta, RootSnapshot } from "../src/application/domEventBus";
import type { FeatureContext } from "../src/application/featureContext";
import { initAutoExpandProjectsFeature } from "../src/features/autoExpandProjects";
import { makeTestContext } from "./helpers/testContext";

type AutoExpandProjectsTestApi = {
  runOnce: (
    ctx: FeatureContext,
    reason: string
  ) => {
    stats: {
      projectsExpanded: boolean;
      projectRows: number;
      collapsedProjectRows: number;
      folderClicks: number;
    };
    done: boolean;
  };
};

function makeDomBusCtx(
  settings: {
    autoExpandProjects?: boolean;
    autoExpandProjectItems?: boolean;
  } = {}
): FeatureContext & {
  emitRoots: (roots: RootSnapshot) => void;
  emitNavDelta: () => void;
} {
  const ctx = makeTestContext({
    autoExpandProjects: settings.autoExpandProjects ?? true,
    autoExpandProjectItems: settings.autoExpandProjectItems ?? true
  });

  const rootSubs = new Set<(roots: RootSnapshot) => void>();
  const navSubs = new Set<(delta: DomDelta) => void>();

  ctx.domBus = {
    ...ctx.domBus!,
    getNavRoot: () => document.querySelector('nav[aria-label="Chat history"]'),
    onRoots: (cb) => {
      rootSubs.add(cb);
      return () => rootSubs.delete(cb);
    },
    onDelta: (channel, cb) => {
      if (channel === "nav") navSubs.add(cb);
      return () => {
        if (channel === "nav") navSubs.delete(cb);
      };
    }
  };

  return {
    ...ctx,
    emitRoots: (roots: RootSnapshot) => {
      for (const cb of rootSubs) cb(roots);
    },
    emitNavDelta: () => {
      const now = Date.now();
      for (const cb of navSubs) {
        cb({ channel: "nav", added: [], removed: [], reason: "mutation", at: now });
      }
    }
  };
}

function mountProjectsNav(ariaExpanded = "true", navAriaLabel = "Chat history") {
  const nav = document.createElement("nav");
  nav.setAttribute("aria-label", navAriaLabel);

  const section = document.createElement("div");
  section.className = "sidebar-expando-section";

  const header = document.createElement("button");
  header.setAttribute("aria-expanded", ariaExpanded);
  header.textContent = "Projects";
  section.appendChild(header);

  nav.appendChild(section);
  document.body.appendChild(nav);

  return { nav, section, header };
}

function addNewProjectRow(section: HTMLElement) {
  const link = document.createElement("a");
  link.href = "https://chatgpt.com/project/new";

  const iconBtn = document.createElement("button");
  iconBtn.className = "icon";
  const iconSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  iconBtn.appendChild(iconSvg);
  const label = document.createElement("span");
  label.textContent = "New project";

  link.append(iconBtn, label);
  section.appendChild(link);

  return { link, iconBtn };
}

function addProjectRow(
  section: HTMLElement,
  name: string,
  opts: { expanded?: boolean; onFolderClick?: () => void; href?: string } = {}
) {
  const link = document.createElement("a");
  link.href = opts.href ?? `https://chatgpt.com/project/${encodeURIComponent(name)}`;

  const folderBtn = document.createElement("button");
  folderBtn.className = "icon";
  folderBtn.dataset.state = opts.expanded ? "open" : "closed";
  folderBtn.setAttribute(
    "aria-label",
    opts.expanded ? "Collapse project folder" : "Expand project folder"
  );
  const iconSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  folderBtn.appendChild(iconSvg);

  const label = document.createElement("span");
  label.textContent = name;
  link.append(folderBtn, label);
  section.appendChild(link);

  const children = document.createElement("div");
  children.className = "overflow-hidden";
  if (opts.expanded) {
    const chat = document.createElement("a");
    chat.href = `https://chatgpt.com/c/${name}-chat`;
    chat.textContent = `${name} chat`;
    children.appendChild(chat);
  }
  section.appendChild(children);

  folderBtn.addEventListener("click", () => {
    folderBtn.dataset.state = "open";
    if (!children.querySelector('a[href*="/c/"]')) {
      const chat = document.createElement("a");
      chat.href = `https://chatgpt.com/c/${name}-chat`;
      chat.textContent = `${name} chat`;
      children.appendChild(chat);
    }
    opts.onFolderClick?.();
  });

  return { link, folderBtn, children };
}

describe("autoExpandProjects", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = "";
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("does not mark Projects section expanded until aria-expanded becomes true", () => {
    const { section, header } = mountProjectsNav("false");
    let headerClicks = 0;
    header.addEventListener("click", () => {
      headerClicks += 1;
      // Intentionally do not update aria-expanded here.
    });

    addProjectRow(section, "audit", { expanded: false });

    const ctx = makeTestContext({
      autoExpandProjects: true,
      autoExpandProjectItems: false
    });
    const handle = initAutoExpandProjectsFeature(ctx);
    const t = handle.__test as unknown as AutoExpandProjectsTestApi;

    const result = t.runOnce(ctx, "test");

    expect(headerClicks).toBe(1);
    expect(result.stats.projectsExpanded).toBe(false);
    expect(result.done).toBe(false);

    handle.dispose();
  });

  it("finds Projects section with localized nav aria-label and no sidebar-expando class hint", () => {
    const { section, header } = mountProjectsNav("false", "История чатов");
    section.className = "custom-section-without-expando-hint";
    let headerClicks = 0;
    header.addEventListener("click", () => {
      headerClicks += 1;
      header.setAttribute("aria-expanded", "true");
    });

    addProjectRow(section, "audit", { expanded: false });

    const ctx = makeTestContext({
      autoExpandProjects: true,
      autoExpandProjectItems: false
    });
    const handle = initAutoExpandProjectsFeature(ctx);
    const t = handle.__test as unknown as AutoExpandProjectsTestApi;

    const result = t.runOnce(ctx, "test");

    expect(headerClicks).toBe(1);
    expect(result.stats.projectsExpanded).toBe(false);
    expect(result.done).toBe(false);

    handle.dispose();
  });

  it("expands Projects section when only 'autoExpandProjectItems' is enabled", () => {
    const { section, header } = mountProjectsNav("false");
    let headerClicks = 0;
    header.addEventListener("click", () => {
      headerClicks += 1;
      // Simulate ChatGPT updating state on click.
      header.setAttribute("aria-expanded", "true");
    });

    addProjectRow(section, "audit", { expanded: false });

    const ctx = makeTestContext({
      autoExpandProjects: false,
      autoExpandProjectItems: true
    });
    const handle = initAutoExpandProjectsFeature(ctx);
    const t = handle.__test as unknown as AutoExpandProjectsTestApi;

    const result = t.runOnce(ctx, "test");

    expect(headerClicks).toBe(1);
    // The feature intentionally does not mark the section as expanded until a later run.
    expect(result.stats.projectsExpanded).toBe(false);
    expect(result.done).toBe(false);

    handle.dispose();
  });

  it("skips New project row and clicks the matching folder toggle for the actual project row", () => {
    const { section } = mountProjectsNav("true");

    let newProjectClicks = 0;
    const newRow = addNewProjectRow(section);
    newRow.iconBtn.addEventListener("click", () => {
      newProjectClicks += 1;
    });

    let projectsClicks = 0;
    addProjectRow(section, "projects", {
      expanded: false,
      onFolderClick: () => {
        projectsClicks += 1;
      }
    });

    let auditClicks = 0;
    addProjectRow(section, "audit", {
      expanded: false,
      onFolderClick: () => {
        auditClicks += 1;
      }
    });

    const ctx = makeTestContext({
      autoExpandProjects: true,
      autoExpandProjectItems: true
    });
    const handle = initAutoExpandProjectsFeature(ctx);
    const t = handle.__test as unknown as AutoExpandProjectsTestApi;

    const result = t.runOnce(ctx, "test");

    expect(newProjectClicks).toBe(0);
    expect(projectsClicks).toBe(0);
    expect(auditClicks).toBe(1);
    expect(result.stats.folderClicks).toBe(1);
    expect(result.stats.collapsedProjectRows).toBeGreaterThanOrEqual(2);

    handle.dispose();
  });

  it("continues after its own synthetic clicks and is not blocked by user cooldown", async () => {
    const ctx = makeDomBusCtx({ autoExpandProjects: true, autoExpandProjectItems: true });
    const { section, header } = mountProjectsNav("false");

    header.addEventListener("click", () => {
      header.setAttribute("aria-expanded", "true");
      ctx.emitNavDelta();
    });

    addNewProjectRow(section);

    let folderClicks = 0;
    addProjectRow(section, "projects", {
      expanded: false,
      onFolderClick: () => {
        folderClicks += 1;
        ctx.emitNavDelta();
      }
    });

    const handle = initAutoExpandProjectsFeature(ctx);

    ctx.emitNavDelta();
    await vi.advanceTimersByTimeAsync(4000);

    expect(folderClicks).toBeGreaterThanOrEqual(1);

    handle.dispose();
  });

  it("rearms after goal reached when a new project row appears (virtualized/lazy load)", async () => {
    const ctx = makeDomBusCtx({ autoExpandProjects: true, autoExpandProjectItems: true });
    const { section } = mountProjectsNav("true");

    addNewProjectRow(section);

    let auditClicks = 0;
    const auditRow = addProjectRow(section, "audit", {
      expanded: false,
      onFolderClick: () => {
        auditClicks += 1;
        ctx.emitNavDelta();
      }
    });

    const handle = initAutoExpandProjectsFeature(ctx);

    // First run: expand the only collapsed project.
    ctx.emitNavDelta();
    await vi.advanceTimersByTimeAsync(400);
    expect(auditClicks).toBe(1);

    // Second run: observe the expanded DOM and reach goal.
    await vi.advanceTimersByTimeAsync(2000);
    ctx.emitNavDelta();
    await vi.advanceTimersByTimeAsync(400);
    expect(auditClicks).toBe(1);

    // Simulate virtualization: the rendered bottom-most project changes.
    auditRow.link.remove();
    auditRow.children.remove();

    let vpnClicks = 0;
    addProjectRow(section, "vpn", {
      expanded: false,
      onFolderClick: () => {
        vpnClicks += 1;
        ctx.emitNavDelta();
      }
    });

    ctx.emitNavDelta();
    await vi.advanceTimersByTimeAsync(2000);
    await vi.advanceTimersByTimeAsync(400);

    expect(vpnClicks).toBe(1);

    handle.dispose();
  });

  it("one-shot: does not re-expand after goal reached on roots/visibility rebind", async () => {
    const ctx = makeDomBusCtx({ autoExpandProjects: true, autoExpandProjectItems: true });
    const { section } = mountProjectsNav("true");

    let auditClicks = 0;
    const auditRow = addProjectRow(section, "audit", {
      expanded: false,
      onFolderClick: () => {
        auditClicks += 1;
      }
    });

    const handle = initAutoExpandProjectsFeature(ctx);

    // Let the feature click once and settle.
    await vi.advanceTimersByTimeAsync(7000);

    expect(auditClicks).toBe(1);
    expect(auditRow.folderBtn.dataset.state).toBe("open");

    // User collapses manually.
    auditRow.folderBtn.dataset.state = "closed";

    // Simulate tab switch / visibility rebind causing domBus roots + nav deltas.
    ctx.emitRoots({
      main: null,
      nav: document.querySelector('nav[aria-label="Chat history"]'),
      reason: "rebind"
    });
    ctx.emitNavDelta();

    await vi.advanceTimersByTimeAsync(7000);

    // One-shot behavior: no further auto clicks.
    expect(auditClicks).toBe(1);
    expect(auditRow.folderBtn.dataset.state).toBe("closed");

    handle.dispose();
  });

  it("treats mounted project chats with data-state=closed as collapsed", () => {
    const { section } = mountProjectsNav("true");

    const row = addProjectRow(section, "audit", { expanded: false });
    // Simulate current ChatGPT behavior: chats remain mounted in DOM even when folder is collapsed.
    if (!row.children.querySelector('a[href*="/c/"]')) {
      const chat = document.createElement("a");
      chat.href = "https://chatgpt.com/c/audit-chat";
      chat.textContent = "audit chat";
      row.children.appendChild(chat);
    }
    row.folderBtn.dataset.state = "closed";
    row.children.style.height = "0px";
    row.children.style.opacity = "0";
    row.children.style.maxHeight = "0px";

    const ctx = makeTestContext({
      autoExpandProjects: true,
      autoExpandProjectItems: true
    });
    const handle = initAutoExpandProjectsFeature(ctx);
    const t = handle.__test as unknown as AutoExpandProjectsTestApi;

    const result = t.runOnce(ctx, "test");

    expect(result.stats.projectRows).toBeGreaterThanOrEqual(1);
    expect(result.stats.collapsedProjectRows).toBeGreaterThanOrEqual(1);
    expect(result.stats.folderClicks).toBe(1);
    expect(result.done).toBe(false);

    handle.dispose();
  });

  it("treats data-state=open as already expanded", () => {
    const { section } = mountProjectsNav("true");
    addProjectRow(section, "audit", { expanded: true });

    const ctx = makeTestContext({
      autoExpandProjects: true,
      autoExpandProjectItems: true
    });
    const handle = initAutoExpandProjectsFeature(ctx);
    const t = handle.__test as unknown as AutoExpandProjectsTestApi;

    const result = t.runOnce(ctx, "test");

    expect(result.stats.projectRows).toBeGreaterThanOrEqual(1);
    expect(result.stats.collapsedProjectRows).toBe(0);
    expect(result.stats.folderClicks).toBe(0);
    expect(result.done).toBe(true);

    handle.dispose();
  });

  it("falls back to hidden/collapsed signals when folder data-state is absent", () => {
    const { section } = mountProjectsNav("true");

    const row = addProjectRow(section, "audit-fallback", { expanded: false });
    // Simulate a DOM variant where the folder button does not expose data-state.
    row.folderBtn.removeAttribute("data-state");

    // Ensure chats are mounted in DOM (presence alone must NOT imply expanded).
    if (!row.children.querySelector('a[href*="/c/"]')) {
      const chat = document.createElement("a");
      chat.href = "https://chatgpt.com/c/audit-fallback-chat";
      chat.textContent = "audit-fallback chat";
      row.children.appendChild(chat);
    }

    row.children.setAttribute("aria-hidden", "true");
    row.children.style.height = "0px";
    row.children.style.maxHeight = "0px";
    row.children.style.opacity = "0";

    const ctx = makeTestContext({
      autoExpandProjects: true,
      autoExpandProjectItems: true
    });
    const handle = initAutoExpandProjectsFeature(ctx);
    const t = handle.__test as unknown as AutoExpandProjectsTestApi;

    const result = t.runOnce(ctx, "test");

    expect(result.stats.projectRows).toBeGreaterThanOrEqual(1);
    expect(result.stats.collapsedProjectRows).toBeGreaterThanOrEqual(1);
    expect(result.stats.folderClicks).toBe(1);
    expect(result.done).toBe(false);

    handle.dispose();
  });

  it("clicks collapsed project folders from bottom to top", () => {
    const { section } = mountProjectsNav("true");

    const clickOrder: string[] = [];
    addNewProjectRow(section); // ensure non-expandable row is still ignored
    addProjectRow(section, "top-project", {
      expanded: false,
      onFolderClick: () => {
        clickOrder.push("top-project");
      }
    });
    addProjectRow(section, "bottom-project", {
      expanded: false,
      onFolderClick: () => {
        clickOrder.push("bottom-project");
      }
    });

    const ctx = makeTestContext({
      autoExpandProjects: true,
      autoExpandProjectItems: true
    });
    const handle = initAutoExpandProjectsFeature(ctx);
    const t = handle.__test as unknown as AutoExpandProjectsTestApi;

    const result = t.runOnce(ctx, "test");

    // Implementation intentionally clicks at most one folder per run.
    // This assertion verifies the first attempted click is the bottom-most collapsed project.
    expect(result.stats.folderClicks).toBe(1);
    expect(clickOrder).toEqual(["bottom-project"]);

    handle.dispose();
  });

  it("supports project links with /g/g-p- URL format", () => {
    const { section } = mountProjectsNav("true");

    let clicks = 0;
    addProjectRow(section, "rag", {
      expanded: false,
      href: "https://chatgpt.com/g/g-p-6999e22c830881919cdc183a",
      onFolderClick: () => {
        clicks += 1;
      }
    });

    const ctx = makeTestContext({
      autoExpandProjects: true,
      autoExpandProjectItems: true
    });
    const handle = initAutoExpandProjectsFeature(ctx);
    const t = handle.__test as unknown as AutoExpandProjectsTestApi;

    const result = t.runOnce(ctx, "test");

    expect(result.stats.projectRows).toBe(1);
    expect(result.stats.collapsedProjectRows).toBe(1);
    expect(result.stats.folderClicks).toBe(1);
    expect(clicks).toBe(1);

    handle.dispose();
  });
});
