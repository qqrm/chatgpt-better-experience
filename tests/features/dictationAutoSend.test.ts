import { afterEach, describe, expect, it, vi } from "vitest";
import * as dictationAutoSend from "../../src/features/dictationAutoSend";
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
  const { initDictationAutoSendFeature, shouldAutoSendFromSubmitClick } = dictationAutoSend;

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

  it("does not auto-send on untrusted submit dictation click", async () => {
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

  it("auto-sends when submit click flow runs", async () => {
    vi.useRealTimers();
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

    setTimeout(() => {
      input.textContent = "Hello from dictation";
    }, 50);

    await (
      feature as {
        __test?: {
          runAutoSendFlow?: (
            snapshotOverride?: string,
            initialShiftHeld?: boolean
          ) => Promise<void>;
        };
      }
    ).__test?.runAutoSendFlow?.();

    await new Promise((resolve) => setTimeout(resolve, 800));

    expect(sendClicked).toBe(true);
    feature.dispose();
  });

  it("does not auto-send when auto-send is disabled", async () => {
    vi.useRealTimers();
    const ctx = createContext({ autoSend: false });
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
    });
    document.body.appendChild(sendBtn);

    setTimeout(() => {
      input.textContent = "Hello from dictation";
    }, 50);

    await (
      feature as {
        __test?: {
          runAutoSendFlow?: (
            snapshotOverride?: string,
            initialShiftHeld?: boolean
          ) => Promise<void>;
        };
      }
    ).__test?.runAutoSendFlow?.();

    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(sendClicked).toBe(false);
    feature.dispose();
  });

  it("skips auto-send when Shift was held at submit click time", async () => {
    vi.useRealTimers();
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

    setTimeout(() => {
      input.textContent = "Hello from dictation";
    }, 50);

    await (
      feature as {
        __test?: {
          runAutoSendFlow?: (
            snapshotOverride?: string,
            initialShiftHeld?: boolean
          ) => Promise<void>;
        };
      }
    ).__test?.runAutoSendFlow?.(undefined, true);

    await new Promise((resolve) => setTimeout(resolve, 800));

    expect(sendClicked).toBe(false);
    feature.dispose();
  });

  it("skips auto-send when Shift is pressed during stabilization after submit", async () => {
    vi.useRealTimers();
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

    setTimeout(() => {
      input.textContent = "Hello from dictation";
    }, 50);

    setTimeout(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Shift", bubbles: true }));
    }, 20);

    await (
      feature as {
        __test?: {
          runAutoSendFlow?: (
            snapshotOverride?: string,
            initialShiftHeld?: boolean
          ) => Promise<void>;
        };
      }
    ).__test?.runAutoSendFlow?.();

    await new Promise((resolve) => setTimeout(resolve, 800));

    expect(sendClicked).toBe(false);
    feature.dispose();
  });

  it("shouldAutoSendFromSubmitClick checks trusted mouse clicks", () => {
    expect(shouldAutoSendFromSubmitClick({ isTrusted: true, detail: 1 })).toBe(true);
    expect(shouldAutoSendFromSubmitClick({ isTrusted: false, detail: 1 })).toBe(false);
    expect(shouldAutoSendFromSubmitClick({ isTrusted: true, detail: 0 })).toBe(false);
  });

  it("triggers submit via hotkey when submit button is visible", () => {
    vi.useFakeTimers();
    const ctx = createContext({ autoSend: true, startDictation: true });
    let clicked = false;
    ctx.helpers.humanClick = () => {
      clicked = true;
      return true;
    };
    const feature = initDictationAutoSendFeature(ctx);

    const input = document.createElement("div");
    input.id = "prompt-textarea";
    input.setAttribute("contenteditable", "true");
    input.getBoundingClientRect = () => ({
      width: 10,
      height: 10,
      top: 0,
      left: 0,
      right: 10,
      bottom: 10,
      x: 0,
      y: 0,
      toJSON: () => ""
    });
    document.body.appendChild(input);
    input.focus();

    const submitBtn = document.createElement("button");
    submitBtn.setAttribute("aria-label", "Submit dictation");
    submitBtn.getBoundingClientRect = () => ({
      width: 10,
      height: 10,
      top: 0,
      left: 0,
      right: 10,
      bottom: 10,
      x: 0,
      y: 0,
      toJSON: () => ""
    });
    document.body.appendChild(submitBtn);

    const nowSpy = vi.spyOn(performance, "now").mockReturnValue(1000);

    window.dispatchEvent(
      new KeyboardEvent("keydown", { code: "Space", ctrlKey: true, bubbles: true })
    );

    nowSpy.mockRestore();

    expect(clicked).toBe(true);
    feature.dispose();
  });

  it("removes listeners on dispose", () => {
    vi.useFakeTimers();
    const ctx = createContext({ autoSend: true, startDictation: true });
    let clicked = false;
    ctx.helpers.humanClick = () => {
      clicked = true;
      return true;
    };
    const feature = initDictationAutoSendFeature(ctx);

    const input = document.createElement("div");
    input.id = "prompt-textarea";
    input.setAttribute("contenteditable", "true");
    input.getBoundingClientRect = () => ({
      width: 10,
      height: 10,
      top: 0,
      left: 0,
      right: 10,
      bottom: 10,
      x: 0,
      y: 0,
      toJSON: () => ""
    });
    document.body.appendChild(input);
    input.focus();

    const submitBtn = document.createElement("button");
    submitBtn.setAttribute("aria-label", "Submit dictation");
    submitBtn.getBoundingClientRect = () => ({
      width: 10,
      height: 10,
      top: 0,
      left: 0,
      right: 10,
      bottom: 10,
      x: 0,
      y: 0,
      toJSON: () => ""
    });
    document.body.appendChild(submitBtn);

    feature.dispose();

    window.dispatchEvent(
      new KeyboardEvent("keydown", { code: "Space", ctrlKey: true, bubbles: true })
    );

    expect(clicked).toBe(false);
  });
});
