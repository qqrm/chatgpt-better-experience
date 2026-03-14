import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildWideChatStyleText } from "../src/application/wideChat";
import {
  WIDE_CHAT_CONTENT_CLASS,
  WIDE_CHAT_OVERLAP_TURN_CLASS,
  WIDE_CHAT_SHELF_CLASS
} from "../src/application/wideChatOverlap";
import { initWideChatFeature } from "../src/features/wideChat";
import { loadFixtureHtml, mountHtml } from "./helpers/fixture";
import { makeTestContext } from "./helpers/testContext";

const WIDE_CHAT_CONTENT_SELECTOR = 'main div[class*="max-w-(--thread-content-max-width)"]';
const FIXTURE_PATH = "tests/fixtures/chatgpt-fixture-2026-02-04-17-23-37.html";
const RECORDED_WIDTHS = [
  1752, 1751, 1687, 1628, 1535, 1348, 1266, 1183, 1180, 1246, 1688, 1828, 1505, 801, 802, 1202,
  1810, 1849
];

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    x: left,
    y: top,
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
    toJSON() {
      return {};
    }
  } as DOMRect;
}

function setWindowWidth(width: number) {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: width
  });
}

function installWideChatRectStub(mode: "share" | "model") {
  const baseContentEl = document.querySelector<HTMLElement>(WIDE_CHAT_CONTENT_SELECTOR);
  const shareButton = document.querySelector<HTMLButtonElement>('button[aria-label="Share"]');
  const modelButton =
    document.querySelector<HTMLButtonElement>('button[aria-label="Switch model"]') ?? null;
  const shareArticle =
    shareButton?.closest<HTMLElement>("article") ??
    modelButton?.closest<HTMLElement>("article") ??
    null;
  const shareHost =
    shareButton?.closest<HTMLElement>("div[class*='gap-y-4']") ??
    modelButton?.closest<HTMLElement>("div[class*='gap-y-4']") ??
    null;
  const shareContent = shareArticle?.querySelector<HTMLElement>(".markdown") ?? null;
  const modelHost = modelButton?.closest<HTMLElement>("div[class*='gap-y-4']") ?? null;

  if (!baseContentEl || !shareArticle || !shareContent || !modelButton || !modelHost) {
    throw new Error("Fixture no longer exposes the expected wide-chat overlap anchors.");
  }

  baseContentEl.style.maxWidth = "640px";

  const originalGetBoundingClientRect = Element.prototype.getBoundingClientRect;

  const shareContentRect = () => rect(220, 180, window.innerWidth >= 1600 ? 1180 : 760, 360);
  const shareShelfRect = () =>
    mode === "share" && shareHost
      ? window.innerWidth >= 1600
        ? rect(shareContentRect().right - 120, 190, 148, 34)
        : rect(shareContentRect().right + 24, 190, 148, 34)
      : rect(shareContentRect().right + 24, 190, 0, 0);
  const modelShelfRect = () =>
    mode === "model" && modelHost
      ? rect(shareContentRect().right - 188, 190, 152, 34)
      : rect(shareContentRect().right + 32, 190, 0, 0);

  Element.prototype.getBoundingClientRect = function getBoundingClientRectStubbed() {
    if (this === baseContentEl) return rect(220, 120, 640, 480);
    if (this === shareContent) return shareContentRect();
    if (this === shareHost || this === shareButton) return shareShelfRect();
    if (this === modelHost || this === modelButton) return modelShelfRect();
    return rect(0, 0, 0, 0);
  };

  return {
    shareArticle,
    shareHost,
    shareContent,
    modelButton,
    modelHost,
    restore: () => {
      Element.prototype.getBoundingClientRect = originalGetBoundingClientRect;
    }
  };
}

async function flushWideChat() {
  await vi.advanceTimersByTimeAsync(90);
  await Promise.resolve();
}

describe("wideChat", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mountHtml(loadFixtureHtml(FIXTURE_PATH));
    setWindowWidth(RECORDED_WIDTHS[0]);
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("builds wide-chat CSS for non-zero widths and disables cleanly at zero", () => {
    expect(
      buildWideChatStyleText({
        basePx: 640,
        wideChatWidth: 0,
        windowWidth: 1752
      })
    ).toBeNull();

    const cssText = buildWideChatStyleText({
      basePx: 640,
      wideChatWidth: 100,
      windowWidth: 1752
    });

    expect(cssText).toContain("--wide-chat-target-max-width");
    expect(cssText).toContain("qqrm-wide-chat-turn-overlap");
  });

  it("adds collision classes for overlapped controls, clears them on narrow widths, and reapplies them after the recorded resize sequence", async () => {
    const rectStub = installWideChatRectStub("share");
    const ctx = makeTestContext({ wideChatWidth: 100 });
    const handle = initWideChatFeature(ctx);
    await flushWideChat();

    expect(rectStub.shareArticle.classList.contains(WIDE_CHAT_OVERLAP_TURN_CLASS)).toBe(true);
    expect(rectStub.shareContent.classList.contains(WIDE_CHAT_CONTENT_CLASS)).toBe(true);
    expect(rectStub.shareHost?.classList.contains(WIDE_CHAT_SHELF_CLASS)).toBe(true);

    for (const width of RECORDED_WIDTHS.slice(1)) {
      setWindowWidth(width);
      window.dispatchEvent(new Event("resize"));
      await flushWideChat();

      if (width === 801) {
        expect(rectStub.shareArticle.classList.contains(WIDE_CHAT_OVERLAP_TURN_CLASS)).toBe(false);
      }
    }

    expect(rectStub.shareArticle.classList.contains(WIDE_CHAT_OVERLAP_TURN_CLASS)).toBe(true);

    const prevSettings = { ...ctx.settings };
    ctx.settings.wideChatWidth = 0;
    handle.onSettingsChange?.({ ...ctx.settings }, prevSettings);
    await flushWideChat();

    expect(rectStub.shareArticle.classList.contains(WIDE_CHAT_OVERLAP_TURN_CLASS)).toBe(false);

    handle.dispose();
    rectStub.restore();
  });

  it("still protects model controls when Share is hidden", async () => {
    for (const shareButton of Array.from(document.querySelectorAll('button[aria-label="Share"]'))) {
      shareButton.remove();
    }

    const rectStub = installWideChatRectStub("model");
    const ctx = makeTestContext({ wideChatWidth: 100, hideShareButton: true });
    const handle = initWideChatFeature(ctx);
    await flushWideChat();

    expect(rectStub.shareArticle.classList.contains(WIDE_CHAT_OVERLAP_TURN_CLASS)).toBe(true);
    expect(rectStub.shareContent.classList.contains(WIDE_CHAT_CONTENT_CLASS)).toBe(true);
    expect(rectStub.shareArticle.querySelector(`.${WIDE_CHAT_SHELF_CLASS}`)).toBeTruthy();

    handle.dispose();
    rectStub.restore();
  });
});
