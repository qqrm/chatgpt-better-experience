import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import type { StoragePort } from "../src/domain/ports/storagePort";
import { initPopupController } from "../src/popup/popupController";

const DRAWER_AUTO_CLOSE_MS = 5 * 60 * 1000;
const popupHtml = readFileSync(resolve(process.cwd(), "src/popup/popup.html"), "utf8");
const popupBodyHtml = popupHtml.match(/<body>([\s\S]*)<\/body>/i)?.[1] ?? "";

function makeMemoryStorage(initial: Record<string, unknown> = {}) {
  const data = { ...initial };
  const storagePort: StoragePort = {
    get: async <T extends Record<string, unknown>>(defaults: T) => ({
      ...defaults,
      ...(data as Partial<T>)
    }),
    getLocal: async <T extends Record<string, unknown>>(defaults: T) => ({
      ...defaults,
      ...(data as Partial<T>)
    }),
    set: async (values) => {
      Object.assign(data, values);
    },
    setLocal: async (values) => {
      Object.assign(data, values);
    }
  };

  return { data, storagePort };
}

function mountPopupHtml() {
  document.body.innerHTML = popupBodyHtml;
}

async function flushUi() {
  await Promise.resolve();
  await vi.advanceTimersByTimeAsync(0);
}

describe("popupController drawer UX", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-14T18:00:00.000Z"));
    mountPopupHtml();

    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn()
      }))
    });

    Object.defineProperty(window, "requestAnimationFrame", {
      configurable: true,
      writable: true,
      value: (callback: FrameRequestCallback) => window.setTimeout(() => callback(0), 0)
    });

    Object.defineProperty(window, "cancelAnimationFrame", {
      configurable: true,
      writable: true,
      value: (handle: number) => window.clearTimeout(handle)
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("opens Chat width details via the reveal button and does not render percentage text", async () => {
    const { data, storagePort } = makeMemoryStorage();
    const controller = await initPopupController({ storagePort, now: () => Date.now() });
    await flushUi();

    const widthButton = document.getElementById("wideChatDetailsButton") as HTMLButtonElement;
    const widthDrawer = document.getElementById("wideChatDetails") as HTMLElement;

    expect(document.getElementById("wideChatWidthValue")).toBeNull();
    expect(document.body.textContent).not.toContain("95% of the viewport");

    widthButton.click();
    await flushUi();

    expect(widthDrawer.hidden).toBe(false);
    expect(data.popupWideChatDetailsOpenUntil).toBe(Date.now() + DRAWER_AUTO_CLOSE_MS);

    controller.dispose();
  });
});
