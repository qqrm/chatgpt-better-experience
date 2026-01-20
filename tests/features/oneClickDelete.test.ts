import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildOneClickDeleteStyleText,
  initOneClickDeleteFeature
} from "../../src/features/oneClickDelete";
import { SETTINGS_DEFAULTS, Settings } from "../../src/domain/settings";
import { FeatureContext } from "../../src/application/featureContext";
import { StoragePort } from "../../src/domain/ports/storagePort";

const createContext = (overrides: Partial<Settings> = {}): FeatureContext => {
  const settings = { ...SETTINGS_DEFAULTS, ...overrides };
  const storagePort: StoragePort = {
    get: <T extends Record<string, unknown>>(defaults: T) => Promise.resolve(defaults),
    set: () => Promise.resolve()
  };

  return {
    settings,
    storagePort,
    logger: { isEnabled: false, debug: () => {} },
    keyState: { shift: false, ctrl: false, alt: false },
    helpers: {
      waitPresent: () => Promise.resolve(null),
      waitGone: () => Promise.resolve(true),
      humanClick: (el) => {
        if (!el) return false;
        el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        return true;
      },
      debounceScheduler: (fn, delayMs) => {
        let timeoutId: number | null = null;
        return {
          schedule: () => {
            if (timeoutId !== null) window.clearTimeout(timeoutId);
            timeoutId = window.setTimeout(fn, delayMs);
          },
          cancel: () => {
            if (timeoutId !== null) window.clearTimeout(timeoutId);
            timeoutId = null;
          }
        };
      },
      safeQuery: (sel, root = document) => root.querySelector(sel)
    }
  };
};

afterEach(() => {
  document.body.innerHTML = "";
  vi.useRealTimers();
});

describe("one-click delete styles", () => {
  it("targets only the options icon svg for absolute positioning", () => {
    const cssText = buildOneClickDeleteStyleText();
    const selector = 'button[data-testid^="history-item-"][data-testid$="-options"]';

    expect(cssText).toContain(`${selector} svg[data-qqrm-native-dots="1"]{`);
    expect(cssText).not.toContain(`${selector} > svg{`);
  });

  it("adds delete and archive buttons, then cleans up on dispose", () => {
    const ctx = createContext({ oneClickDelete: true });

    const row = document.createElement("div");
    row.className = "group __menu-item hoverable";
    const btn = document.createElement("button");
    btn.setAttribute("data-testid", "history-item-1-options");
    btn.innerHTML = `<svg></svg>`;
    row.appendChild(btn);
    document.body.appendChild(row);

    const feature = initOneClickDeleteFeature(ctx);

    expect(btn.querySelector('span[data-qqrm-oneclick-del-x="1"]')).not.toBeNull();
    expect(btn.querySelector('span[data-qqrm-oneclick-archive="1"]')).not.toBeNull();
    expect(btn.querySelector('svg[data-qqrm-native-dots="1"]')).not.toBeNull();
    expect(document.getElementById("cgptbe-silent-delete-style")).not.toBeNull();

    feature.dispose();

    expect(btn.querySelector('span[data-qqrm-oneclick-del-x="1"]')).toBeNull();
    expect(btn.querySelector('span[data-qqrm-oneclick-archive="1"]')).toBeNull();
    expect(btn.querySelector('svg[data-qqrm-native-dots="1"]')).toBeNull();
    expect(document.getElementById("cgptbe-silent-delete-style")).toBeNull();
  });

  it("shows and cancels pending overlay on delete click", () => {
    vi.useFakeTimers();
    const ctx = createContext({ oneClickDelete: true });

    const row = document.createElement("div");
    row.className = "group __menu-item hoverable";
    const btn = document.createElement("button");
    btn.setAttribute("data-testid", "history-item-1-options");
    btn.innerHTML = `<svg></svg>`;
    row.appendChild(btn);
    document.body.appendChild(row);

    const feature = initOneClickDeleteFeature(ctx);
    const x = btn.querySelector('span[data-qqrm-oneclick-del-x="1"]');
    const Pointer = window.PointerEvent ?? MouseEvent;
    x?.dispatchEvent(new Pointer("pointerdown", { bubbles: true }));

    const overlay = row.querySelector(".qqrm-oneclick-undo-overlay");
    expect(overlay).not.toBeNull();

    overlay?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(row.querySelector(".qqrm-oneclick-undo-overlay")).toBeNull();

    feature.dispose();
  });
});
