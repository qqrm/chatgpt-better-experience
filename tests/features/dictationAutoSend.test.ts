import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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

const loadFixture = (name: string) => {
  const repoRoot = process.env.PWD ?? process.cwd();
  return readFileSync(resolve(repoRoot, "tests", "fixtures", name), "utf8");
};

const markVisible = (...elements: Array<Element | null>) => {
  for (const element of elements) {
    if (!element) continue;
    element.getBoundingClientRect = () => ({
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
  }
};

const setupComposerFixture = () => {
  const footer = document.createElement("div");
  footer.setAttribute("data-testid", "composer-footer-actions");

  const input = document.createElement("div");
  input.id = "prompt-textarea";
  input.setAttribute("contenteditable", "true");

  const sendBtn = document.createElement("button");
  sendBtn.setAttribute("data-testid", "send-button");

  const submitBtn = document.createElement("button");
  submitBtn.setAttribute("aria-label", "Done");
  submitBtn.setAttribute("data-testid", "dictation-submit");

  footer.appendChild(submitBtn);
  footer.appendChild(sendBtn);
  document.body.appendChild(input);
  document.body.appendChild(footer);

  markVisible(input, sendBtn, submitBtn, footer);

  return { footer, input, sendBtn, submitBtn };
};

afterEach(() => {
  document.body.innerHTML = "";
  vi.useRealTimers();
});

describe("dictation auto-send", () => {
  const { initDictationAutoSendFeature, shouldAutoSendFromSubmitClick } = dictationAutoSend;

  it("auto-sends only on SUBMIT -> NONE, not on transcribe complete", async () => {
    const ctx = createContext({ autoSend: true });
    const { input, sendBtn, submitBtn } = setupComposerFixture();
    const feature = initDictationAutoSendFeature(ctx);

    let sendClicked = 0;
    sendBtn.addEventListener("click", () => {
      sendClicked += 1;
      input.textContent = "";
    });

    window.postMessage({ source: "tm-dictation-transcribe", type: "complete", id: "t-1" }, "*");

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(sendClicked).toBe(0);

    await new Promise((resolve) => setTimeout(resolve, 2100));

    input.textContent = "Hello from dictation";
    await new Promise((resolve) => setTimeout(resolve, 0));
    submitBtn.remove();

    await new Promise((resolve) => setTimeout(resolve, 800));

    expect(sendClicked).toBe(1);
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

  it("auto-sends on SUBMIT -> NONE when input is non-empty", async () => {
    vi.useRealTimers();
    const ctx = createContext({ autoSend: true });
    const { input, sendBtn, submitBtn } = setupComposerFixture();
    const feature = initDictationAutoSendFeature(ctx);

    let sendClicked = 0;
    sendBtn.addEventListener("click", () => {
      sendClicked += 1;
      input.textContent = "";
    });

    input.textContent = "Hello from dictation";
    submitBtn.remove();

    await new Promise((resolve) => setTimeout(resolve, 800));

    expect(sendClicked).toBe(1);
    feature.dispose();
  });

  it("does not auto-send when auto-send is disabled", async () => {
    vi.useRealTimers();
    const ctx = createContext({ autoSend: false });
    const { input, sendBtn, submitBtn } = setupComposerFixture();
    const feature = initDictationAutoSendFeature(ctx);

    let sendClicked = false;
    sendBtn.addEventListener("click", () => {
      sendClicked = true;
    });

    input.textContent = "Hello from dictation";
    submitBtn.remove();

    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(sendClicked).toBe(false);
    feature.dispose();
  });

  it("skips auto-send when Shift is pressed during SUBMIT", async () => {
    vi.useRealTimers();
    const ctx = createContext({ autoSend: true });
    const { input, sendBtn, submitBtn } = setupComposerFixture();
    const feature = initDictationAutoSendFeature(ctx);

    let sendClicked = false;
    sendBtn.addEventListener("click", () => {
      sendClicked = true;
      input.textContent = "";
    });

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Shift", bubbles: true }));

    input.textContent = "Hello from dictation";
    submitBtn.remove();

    await new Promise((resolve) => setTimeout(resolve, 800));

    expect(sendClicked).toBe(false);
    feature.dispose();
  });

  it("Ctrl+Enter in SUBMIT clicks submit button and auto-sends via transition", async () => {
    vi.useRealTimers();
    const ctx = createContext({ autoSend: true });
    const { input, sendBtn, submitBtn } = setupComposerFixture();
    const feature = initDictationAutoSendFeature(ctx);

    let sendClicked = 0;
    let submitClicked = 0;
    sendBtn.addEventListener("click", () => {
      sendClicked += 1;
      input.textContent = "";
    });
    submitBtn.addEventListener("click", () => {
      submitClicked += 1;
      submitBtn.remove();
    });

    input.textContent = "Hello from dictation";

    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true })
    );

    await new Promise((resolve) => setTimeout(resolve, 800));

    expect(submitClicked).toBe(1);
    expect(sendClicked).toBe(1);
    feature.dispose();
  });

  it("prevents duplicate auto-send triggers on rapid SUBMIT -> NONE transitions", async () => {
    vi.useRealTimers();
    const ctx = createContext({ autoSend: true });
    const { input, sendBtn, submitBtn, footer } = setupComposerFixture();
    const feature = initDictationAutoSendFeature(ctx);

    let sendClicked = 0;
    sendBtn.addEventListener("click", () => {
      sendClicked += 1;
      input.textContent = "";
    });

    input.textContent = "First dictation";
    submitBtn.remove();

    await new Promise((resolve) => setTimeout(resolve, 900));

    const nextSubmit = document.createElement("button");
    nextSubmit.setAttribute("aria-label", "Done");
    footer.prepend(nextSubmit);
    markVisible(nextSubmit);
    input.textContent = "Second dictation";
    nextSubmit.remove();

    await new Promise((resolve) => setTimeout(resolve, 900));

    expect(sendClicked).toBe(1);
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

    const { input } = setupComposerFixture();
    input.focus();

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

    const { input } = setupComposerFixture();
    input.focus();

    feature.dispose();

    window.dispatchEvent(
      new KeyboardEvent("keydown", { code: "Space", ctrlKey: true, bubbles: true })
    );

    expect(clicked).toBe(false);
  });

  it("detects submit dictation state in Codex root fixture", () => {
    const ctx = createContext({ autoSend: true });
    const feature = initDictationAutoSendFeature(ctx);

    document.documentElement.innerHTML = loadFixture("codex-root.html");

    const dictationButton = document.querySelector('[data-testid="dictation-button"]');
    const submitButton = document.querySelector('[data-testid="codex-submit"]');
    const sendButton = document.querySelector('button[type="submit"]');

    markVisible(dictationButton, submitButton, sendButton);

    const state = (
      feature as {
        __test?: { getDictationUiState?: () => string; findSubmitDictationButton?: () => Element };
      }
    ).__test?.getDictationUiState?.();

    const foundSubmit = (
      feature as {
        __test?: { findSubmitDictationButton?: () => Element | null };
      }
    ).__test?.findSubmitDictationButton?.();

    expect(state).toBe("SUBMIT");
    expect(foundSubmit).toBe(submitButton);
    feature.dispose();
  });

  it("detects submit dictation state in Codex task fixture", () => {
    const ctx = createContext({ autoSend: true });
    const feature = initDictationAutoSendFeature(ctx);

    document.documentElement.innerHTML = loadFixture("codex-task.html");

    const dictationButton = document.querySelector('[data-testid="dictation-button"]');
    const submitButton = document.querySelector('[data-testid="codex-submit"]');
    const sendButton = document.querySelector('button[type="submit"]');

    markVisible(dictationButton, submitButton, sendButton);

    const state = (
      feature as {
        __test?: { getDictationUiState?: () => string; findSubmitDictationButton?: () => Element };
      }
    ).__test?.getDictationUiState?.();

    const foundSubmit = (
      feature as {
        __test?: { findSubmitDictationButton?: () => Element | null };
      }
    ).__test?.findSubmitDictationButton?.();

    expect(state).toBe("SUBMIT");
    expect(foundSubmit).toBe(submitButton);
    feature.dispose();
  });
});
