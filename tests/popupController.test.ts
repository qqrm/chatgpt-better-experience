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

  it("opens Trim chat DOM details on enable, stores a deadline, and restores it across popup reopen", async () => {
    const { data, storagePort } = makeMemoryStorage();
    const controller = await initPopupController({ storagePort, now: () => Date.now() });
    await flushUi();

    const trimToggle = document.getElementById("trimChatDom") as HTMLInputElement;
    const trimButton = document.getElementById("trimChatDomDetailsButton") as HTMLButtonElement;
    const trimDrawer = document.getElementById("trimChatDomDetails") as HTMLElement;

    trimToggle.checked = true;
    trimToggle.dispatchEvent(new Event("change", { bubbles: true }));
    await flushUi();

    const storedDeadline = data.popupTrimChatDomDetailsOpenUntil;
    expect(trimButton.hidden).toBe(false);
    expect(trimDrawer.hidden).toBe(false);
    expect(typeof storedDeadline).toBe("number");
    expect(storedDeadline).toBe(Date.now() + DRAWER_AUTO_CLOSE_MS);

    controller.dispose();

    mountPopupHtml();
    const reopened = await initPopupController({ storagePort, now: () => Date.now() });
    await flushUi();

    expect((document.getElementById("trimChatDomDetails") as HTMLElement).hidden).toBe(false);

    reopened.dispose();
  });

  it("collapses expired drawer deadlines on load", async () => {
    const expiredAt = Date.now() - 1_000;
    const { data, storagePort } = makeMemoryStorage({
      trimChatDom: true,
      popupTrimChatDomDetailsOpenUntil: expiredAt,
      popupWideChatDetailsOpenUntil: expiredAt
    });

    const controller = await initPopupController({ storagePort, now: () => Date.now() });
    await flushUi();

    expect((document.getElementById("trimChatDomDetails") as HTMLElement).hidden).toBe(true);
    expect((document.getElementById("wideChatDetails") as HTMLElement).hidden).toBe(true);
    expect(data.popupTrimChatDomDetailsOpenUntil).toBe(0);
    expect(data.popupWideChatDetailsOpenUntil).toBe(0);

    controller.dispose();
  });

  it("hides Trim chat DOM details and clears its deadline when disabled", async () => {
    const futureDeadline = Date.now() + DRAWER_AUTO_CLOSE_MS;
    const { data, storagePort } = makeMemoryStorage({
      trimChatDom: true,
      popupTrimChatDomDetailsOpenUntil: futureDeadline
    });

    const controller = await initPopupController({ storagePort, now: () => Date.now() });
    await flushUi();

    const trimToggle = document.getElementById("trimChatDom") as HTMLInputElement;
    const trimButton = document.getElementById("trimChatDomDetailsButton") as HTMLButtonElement;
    const trimDrawer = document.getElementById("trimChatDomDetails") as HTMLElement;

    expect(trimButton.hidden).toBe(false);
    expect(trimDrawer.hidden).toBe(false);

    trimToggle.checked = false;
    trimToggle.dispatchEvent(new Event("change", { bubbles: true }));
    await flushUi();

    expect(trimButton.hidden).toBe(true);
    expect(trimDrawer.hidden).toBe(true);
    expect(data.popupTrimChatDomDetailsOpenUntil).toBe(0);

    controller.dispose();
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
