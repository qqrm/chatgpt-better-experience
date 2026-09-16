import { describe, expect, it, vi } from "vitest";
import { createDomEventBus } from "../src/application/domEventBus";
import type { FeatureContext } from "../src/application/featureContext";
import { SETTINGS_DEFAULTS } from "../src/domain/settings";

function makeCtx(): FeatureContext {
  return {
    settings: SETTINGS_DEFAULTS,
    storagePort: {
      get: async <T extends Record<string, unknown>>(defaults: T): Promise<T> => defaults,
      set: async () => {},
      getLocal: async <T extends Record<string, unknown>>(defaults: T): Promise<T> => defaults,
      setLocal: async () => {}
    },
    domBus: null,
    logger: {
      isEnabled: false,
      debug: () => {},
      isTraceEnabled: () => false,
      trace: () => {},
      contractSnapshot: () => {}
    },
    keyState: { shift: false, ctrl: false, alt: false },
    helpers: {
      waitPresent: async () => null,
      waitGone: async () => true,
      humanClick: () => true,
      debounceScheduler: (fn: () => void, delayMs: number) => {
        let timeoutId: number | null = null;
        return {
          schedule: () => {
            if (timeoutId !== null) window.clearTimeout(timeoutId);
            timeoutId = window.setTimeout(() => {
              timeoutId = null;
              fn();
            }, delayMs);
          },
          cancel: () => {
            if (timeoutId !== null) window.clearTimeout(timeoutId);
            timeoutId = null;
          }
        };
      },
      createRafScheduler: (fn: () => void) => {
        let handle: number | null = null;
        const hasRaf = typeof window.requestAnimationFrame === "function";

        return {
          schedule: () => {
            if (handle !== null) return;
            handle = hasRaf
              ? window.requestAnimationFrame(() => {
                  handle = null;
                  fn();
                })
              : window.setTimeout(() => {
                  handle = null;
                  fn();
                }, 16);
          },
          cancel: () => {
            if (handle === null) return;
            if (hasRaf) {
              window.cancelAnimationFrame(handle);
            } else {
              window.clearTimeout(handle);
            }
            handle = null;
          }
        };
      },
      observe: (root: Element, cb: MutationCallback) => {
        const observer = new MutationObserver(cb);
        observer.observe(root, { childList: true, subtree: true });
        return { observer, disconnect: () => observer.disconnect() };
      },
      extractAddedElements: () => [],
      onPathChange: () => () => {},
      safeQuery: <T extends Element = Element>(sel: string, root: Document | Element = document) =>
        root.querySelector(sel) as T | null
    }
  };
}

