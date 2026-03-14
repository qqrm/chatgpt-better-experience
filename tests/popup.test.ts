import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AUTO_EXPAND_PROJECTS_PREFS_KEY,
  AUTO_EXPAND_PROJECTS_REGISTRY_KEY
} from "../src/domain/settings";

type StorageChangeListener = (
  changes: Record<string, { oldValue?: unknown; newValue?: unknown }>,
  areaName: string
) => void;

type MockExtension = {
  browser: {
    runtime: { lastError: null };
    storage: {
      sync: {
        get: (keys: Record<string, unknown>, cb: (values: Record<string, unknown>) => void) => void;
        set: (values: Record<string, unknown>, cb: () => void) => void;
      };
      local: {
        get: (keys: Record<string, unknown>, cb: (values: Record<string, unknown>) => void) => void;
        set: (values: Record<string, unknown>, cb: () => void) => void;
      };
      onChanged: {
        addListener: (cb: StorageChangeListener) => void;
      };
    };
  };
  syncData: Record<string, unknown>;
  localData: Record<string, unknown>;
};

const popupHtml = readFileSync(resolve("src/popup/popup.html"), "utf8");

function mountPopupHtml() {
  const head = /<head[^>]*>([\s\S]*?)<\/head>/i.exec(popupHtml)?.[1] ?? "";
  const body = /<body[^>]*>([\s\S]*?)<\/body>/i.exec(popupHtml)?.[1] ?? "";
  document.head.innerHTML = head;
  document.body.innerHTML = body;
}

function createMockExtension(
  syncData: Record<string, unknown> = {},
  localData: Record<string, unknown> = {}
): MockExtension {
  const syncStore = { ...syncData };
  const localStore = { ...localData };
  const listeners = new Set<StorageChangeListener>();

  const emit = (
    area: "sync" | "local",
    values: Record<string, unknown>,
    target: Record<string, unknown>
  ) => {
    const changes = Object.fromEntries(
      Object.entries(values).map(([key, value]) => [
        key,
        { oldValue: target[key], newValue: value }
      ])
    );
    Object.assign(target, values);
    for (const listener of listeners) listener(changes, area);
  };

  return {
    syncData: syncStore,
    localData: localStore,
    browser: {
      runtime: { lastError: null },
      storage: {
        sync: {
          get: (keys, cb) => cb({ ...keys, ...syncStore }),
          set: (values, cb) => {
            emit("sync", values, syncStore);
            cb();
          }
        },
        local: {
          get: (keys, cb) => cb({ ...keys, ...localStore }),
          set: (values, cb) => {
            emit("local", values, localStore);
            cb();
          }
        },
        onChanged: {
          addListener: (cb) => {
            listeners.add(cb);
          }
        }
      }
    }
  };
}

async function loadPopupModule() {
  vi.resetModules();
  await import("../src/popup/popup");
  await Promise.resolve();
  await vi.runOnlyPendingTimersAsync();
  await Promise.resolve();
}

