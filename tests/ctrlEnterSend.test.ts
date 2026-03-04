import { afterEach, describe, expect, it, vi } from "vitest";
import { initCtrlEnterSendFeature } from "../src/features/ctrlEnterSend";
import { makeTestContext } from "./helpers/testContext";

type CtrlEnterTestApi = {
  handleKeyDown?: (e: KeyboardEvent) => void;
};

const setCaretToEnd = (el: HTMLElement) => {
  el.focus();
  const sel = window.getSelection();
  if (!sel) throw new Error("missing selection");
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  sel.removeAllRanges();
  sel.addRange(range);
};

const markVisible = (el: HTMLElement) => {
  Object.defineProperty(el, "offsetParent", {
    configurable: true,
    get: () => document.body
  });
};

type FakeKeyDownOptions = {
  key: string;
  code?: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  repeat?: boolean;
  isComposing?: boolean;
  defaultPrevented?: boolean;
};

const makeFakeKeyDown = (target: HTMLElement, opts: FakeKeyDownOptions) => {
  let defaultPrevented = !!opts.defaultPrevented;
  const event = {
    key: opts.key,
    code: opts.code ?? opts.key,
    ctrlKey: !!opts.ctrlKey,
    metaKey: !!opts.metaKey,
    shiftKey: !!opts.shiftKey,
    altKey: !!opts.altKey,
    repeat: !!opts.repeat,
    isComposing: !!opts.isComposing,
    isTrusted: true,
    get defaultPrevented() {
      return defaultPrevented;
    },
    target,
    preventDefault: () => {
      defaultPrevented = true;
    },
    stopPropagation: vi.fn(),
    stopImmediatePropagation: vi.fn()
  };
  return event as unknown as KeyboardEvent;
};

describe("ctrlEnterSend", () => {
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("plain Enter inserts newline (contenteditable) even if defaultPrevented is already true", async () => {
    vi.useFakeTimers();

    document.body.innerHTML = `
      <footer>
        <form data-testid="composer">
          <div id="prompt-textarea" contenteditable="true" role="textbox" aria-multiline="true">hello</div>
          <button id="composer-submit-button" data-testid="send-button" type="submit" aria-label="Send">Send</button>
        </form>
      </footer>
    `;

    const sendCalls: string[] = [];
    const ctx = makeTestContext({ ctrlEnterSends: true });
    ctx.helpers.humanClick = (_el, why) => {
      sendCalls.push(why);
      return true;
    };

    const handle = initCtrlEnterSendFeature(ctx);
    const api = handle.__test as CtrlEnterTestApi;
    expect(api.handleKeyDown).toBeTypeOf("function");

    const composer = document.getElementById("prompt-textarea") as HTMLElement;
    const sendButton = document.getElementById("composer-submit-button") as HTMLElement;
    markVisible(composer);
    markVisible(sendButton);
    setCaretToEnd(composer);

    // Simulate ChatGPT (or another early handler) having already called preventDefault().
    const e = makeFakeKeyDown(composer, { key: "Enter", defaultPrevented: true });
    api.handleKeyDown?.(e);

    // handlePlainEnter uses setTimeout(0) for fallback insertion.
    await vi.runOnlyPendingTimersAsync();

    expect(composer.querySelector("br")).not.toBeNull();
    expect(sendCalls).not.toContain("send");

    handle.dispose();
  });

  it("Ctrl+Enter triggers send (via humanClick)", async () => {
    document.body.innerHTML = `
      <footer>
        <form data-testid="composer">
          <div id="prompt-textarea" contenteditable="true" role="textbox" aria-multiline="true">hello</div>
          <button id="composer-submit-button" data-testid="send-button" type="submit" aria-label="Send">Send</button>
        </form>
      </footer>
    `;

    const calls: string[] = [];
    const ctx = makeTestContext({ ctrlEnterSends: true });
    ctx.helpers.humanClick = (_el, why) => {
      calls.push(why);
      return true;
    };

    const handle = initCtrlEnterSendFeature(ctx);
    const api = handle.__test as CtrlEnterTestApi;
    expect(api.handleKeyDown).toBeTypeOf("function");

    const composer = document.getElementById("prompt-textarea") as HTMLElement;
    const sendButton = document.getElementById("composer-submit-button") as HTMLElement;
    markVisible(composer);
    markVisible(sendButton);
    setCaretToEnd(composer);

    const e = makeFakeKeyDown(composer, { key: "Enter", ctrlKey: true });
    api.handleKeyDown?.(e);

    expect(calls).toContain("send");

    handle.dispose();
  });
});
