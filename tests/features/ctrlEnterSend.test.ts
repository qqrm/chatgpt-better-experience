import { afterEach, describe, expect, it, vi } from "vitest";
import { initCtrlEnterSendFeature } from "../../src/features/ctrlEnterSend";
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
      humanClick: () => true,
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

describe("ctrl-enter send", () => {
  it("does not intercept when ctrl-enter sends is disabled", () => {
    const ctx = createContext({ ctrlEnterSends: false });
    const feature = initCtrlEnterSendFeature(ctx);

    const textarea = document.createElement("textarea");
    textarea.setAttribute("data-testid", "prompt-textarea");
    document.body.appendChild(textarea);
    textarea.focus();

    let sendClicked = false;
    const sendBtn = document.createElement("button");
    sendBtn.setAttribute("data-testid", "send-button");
    Object.defineProperty(sendBtn, "offsetParent", { value: document.body });
    sendBtn.addEventListener("click", () => {
      sendClicked = true;
    });
    document.body.appendChild(sendBtn);

    const ctrlEvent = new KeyboardEvent("keydown", {
      key: "Enter",
      ctrlKey: true,
      bubbles: true,
      cancelable: true
    });
    textarea.dispatchEvent(ctrlEvent);
    expect(ctrlEvent.defaultPrevented).toBe(false);
    expect(sendClicked).toBe(false);

    const enterEvent = new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true
    });
    textarea.dispatchEvent(enterEvent);
    expect(enterEvent.defaultPrevented).toBe(false);

    const shiftEvent = new KeyboardEvent("keydown", {
      key: "Enter",
      shiftKey: true,
      bubbles: true,
      cancelable: true
    });
    textarea.dispatchEvent(shiftEvent);
    expect(shiftEvent.defaultPrevented).toBe(false);

    feature.dispose();
  });

  it("sends with Ctrl+Enter in the composer", () => {
    vi.useFakeTimers();
    const ctx = createContext({ ctrlEnterSends: true });
    const feature = initCtrlEnterSendFeature(ctx);

    const textarea = document.createElement("textarea");
    textarea.setAttribute("data-testid", "prompt-textarea");
    document.body.appendChild(textarea);
    textarea.focus();

    let sendClicked = false;
    const sendBtn = document.createElement("button");
    sendBtn.setAttribute("data-testid", "send-button");
    Object.defineProperty(sendBtn, "offsetParent", { value: document.body });
    sendBtn.addEventListener("click", () => {
      sendClicked = true;
    });
    document.body.appendChild(sendBtn);

    textarea.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true })
    );

    expect(sendClicked).toBe(true);
    feature.dispose();
  });

  it("inserts newline on Enter without Ctrl", () => {
    vi.useFakeTimers();
    const ctx = createContext({ ctrlEnterSends: true });
    const feature = initCtrlEnterSendFeature(ctx);

    const textarea = document.createElement("textarea");
    textarea.setAttribute("data-testid", "prompt-textarea");
    textarea.value = "Hello";
    document.body.appendChild(textarea);
    textarea.focus();

    textarea.selectionStart = textarea.value.length;
    textarea.selectionEnd = textarea.value.length;

    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    expect(textarea.value).toBe("Hello\n");
    feature.dispose();
  });

  it("does not intercept Shift+Enter", () => {
    vi.useFakeTimers();
    const ctx = createContext({ ctrlEnterSends: true });
    const feature = initCtrlEnterSendFeature(ctx);

    const textarea = document.createElement("textarea");
    textarea.setAttribute("data-testid", "prompt-textarea");
    document.body.appendChild(textarea);
    textarea.focus();

    const shiftEvent = new KeyboardEvent("keydown", {
      key: "Enter",
      shiftKey: true,
      bubbles: true,
      cancelable: true
    });
    textarea.dispatchEvent(shiftEvent);

    expect(shiftEvent.defaultPrevented).toBe(false);
    feature.dispose();
  });

  it("applies edit with Ctrl+Enter in edit mode", () => {
    vi.useFakeTimers();
    const ctx = createContext({ ctrlEnterSends: true });
    const feature = initCtrlEnterSendFeature(ctx);

    let composerSendClicked = false;
    const composerSend = document.createElement("button");
    composerSend.setAttribute("data-testid", "send-button");
    Object.defineProperty(composerSend, "offsetParent", { value: document.body });
    composerSend.addEventListener("click", () => {
      composerSendClicked = true;
    });
    document.body.appendChild(composerSend);

    const container = document.createElement("div");
    container.setAttribute("data-message-author-role", "user");

    const form = document.createElement("form");
    const editTextarea = document.createElement("textarea");
    const saveBtn = document.createElement("div");
    saveBtn.setAttribute("role", "button");
    saveBtn.setAttribute("aria-label", "Apply");
    saveBtn.setAttribute("data-testid", "save-edit");
    saveBtn.textContent = "Apply";
    Object.defineProperty(saveBtn, "offsetParent", { value: document.body });

    let saveClicked = false;
    saveBtn.addEventListener("click", () => {
      saveClicked = true;
    });

    form.appendChild(editTextarea);
    form.appendChild(saveBtn);
    container.appendChild(form);
    document.body.appendChild(container);

    editTextarea.focus();
    editTextarea.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true })
    );

    expect(saveClicked).toBe(true);
    expect(composerSendClicked).toBe(false);
    feature.dispose();
  });

  it("ignores keydown events outside composer targets", () => {
    vi.useFakeTimers();
    const ctx = createContext({ ctrlEnterSends: true });
    const feature = initCtrlEnterSendFeature(ctx);

    let sendClicked = false;
    const sendBtn = document.createElement("button");
    sendBtn.setAttribute("data-testid", "send-button");
    Object.defineProperty(sendBtn, "offsetParent", { value: document.body });
    sendBtn.addEventListener("click", () => {
      sendClicked = true;
    });
    document.body.appendChild(sendBtn);

    const unrelated = document.createElement("div");
    document.body.appendChild(unrelated);

    unrelated.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true })
    );

    expect(sendClicked).toBe(false);
    feature.dispose();
  });

  it("sends when dictation submit button is visible", async () => {
    vi.useFakeTimers();
    const ctx = createContext({ ctrlEnterSends: true });
    const feature = initCtrlEnterSendFeature(ctx);

    const textarea = document.createElement("textarea");
    textarea.setAttribute("data-testid", "prompt-textarea");
    document.body.appendChild(textarea);
    textarea.focus();

    const submitBtn = document.createElement("div");
    submitBtn.setAttribute("role", "button");
    submitBtn.setAttribute("aria-label", "Submit dictation");
    Object.defineProperty(submitBtn, "offsetParent", { value: document.body });
    submitBtn.addEventListener("click", () => {
      setTimeout(() => {
        textarea.value = "Dictated text";
      }, 50);
    });
    document.body.appendChild(submitBtn);

    let sendClicked = false;
    const sendBtn = document.createElement("div");
    sendBtn.setAttribute("role", "button");
    sendBtn.setAttribute("data-testid", "send-button");
    Object.defineProperty(sendBtn, "offsetParent", { value: document.body });
    sendBtn.addEventListener("click", () => {
      sendClicked = true;
    });
    document.body.appendChild(sendBtn);

    textarea.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true })
    );

    await vi.advanceTimersByTimeAsync(2000);

    expect(sendClicked).toBe(true);
    feature.dispose();
  });

  it("finishes dictation when stop button is visible", async () => {
    vi.useFakeTimers();
    const ctx = createContext({ ctrlEnterSends: true });
    const feature = initCtrlEnterSendFeature(ctx);

    const textarea = document.createElement("textarea");
    textarea.setAttribute("data-testid", "prompt-textarea");
    document.body.appendChild(textarea);
    textarea.focus();

    let stopClicked = false;
    const stopBtn = document.createElement("div");
    stopBtn.setAttribute("role", "button");
    stopBtn.setAttribute("aria-label", "Stop dictation");
    Object.defineProperty(stopBtn, "offsetParent", { value: document.body });
    stopBtn.addEventListener("click", () => {
      stopClicked = true;
      setTimeout(() => {
        textarea.value = "Dictated text";
      }, 50);
    });
    document.body.appendChild(stopBtn);

    let submitClicked = false;
    const submitBtn = document.createElement("div");
    submitBtn.setAttribute("role", "button");
    submitBtn.setAttribute("aria-label", "Submit dictation");
    Object.defineProperty(submitBtn, "offsetParent", { value: null, configurable: true });
    submitBtn.addEventListener("click", () => {
      submitClicked = true;
    });
    document.body.appendChild(submitBtn);

    let sendClicked = false;
    const sendBtn = document.createElement("div");
    sendBtn.setAttribute("role", "button");
    sendBtn.setAttribute("data-testid", "send-button");
    Object.defineProperty(sendBtn, "offsetParent", { value: document.body });
    sendBtn.addEventListener("click", () => {
      sendClicked = true;
    });
    document.body.appendChild(sendBtn);

    stopBtn.addEventListener("click", () => {
      Object.defineProperty(submitBtn, "offsetParent", {
        value: document.body,
        configurable: true
      });
    });

    textarea.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true })
    );

    await vi.advanceTimersByTimeAsync(2000);

    expect(stopClicked).toBe(true);
    expect(submitClicked).toBe(true);
    expect(sendClicked).toBe(true);
    feature.dispose();
  });
});
