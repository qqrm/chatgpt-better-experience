import { afterEach, describe, expect, it, vi } from "vitest";
import { initDictationAutoSendFeature } from "../../src/features/dictationAutoSend";
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

describe("dictation auto-send", () => {
  it("does not auto-send on transcribe complete messages", async () => {
    const ctx = createContext({ autoSend: true });
    const feature = initDictationAutoSendFeature(ctx);

    let sendClicked = false;
    const sendBtn = document.createElement("button");
    sendBtn.setAttribute("data-testid", "send-button");
    sendBtn.addEventListener("click", () => {
      sendClicked = true;
    });
    document.body.appendChild(sendBtn);

    window.postMessage({ source: "tm-dictation-transcribe", type: "complete", id: "t-1" }, "*");

    await Promise.resolve();

    expect(sendClicked).toBe(false);
    feature.dispose();
  });

  it("auto-sends on submit dictation click", async () => {
    vi.useFakeTimers();
    const ctx = createContext({ autoSend: true });
    const feature = initDictationAutoSendFeature(ctx);

    const input = document.createElement("div");
    input.id = "prompt-textarea";
    input.setAttribute("contenteditable", "true");
    document.body.appendChild(input);

    let sendClicked = false;
    const sendBtn = document.createElement("button");
    sendBtn.setAttribute("data-testid", "send-button");
    sendBtn.addEventListener("click", () => {
      sendClicked = true;
      input.textContent = "";
    });
    document.body.appendChild(sendBtn);

    const submitBtn = document.createElement("button");
    submitBtn.setAttribute("aria-label", "Submit dictation");
    document.body.appendChild(submitBtn);

    submitBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    setTimeout(() => {
      input.textContent = "Hello from dictation";
    }, 50);

    await vi.advanceTimersByTimeAsync(1000);

    expect(sendClicked).toBe(true);
    feature.dispose();
  });

  it("skips auto-send when shift is held on submit", async () => {
    vi.useFakeTimers();
    const ctx = createContext({ autoSend: true });
    const feature = initDictationAutoSendFeature(ctx);

    const input = document.createElement("div");
    input.id = "prompt-textarea";
    input.setAttribute("contenteditable", "true");
    document.body.appendChild(input);

    let sendClicked = false;
    const sendBtn = document.createElement("button");
    sendBtn.setAttribute("data-testid", "send-button");
    sendBtn.addEventListener("click", () => {
      sendClicked = true;
      input.textContent = "";
    });
    document.body.appendChild(sendBtn);

    const submitBtn = document.createElement("button");
    submitBtn.setAttribute("aria-label", "Submit dictation");
    document.body.appendChild(submitBtn);

    submitBtn.dispatchEvent(new MouseEvent("click", { bubbles: true, shiftKey: true }));
    setTimeout(() => {
      input.textContent = "Hello from dictation";
    }, 50);

    await vi.advanceTimersByTimeAsync(1000);

    expect(sendClicked).toBe(false);
    feature.dispose();
  });

  it("does not auto-send on Ctrl+Space dictation toggle", () => {
    const ctx = createContext({ autoSend: true, startDictation: false });
    const feature = initDictationAutoSendFeature(ctx);

    let sendClicked = false;
    const sendBtn = document.createElement("button");
    sendBtn.setAttribute("data-testid", "send-button");
    sendBtn.addEventListener("click", () => {
      sendClicked = true;
    });
    document.body.appendChild(sendBtn);

    window.dispatchEvent(
      new KeyboardEvent("keydown", { code: "Space", ctrlKey: true, bubbles: true })
    );

    expect(sendClicked).toBe(false);
    feature.dispose();
  });
});
