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

function mountProjectsNav(ariaExpanded = "true") {
  const nav = document.createElement("nav");
  nav.setAttribute("aria-label", "Chat history");

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
  opts: { expanded?: boolean; onFolderClick?: () => void } = {}
) {
  const link = document.createElement("a");
  link.href = `https://chatgpt.com/project/${encodeURIComponent(name)}`;

  const folderBtn = document.createElement("button");
  folderBtn.className = "icon";
  folderBtn.dataset.state = opts.expanded ? "open" : "closed";
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
    expect(projectsClicks).toBe(1);
    expect(auditClicks).toBe(0);
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
});
