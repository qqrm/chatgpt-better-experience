import { afterEach, describe, expect, it, vi } from "vitest";
import { initEditLastMessageFeature } from "../../src/features/editLastMessage";
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

describe("edit last message", () => {
  it("opens edit mode on ArrowUp when composer is empty", async () => {
    vi.useFakeTimers();
    const ctx = createContext({ editLastMessageOnArrowUp: true });
    const feature = initEditLastMessageFeature(ctx);

    const composer = document.createElement("textarea");
    composer.setAttribute("data-testid", "prompt-textarea");
    document.body.appendChild(composer);
    composer.focus();

    const message = document.createElement("div");
    message.setAttribute("data-message-author-role", "user");
    message.getBoundingClientRect = () => ({ width: 10, height: 10 }) as DOMRect;
    const scrollSpy = vi.fn();
    message.scrollIntoView = scrollSpy;

    const editBtn = document.createElement("button");
    editBtn.setAttribute("aria-label", "Edit message");
    editBtn.addEventListener("click", () => {
      setTimeout(() => {
        const editInput = document.createElement("textarea");
        editInput.value = "Edited text";
        editInput.getBoundingClientRect = () => ({ width: 10, height: 10 }) as DOMRect;
        message.appendChild(editInput);
      }, 100);
    });

    message.appendChild(editBtn);
    document.body.appendChild(message);

    composer.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true, cancelable: true })
    );

    await vi.advanceTimersByTimeAsync(500);

    const editInput = message.querySelector("textarea") as HTMLTextAreaElement;
    expect(editInput).toBeTruthy();
    expect(document.activeElement).toBe(editInput);
    expect(editInput.selectionStart).toBe(editInput.value.length);
    expect(editInput.selectionEnd).toBe(editInput.value.length);
    expect(scrollSpy).toHaveBeenCalled();

    feature.dispose();
  });

  it("does not intercept ArrowUp when composer has text", () => {
    const ctx = createContext({ editLastMessageOnArrowUp: true });
    const feature = initEditLastMessageFeature(ctx);

    const composer = document.createElement("textarea");
    composer.setAttribute("data-testid", "prompt-textarea");
    composer.value = "Hello";
    document.body.appendChild(composer);
    composer.focus();

    let clicked = false;
    const message = document.createElement("div");
    message.setAttribute("data-message-author-role", "user");
    message.getBoundingClientRect = () => ({ width: 10, height: 10 }) as DOMRect;
    const editBtn = document.createElement("button");
    editBtn.setAttribute("aria-label", "Edit message");
    editBtn.addEventListener("click", () => {
      clicked = true;
    });
    message.appendChild(editBtn);
    document.body.appendChild(message);

    const event = new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true, cancelable: true });
    composer.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    expect(clicked).toBe(false);

    feature.dispose();
  });
});