describe("domEventBus root discovery", () => {
  it("emits touched mutation targets for main-channel updates", async () => {
    document.body.innerHTML = `
      <main role="main" id="main">
        <div id="message-content"></div>
      </main>
    `;

    const bus = createDomEventBus(makeCtx());
    const deltas: Array<{ touched: Element[] | undefined }> = [];

    const unsubscribe = bus.onDelta("main", (delta) => {
      if (delta.reason === "mutation") deltas.push({ touched: delta.touched });
    });

    const content = document.getElementById("message-content");
    const chunk = document.createElement("p");
    chunk.textContent = "reply";
    content?.appendChild(chunk);

    await new Promise((resolve) => window.setTimeout(resolve, 50));

    expect(deltas.some((delta) => delta.touched?.includes(content as Element))).toBe(true);

    unsubscribe();
  });

  it("discovers main root when ChatGPT renders a plain main without role", async () => {
    document.body.innerHTML = '<main id="main-no-role"></main>';

    const bus = createDomEventBus(makeCtx());
    const snapshots: Array<{ main: Element | null }> = [];

    const unsubscribe = bus.onRoots((roots) => {
      snapshots.push({ main: roots.main });
    });

    await new Promise((resolve) => window.setTimeout(resolve, 20));

    const main = document.getElementById("main-no-role");
    expect(snapshots.some((snap) => snap.main === main)).toBe(true);
    expect(bus.getMainRoot()).toBe(main);

    unsubscribe();
  });

  it("discovers nav root that appears after initial start", async () => {
    document.body.innerHTML = '<main role="main" id="main"></main>';

    const bus = createDomEventBus(makeCtx());
    const snapshots: Array<{ nav: Element | null }> = [];

    const unsubscribe = bus.onRoots((roots) => {
      snapshots.push({ nav: roots.nav });
    });

    const nav = document.createElement("nav");
    nav.setAttribute("aria-label", "Chat history");
    nav.id = "chat-nav";
    document.body.appendChild(nav);

    await new Promise((resolve) => window.setTimeout(resolve, 50));

    expect(snapshots.some((snap) => snap.nav === nav)).toBe(true);

    unsubscribe();
  });

  it("discovers nav root with localized aria-label", async () => {
    document.body.innerHTML = `
      <main role="main" id="main"></main>
      <nav aria-label="История чатов" id="chat-nav-localized"></nav>
    `;

    const bus = createDomEventBus(makeCtx());
    const snapshots: Array<{ nav: Element | null }> = [];

    const unsubscribe = bus.onRoots((roots) => {
      snapshots.push({ nav: roots.nav });
    });

    const nav = document.getElementById("chat-nav-localized");
    await new Promise((resolve) => window.setTimeout(resolve, 20));

    expect(snapshots.some((snap) => snap.nav === nav)).toBe(true);

    unsubscribe();
  });

  it("discovers a pinned-chat nav from its undefined options trigger", async () => {
    document.body.innerHTML = `
      <nav id="pinned-chat-nav">
        <a class="group __menu-item hoverable" href="/c/pinned-chat">
          <button data-testid="undefined-options" type="button"></button>
        </a>
      </nav>
    `;

    const bus = createDomEventBus(makeCtx());
    const snapshots: Array<{ nav: Element | null }> = [];
    const unsubscribe = bus.onRoots((roots) => {
      snapshots.push({ nav: roots.nav });
    });

    const nav = document.getElementById("pinned-chat-nav");
    await new Promise((resolve) => window.setTimeout(resolve, 20));

    expect(snapshots.some((snap) => snap.nav === nav)).toBe(true);

    unsubscribe();
  });

  it("keeps discovering nav roots via slow poll after the finder window expires", async () => {
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"]
    });

    try {
      document.body.innerHTML = '<main role="main" id="main"></main>';

      const bus = createDomEventBus(makeCtx());
      const snapshots: Array<{ nav: Element | null }> = [];
      const unsubscribe = bus.onRoots((roots) => {
        snapshots.push({ nav: roots.nav });
      });

      await vi.advanceTimersByTimeAsync(15_500);

      const nav = document.createElement("nav");
      nav.setAttribute("aria-label", "Chat history");
      nav.id = "late-nav";
      document.body.appendChild(nav);

      await vi.advanceTimersByTimeAsync(3_500);

      expect(snapshots.some((snap) => snap.nav === nav)).toBe(true);
      expect(bus.getNavRoot()).toBe(nav);

      unsubscribe();
    } finally {
      vi.useRealTimers();
    }
  });

  it("re-resolves missing roots on demand via ensureRoots", () => {
    document.body.innerHTML = '<main role="main" id="main"></main>';

    const bus = createDomEventBus(makeCtx());
    const snapshots: Array<{ nav: Element | null }> = [];
    const unsubscribe = bus.onRoots((roots) => {
      snapshots.push({ nav: roots.nav });
    });

    const nav = document.createElement("nav");
    nav.setAttribute("aria-label", "Chat history");
    nav.id = "on-demand-nav";
    document.body.appendChild(nav);

    bus.ensureRoots();

    expect(bus.getNavRoot()).toBe(nav);
    expect(snapshots.some((snap) => snap.nav === nav)).toBe(true);

    unsubscribe();
  });
});
