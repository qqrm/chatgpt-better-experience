import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DomDelta, RootSnapshot } from "../src/application/domEventBus";
import type { FeatureContext } from "../src/application/featureContext";
import { initAutoExpandChatsFeature } from "../src/features/autoExpandChats";
import { makeTestContext } from "./helpers/testContext";

function setVisibleRect(el: Element, width = 300, height = 32): void {
  Object.defineProperty(el, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: width,
      bottom: height,
      width,
      height,
      toJSON: () => ({})
    })
  });
}

function mountSidebarShell(open = true): HTMLElement {
  const sidebar = document.createElement("div");
  sidebar.id = "stage-slideover-sidebar";
  setVisibleRect(sidebar, open ? 320 : 80, 800);
  document.body.appendChild(sidebar);
  return sidebar;
}

function mountOpenSidebarButton(onClick?: () => void): HTMLButtonElement {
  const tinyBar = document.createElement("div");
  tinyBar.id = "stage-sidebar-tiny-bar";
  const btn = document.createElement("button");
  btn.setAttribute("aria-label", "Open sidebar");
  btn.setAttribute("aria-controls", "stage-slideover-sidebar");
  setVisibleRect(btn, 24, 24);
  if (onClick) btn.addEventListener("click", onClick);
  tinyBar.appendChild(btn);
  document.body.appendChild(tinyBar);
  return btn;
}

function mountYourChatsToggle(sidebar: HTMLElement, ariaExpanded = "false"): HTMLButtonElement {
  const nav = document.createElement("nav");
  nav.setAttribute("aria-label", "Chat history");
  setVisibleRect(nav, 300, 700);

  const section = document.createElement("div");
  section.className = "group/sidebar-expando-section";
  const button = document.createElement("button");
  button.setAttribute("aria-expanded", ariaExpanded);
  button.textContent = "Your chats";
  setVisibleRect(button, 260, 28);
  section.appendChild(button);
  nav.appendChild(section);
  sidebar.appendChild(nav);

  return button;
}

function mountStandaloneChatHistoryNav(ariaExpanded = "false"): HTMLButtonElement {
  const nav = document.createElement("nav");
  nav.setAttribute("aria-label", "Chat history");
  setVisibleRect(nav, 300, 700);

  const section = document.createElement("div");
  section.className = "group/sidebar-expando-section";
  const button = document.createElement("button");
  button.setAttribute("aria-expanded", ariaExpanded);
  button.textContent = "Your chats";
  setVisibleRect(button, 260, 28);
  section.appendChild(button);
  nav.appendChild(section);
  document.body.appendChild(nav);

  return button;
}

