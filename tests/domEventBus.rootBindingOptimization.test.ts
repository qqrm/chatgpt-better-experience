import { describe, expect, it } from "vitest";
import { createDomEventBus } from "../src/application/domEventBus";
import type { FeatureContext } from "../src/application/featureContext";
import { SETTINGS_DEFAULTS } from "../src/domain/settings";

type PathWatcher = {
  active: boolean;
  hookCalls: number;
};

function makeCtx(pathWatcher: PathWatcher) {
  return {
    settings: SETTINGS_DEFAULTS,
    domBus: null,
    keyState: { shift: false, ctrl: false, alt: false },
    storagePort: {
      get: async <T extends Record<string, unknown>>(defaults: T): Promise<T> => defaults,
      set: async () => {},
      onSettingsChange: () => () => {}
    },
    logger: {
      isEnabled: false,
      debug: () => {}
    },
    helpers: {
      waitPresent: async () => null,
      waitGone: async () => true,
      humanClick: () => true,
      safeQuery: (selector: string) => (document.querySelector(selector) as Element | null) ?? null,

      onPathChange: (_cb: (path: string) => void) => {
        pathWatcher.active = true;
        pathWatcher.hookCalls += 1;
        // no-op in this test; just return unsubscribe
        return () => {
          pathWatcher.active = false;
        };
      },

      createRafScheduler: (cb: () => void) => {
        let rafId: number | null = null;
        const schedule = () => {
          if (rafId !== null) return;
          rafId = requestAnimationFrame(() => {
            rafId = null;
            cb();
          });
        };
        const cancel = () => {
          if (rafId === null) return;
          cancelAnimationFrame(rafId);
          rafId = null;
        };
        return { schedule, cancel };
      },

      debounceScheduler: (cb: () => void, delayMs: number) => {
        let id: number | null = null;
        const schedule = () => {
          if (id !== null) window.clearTimeout(id);
          id = window.setTimeout(() => {
            id = null;
            cb();
          }, delayMs);
        };
        const cancel = () => {
          if (id === null) return;
          window.clearTimeout(id);
          id = null;
        };
        return { schedule, cancel };
      },

      extractAddedElements: (records: MutationRecord[]) => {
        const out: Element[] = [];
        for (const record of records) {
          if (record.type !== "childList") continue;
          for (const node of Array.from(record.addedNodes)) {
            if (node.nodeType === Node.ELEMENT_NODE) out.push(node as Element);
          }
        }
        return out;
      },

      observe: (root: Element, cb: (records: MutationRecord[]) => void) => {
        const obs = new MutationObserver(cb);
        obs.observe(root, { childList: true, subtree: true });
        return { observer: obs, disconnect: () => obs.disconnect() };
      }
    }
  } as unknown as FeatureContext;
}

describe("domEventBus root binding optimization", () => {
  it("keeps main root null for nav-only delta subscribers until roots are requested", () => {
    document.body.innerHTML =
      '<main role="main" id="m"></main><nav aria-label="Chat history" id="n"></nav>';

    const pathWatcher: PathWatcher = { active: false, hookCalls: 0 };
    const ctx = makeCtx(pathWatcher);
    const bus = createDomEventBus(ctx);

    const unsubNav = bus.onDelta("nav", () => {});

    // With nav-only delta subscribers and no root subscribers, main should not be bound.
    expect(bus.getNavRoot()?.id).toBe("n");
    expect(bus.getMainRoot()).toBe(null);

    let calls = 0;
    let snap: { nav: Element | null; main: Element | null } | null = null;

    const unsubRoots = bus.onRoots((r) => {
      calls += 1;
      snap = r;
    });

    // Adding the first root subscriber should trigger an immediate rebind and callback.
    expect(calls).toBe(1);
    expect(snap).not.toBeNull();
    expect(snap!.nav?.id).toBe("n");
    expect(snap!.main?.id).toBe("m");
    expect(bus.getMainRoot()?.id).toBe("m");

    unsubRoots();
    unsubNav();
  });

  it("starts from idle via onRoots and stops when unsubscribed", () => {
    document.body.innerHTML =
      '<main role="main" id="m"></main><nav aria-label="Chat history" id="n"></nav>';

    const pathWatcher: PathWatcher = { active: false, hookCalls: 0 };
    const ctx = makeCtx(pathWatcher);
    const bus = createDomEventBus(ctx);

    let calls = 0;
    const unsubRoots = bus.onRoots(() => {
      calls += 1;
    });

    expect(calls).toBe(1);
    expect(pathWatcher.active).toBe(true);

    unsubRoots();
    expect(pathWatcher.active).toBe(false);
  });
});
