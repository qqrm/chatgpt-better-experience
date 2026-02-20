import { describe, expect, it } from "vitest";
import { createDomEventBus } from "../src/application/domEventBus";
import type { FeatureContext } from "../src/application/featureContext";
import { SETTINGS_DEFAULTS } from "../src/domain/settings";

function makeCtx(pathWatcher: { active: boolean }): FeatureContext {
  return {
    settings: SETTINGS_DEFAULTS,
    storagePort: {
      get: async <T extends Record<string, unknown>>(defaults: T): Promise<T> => defaults,
      set: async () => {}
    },
    domBus: null,
    logger: { isEnabled: false, debug: () => {} },
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
        let rafId: number | null = null;
        return {
          schedule: () => {
            if (rafId !== null) return;
            rafId = window.requestAnimationFrame(() => {
              rafId = null;
              fn();
            });
          },
          cancel: () => {
            if (rafId === null) return;
            window.cancelAnimationFrame(rafId);
            rafId = null;
          }
        };
      },
      observe: () => {
        throw new Error("not used");
      },
      extractAddedElements: () => [],
      onPathChange: () => {
        pathWatcher.active = true;
        return () => {
          pathWatcher.active = false;
        };
      },
      safeQuery: <T extends Element = Element>(sel: string, root: Document | Element = document) =>
        root.querySelector(sel) as T | null
    }
  };
}

describe("domEventBus lazy binding", () => {
  it("binds observers only when subscribed and disconnects after unsubscribe", () => {
    document.body.innerHTML = `
      <main><div>main</div></main>
      <nav aria-label="Chat history"><div>nav</div></nav>
    `;

    const OriginalObserver = globalThis.MutationObserver;
    let observeCalls = 0;
    let disconnectCalls = 0;

    class CountingObserver extends OriginalObserver {
      observe(target: Node, options?: MutationObserverInit): void {
        observeCalls += 1;
        super.observe(target, options);
      }
      disconnect(): void {
        disconnectCalls += 1;
        super.disconnect();
      }
    }

    globalThis.MutationObserver = CountingObserver;

    try {
      const pathWatcher = { active: false };
      const bus = createDomEventBus(makeCtx(pathWatcher));

      bus.start();
      expect(observeCalls).toBe(0);
      expect(pathWatcher.active).toBe(false);

      const unsub = bus.onDelta("nav", () => {});
      expect(observeCalls).toBeGreaterThan(0);
      expect(pathWatcher.active).toBe(true);

      unsub();
      expect(disconnectCalls).toBeGreaterThan(0);
      expect(pathWatcher.active).toBe(false);
    } finally {
      globalThis.MutationObserver = OriginalObserver;
    }
  });
});