function makeDomBusCtx(): FeatureContext & {
  emitRoots: (roots: RootSnapshot) => void;
  emitNavDelta: () => void;
} {
  const ctx = makeTestContext({ autoExpandChats: true });
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

describe("autoExpandChats", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = "";
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("late mount regression: retries and expands when Your chats mounts later", async () => {
    const ctx = makeDomBusCtx();
    const sidebar = mountSidebarShell(true);

    const handle = initAutoExpandChatsFeature(ctx);

    await vi.advanceTimersByTimeAsync(500);

    let clicks = 0;
    const toggle = mountYourChatsToggle(sidebar, "false");
    toggle.addEventListener("click", () => {
      clicks += 1;
      toggle.setAttribute("aria-expanded", "true");
    });

    ctx.emitNavDelta();
    await vi.advanceTimersByTimeAsync(500);

    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(clicks).toBe(1);

    handle.dispose();
  });

  it("already expanded is a no-op", async () => {
    const ctx = makeDomBusCtx();
    const sidebar = mountSidebarShell(true);
    const toggle = mountYourChatsToggle(sidebar, "true");

    let clicks = 0;
    toggle.addEventListener("click", () => {
      clicks += 1;
    });

    const handle = initAutoExpandChatsFeature(ctx);

    ctx.emitNavDelta();
    await vi.advanceTimersByTimeAsync(500);

    expect(clicks).toBe(0);

    handle.dispose();
  });

  it("one-shot: does not re-expand after goal reached on roots/mutations", async () => {
    const ctx = makeDomBusCtx();
    const sidebar = mountSidebarShell(true);

    let clicks = 0;
    const toggle = mountYourChatsToggle(sidebar, "false");
    toggle.addEventListener("click", () => {
      clicks += 1;
      toggle.setAttribute("aria-expanded", "true");
    });

    const handle = initAutoExpandChatsFeature(ctx);

    ctx.emitNavDelta();
    await vi.advanceTimersByTimeAsync(500);

    expect(clicks).toBe(1);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");

    // Simulate user collapsing again. One-shot behavior means we should not fight this.
    toggle.setAttribute("aria-expanded", "false");

    ctx.emitRoots({
      main: null,
      nav: document.querySelector('nav[aria-label="Chat history"]'),
      reason: "route"
    });
    ctx.emitNavDelta();
    await vi.advanceTimersByTimeAsync(500);

    expect(clicks).toBe(1);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");

    handle.dispose();
  });

  it("mutation-driven retry succeeds after initial miss", async () => {
    const ctx = makeDomBusCtx();
    const sidebar = mountSidebarShell(true);

    const handle = initAutoExpandChatsFeature(ctx);

    await vi.advanceTimersByTimeAsync(500);

    let clicks = 0;
    const toggle = mountYourChatsToggle(sidebar, "false");
    toggle.addEventListener("click", () => {
      clicks += 1;
      toggle.setAttribute("aria-expanded", "true");
    });

    ctx.emitNavDelta();
    await vi.advanceTimersByTimeAsync(500);

    expect(clicks).toBe(1);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");

    handle.dispose();
  });

  it("backs off during user interaction cooldown", async () => {
    const ctx = makeDomBusCtx();
    const sidebar = mountSidebarShell(true);
    const toggle = mountYourChatsToggle(sidebar, "false");

    let clicks = 0;
    toggle.addEventListener("click", () => {
      clicks += 1;
      toggle.setAttribute("aria-expanded", "true");
    });

    const handle = initAutoExpandChatsFeature(ctx);

    toggle.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    ctx.emitNavDelta();
    await vi.advanceTimersByTimeAsync(500);

    expect(clicks).toBe(1); // only manual click, no auto click during cooldown
    expect(toggle.getAttribute("aria-expanded")).toBe("true");

    handle.dispose();
  });

  it("confirms success by aria-expanded=true, not just click invocation", async () => {
    const ctx = makeDomBusCtx();
    const sidebar = mountSidebarShell(true);
    const toggle = mountYourChatsToggle(sidebar, "false");

    let clicks = 0;
    toggle.addEventListener("click", () => {
      clicks += 1;
      // intentionally do not update aria-expanded
    });

    const handle = initAutoExpandChatsFeature(ctx);

    ctx.emitNavDelta();
    await vi.advanceTimersByTimeAsync(500);

    expect(clicks).toBeGreaterThan(0);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");

    handle.dispose();
  });

  it("prefers visible nav path even if sidebar shell looks closed", async () => {
    const ctx = makeDomBusCtx();
    const sidebar = mountSidebarShell(false);

    let openClicks = 0;
    mountOpenSidebarButton(() => {
      openClicks += 1;
      setVisibleRect(sidebar, 320, 800);
    });

    const toggle = mountStandaloneChatHistoryNav("false");
    let chatsClicks = 0;
    toggle.addEventListener("click", () => {
      chatsClicks += 1;
      toggle.setAttribute("aria-expanded", "true");
    });

    const handle = initAutoExpandChatsFeature(ctx);

    ctx.emitNavDelta();
    await vi.advanceTimersByTimeAsync(500);

    expect(openClicks).toBe(0);
    expect(chatsClicks).toBe(1);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");

    handle.dispose();
  });

  it("falls back to live nav query when domBus nav root is stale", async () => {
    const ctx = makeDomBusCtx();
    const sidebar = mountSidebarShell(true);
    const staleNav = document.createElement("nav");
    staleNav.setAttribute("aria-label", "Chat history");
    setVisibleRect(staleNav, 300, 700);

    ctx.domBus = {
      ...ctx.domBus!,
      getNavRoot: () => staleNav
    };

    const toggle = mountYourChatsToggle(sidebar, "false");
    let clicks = 0;
    toggle.addEventListener("click", () => {
      clicks += 1;
      toggle.setAttribute("aria-expanded", "true");
    });

    const handle = initAutoExpandChatsFeature(ctx);

    ctx.emitNavDelta();
    await vi.advanceTimersByTimeAsync(500);

    expect(clicks).toBe(1);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");

    handle.dispose();
  });

  it("opens sidebar only when nav is unavailable, then expands chats", async () => {
    const ctx = makeDomBusCtx();
    const sidebar = mountSidebarShell(false);

    let openClicks = 0;
    let toggle: HTMLButtonElement | null = null;
    let clicks = 0;
    mountOpenSidebarButton(() => {
      openClicks += 1;
      setVisibleRect(sidebar, 320, 800);
      toggle = mountYourChatsToggle(sidebar, "false");
      toggle.addEventListener("click", () => {
        clicks += 1;
        toggle?.setAttribute("aria-expanded", "true");
      });
    });

    const handle = initAutoExpandChatsFeature(ctx);

    ctx.emitNavDelta();
    await vi.advanceTimersByTimeAsync(800);

    ctx.emitNavDelta();
    await vi.advanceTimersByTimeAsync(500);

    expect(openClicks).toBe(1);
    const liveToggle = document.querySelector<HTMLButtonElement>(
      'nav[aria-label="Chat history"] button[aria-expanded]'
    );
    expect(liveToggle).not.toBeNull();
    expect(liveToggle?.getAttribute("aria-expanded")).toBe("true");
    expect(clicks).toBe(1);

    handle.dispose();
  });
});