describe("popup selective projects UI", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mountPopupHtml();
    window.matchMedia = vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn()
    }) as typeof window.matchMedia;
    window.requestAnimationFrame = ((cb: FrameRequestCallback) =>
      window.setTimeout(() => cb(performance.now()), 0)) as typeof window.requestAnimationFrame;
    window.cancelAnimationFrame = ((id: number) =>
      window.clearTimeout(id)) as typeof window.cancelAnimationFrame;
    delete window.__CBE_POPUP_PREVIEW__;
    delete (globalThis as typeof globalThis & { browser?: unknown }).browser;
    delete (globalThis as typeof globalThis & { chrome?: unknown }).chrome;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllTimers();
    vi.useRealTimers();
    delete window.__CBE_POPUP_PREVIEW__;
    delete (globalThis as typeof globalThis & { browser?: unknown }).browser;
    delete (globalThis as typeof globalThis & { chrome?: unknown }).chrome;
  });

  it("shows the renamed label, toggles the dropdown, and preserves prefs across disable/enable", async () => {
    const extension = createMockExtension(
      { autoExpandProjectItems: true },
      {
        [AUTO_EXPAND_PROJECTS_REGISTRY_KEY]: {
          version: 1,
          entriesByHref: {
            "/project/orion": {
              href: "/project/orion",
              title: "Orion",
              lastSeenAt: 300,
              lastSeenOrder: 0
            },
            "/project/lynx": {
              href: "/project/lynx",
              title: "Lynx",
              lastSeenAt: 300,
              lastSeenOrder: 1
            }
          }
        },
        [AUTO_EXPAND_PROJECTS_PREFS_KEY]: {
          version: 1,
          expandedByHref: {
            "/project/orion": true,
            "/project/lynx": false
          }
        }
      }
    );
    (globalThis as typeof globalThis & { browser?: unknown }).browser = extension.browser;

    await loadPopupModule();

    const label = document.querySelector<HTMLLabelElement>('label[for="autoExpandProjectItems"]');
    const reveal = document.getElementById("autoExpandProjectItemsReveal") as HTMLButtonElement;
    const dropdown = document.getElementById("autoExpandProjectItemsDropdown") as HTMLElement;
    const mainToggle = document.getElementById("autoExpandProjectItems") as HTMLInputElement;

    expect(label?.textContent?.trim()).toBe("Auto-expand projects");
    expect(reveal.hidden).toBe(false);
    expect(dropdown.hidden).toBe(true);

    reveal.click();
    expect(dropdown.hidden).toBe(false);

    const lynxToggle = dropdown.querySelector<HTMLInputElement>(
      'input[data-project-href="/project/lynx"]'
    );
    expect(lynxToggle?.checked).toBe(false);
    lynxToggle?.click();
    await Promise.resolve();

    mainToggle.checked = false;
    mainToggle.dispatchEvent(new Event("change", { bubbles: true }));
    expect(reveal.hidden).toBe(true);
    expect(dropdown.hidden).toBe(true);

    mainToggle.checked = true;
    mainToggle.dispatchEvent(new Event("change", { bubbles: true }));
    expect(reveal.hidden).toBe(false);
    expect(dropdown.hidden).toBe(true);

    reveal.click();
    const refreshedLynxToggle = dropdown.querySelector<HTMLInputElement>(
      'input[data-project-href="/project/lynx"]'
    );
    expect(refreshedLynxToggle?.checked).toBe(true);
    expect(
      (
        extension.localData[AUTO_EXPAND_PROJECTS_PREFS_KEY] as {
          expandedByHref: Record<string, boolean>;
        }
      ).expandedByHref["/project/lynx"]
    ).toBe(true);
  });

  it("auto-hides the dropdown after 5 minutes and resets the timer on interaction", async () => {
    const extension = createMockExtension(
      { autoExpandProjectItems: true },
      {
        [AUTO_EXPAND_PROJECTS_REGISTRY_KEY]: {
          version: 1,
          entriesByHref: {
            "/project/orion": {
              href: "/project/orion",
              title: "Orion",
              lastSeenAt: 300,
              lastSeenOrder: 0
            }
          }
        },
        [AUTO_EXPAND_PROJECTS_PREFS_KEY]: {
          version: 1,
          expandedByHref: {
            "/project/orion": true
          }
        }
      }
    );
    (globalThis as typeof globalThis & { browser?: unknown }).browser = extension.browser;

    await loadPopupModule();

    const reveal = document.getElementById("autoExpandProjectItemsReveal") as HTMLButtonElement;
    const dropdown = document.getElementById("autoExpandProjectItemsDropdown") as HTMLElement;

    reveal.click();
    expect(dropdown.hidden).toBe(false);

    await vi.advanceTimersByTimeAsync(4 * 60 * 1000);
    dropdown.dispatchEvent(new Event("wheel", { bubbles: true }));
    await vi.advanceTimersByTimeAsync(4 * 60 * 1000);
    expect(dropdown.hidden).toBe(false);

    await vi.advanceTimersByTimeAsync(60_001);
    expect(dropdown.hidden).toBe(true);
  });

  it("re-renders registry changes from storage without closing an already-open dropdown", async () => {
    const extension = createMockExtension(
      { autoExpandProjectItems: true },
      {
        [AUTO_EXPAND_PROJECTS_REGISTRY_KEY]: {
          version: 1,
          entriesByHref: {
            "/project/orion": {
              href: "/project/orion",
              title: "Orion",
              lastSeenAt: 200,
              lastSeenOrder: 0
            }
          }
        },
        [AUTO_EXPAND_PROJECTS_PREFS_KEY]: {
          version: 1,
          expandedByHref: {
            "/project/orion": true
          }
        }
      }
    );
    (globalThis as typeof globalThis & { browser?: unknown }).browser = extension.browser;

    await loadPopupModule();

    const reveal = document.getElementById("autoExpandProjectItemsReveal") as HTMLButtonElement;
    const dropdown = document.getElementById("autoExpandProjectItemsDropdown") as HTMLElement;
    reveal.click();
    expect(dropdown.hidden).toBe(false);

    extension.browser.storage.local.set(
      {
        [AUTO_EXPAND_PROJECTS_REGISTRY_KEY]: {
          version: 1,
          entriesByHref: {
            "/project/orion": {
              href: "/project/orion",
              title: "Orion",
              lastSeenAt: 250,
              lastSeenOrder: 0
            },
            "/project/capybara-lab": {
              href: "/project/capybara-lab",
              title: "Capybara Lab",
              lastSeenAt: 250,
              lastSeenOrder: 1
            }
          }
        },
        [AUTO_EXPAND_PROJECTS_PREFS_KEY]: {
          version: 1,
          expandedByHref: {
            "/project/orion": true,
            "/project/capybara-lab": false
          }
        }
      },
      () => {}
    );
    await Promise.resolve();

    expect(dropdown.hidden).toBe(false);
    expect(dropdown.textContent).toContain("Capybara Lab");
  });

  it("uses the preview hook to render the sidebar tab with the dropdown open", async () => {
    window.__CBE_POPUP_PREVIEW__ = {
      settings: { autoExpandProjectItems: true },
      popupActiveTab: "sidebar",
      forceAutoExpandProjectsDropdownOpen: true,
      registry: {
        version: 1,
        entriesByHref: {
          "/project/orion": {
            href: "/project/orion",
            title: "Orion",
            lastSeenAt: 500,
            lastSeenOrder: 0
          },
          "/project/quasar": {
            href: "/project/quasar",
            title: "Quasar",
            lastSeenAt: 500,
            lastSeenOrder: 1
          },
          "/project/lynx": {
            href: "/project/lynx",
            title: "Lynx",
            lastSeenAt: 500,
            lastSeenOrder: 2
          },
          "/project/otter": {
            href: "/project/otter",
            title: "Otter",
            lastSeenAt: 500,
            lastSeenOrder: 3
          },
          "/project/capybara-lab": {
            href: "/project/capybara-lab",
            title: "Capybara Lab",
            lastSeenAt: 500,
            lastSeenOrder: 4
          }
        }
      },
      prefs: {
        version: 1,
        expandedByHref: {
          "/project/orion": true,
          "/project/quasar": false,
          "/project/lynx": true,
          "/project/otter": false,
          "/project/capybara-lab": true
        }
      }
    };

    await loadPopupModule();

    const sidebarPanel = document.getElementById("panel-sidebar") as HTMLElement;
    const dropdown = document.getElementById("autoExpandProjectItemsDropdown") as HTMLElement;

    expect(sidebarPanel.classList.contains("isActive")).toBe(true);
    expect(dropdown.hidden).toBe(false);
    expect(dropdown.textContent).toContain("Orion");
    expect(dropdown.textContent).toContain("Capybara Lab");
  });
});
