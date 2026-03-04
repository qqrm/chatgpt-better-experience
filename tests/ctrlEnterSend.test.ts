import { afterEach, describe, expect, it, vi } from "vitest";
import { initCtrlEnterSendFeature } from "../src/features/ctrlEnterSend";
import { makeTestContext } from "./helpers/testContext";

describe("ctrlEnterSend", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("inserts a newline on plain Enter even when default is already prevented", async () => {
    vi.useFakeTimers();

    document.body.innerHTML = `
      <form data-testid="composer">
        <div id="prompt-textarea" contenteditable="true">hello</div>
        <button id="composer-submit-button" data-testid="send-button" type="submit">Send</button>
      </form>
    `;

    let keydownHandler: ((e: KeyboardEvent) => void) | null = null;
    const addEventListenerSpy = vi.spyOn(window, "addEventListener");

    const handle = initCtrlEnterSendFeature(makeTestContext({ ctrlEnterSends: true }));

    for (const call of addEventListenerSpy.mock.calls) {
      if (call[0] === "keydown") {
        keydownHandler = call[1] as (e: KeyboardEvent) => void;
        break;
      }
    }
    expect(keydownHandler).not.toBeNull();

    const prompt = document.getElementById("prompt-textarea") as HTMLElement;
    prompt.focus();

    const range = document.createRange();
    range.selectNodeContents(prompt);
    range.collapse(false);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    const event = {
      key: "Enter",
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      altKey: false,
      isComposing: false,
      isTrusted: true,
      defaultPrevented: true,
      target: prompt,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      stopImmediatePropagation: vi.fn()
    } as unknown as KeyboardEvent;

    keydownHandler?.(event);
    await vi.runOnlyPendingTimersAsync();

    expect(prompt.innerHTML.toLowerCase()).toContain("<br");

    handle.dispose();
  });
});
