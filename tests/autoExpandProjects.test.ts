import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DomDelta, RootSnapshot } from "../src/application/domEventBus";
import type { FeatureContext } from "../src/application/featureContext";
import {
  AUTO_EXPAND_PROJECTS_PREFS_KEY,
  AUTO_EXPAND_PROJECTS_REGISTRY_KEY,
  type AutoExpandProjectsPrefs,
  type AutoExpandProjectsRegistry
} from "../src/domain/settings";
import type { StoragePort, StorageChangeHandler } from "../src/domain/ports/storagePort";
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
      expandedProjectRows: number;
      mismatchedProjectRows: number;
      folderClicks: number;
    };
    done: boolean;
  };
  loadLocalState: () => Promise<void>;
  getLocalState: () => {
    registry: AutoExpandProjectsRegistry;
    prefs: AutoExpandProjectsPrefs;
  };
  captureRemovedProjectCandidates: (removed: Element[]) => string[];
};

type MemoryStorage = StoragePort & {
  syncData: Record<string, unknown>;
  localData: Record<string, unknown>;
};

function makeRegistryEntry(href: string, title: string, lastSeenAt: number, lastSeenOrder: number) {
  return { href, title, lastSeenAt, lastSeenOrder };
}

function makeMemoryStorage(localData: Record<string, unknown> = {}): MemoryStorage {
  const syncData: Record<string, unknown> = {};
  const storedLocal = { ...localData };
  const changeHandlers = new Set<StorageChangeHandler>();

  const emit = (
    changes: Record<string, { oldValue?: unknown; newValue?: unknown }>,
    area: string
  ) => {
    for (const handler of changeHandlers) handler(changes, area);
  };

  return {
    syncData,
    localData: storedLocal,
    get: async <T extends Record<string, unknown>>(defaults: T) => ({
      ...defaults,
      ...(syncData as Partial<T>)
    }),
    set: async (values) => {
      const changes = Object.fromEntries(
        Object.entries(values).map(([key, value]) => [
          key,
          { oldValue: syncData[key], newValue: value }
        ])
      );
      Object.assign(syncData, values);
      emit(changes, "sync");
    },
    getLocal: async <T extends Record<string, unknown>>(defaults: T) => ({
      ...defaults,
      ...(storedLocal as Partial<T>)
    }),
    setLocal: async (values) => {
      const changes = Object.fromEntries(
        Object.entries(values).map(([key, value]) => [
          key,
          { oldValue: storedLocal[key], newValue: value }
        ])
      );
      Object.assign(storedLocal, values);
      emit(changes, "local");
    },
    onChanged: (handler) => {
      changeHandlers.add(handler);
    }
  };
}

function makeSelectiveLocalState(
  entries: Array<{ href: string; title: string; lastSeenAt?: number; lastSeenOrder?: number }>,
  expandedByHref: Record<string, boolean> = {}
) {
  return {
    [AUTO_EXPAND_PROJECTS_REGISTRY_KEY]: {
      version: 1,
      entriesByHref: Object.fromEntries(
        entries.map((entry, index) => [
          entry.href,
          makeRegistryEntry(
            entry.href,
            entry.title,
            entry.lastSeenAt ?? 100,
            entry.lastSeenOrder ?? index
          )
        ])
      )
    },
    [AUTO_EXPAND_PROJECTS_PREFS_KEY]: {
      version: 1,
      expandedByHref: { ...expandedByHref }
    }
  };
}

function makeDomBusCtx(
  settings: {
    autoExpandProjects?: boolean;
    autoExpandProjectItems?: boolean;
  } = {},
  localData: Record<string, unknown> = {}
): FeatureContext & {
  emitRoots: (roots: RootSnapshot) => void;
  emitNavDelta: (delta?: Partial<DomDelta>) => void;
  storagePort: MemoryStorage;
} {
  const storagePort = makeMemoryStorage(localData);
  const ctx = makeTestContext({
    autoExpandProjects: settings.autoExpandProjects ?? true,
    autoExpandProjectItems: settings.autoExpandProjectItems ?? false
  });
  ctx.storagePort = storagePort;

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
    storagePort,
    emitRoots: (roots: RootSnapshot) => {
      for (const cb of rootSubs) cb(roots);
    },
    emitNavDelta: (delta: Partial<DomDelta> = {}) => {
      const now = Date.now();
      for (const cb of navSubs) {
        cb({
          channel: "nav",
          added: delta.added ?? [],
          removed: delta.removed ?? [],
          reason: delta.reason ?? "mutation",
          at: now
        });
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
  const row = document.createElement("div");
  const link = document.createElement("a");
  link.href = "https://chatgpt.com/project/new";

  const iconBtn = document.createElement("button");
  iconBtn.className = "icon";
  const iconSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  iconBtn.appendChild(iconSvg);
  const label = document.createElement("span");
  label.textContent = "New project";

  link.append(iconBtn, label);
  row.appendChild(link);
  section.appendChild(row);

  return { row, link, iconBtn };
}

function addProjectRow(
  section: HTMLElement,
  name: string,
  opts: {
    expanded?: boolean;
    onFolderClick?: (expanded: boolean) => void;
    href?: string;
    keepMountedWhenCollapsed?: boolean;
  } = {}
) {
  const row = document.createElement("div");
  const link = document.createElement("a");
  link.href = opts.href ?? `https://chatgpt.com/project/${encodeURIComponent(name)}`;

  const folderBtn = document.createElement("button");
  folderBtn.className = "icon";
  const iconSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  folderBtn.appendChild(iconSvg);

  const label = document.createElement("span");
  label.textContent = name;
  link.append(folderBtn, label);
  row.appendChild(link);

  const children = document.createElement("div");
  children.className = "overflow-hidden";
  row.appendChild(children);
  section.appendChild(row);

  const applyExpandedState = (expanded: boolean) => {
    folderBtn.dataset.state = expanded ? "open" : "closed";
    folderBtn.setAttribute(
      "aria-label",
      expanded ? "Collapse project folder" : "Expand project folder"
    );

    if (expanded) {
      children.removeAttribute("aria-hidden");
      children.style.height = "";
      children.style.maxHeight = "";
      children.style.opacity = "";
      if (!children.querySelector('a[href*="/c/"]')) {
        const chat = document.createElement("a");
        chat.href = `https://chatgpt.com/c/${name}-chat`;
        chat.textContent = `${name} chat`;
        children.appendChild(chat);
      }
      return;
    }

    children.setAttribute("aria-hidden", "true");
    children.style.height = "0px";
    children.style.maxHeight = "0px";
    children.style.opacity = "0";
    if (!opts.keepMountedWhenCollapsed) {
      children.replaceChildren();
    }
  };

  applyExpandedState(!!opts.expanded);

  folderBtn.addEventListener("click", () => {
    const nextExpanded = folderBtn.dataset.state !== "open";
    applyExpandedState(nextExpanded);
    opts.onFolderClick?.(nextExpanded);
  });

  return { row, link, folderBtn, children, applyExpandedState };
}

async function prepareSelectiveFeature(ctx: FeatureContext, localData: Record<string, unknown>) {
  ctx.storagePort = makeMemoryStorage(localData);
  const handle = initAutoExpandProjectsFeature(ctx);
  const t = handle.__test as unknown as AutoExpandProjectsTestApi;
  await t.loadLocalState();
  return { handle, t };
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
    expect(result.stats.projectsExpanded).toBe(false);
    expect(result.done).toBe(false);

    handle.dispose();
  });

  it("skips New project and expands only selected project rows", async () => {
    const { section } = mountProjectsNav("true");
    let newProjectClicks = 0;
    const newRow = addNewProjectRow(section);
    newRow.iconBtn.addEventListener("click", () => {
      newProjectClicks += 1;
    });

    let topProjectClicks = 0;
    addProjectRow(section, "projects", {
      expanded: false,
      onFolderClick: () => {
        topProjectClicks += 1;
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
    const { handle, t } = await prepareSelectiveFeature(
      ctx,
      makeSelectiveLocalState(
        [
          { href: "/project/projects", title: "projects" },
          { href: "/project/audit", title: "audit" }
        ],
        {
          "/project/projects": false,
          "/project/audit": true
        }
      )
    );

    const result = t.runOnce(ctx, "test");

    expect(newProjectClicks).toBe(0);
    expect(topProjectClicks).toBe(0);
    expect(auditClicks).toBe(1);
    expect(result.stats.projectRows).toBe(2);
    expect(result.stats.collapsedProjectRows).toBe(1);
    expect(result.stats.folderClicks).toBe(1);

    handle.dispose();
  });

  it("collapses unselected expanded projects and reaches goal on the next run", async () => {
    const { section } = mountProjectsNav("true");
    const auditRow = addProjectRow(section, "audit", { expanded: true });

    const ctx = makeTestContext({
      autoExpandProjects: true,
      autoExpandProjectItems: true
    });
    const { handle, t } = await prepareSelectiveFeature(
      ctx,
      makeSelectiveLocalState([{ href: "/project/audit", title: "audit" }], {
        "/project/audit": false
      })
    );

    const first = t.runOnce(ctx, "collapse");
    const second = t.runOnce(ctx, "collapse-follow-up");

    expect(first.stats.expandedProjectRows).toBe(1);
    expect(first.stats.folderClicks).toBe(1);
    expect(first.done).toBe(false);
    expect(auditRow.folderBtn.dataset.state).toBe("closed");
    expect(second.stats.mismatchedProjectRows).toBe(0);
    expect(second.done).toBe(true);

    handle.dispose();
  });

  it("leaves matching expanded and collapsed project states untouched", async () => {
    const { section } = mountProjectsNav("true");
    addProjectRow(section, "orion", { expanded: true });
    addProjectRow(section, "lynx", { expanded: false });

    const ctx = makeTestContext({
      autoExpandProjects: true,
      autoExpandProjectItems: true
    });
    const { handle, t } = await prepareSelectiveFeature(
      ctx,
      makeSelectiveLocalState(
        [
          { href: "/project/orion", title: "orion" },
          { href: "/project/lynx", title: "lynx" }
        ],
        {
          "/project/orion": true,
          "/project/lynx": false
        }
      )
    );

    const result = t.runOnce(ctx, "match");

    expect(result.stats.mismatchedProjectRows).toBe(0);
    expect(result.stats.folderClicks).toBe(0);
    expect(result.done).toBe(true);

    handle.dispose();
  });

  it("keeps one-click-per-cycle discipline and prioritizes the bottom-most mismatched row", async () => {
    const { section } = mountProjectsNav("true");
    const clickOrder: string[] = [];

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
    const { handle, t } = await prepareSelectiveFeature(
      ctx,
      makeSelectiveLocalState(
        [
          { href: "/project/top-project", title: "top-project" },
          { href: "/project/bottom-project", title: "bottom-project" }
        ],
        {
          "/project/top-project": true,
          "/project/bottom-project": true
        }
      )
    );

    const result = t.runOnce(ctx, "bottom-first");

    expect(result.stats.folderClicks).toBe(1);
    expect(result.stats.collapsedProjectRows).toBe(2);
    expect(clickOrder).toEqual(["bottom-project"]);

    handle.dispose();
  });

  it("treats mounted project chats with data-state=closed as collapsed when desired state is expanded", async () => {
    const { section } = mountProjectsNav("true");
    const row = addProjectRow(section, "audit", {
      expanded: false,
      keepMountedWhenCollapsed: true
    });
    row.applyExpandedState(false);
    if (!row.children.querySelector('a[href*="/c/"]')) {
      const chat = document.createElement("a");
      chat.href = "https://chatgpt.com/c/audit-chat";
      chat.textContent = "audit chat";
      row.children.appendChild(chat);
    }

    const ctx = makeTestContext({
      autoExpandProjects: true,
      autoExpandProjectItems: true
    });
    const { handle, t } = await prepareSelectiveFeature(
      ctx,
      makeSelectiveLocalState([{ href: "/project/audit", title: "audit" }], {
        "/project/audit": true
      })
    );

    const result = t.runOnce(ctx, "mounted-collapsed");

    expect(result.stats.collapsedProjectRows).toBe(1);
    expect(result.stats.folderClicks).toBe(1);
    expect(result.done).toBe(false);

    handle.dispose();
  });

  it("falls back to hidden container signals when folder data-state is absent", async () => {
    const { section } = mountProjectsNav("true");
    const row = addProjectRow(section, "fallback", {
      expanded: false,
      keepMountedWhenCollapsed: true
    });
    row.folderBtn.removeAttribute("data-state");
    row.children.setAttribute("aria-hidden", "true");
    row.children.style.height = "0px";
    row.children.style.maxHeight = "0px";
    row.children.style.opacity = "0";
    if (!row.children.querySelector('a[href*="/c/"]')) {
      const chat = document.createElement("a");
      chat.href = "https://chatgpt.com/c/fallback-chat";
      chat.textContent = "fallback chat";
      row.children.appendChild(chat);
    }

    const ctx = makeTestContext({
      autoExpandProjects: true,
      autoExpandProjectItems: true
    });
    const { handle, t } = await prepareSelectiveFeature(
      ctx,
      makeSelectiveLocalState([{ href: "/project/fallback", title: "fallback" }], {
        "/project/fallback": true
      })
    );

    const result = t.runOnce(ctx, "fallback-collapse");

    expect(result.stats.collapsedProjectRows).toBe(1);
    expect(result.stats.folderClicks).toBe(1);
    expect(result.done).toBe(false);

    handle.dispose();
  });

  it("supports project links with /g/g-p- URL format", async () => {
    const { section } = mountProjectsNav("true");
    let clicks = 0;
    addProjectRow(section, "rag", {
      expanded: false,
      href: "https://chatgpt.com/g/g-p-6999e22c830881919cdc183a/project",
      onFolderClick: () => {
        clicks += 1;
      }
    });

    const href = "/g/g-p-6999e22c830881919cdc183a/project";
    const ctx = makeTestContext({
      autoExpandProjects: true,
      autoExpandProjectItems: true
    });
    const { handle, t } = await prepareSelectiveFeature(
      ctx,
      makeSelectiveLocalState([{ href, title: "rag" }], {
        [href]: true
      })
    );

    const result = t.runOnce(ctx, "g-p-expand");

    expect(result.stats.projectRows).toBe(1);
    expect(result.stats.collapsedProjectRows).toBe(1);
    expect(result.stats.folderClicks).toBe(1);
    expect(clicks).toBe(1);

    handle.dispose();
  });

  it("treats detached g-p chats as expanded and only clicks other mismatched rows", async () => {
    const { section } = mountProjectsNav("true");
    let vpnClicks = 0;
    addProjectRow(section, "vpn", {
      expanded: false,
      href: "https://chatgpt.com/g/g-p-697b0fab9a608191811e75e5de0b52ad-vpn/project",
      onFolderClick: () => {
        vpnClicks += 1;
      }
    });

    let ragClicks = 0;
    addProjectRow(section, "rag", {
      expanded: false,
      href: "https://chatgpt.com/g/g-p-6984450a14788191ad819fb327c7e500-rag/project",
      onFolderClick: () => {
        ragClicks += 1;
      }
    });

    const detachedVpnChats = document.createElement("div");
    detachedVpnChats.className = "overflow-hidden";
    const vpnChat = document.createElement("a");
    vpnChat.href =
      "https://chatgpt.com/g/g-p-697b0fab9a608191811e75e5de0b52ad/c/69a95070-a2e8-8393-8f05-14a92caf47f5";
    vpnChat.textContent = "VPS for VPN";
    detachedVpnChats.appendChild(vpnChat);
    section.appendChild(detachedVpnChats);

    const vpnHref = "/g/g-p-697b0fab9a608191811e75e5de0b52ad-vpn/project";
    const ragHref = "/g/g-p-6984450a14788191ad819fb327c7e500-rag/project";
    const ctx = makeTestContext({
      autoExpandProjects: true,
      autoExpandProjectItems: true
    });
    const { handle, t } = await prepareSelectiveFeature(
      ctx,
      makeSelectiveLocalState(
        [
          { href: vpnHref, title: "vpn" },
          { href: ragHref, title: "rag" }
        ],
        {
          [vpnHref]: true,
          [ragHref]: true
        }
      )
    );

    const result = t.runOnce(ctx, "detached-g-p");

    expect(vpnClicks).toBe(0);
    expect(ragClicks).toBe(1);
    expect(result.stats.folderClicks).toBe(1);

    handle.dispose();
  });

  it("re-enforces stored expanded state after a later route/root rebind", async () => {
    const localState = makeSelectiveLocalState([{ href: "/project/audit", title: "audit" }], {
      "/project/audit": true
    });
    const ctx = makeDomBusCtx(
      { autoExpandProjects: true, autoExpandProjectItems: true },
      localState
    );
    const { section } = mountProjectsNav("true");

    let auditClicks = 0;
    const auditRow = addProjectRow(section, "audit", {
      expanded: false,
      onFolderClick: () => {
        auditClicks += 1;
        ctx.emitNavDelta();
      }
    });

    const handle = initAutoExpandProjectsFeature(ctx);

    ctx.emitNavDelta();
    await vi.advanceTimersByTimeAsync(2000);
    expect(auditClicks).toBe(1);
    expect(auditRow.folderBtn.dataset.state).toBe("open");

    auditRow.applyExpandedState(false);
    ctx.emitRoots({
      main: null,
      nav: document.querySelector('nav[aria-label="Chat history"]'),
      reason: "rebind"
    });
    ctx.emitNavDelta();
    await vi.advanceTimersByTimeAsync(2000);

    expect(auditClicks).toBe(2);
    expect(auditRow.folderBtn.dataset.state).toBe("open");

    handle.dispose();
  });

  it("adds newly discovered projects to the registry with default false prefs", async () => {
    const { section } = mountProjectsNav("true");
    addProjectRow(section, "orion", { expanded: false });

    const ctx = makeTestContext({
      autoExpandProjects: false,
      autoExpandProjectItems: false
    });
    const { handle, t } = await prepareSelectiveFeature(ctx, {});

    const result = t.runOnce(ctx, "registry-add");
    const state = t.getLocalState();

    expect(result.done).toBe(true);
    expect(state.registry.entriesByHref["/project/orion"]?.title).toBe("orion");
    expect(state.prefs.expandedByHref["/project/orion"]).toBe(false);

    handle.dispose();
  });

  it("updates registry titles when the same project href changes label", async () => {
    const { section } = mountProjectsNav("true");
    addProjectRow(section, "New Orion", {
      expanded: false,
      href: "https://chatgpt.com/project/orion"
    });

    const ctx = makeTestContext({
      autoExpandProjects: false,
      autoExpandProjectItems: false
    });
    const { handle, t } = await prepareSelectiveFeature(
      ctx,
      makeSelectiveLocalState([{ href: "/project/orion", title: "Old Orion", lastSeenAt: 50 }])
    );

    t.runOnce(ctx, "registry-title-update");
    const state = t.getLocalState();

    expect(state.registry.entriesByHref["/project/orion"]?.title).toBe("New Orion");

    handle.dispose();
  });

  it("does not delete missing registry entries on plain absence alone", async () => {
    const { section } = mountProjectsNav("true");
    addProjectRow(section, "orion", {
      expanded: false,
      href: "https://chatgpt.com/project/orion"
    });

    const ctx = makeTestContext({
      autoExpandProjects: false,
      autoExpandProjectItems: false
    });
    const { handle, t } = await prepareSelectiveFeature(
      ctx,
      makeSelectiveLocalState(
        [
          { href: "/project/orion", title: "orion", lastSeenAt: 100, lastSeenOrder: 0 },
          { href: "/project/lynx", title: "lynx", lastSeenAt: 90, lastSeenOrder: 1 }
        ],
        {
          "/project/lynx": true
        }
      )
    );

    t.runOnce(ctx, "registry-absence");
    const state = t.getLocalState();

    expect(state.registry.entriesByHref["/project/lynx"]?.title).toBe("lynx");
    expect(state.prefs.expandedByHref["/project/lynx"]).toBe(true);

    handle.dispose();
  });

  it("removes registry and prefs only after a confident removed-subtree signal", async () => {
    const { section } = mountProjectsNav("true");
    addProjectRow(section, "orion", {
      expanded: false,
      href: "https://chatgpt.com/project/orion"
    });
    const lynxRow = addProjectRow(section, "lynx", {
      expanded: false,
      href: "https://chatgpt.com/project/lynx"
    });

    const ctx = makeTestContext({
      autoExpandProjects: false,
      autoExpandProjectItems: false
    });
    const { handle, t } = await prepareSelectiveFeature(
      ctx,
      makeSelectiveLocalState(
        [
          { href: "/project/orion", title: "orion", lastSeenAt: 100, lastSeenOrder: 0 },
          { href: "/project/lynx", title: "lynx", lastSeenAt: 100, lastSeenOrder: 1 }
        ],
        {
          "/project/lynx": true
        }
      )
    );

    section.removeChild(lynxRow.row);
    t.captureRemovedProjectCandidates([lynxRow.row]);
    t.runOnce(ctx, "registry-remove");

    const state = t.getLocalState();
    expect(state.registry.entriesByHref["/project/lynx"]).toBeUndefined();
    expect(state.prefs.expandedByHref["/project/lynx"]).toBeUndefined();

    handle.dispose();
  });
});
